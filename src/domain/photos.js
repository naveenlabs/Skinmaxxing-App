

export const GALLERY_PAGE_SIZE = 20;

export const MAX_PHOTOS_PER_PICK = 5;

export function photoKey(date, period, id) { return `${date}:${period}:${id}`; }

export function genPhotoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// The storage layer itself now lives in ./lib/store.js so the sync engine can sit under
// the same seam. Behaviour is unchanged: window.storage (the Claude artifact API) still
// wins over localStorage wherever it exists.
/* --------------------------------- component --------------------------------- */
