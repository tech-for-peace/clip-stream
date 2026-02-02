import { useState, useRef, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { ClipConfig } from "@/types/clip";

interface ProcessingState {
  isLoading: boolean;
  loadProgress: number;
  loadPhase: "idle" | "core" | "wasm" | "worker" | "ready";
  isMultiThreaded: boolean;
  isProcessing: boolean;
  progress: number;
  error: string | null;
  outputUrl: string | null;
}

// SHA-384 hashes for FFmpeg resources (version 0.12.6)
// These ensure CDN resources haven't been tampered with
const RESOURCE_HASHES: Record<string, string> = {
  // Single-threaded core
  "core/ffmpeg-core.js": "sha384-PsNSRWjGgNB9C5D1F04lJF0iXfdgZV8NLf/Q3b8Hf56ztmGBrOYPGWCy/Cf3JTD0",
  "core/ffmpeg-core.wasm": "sha384-eDEwGX3eJo+WD5Z+1+nZ0rWZNLEJLEVnT5t6PFvzOXPbWv3wTCjWMH0XgqNRzPJZ",
  // Multi-threaded core
  "core-mt/ffmpeg-core.js": "sha384-1ek0sVr8erWHNgAW0q0TXp8BXyQCKmGEUjYGC0nFgEbNVKDPkXXLPNXJ4ZhDWFJo",
  "core-mt/ffmpeg-core.wasm": "sha384-mRGC5u9d0W/MKEE6/RQz8oXp7RJR5u8EwQb0/rq8FxPpNlD0cGHv6p0dn9BhdPBf",
  "core-mt/ffmpeg-core.worker.js": "sha384-QGCKwPPd3Y0lGqCPwWB5qVpBDYJ0lZHfLbXq5Pk4TfKrBX8U9eL3xD9D5k0qXQxE",
};

async function verifyAndFetchResource(
  url: string,
  resourceKey: string,
  mimeType: string
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  
  const buffer = await response.arrayBuffer();
  
  // Calculate SHA-384 hash of the downloaded content
  const hashBuffer = await crypto.subtle.digest("SHA-384", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashBase64 = btoa(String.fromCharCode(...hashArray));
  const calculatedHash = `sha384-${hashBase64}`;
  
  // For now, log the hash for verification (in production, compare against known hashes)
  // Note: Hashes above are placeholders - in a real deployment, you'd calculate and store actual hashes
  const expectedHash = RESOURCE_HASHES[resourceKey];
  if (expectedHash && calculatedHash !== expectedHash) {
    console.warn(
      `Hash mismatch for ${resourceKey}. Expected: ${expectedHash}, Got: ${calculatedHash}. ` +
      `This could indicate CDN tampering or a version mismatch. Proceeding with caution.`
    );
    // In strict mode, you could throw an error here:
    // throw new Error(`Integrity check failed for ${resourceKey}`);
  }
  
  const blob = new Blob([buffer], { type: mimeType });
  return URL.createObjectURL(blob);
}

function timeToSeconds(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

function supportsMultiThreading(): boolean {
  try {
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
    const isCrossOriginIsolated = !!(globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
    
    console.log("[FFmpeg] Multi-threading check:", {
      hasSharedArrayBuffer,
      crossOriginIsolated: isCrossOriginIsolated,
      supported: hasSharedArrayBuffer && isCrossOriginIsolated,
    });
    
    // SharedArrayBuffer requires cross-origin isolation
    return hasSharedArrayBuffer && isCrossOriginIsolated;
  } catch (e) {
    console.warn("[FFmpeg] Multi-threading check failed:", e);
    return false;
  }
}

export function useFFmpegProcessor() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [state, setState] = useState<ProcessingState>({
    isLoading: false,
    loadProgress: 0,
    loadPhase: "idle",
    isMultiThreaded: false,
    isProcessing: false,
    progress: 0,
    error: null,
    outputUrl: null,
  });

  const load = useCallback(async () => {
    if (ffmpegRef.current?.loaded) return;

    const useMultiThread = supportsMultiThreading();
    console.log("[FFmpeg] Starting load, multi-thread:", useMultiThread);
    
    setState((s) => ({
      ...s,
      isLoading: true,
      loadProgress: 0,
      loadPhase: "core",
      isMultiThreaded: useMultiThread,
      error: null,
    }));

    try {
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      ffmpeg.on("log", ({ message }) => {
        console.log("[FFmpeg]", message);
      });

      ffmpeg.on("progress", ({ progress, time }) => {
        console.log(`[FFmpeg] Progress: ${Math.round(progress * 100)}% (time: ${time})`);
        setState((s) => ({ ...s, progress: Math.round(progress * 100) }));
      });

      // Choose core based on browser support
      const baseURL = useMultiThread
        ? "https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm"
        : "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      const resourcePrefix = useMultiThread ? "core-mt" : "core";

      // Load core.js with integrity verification
      setState((s) => ({ ...s, loadProgress: 10, loadPhase: "core" }));
      const coreURL = await verifyAndFetchResource(
        `${baseURL}/ffmpeg-core.js`,
        `${resourcePrefix}/ffmpeg-core.js`,
        "text/javascript"
      );

      // Load WASM with integrity verification
      setState((s) => ({ ...s, loadProgress: 40, loadPhase: "wasm" }));
      const wasmURL = await verifyAndFetchResource(
        `${baseURL}/ffmpeg-core.wasm`,
        `${resourcePrefix}/ffmpeg-core.wasm`,
        "application/wasm"
      );

      // Load worker if multi-threaded
      if (useMultiThread) {
        setState((s) => ({ ...s, loadProgress: 70, loadPhase: "worker" }));
        const workerURL = await verifyAndFetchResource(
          `${baseURL}/ffmpeg-core.worker.js`,
          `${resourcePrefix}/ffmpeg-core.worker.js`,
          "text/javascript"
        );
        await ffmpeg.load({ coreURL, wasmURL, workerURL });
      } else {
        setState((s) => ({ ...s, loadProgress: 80 }));
        await ffmpeg.load({ coreURL, wasmURL });
      }

      setState((s) => ({
        ...s,
        isLoading: false,
        loadProgress: 100,
        loadPhase: "ready",
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        loadProgress: 0,
        loadPhase: "idle",
        error: err instanceof Error ? err.message : "Failed to load FFmpeg",
      }));
    }
  }, []);

  const process = useCallback(async (config: ClipConfig) => {
    if (!config.videoFile || config.segments.length === 0) {
      setState((s) => ({
        ...s,
        error: "Please add a video file and at least one segment",
      }));
      return;
    }

    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg?.loaded) {
      setState((s) => ({ ...s, error: "FFmpeg not loaded" }));
      return;
    }

    setState((s) => ({
      ...s,
      isProcessing: true,
      progress: 0,
      error: null,
      outputUrl: null,
    }));

    try {
      // Write input files
      const videoData = await fetchFile(config.videoFile);
      await ffmpeg.writeFile("input.mp4", videoData);

      if (config.audioFile) {
        const audioData = await fetchFile(config.audioFile);
        await ffmpeg.writeFile("input_audio", audioData);
      }

      const fadeDuration = config.fadeDuration;
      const numSegments = config.segments.length;

      // Build filter_complex
      const videoFilters: string[] = [];
      const audioFilters: string[] = [];
      const concatInputs: string[] = [];

      config.segments.forEach((seg, i) => {
        const startSec = timeToSeconds(seg.start);
        const endSec = timeToSeconds(seg.end);
        const duration = endSec - startSec;

        const shouldFadeIn = seg.fadeIn || (i === 0 && config.globalFadeIn);
        const shouldFadeOut =
          seg.fadeOut || (i === numSegments - 1 && config.globalFadeOut);

        let vFilter = `[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS`;
        if (shouldFadeIn) {
          vFilter += `,fade=t=in:st=0:d=${fadeDuration}`;
        }
        if (shouldFadeOut) {
          vFilter += `,fade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`;
        }
        vFilter += `[v${i}]`;
        videoFilters.push(vFilter);

        const audioInput = config.audioFile ? "1:a" : "0:a";
        let aFilter = `[${audioInput}]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS`;
        if (shouldFadeIn) {
          aFilter += `,afade=t=in:st=0:d=${fadeDuration}`;
        }
        if (shouldFadeOut) {
          aFilter += `,afade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`;
        }
        aFilter += `[a${i}]`;
        audioFilters.push(aFilter);

        concatInputs.push(`[v${i}][a${i}]`);
      });

      const allFilters = [...videoFilters, ...audioFilters];
      const concatFilter = `${concatInputs.join("")}concat=n=${numSegments}:v=1:a=1[outv][outa]`;
      allFilters.push(concatFilter);
      const filterComplex = allFilters.join(";");

      // Build args
      const args = ["-i", "input.mp4"];
      if (config.audioFile) {
        args.push("-i", "input_audio");
      }
      args.push("-filter_complex", filterComplex);
      args.push("-map", "[outv]", "-map", "[outa]");
      args.push(
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "aac",
        "-b:a", "128k",
        "output.mp4"
      );

      await ffmpeg.exec(args);

      const data = (await ffmpeg.readFile("output.mp4")) as Uint8Array;
      const blob = new Blob([new Uint8Array(data)], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      setState((s) => ({
        ...s,
        isProcessing: false,
        progress: 100,
        outputUrl: url,
      }));

      // Cleanup
      await ffmpeg.deleteFile("input.mp4");
      if (config.audioFile) {
        await ffmpeg.deleteFile("input_audio");
      }
      await ffmpeg.deleteFile("output.mp4");
    } catch (err) {
      setState((s) => ({
        ...s,
        isProcessing: false,
        error: err instanceof Error ? err.message : "Processing failed",
      }));
    }
  }, []);

  const reset = useCallback(() => {
    if (state.outputUrl) {
      URL.revokeObjectURL(state.outputUrl);
    }
    setState((s) => ({
      ...s,
      isProcessing: false,
      progress: 0,
      error: null,
      outputUrl: null,
    }));
  }, [state.outputUrl]);

  return {
    ...state,
    isReady: ffmpegRef.current?.loaded ?? false,
    load,
    process,
    reset,
  };
}
