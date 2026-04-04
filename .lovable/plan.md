
Goal: make the app load again in a browser that previously got stuck, and stop Advanced mode from allocating large memory before the user actually runs a job.

What I found
- Advanced mode is eagerly loading FFmpeg on page entry:
  - `src/pages/Advanced.tsx` calls `processor.load()` in `useEffect`.
- That effect currently depends on the whole `processor` object:
  - `useEffect(() => { processor.load(); }, [processor])`
  - Because the hook returns a new object every render, this can retrigger `load()` repeatedly while state updates happen during loading.
- Simple mode also eagerly loads FFmpeg on mount:
  - `src/components/BrowserProcessor.tsx` calls `load()` immediately.
- Both hooks fetch the large FFmpeg core/wasm files and create blob URLs during load, but there is no complete disposal path on unmount and no browser recovery cleanup path.
- There is no recovery flow for a “poisoned” browser session:
  - no IndexedDB cleanup
  - no service worker reset option
  - no explicit cache/object-URL purge for partially loaded FFmpeg assets

Implementation plan

1. Stop all eager FFmpeg startup work
- Remove automatic `load()` from Advanced mode page entry.
- Remove automatic `load()` from Simple mode mount as well.
- Change both flows to lazy initialization:
  - only load FFmpeg when the user reaches the Run step and explicitly starts execution, or
  - when they press a dedicated “Initialize FFmpeg” / “Run” action.
- Keep the UI informative by showing a lightweight idle state instead of starting the wasm download automatically.

2. Fix the immediate Advanced-mode re-render loop
- Replace the current Advanced effect dependency bug.
- Do not depend on the entire `processor` object.
- Best approach: remove the effect entirely as part of lazy loading.
- If any effect remains, depend only on stable callbacks, not the hook return object.

3. Add a hard cleanup/dispose layer to both FFmpeg hooks
- Extend `useFFmpegRawProcessor` and `useFFmpegProcessor` with a shared cleanup routine that:
  - terminates the FFmpeg instance if present
  - clears listeners/timers
  - deletes any known virtual FS files
  - revokes output object URLs
  - revokes temporary blob URLs created for `coreURL`, `wasmURL`, and `workerURL`
  - nulls refs after cleanup
- Run this cleanup:
  - on successful completion
  - on error
  - on cancel
  - on component unmount
  - before starting a fresh load if an old instance exists

4. Add browser recovery on startup for broken sessions
- Add a small “safe boot” utility that runs once near app startup and attempts to clear leftover FFmpeg browser storage:
  - delete likely IndexedDB databases used by FFmpeg/browser wasm caching when present
  - optionally clear Cache Storage entries related to FFmpeg assets
- Keep this targeted to FFmpeg-related storage, not a full app wipe.
- If cleanup fails, surface a non-blocking warning rather than crashing.

5. Add a user-visible recovery escape hatch
- Add a lightweight recovery banner/button for users stuck in a bad browser state:
  - “Reset video engine”
- This action should:
  - call the same cleanup/dispose utility
  - unregister the COI service worker if needed, then reload
  - clear FFmpeg-related IndexedDB/cache entries
  - revoke current output URLs/state
- Place it where the user can reach it before any heavy work starts.

6. Make the UI resilient before initialization
- In Advanced mode Run step, show:
  - “FFmpeg is not loaded yet”
  - expected download size
  - single-threaded notice if cross-origin isolation is unavailable
- Only start the load after user intent.
- This avoids memory pressure simply from visiting `/a`.

7. Prevent future runaway sessions
- Guard `load()` against concurrent calls with an internal “loading promise” or mutex so repeated clicks/renders cannot start multiple loads.
- Ensure only one FFmpeg instance can exist at a time.
- When a load fails or is aborted, always dispose partially created resources before returning to idle.

8. Verify the fix
- Test path A: open `/a` in a fresh tab and confirm no FFmpeg download/memory spike occurs until the user starts processing.
- Test path B: simulate a failed/aborted load and confirm cleanup returns the hook to idle.
- Test path C: use the recovery action in a browser that previously got stuck and confirm the app becomes navigable again.
- Test path D: after a completed run, navigate away/back and confirm no immediate heavy allocation happens.

Technical details
- Files likely involved:
  - `src/pages/Advanced.tsx`
  - `src/components/BrowserProcessor.tsx`
  - `src/hooks/useFFmpegRawProcessor.ts`
  - `src/hooks/useFFmpegProcessor.ts`
  - likely a new shared cleanup utility under `src/lib/` or `src/utils/`
  - possibly `src/App.tsx` or `src/main.tsx` for one-time recovery bootstrapping
- Highest-priority bug:
  - `src/pages/Advanced.tsx:96-98` currently causes repeated load attempts because `[processor]` is unstable.
- Main design change:
  - FFmpeg becomes “load on intent”, not “load on page open”.

Expected outcome
- You should be able to open the site again without it immediately consuming huge memory.
- Simply switching to Advanced mode will no longer download/instantiate FFmpeg.
- Large failed sessions will be easier to recover from without manually clearing browser data.
- Memory usage after crashes/cancels should drop more reliably because resources are explicitly disposed.
