

## Memory Leak Fix Plan

### Problem Summary

Both processor hooks (`useFFmpegProcessor.ts` and `useFFmpegRawProcessor.ts`) have critical memory management issues:

1. **FFmpeg instance reuse** — Same WASM instance kept alive forever, accumulating memory across runs
2. **No FS cleanup on error paths** — `finally` blocks missing; crashes skip file deletion
3. **Blob URL leaks** — `verifyAndFetchResource` creates Object URLs for core/wasm/worker that are never revoked
4. **Buffer references retained** — `videoData`, `audioData`, `data` (output) kept in closure scope after use
5. **No concurrency guard** — Nothing prevents overlapping jobs
6. **Raw processor has zero lifecycle cleanup** — No `useEffect` teardown, no `pagehide` handler

### Architecture Change

Create a shared `safeFFmpegRunner.ts` utility that both hooks use. Each job gets a **fresh FFmpeg instance** that is terminated after completion.

```text
┌─────────────────────┐
│  safeFFmpegRunner.ts │  ← new shared utility
│                      │
│  - mutex (1 job)     │
│  - track all URLs    │
│  - fresh FFmpeg/job  │
│  - try/finally cleanup│
│  - pagehide handler  │
│  - memory pressure   │
└──────────┬───────────┘
           │
    ┌──────┴──────┐
    │             │
useFFmpeg     useFFmpegRaw
Processor     Processor
(simple)      (advanced)
```

### File Changes

#### 1. New file: `src/utils/safeFFmpegRunner.ts`

Core utility providing:

- **`loadFFmpeg()`** — Creates a fresh FFmpeg instance, fetches+verifies core/wasm/worker with integrity checks, loads it, returns the instance. Revokes loader blob URLs immediately after `ffmpeg.load()`.
- **`runFFmpegJob(callback)`** — Mutex-guarded wrapper. Creates fresh FFmpeg via `loadFFmpeg`, calls the user's callback in a `try` block, then in `finally`: unlinks all tracked FS files, terminates FFmpeg, revokes all output blob URLs, nulls buffer references.
- **Blob URL tracking** — `createTrackedURL(blob)` and `revokeAllURLs()` functions. All URLs created during a job are tracked in a Set and revoked in `finally`.
- **Memory pressure check** — Before starting a job, check `performance.memory` (Chrome) and abort if >70% heap used.
- **`pagehide` handler** — Module-level listener that terminates any active FFmpeg instance and revokes all tracked URLs.

#### 2. Refactor: `src/hooks/useFFmpegProcessor.ts`

- Remove `ffmpegRef` persistent ref — no longer reused across runs
- Remove the `load` function (loading happens inside each job)
- Remove `verifyAndFetchResource` (moved to shared utility)
- Refactor `process()` to use `runFFmpegJob()`:
  - Inside the callback: write files, exec, read output — same logic
  - `fetchFile` result assigned to `let` variables, set to `null` after `writeFile`
  - Output `data` from `readFile` set to `null` after creating Blob
  - All FS cleanup (unlink input/output) moved to `finally` block
  - Blob URL for output tracked via the shared tracker
- Keep `cancel` support via AbortController
- Remove eager IndexedDB purge (runner handles lifecycle)
- Keep `useEffect` cleanup but delegate to runner's dispose

#### 3. Refactor: `src/hooks/useFFmpegRawProcessor.ts`

- Remove `ffmpegRef` persistent ref
- Remove `load` function and `verifyAndFetchResource` (use shared runner)
- Refactor `execute()` to use `runFFmpegJob()`:
  - Write files inside callback, null buffer refs after each write
  - FS unlink all input files + output file in `finally`
  - Output blob URL tracked
- Add `useEffect` teardown (missing entirely today) — calls runner's dispose on unmount
- `reset()` revokes output URL via shared tracker

#### 4. Update: `src/components/BrowserProcessor.tsx`

- Remove `useEffect(() => { load(); }, [load])` — no more eager loading
- The `load` export is removed; component shows "Process Video" button that triggers processing directly
- Loading UI shown inline during first job's FFmpeg initialization

#### 5. Update: `src/pages/Advanced.tsx`

- Remove `useEffect(() => { processor.load(); }, [processor])` — no more eager loading
- Loading state handled inline when user clicks "Run"

### Key Cleanup Guarantees

Every processing path wraps in `try/finally`:

```text
try {
  ffmpeg = await loadFFmpeg(onProgress)
  // write inputs (null buffers after each)
  // exec
  // read output (null after blob creation)
} finally {
  // unlink ALL known FS files
  // ffmpeg.terminate()
  // ffmpeg = null
  // revoke all blob URLs except the output preview
  // null all buffer references
}
```

### What This Fixes

| Issue | Fix |
|-------|-----|
| WASM heap persists across runs | Fresh instance per job, terminated after |
| Loader blob URLs leak (~35MB) | Revoked immediately after `ffmpeg.load()` |
| FS files accumulate | Explicit unlink in `finally` for all files |
| Output blob URLs leak on reset | Tracked Set, revoked on reset/unmount/pagehide |
| Buffer refs in closures | Explicitly nulled after use |
| Concurrent jobs corrupt state | Mutex prevents overlap |
| Crash leaves resources | `pagehide` + `finally` ensure cleanup |
| Raw processor has no teardown | Added `useEffect` cleanup |
| Eager WASM load wastes memory | Deferred to first job execution |

