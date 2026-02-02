

# Plan: Enable Multi-threaded FFmpeg Processing

## Overview
Upgrade ClipStream to use multi-threaded FFmpeg.wasm for significantly faster video processing. This requires adding specific security headers and switching to the multi-threaded FFmpeg core.

## What Changes

### 1. Add Required HTTP Headers
Add COOP/COEP headers to enable `SharedArrayBuffer` support, which is required for multi-threading.

**For development** - Update `vite.config.ts`:
```typescript
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  }
}
```

**For production** - Create `public/_headers` file (Lovable uses Netlify-style headers):
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### 2. Switch to Multi-threaded FFmpeg Core
Update `useFFmpegProcessor.ts` to load the multi-threaded version:

```typescript
// Change from single-threaded:
const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

// To multi-threaded:
const baseURL = "https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm";
```

Also load the worker file:
```typescript
const workerURL = await toBlobURL(
  `${baseURL}/ffmpeg-core.worker.js`,
  "text/javascript"
);
await ffmpeg.load({ coreURL, wasmURL, workerURL });
```

### 3. Improve Loading Experience
- Add real progress tracking for WASM download using fetch with progress
- Cache the WASM binary in IndexedDB for instant subsequent loads
- Show clear status messages during each phase

### 4. Add Fallback for Unsupported Browsers
Not all browsers support `SharedArrayBuffer`. Add detection:

```typescript
const supportsMultiThreading = typeof SharedArrayBuffer !== 'undefined';
// Use core-mt if supported, otherwise fall back to single-threaded core
```

## Files to Modify

| File | Changes |
|------|---------|
| `vite.config.ts` | Add COOP/COEP headers for dev server |
| `public/_headers` | Create file with production headers |
| `src/hooks/useFFmpegProcessor.ts` | Switch to multi-threaded core, add worker loading, add fallback logic |
| `src/components/BrowserProcessor.tsx` | Improve loading UI with phase indicators |

## Technical Notes

### Why These Headers Are Needed
- `Cross-Origin-Opener-Policy: same-origin` - Isolates the browsing context
- `Cross-Origin-Embedder-Policy: require-corp` - Requires all resources to be CORS-enabled

These enable `SharedArrayBuffer` which FFmpeg uses to share memory between threads.

### Multi-threaded Core Size
- Single-threaded core: ~32MB
- Multi-threaded core: ~32MB (similar size, but includes worker)

### Browser Support
- Chrome 92+, Edge 92+, Firefox 79+, Safari 15.2+
- Falls back to single-threaded for older browsers

### Performance Improvement
Multi-threading can provide 2-4x faster processing on multi-core devices, especially noticeable on longer videos or complex filter operations.

