import { useState, useRef, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
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
    return typeof SharedArrayBuffer !== "undefined";
  } catch {
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

      ffmpeg.on("progress", ({ progress }) => {
        setState((s) => ({ ...s, progress: Math.round(progress * 100) }));
      });

      // Choose core based on browser support
      const baseURL = useMultiThread
        ? "https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm"
        : "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

      // Load core.js
      setState((s) => ({ ...s, loadProgress: 10, loadPhase: "core" }));
      const coreURL = await toBlobURL(
        `${baseURL}/ffmpeg-core.js`,
        "text/javascript"
      );

      // Load WASM
      setState((s) => ({ ...s, loadProgress: 40, loadPhase: "wasm" }));
      const wasmURL = await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
      );

      // Load worker if multi-threaded
      if (useMultiThread) {
        setState((s) => ({ ...s, loadProgress: 70, loadPhase: "worker" }));
        const workerURL = await toBlobURL(
          `${baseURL}/ffmpeg-core.worker.js`,
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
