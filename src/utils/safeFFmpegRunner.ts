/**
 * Safe FFmpeg Runner — shared lifecycle manager for both Simple and Advanced modes.
 *
 * Key guarantees:
 * - Fresh FFmpeg instance per job (no WASM heap accumulation)
 * - Mutex prevents concurrent jobs
 * - All Blob URLs tracked and revoked on cleanup
 * - All FS files unlinked in finally blocks
 * - Buffer references nulled after use
 * - pagehide listener terminates active instance
 * - Memory pressure check before starting (Chrome only)
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";

// ── Integrity hashes for FFmpeg CDN resources (v0.12.10) ──
const RESOURCE_HASHES: Record<string, string> = {
  "core/ffmpeg-core.js":
    "sha384-9KlAmgHu5wDqdgQvFhQGZOtKdCwGcMppDhM/kBkUpZ5LS7KGuAHbE+NgtJQEf84i",
  "core/ffmpeg-core.wasm":
    "sha384-U1VDhkPYrM3wTCT4/vjSpSsKqG/UjljYrYCI4hBSJ02svbCkxuCi6U6u/peg5vpW",
  "core-mt/ffmpeg-core.js":
    "sha384-CqK+fB7O3Dl0SbCkpBiLNrSGeKVUCxa/mwPUPzOGLIQwVNBZEO3OOBhsTz6WqRw3",
  "core-mt/ffmpeg-core.wasm":
    "sha384-IXnr5PE2UFcQ5DvI5LyubPqmMF46EkyIMlbdn4CNQR1iQ8/2irEkyhDFnVDxv4f/",
  "core-mt/ffmpeg-core.worker.js":
    "sha384-mH8cZ9JWsDxI1nYKmKMTA3qGV40dhtv4c6nOLSi5O2rr+0bx3pzHPIkIi6++JFye",
};

// ── Module-level state ──
let activeFFmpeg: FFmpeg | null = null;
let jobQueue: Promise<unknown> = Promise.resolve();
const trackedUrls = new Set<string>();

const DEFAULT_LOAD_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_EXEC_TIMEOUT_MS = 45 * 60 * 1000;
const DEFAULT_QUEUE_WAIT_TIMEOUT_MS = 15 * 1000;

interface JobTimeoutOptions {
  loadTimeoutMs?: number;
  execTimeoutMs?: number;
  queueWaitTimeoutMs?: number;
}

function timeoutError(message: string): Error {
  return new Error(message);
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          try { onTimeout?.(); } catch { /* ignore */ }
          reject(timeoutError(message));
        }, ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function forceTerminateInstance(ffmpeg: FFmpeg | null): void {
  if (!ffmpeg) return;

  try { ffmpeg.terminate(); } catch { /* ignore */ }

  // v0.12 API primarily exposes terminate(), but guard for exit() if present.
  const withExit = ffmpeg as FFmpeg & { exit?: () => void };
  try { withExit.exit?.(); } catch { /* ignore */ }
}

// ── Blob URL tracking ──

/** Create an Object URL and track it for later revocation */
export function createTrackedUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  trackedUrls.add(url);
  return url;
}

/** Revoke a single tracked URL */
export function revokeTrackedUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch { /* ignore */ }
  trackedUrls.delete(url);
}

/** Revoke ALL tracked URLs */
function revokeAllUrls(): void {
  for (const url of trackedUrls) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
  trackedUrls.clear();
}

// ── Multi-threading detection ──

export function supportsMultiThreading(): boolean {
  try {
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
    const isCrossOriginIsolated = !!(
      globalThis as { crossOriginIsolated?: boolean }
    ).crossOriginIsolated;
    return hasSharedArrayBuffer && isCrossOriginIsolated;
  } catch {
    return false;
  }
}

// ── Resource fetching with integrity verification ──

async function verifyAndFetchResource(
  url: string,
  resourceKey: string,
  mimeType: string,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  let buffer: ArrayBuffer | null = await response.arrayBuffer();

  // Verify SHA-384 integrity
  const hashBuffer = await crypto.subtle.digest("SHA-384", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashBase64 = btoa(String.fromCharCode(...hashArray));
  const calculatedHash = `sha384-${hashBase64}`;

  const expectedHash = RESOURCE_HASHES[resourceKey];
  if (expectedHash && calculatedHash !== expectedHash) {
    buffer = null; // Release buffer on failure
    throw new Error(
      `Security error: integrity check failed for ${resourceKey}. Aborting load.`,
    );
  }

  const blob = new Blob([buffer], { type: mimeType });
  buffer = null; // Release the ArrayBuffer reference immediately
  const blobUrl = URL.createObjectURL(blob);
  return blobUrl;
}

// ── Memory pressure check (Chrome only) ──

interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function checkMemoryPressure(): void {
  const perf = performance as Performance & { memory?: PerformanceMemory };
  if (perf.memory) {
    const usage = perf.memory.usedJSHeapSize / perf.memory.jsHeapSizeLimit;
    if (usage > 0.7) {
      throw new Error(
        `Memory pressure too high (${Math.round(usage * 100)}% of heap limit). ` +
        `Try closing other tabs or processing a smaller file.`,
      );
    }
  }
}

// ── Core: load a fresh FFmpeg instance ──

export interface LoadProgressCallback {
  onPhase: (phase: "core" | "wasm" | "worker", progress: number) => void;
  onLog: (message: string) => void;
}

/**
 * Creates and loads a brand-new FFmpeg instance.
 * Loader blob URLs are revoked immediately after ffmpeg.load() to free ~35MB.
 * Returns { ffmpeg, isMultiThreaded }.
 */
export async function loadFreshFFmpeg(
  cb?: LoadProgressCallback,
): Promise<{ ffmpeg: FFmpeg; isMultiThreaded: boolean }> {
  // Check memory before allocating the WASM heap
  checkMemoryPressure();

  // Purge stale IndexedDB caches from previous sessions/crashes
  try { indexedDB.deleteDatabase("ffmpeg-core"); } catch { /* ignore */ }
  try { indexedDB.deleteDatabase("ffmpeg-cache"); } catch { /* ignore */ }

  const useMultiThread = supportsMultiThreading();
  cb?.onLog(`Multi-threading: ${useMultiThread ? "enabled" : "disabled"}`);

  const ffmpeg = new FFmpeg();
  activeFFmpeg = ffmpeg;

  const baseURL = useMultiThread
    ? "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm"
    : "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
  const prefix = useMultiThread ? "core-mt" : "core";

  // Fetch and verify core.js
  cb?.onPhase("core", 10);
  cb?.onLog("Loading FFmpeg core...");
  const coreURL = await verifyAndFetchResource(
    `${baseURL}/ffmpeg-core.js`,
    `${prefix}/ffmpeg-core.js`,
    "text/javascript",
  );

  // Fetch and verify WASM (~32MB)
  cb?.onPhase("wasm", 40);
  cb?.onLog("Loading WebAssembly module (~32MB)...");
  const wasmURL = await verifyAndFetchResource(
    `${baseURL}/ffmpeg-core.wasm`,
    `${prefix}/ffmpeg-core.wasm`,
    "application/wasm",
  );

  // Fetch worker if multi-threaded
  let workerURL: string | undefined;
  if (useMultiThread) {
    cb?.onPhase("worker", 70);
    cb?.onLog("Loading multi-thread worker...");
    workerURL = await verifyAndFetchResource(
      `${baseURL}/ffmpeg-core.worker.js`,
      `${prefix}/ffmpeg-core.worker.js`,
      "text/javascript",
    );
  } else {
    cb?.onPhase("wasm", 80);
  }

  // Load FFmpeg with the blob URLs
  if (workerURL) {
    await ffmpeg.load({ coreURL, wasmURL, workerURL });
  } else {
    await ffmpeg.load({ coreURL, wasmURL });
  }

  // Immediately revoke loader blob URLs — they held ~35MB of copies
  URL.revokeObjectURL(coreURL);
  URL.revokeObjectURL(wasmURL);
  if (workerURL) URL.revokeObjectURL(workerURL);

  cb?.onLog(useMultiThread ? "Multi-threaded FFmpeg ready" : "Single-threaded FFmpeg ready");

  return { ffmpeg, isMultiThreaded: useMultiThread };
}

// ── Terminate and cleanup ──

/** Terminate the active FFmpeg instance and free all resources */
export function terminateFFmpeg(): void {
  if (activeFFmpeg) {
    forceTerminateInstance(activeFFmpeg);
    activeFFmpeg = null;
  }
}

/** Full cleanup: terminate FFmpeg + revoke all tracked URLs */
export function disposeAll(): void {
  terminateFFmpeg();
  revokeAllUrls();
}

/** Safely unlink a file from FFmpeg FS, ignoring errors */
export async function safeUnlink(ffmpeg: FFmpeg, filename: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(filename);
  } catch { /* file may not exist */ }
}

// ── Mutex-guarded job runner ──

/**
 * Run an FFmpeg job with full lifecycle management.
 *
 * - Prevents concurrent jobs via mutex
 * - Creates a fresh FFmpeg instance
 * - Calls your callback with the instance
 * - In `finally`: terminates the instance (freeing WASM heap)
 *
 * NOTE: The callback is responsible for:
 * - Calling safeUnlink() on all FS files it creates
 * - Nulling buffer variables after use
 * - Using createTrackedUrl() for output blobs
 *
 * The runner handles: instance termination, mutex release.
 */
export async function runFFmpegJob<T>(
  callback: (ffmpeg: FFmpeg, isMultiThreaded: boolean) => Promise<T>,
  loadCb?: LoadProgressCallback,
  options?: JobTimeoutOptions,
): Promise<T> {
  const loadTimeoutMs = options?.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const execTimeoutMs = options?.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const queueWaitTimeoutMs = options?.queueWaitTimeoutMs ?? DEFAULT_QUEUE_WAIT_TIMEOUT_MS;

  // Promise-chain mutex: waits for any previous job to finish (even abandoned ones)
  let release!: () => void;
  const prev = jobQueue;
  jobQueue = new Promise<void>((r) => (release = r));

  // Wait for the previous job to complete (swallow its errors)
  try {
    await withTimeout(
      prev.catch(() => {}),
      queueWaitTimeoutMs,
      "Previous FFmpeg job did not release in time. Recovering lock...",
      () => {
        // Recover from stale/hung previous jobs.
        terminateFFmpeg();
      },
    );
  } catch {
    // Continue with a fresh job after forced termination above.
  }

  let ffmpeg: FFmpeg | null = null;

  try {
    const result = await withTimeout(
      loadFreshFFmpeg(loadCb),
      loadTimeoutMs,
      `FFmpeg load timed out after ${Math.round(loadTimeoutMs / 1000)}s`,
      () => {
        terminateFFmpeg();
      },
    );
    ffmpeg = result.ffmpeg;

    return await withTimeout(
      callback(ffmpeg, result.isMultiThreaded),
      execTimeoutMs,
      `FFmpeg processing timed out after ${Math.round(execTimeoutMs / 1000)}s`,
      () => {
        forceTerminateInstance(ffmpeg);
      },
    );
  } finally {
    // Always terminate the instance to free the WASM heap
    forceTerminateInstance(ffmpeg);
    // Clear the module-level reference
    if (activeFFmpeg === ffmpeg) {
      activeFFmpeg = null;
    }
    // Release the mutex so the next job can proceed
    release();
  }
}

// ── Page lifecycle: terminate on tab close/navigation ──

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    disposeAll();
  });
}
