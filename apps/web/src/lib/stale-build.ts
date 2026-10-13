/**
 * After a deploy, the page's code files get new names. A tab opened before the deploy still asks for the old ones,
 * which no longer exist ("Failed to fetch dynamically imported module …/attendance-page-B7KwsM3j.js"). The fix is to
 * load the new version: reload once, automatically. A short guard stops a reload loop if the files really are missing
 * (e.g. the site is down), in which case the error screen offers a manual reload instead.
 */
const KEY = 'stencil.staleBuildReloadAt';
const GUARD_MS = 30_000;

export const isChunkLoadError = (error: unknown) => {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Unable to preload CSS/i.test(message);
};

/** Reloads the page to pick up the new version; false (no reload) if it already did so moments ago. */
export const reloadForNewVersion = () => {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < GUARD_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked: still reload once (the error screen handles the rest) */
  }
  window.location.reload();
  return true;
};
