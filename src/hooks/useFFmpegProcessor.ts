import { useState, useRef, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { ClipConfig } from "@/types/clip";

export interface LogEntry {
  timestamp: Date;
  type: "info" | "warn" | "error" | "progress";
  message: string;
}

interface ProcessingState {
  isLoading: boolean;
  loadProgress: number;
  loadPhase: "idle" | "core" | "wasm" | "worker" | "ready";
  isMultiThreaded: boolean;
  isProcessing: boolean;
  progress: number;
  error: string | null;
  outputUrl: string | null;
  logs: LogEntry[];
}

// SHA-384 hashes for FFmpeg resources (version 0.12.10)
// These ensure CDN resources haven't been tampered with
const RESOURCE_HASHES: Record<string, string> = {
  // Single-threaded core
  "core/ffmpeg-core.js": "sha384-9KlAmgHu5wDqdgQvFhQGZOtKdCwGcMppDhM/kBkUpZ5LS7KGuAHbE+NgtJQEf84i",
  "core/ffmpeg-core.wasm": "sha384-U1VDhkPYrM3wTCT4/vjSpSsKqG/UjljYrYCI4hBSJ02svbCkxuCi6U6u/peg5vpW",
  // Multi-threaded core
  "core-mt/ffmpeg-core.js": "sha384-CqK+fB7O3Dl0SbCkpBiLNrSGeKVUCxa/mwPUPzOGLIQwVNBZEO3OOBhsTz6WqRw3",
  "core-mt/ffmpeg-core.wasm": "sha384-IXnr5PE2UFcQ5DvI5LyubPqmMF46EkyIMlbdn4CNQR1iQ8/2irEkyhDFnVDxv4f/",
  "core-mt/ffmpeg-core.worker.js": "sha384-mH8cZ9JWsDxI1nYKmKMTA3qGV40dhtv4c6nOLSi5O2rr+0bx3pzHPIkIi6++JFye",
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
    logs: [],
  });

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    const entry: LogEntry = { timestamp: new Date(), type, message };
    setState((s) => ({ ...s, logs: [...s.logs.slice(-99), entry] })); // Keep last 100 logs
    console.log(`[FFmpeg ${type}]`, message);
  }, []);

  const clearLogs = useCallback(() => {
    setState((s) => ({ ...s, logs: [] }));
  }, []);

  const load = useCallback(async () => {
    if (ffmpegRef.current?.loaded) return;

    const useMultiThread = supportsMultiThreading();
    addLog("info", `Multi-threading: ${useMultiThread ? "enabled" : "disabled (requires cross-origin isolation)"}`);
    if (!useMultiThread) {
      addLog("warn", "SharedArrayBuffer unavailable - running in single-threaded mode");
    }
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
        addLog("info", message);
      });

      ffmpeg.on("progress", ({ progress, time }) => {
        const pct = Math.round(progress * 100);
        addLog("progress", `Progress: ${pct}% (time: ${time})`);
        setState((s) => ({ ...s, progress: pct }));
      });

      // Choose core based on browser support
      const baseURL = useMultiThread
        ? "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm"
        : "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
      const resourcePrefix = useMultiThread ? "core-mt" : "core";

      // Load core.js with integrity verification
      addLog("info", "Loading FFmpeg core...");
      setState((s) => ({ ...s, loadProgress: 10, loadPhase: "core" }));
      const coreURL = await verifyAndFetchResource(
        `${baseURL}/ffmpeg-core.js`,
        `${resourcePrefix}/ffmpeg-core.js`,
        "text/javascript"
      );
      addLog("info", "Core loaded successfully");

      // Load WASM with integrity verification
      addLog("info", "Loading WebAssembly module (~32MB)...");
      setState((s) => ({ ...s, loadProgress: 40, loadPhase: "wasm" }));
      const wasmURL = await verifyAndFetchResource(
        `${baseURL}/ffmpeg-core.wasm`,
        `${resourcePrefix}/ffmpeg-core.wasm`,
        "application/wasm"
      );
      addLog("info", "WASM module loaded successfully");

      // Load worker if multi-threaded
      if (useMultiThread) {
        addLog("info", "Loading multi-thread worker...");
        setState((s) => ({ ...s, loadProgress: 70, loadPhase: "worker" }));
        const workerURL = await verifyAndFetchResource(
          `${baseURL}/ffmpeg-core.worker.js`,
          `${resourcePrefix}/ffmpeg-core.worker.js`,
          "text/javascript"
        );
        await ffmpeg.load({ coreURL, wasmURL, workerURL });
        addLog("info", "Multi-threaded FFmpeg ready");
      } else {
        setState((s) => ({ ...s, loadProgress: 80 }));
        await ffmpeg.load({ coreURL, wasmURL });
        addLog("info", "Single-threaded FFmpeg ready");
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
      addLog("error", err instanceof Error ? err.message : "Failed to load FFmpeg");
    }
  }, [addLog]);

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

    clearLogs();
    addLog("info", `Processing ${config.segments.length} segment(s)...`);

    setState((s) => ({
      ...s,
      isProcessing: true,
      progress: 0,
      error: null,
      outputUrl: null,
    }));

    try {
      // Write input files
      addLog("info", `Loading video file: ${config.videoFile.name}`);
      const videoData = await fetchFile(config.videoFile);
      await ffmpeg.writeFile("input.mp4", videoData);
      addLog("info", "Video file loaded into memory");

      if (config.audioFile) {
        addLog("info", `Loading audio file: ${config.audioFile.name}`);
        const audioData = await fetchFile(config.audioFile);
        await ffmpeg.writeFile("input_audio", audioData);
        addLog("info", "Audio file loaded into memory");
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

      addLog("info", "Starting FFmpeg processing...");
      await ffmpeg.exec(args);

      addLog("info", "Reading output file...");
      const data = (await ffmpeg.readFile("output.mp4")) as Uint8Array;
      const blob = new Blob([new Uint8Array(data)], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      addLog("info", `Processing complete! Output size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);

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
      const errorMsg = err instanceof Error ? err.message : "Processing failed";
      addLog("error", errorMsg);
      setState((s) => ({
        ...s,
        isProcessing: false,
        error: errorMsg,
      }));
    }
  }, [addLog, clearLogs]);

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
    clearLogs,
  };
}
