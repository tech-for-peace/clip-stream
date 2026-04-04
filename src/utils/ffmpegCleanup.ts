/**
 * FFmpeg browser cleanup & recovery utilities.
 *
 * Clears IndexedDB databases, Cache Storage entries, and blob URLs
 * left behind by ffmpeg.wasm after crashes or incomplete sessions.
 */

const FFMPEG_IDB_NAMES = ["ffmpeg-core", "ffmpeg-cache"];

/** Delete IndexedDB databases related to FFmpeg caching */
async function purgeIndexedDB(): Promise<void> {
  for (const name of FFMPEG_IDB_NAMES) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve(); // still counts as cleaned
      });
    } catch {
      // non-critical
    }
  }
}

/** Delete Cache Storage entries related to FFmpeg */
async function purgeCacheStorage(): Promise<void> {
  if (!("caches" in globalThis)) return;
  try {
    const keys = await caches.keys();
    for (const key of keys) {
      if (key.toLowerCase().includes("ffmpeg")) {
        await caches.delete(key);
      }
    }
  } catch {
    // non-critical
  }
}

/**
 * Run once on app startup to clear leftover FFmpeg browser storage.
 * Safe to call even when nothing is cached.
 */
export async function ffmpegSafeBoot(): Promise<void> {
  try {
    await Promise.all([purgeIndexedDB(), purgeCacheStorage()]);
    console.log("[FFmpeg] Safe boot: cleaned up browser caches");
  } catch (e) {
    console.warn("[FFmpeg] Safe boot cleanup failed (non-fatal):", e);
  }
}

/**
 * Full recovery: purge caches, unregister COI service worker, reload.
 * Use when the user is stuck and nothing else helps.
 */
export async function ffmpegFullReset(): Promise<void> {
  await ffmpegSafeBoot();

  // Unregister all service workers (especially coi-serviceworker)
  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    } catch {
      // non-critical
    }
  }

  // Hard reload
  window.location.reload();
}
