# Glass — backend setup

Everything the app needs that can't live in the repo. Run the SQL in the Supabase SQL
editor, then set the dashboard options listed at the bottom.

The client is never trusted. Row level security decides what a request may touch, the
triggers below decide how much of it there can be, and the buckets decide what may be
uploaded — none of which the browser can talk its way past.

---

## 1. Core table (already applied)

For reference, this is what should already exist:

```sql
create table public.user_state (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  products     jsonb not null default '[]'::jsonb,
  logs         jsonb not null default '{}'::jsonb,
  photo_index  jsonb not null default '{}'::jsonb,
  meta         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

alter table public.user_state enable row level security;

create policy "own row" on public.user_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

---

## 2. Size limits on the document row

Without this one account can put an arbitrary amount of JSON in the shared database.
The app's own writes are tiny — a year of logs is around 110 KB — so 5 MB is far beyond
any honest use while still being a real ceiling.

```sql
create or replace function public.enforce_user_state_size()
returns trigger language plpgsql as $$
declare
  row_bytes int;
begin
  row_bytes :=
      coalesce(pg_column_size(new.products), 0)
    + coalesce(pg_column_size(new.logs), 0)
    + coalesce(pg_column_size(new.photo_index), 0)
    + coalesce(pg_column_size(new.meta), 0);

  if row_bytes > 5 * 1024 * 1024 then
    raise exception 'user_state row too large (% bytes, limit 5MB)', row_bytes
      using errcode = 'check_violation';
  end if;

  if length(coalesce(new.display_name, '')) > 60 then
    raise exception 'display_name too long' using errcode = 'check_violation';
  end if;

  -- The client sets user_id from its own session, but never rely on that.
  if new.user_id <> auth.uid() then
    raise exception 'user_id must match the authenticated user' using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists user_state_size on public.user_state;
create trigger user_state_size
  before insert or update on public.user_state
  for each row execute function public.enforce_user_state_size();
```

Note the `auth.uid()` check is deliberately redundant with RLS. Defence in depth: if a
policy is ever loosened by accident, the trigger still refuses to write one user's data
into another user's row.

---

## 3. Per-account photo quota

Storage RLS already stops anyone reading or writing another person's folder. This stops
one account filling the shared free tier. 200 MB is roughly 2,000 progress photos at the
size the app produces.

```sql
create or replace function public.enforce_photo_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner_folder text;
  used bigint;
  limit_bytes constant bigint := 200 * 1024 * 1024;
begin
  if new.bucket_id not in ('progress-photos', 'avatars') then
    return new;
  end if;

  owner_folder := split_part(new.name, '/', 1);
  if owner_folder <> auth.uid()::text then
    raise exception 'cannot write outside your own folder' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum((o.metadata->>'size')::bigint), 0) into used
  from storage.objects o
  where o.bucket_id = new.bucket_id
    and split_part(o.name, '/', 1) = owner_folder
    and o.id <> new.id;

  if used + coalesce((new.metadata->>'size')::bigint, 0) > limit_bytes then
    raise exception 'storage quota exceeded' using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists photo_quota on storage.objects;
create trigger photo_quota
  before insert or update on storage.objects
  for each row execute function public.enforce_photo_quota();
```

---

## 4. Avatars bucket

In the dashboard: **Storage → New bucket**

- Name: `avatars`
- **Private** (leave "Public bucket" off)
- Restrict file size: **2 MB**
- Restrict MIME types: `image/jpeg`

Then its policies:

```sql
create policy "own avatar - select" on storage.objects
  for select using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own avatar - insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own avatar - update" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own avatar - delete" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
```

The app also re-encodes every upload to a 512px JPEG before it leaves the browser, so
whatever was actually selected — an SVG, a renamed executable, a 40 MP photo — is
discarded rather than stored. The bucket limits are what stop someone bypassing the app
and posting directly to the API.

---

## 5. Auth settings (dashboard, not SQL)

**Google is the only way in.** The email six-digit-code door was removed from the app.

**Authentication → Providers → Email — turn it off.** Removing the button removed it from
the *interface*; the provider itself stays live at the API until it's disabled here, so
anyone who knows the project URL could still request a code and get a session. Turning it
off is what actually closes the door. No SMTP is needed, and nothing else has to change.

**Authentication → Rate limits** — defaults are fine. With email disabled the only limit
that matters is token refreshes.

**Authentication → URL Configuration**
- Site URL: `https://skinmaxxing.netlify.app`
- Redirect URLs also include `http://localhost:5173/**`

---

## 6. What lives where

| Data | Local | Cloud | Scope |
|---|---|---|---|
| products, logs, photo_index | localStorage (small JSON) | `user_state` jsonb | per account; guest is device-only |
| progress photo blobs | IndexedDB | `progress-photos/<uid>/…` | per account |
| avatar | IndexedDB | `avatars/<uid>/avatar.jpg` | per account |
| session | `glass:sb-auth` | Supabase | device |
| device flags (`auth-mode`, `last-uid`) | localStorage, unnamespaced | — | device |

Local storage keys are namespaced: `glass:` signed out, `glass:u_<uid>:` signed in. That
is what keeps two accounts on one phone from seeing each other, and it is asserted by
`scripts/audit/identity-check.mjs`.

Source of truth is local for writes; the cloud reconciles by per-entry timestamp on the
next pull. Nothing blocks on the network.
