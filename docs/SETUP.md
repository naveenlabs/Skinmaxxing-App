# Skinmaxxing — backend setup

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
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

`auth.uid()` is wrapped in a `select` so Postgres evaluates it once per query instead of
once per row. Semantically identical, and it keeps the database linter quiet.

**The `updated_at` trigger is load-bearing — don't skip it.** The client never sends
`updated_at`; it reads the value back and passes it to the next write as a precondition
(`.eq("updated_at", …)` in `src/lib/sync.js`). That is how a second device's edit is
detected instead of silently overwritten. Without this trigger the column would keep its
insert-time value forever, every conditional update would match, and concurrent edits on
two devices would clobber each other with no conflict ever raised.

```sql
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch
  before insert or update on public.user_state
  for each row execute function public.touch_updated_at();

revoke all on function public.touch_updated_at() from public, anon, authenticated;
```

---

## 2. Size limits on the document row

Without this one account can put an arbitrary amount of JSON in the shared database.
The app's own writes are tiny — a year of logs is around 110 KB — so 5 MB is far beyond
any honest use while still being a real ceiling.

```sql
create or replace function public.enforce_user_state_size()
returns trigger language plpgsql set search_path = '' as $$
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

revoke all on function public.enforce_user_state_size() from public, anon, authenticated;
```

Note the `auth.uid()` check is deliberately redundant with RLS. Defence in depth: if a
policy is ever loosened by accident, the trigger still refuses to write one user's data
into another user's row.

The `revoke` stops the function being callable as a REST RPC. Postgres does **not** check
`EXECUTE` when firing a trigger, so the trigger keeps working — only the
`/rest/v1/rpc/…` door closes. `set search_path = ''` is the matching hardening: with an
empty search path nothing unqualified can be resolved, so a schema someone else controls
can't shadow a call inside the function body. Both bodies here use only `pg_catalog`
builtins and a schema-qualified `auth.uid()`, so neither change alters behaviour.

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

revoke all on function public.enforce_photo_quota() from public, anon, authenticated;
```

The limit is applied **per bucket**, not across both — `progress-photos` and `avatars`
each get their own 200 MB. That's harmless in practice: the app stores exactly one
`avatar.jpg` per user and the bucket itself caps files at 2 MB.

This one is `security definer` because it reads `storage.objects` to total up existing
usage, which the calling user cannot do directly. That makes the `revoke` above matter
more than it does for the others — a `security definer` function reachable over REST runs
with the owner's privileges, so it should not be reachable over REST at all.

---

## 4. Buckets

Bucket names are **exact string keys**, not labels — the app looks for `progress-photos`
and `avatars` in lowercase (`src/lib/supabase.js`). A bucket named `Avatars` or
`Progress Photos` will not match, and Supabase has no rename, so getting this wrong means
deleting and recreating.

### 4a. Progress photos

**Storage → New bucket**

- Name: `progress-photos`
- **Private** (leave "Public bucket" off)
- Restrict file size: **5 MB**
- Restrict MIME types: `image/jpeg`

```sql
create policy "own photos - select" on storage.objects
  for select using (
    bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own photos - insert" on storage.objects
  for insert with check (
    bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own photos - update" on storage.objects
  for update using (
    bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own photos - delete" on storage.objects
  for delete using (
    bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
```

### 4b. Avatars

**Storage → New bucket**

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

**"Leaked password protection is disabled" can be ignored.** The database linter reports it
unconditionally. It checks submitted passwords against HaveIBeenPwned — and with Google as
the only provider this project has no passwords to check. It is the one advisor warning
expected to stay open.

---

## 5b. Checking your work

Supabase's own linter will confirm the above landed. In the dashboard:
**Advisors → Security Advisor** and **Advisors → Performance Advisor**.

A correctly configured project reports **no performance issues** and exactly one security
warning — the leaked-password one noted above. Anything else means a step here was missed.
Worth re-running after any schema change, since a new table without RLS shows up here
first.

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
