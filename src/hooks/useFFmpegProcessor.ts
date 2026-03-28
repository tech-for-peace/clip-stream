import { useState, useRef, useCallback, useEffect } from "react";
import { fetchFile } from "@ffmpeg/util";
import type { ClipConfig } from "@/types/clip";
import { timeToSeconds } from "@/utils/timeUtils";
import {
  runFFmpegJob,
  createTrackedUrl,
  revokeTrackedUrl,
  safeUnlink,
  disposeAll,
  type LoadProgressCallback,
} from "@/utils/safeFFmpegRunner";

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
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
  error: string | null;
  outputUrl: string | null;
  logs: LogEntry[];
  isCancelling: boolean;
}

export function useFFmpegProcessor() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutCancelledRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [state, setState] = useState<ProcessingState>({
    isLoading: false,
    loadProgress: 0,
    loadPhase: "idle",
    isMultiThreaded: false,
    isProcessing: false,
    progress: 0,
    elapsedSeconds: 0,
    estimatedRemainingSeconds: null,
    error: null,
    outputUrl: null,
    logs: [],
    isCancelling: false,
  });

  // Cleanup on unmount / page hide
  useEffect(() => {
    return () => {
      disposeAll();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, []);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    const entry: LogEntry = { timestamp: new Date(), type, message };
    setState((s) => ({ ...s, logs: [...s.logs.slice(-99), entry] }));
  }, []);

  const clearLogs = useCallback(() => {
    setState((s) => ({ ...s, logs: [] }));
  }, []);

  const cancel = useCallback(() => {
    if (
      abortControllerRef.current &&
      !abortControllerRef.current.signal.aborted
    ) {
      abortControllerRef.current.abort();
      addLog("warn", "Cancellation requested... Waiting for FFmpeg to stop...");
      setState((s) => ({ ...s, isCancelling: true }));

      setTimeout(() => {
        if (
          abortControllerRef.current?.signal.aborted &&
          !timeoutCancelledRef.current
        ) {
          timeoutCancelledRef.current = true;
          addLog("warn", "FFmpeg did not stop in time, forcing cancellation");
          setState((s) => ({
            ...s,
            error: "FFmpeg did not stop in time, forcing cancellation",
          }));
        }
      }, 5000);
    }
  }, [addLog]);

  const process = useCallback(
    async (config: ClipConfig) => {
      if (!config.videoFile || config.segments.length === 0) {
        setState((s) => ({
          ...s,
          error: "Please add a video file and at least one segment",
        }));
        return;
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      clearLogs();
      addLog("info", `Processing ${config.segments.length} segment(s)...`);

      setState((s) => ({
        ...s,
        isLoading: true,
        isProcessing: false,
        isCancelling: false,
        loadProgress: 0,
        loadPhase: "core",
        progress: 0,
        elapsedSeconds: 0,
        estimatedRemainingSeconds: null,
        error: null,
        outputUrl: null,
      }));

      // Build load progress callback
      const loadCb: LoadProgressCallback = {
        onPhase: (phase, progress) => {
          setState((s) => ({ ...s, loadPhase: phase, loadProgress: progress }));
        },
        onLog: (message) => addLog("info", message),
      };

      try {
        const outputUrl = await runFFmpegJob(async (ffmpeg, isMultiThreaded) => {
          // FFmpeg loaded — transition from loading to processing
          setState((s) => ({
            ...s,
            isLoading: false,
            loadProgress: 100,
            loadPhase: "ready",
            isMultiThreaded,
            isProcessing: true,
          }));

          // Wire up log and progress handlers
          ffmpeg.on("log", ({ message }) => addLog("info", message));
          ffmpeg.on("progress", ({ progress, time }) => {
            const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
            const totalSeconds = Math.floor(time / 1000000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            const timeStr =
              hours > 0
                ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
                : `${minutes}:${seconds.toString().padStart(2, "0")}`;
            addLog("progress", `Progress: ${pct}% (time: ${timeStr})`);
            const elapsed = (Date.now() - startTimeRef.current) / 1000;
            let remaining: number | null = null;
            if (pct > 2 && pct < 100) {
              remaining = Math.max(0, (elapsed / pct) * (100 - pct));
            }
            setState((s) => ({ ...s, progress: pct, estimatedRemainingSeconds: remaining }));
          });

          // Start elapsed timer
          startTimeRef.current = Date.now();
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
            setState((s) => ({ ...s, elapsedSeconds: elapsed }));
          }, 1000);

          if (signal.aborted) throw new Error("Processing cancelled");

          // Write video input — null buffer immediately after
          addLog("info", `Loading video file: ${config.videoFile!.name}`);
          let videoData: Uint8Array | null = await fetchFile(config.videoFile!);
          await ffmpeg.writeFile("input.mp4", videoData);
          videoData = null; // Release buffer reference
          addLog("info", "Video file loaded into memory");

          if (signal.aborted) throw new Error("Processing cancelled");

          // Probe for audio streams and duration
          addLog("info", "Analyzing video file...");
          let hasInputAudio = false;
          let videoDuration = 0;

          const audioCheckLogs: string[] = [];
          const logHandler = ({ message }: { message: string }) => {
            audioCheckLogs.push(message);
          };
          ffmpeg.on("log", logHandler);
          await ffmpeg.exec(["-i", "input.mp4", "-t", "0", "-f", "null", "-"]);

          if (signal.aborted) throw new Error("Processing cancelled");

          const durationLog = audioCheckLogs.find((log) => log.includes("Duration:"));
          if (durationLog) {
            const match = durationLog.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (match) {
              videoDuration = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]);
              addLog("info", `Video duration: ${videoDuration.toFixed(2)} seconds`);
            }
          }

          hasInputAudio = audioCheckLogs.some(
            (log) =>
              log.toLowerCase().includes("audio:") ||
              (log.toLowerCase().includes("stream") && log.toLowerCase().includes("audio")),
          );
          addLog("info", hasInputAudio ? "Audio track detected" : "No audio track found");

          // Validate segment times
          if (videoDuration > 0) {
            for (const seg of config.segments) {
              const startSec = timeToSeconds(seg.start);
              const endSec = timeToSeconds(seg.end);
              if (startSec >= videoDuration) {
                throw new Error(`Segment start time (${seg.start}) is beyond video duration (${videoDuration.toFixed(1)}s)`);
              }
              if (endSec > videoDuration) {
                addLog("warn", `Segment end time (${seg.end}) exceeds video duration, clamping to ${videoDuration.toFixed(1)}s`);
              }
              if (startSec >= endSec) {
                throw new Error(`Invalid segment: start (${seg.start}) must be before end (${seg.end})`);
              }
            }
          }

          // Write audio input if provided — null buffer immediately after
          if (config.audioFile) {
            addLog("info", `Loading audio file: ${config.audioFile.name}`);
            let audioData: Uint8Array | null = await fetchFile(config.audioFile);
            await ffmpeg.writeFile("input_audio", audioData);
            audioData = null; // Release buffer reference
            addLog("info", "Audio file loaded into memory");
            if (signal.aborted) throw new Error("Processing cancelled");
          }

          const processAudio = !!(config.audioFile || hasInputAudio);
          if (!processAudio) {
            addLog("warn", "Input video has no audio track - processing video only");
          }

          const fadeDuration = config.fadeDuration;
          const numSegments = config.segments.length;

          config.segments.forEach((seg, i) => {
            const startSec = timeToSeconds(seg.start);
            const endSec = timeToSeconds(seg.end);
            addLog("info", `Segment ${i + 1}: ${seg.start} (${startSec}s) to ${seg.end} (${endSec}s)`);
          });

          const canUseSimpleMode =
            numSegments === 1 &&
            !config.segments[0].fadeIn &&
            !config.segments[0].fadeOut &&
            !config.globalFadeIn &&
            !config.globalFadeOut;

          // ── Build args helpers ──

          const buildSimpleArgs = (withAudio: boolean): string[] => {
            const seg = config.segments[0];
            const startSec = timeToSeconds(seg.start);
            const endSec = timeToSeconds(seg.end);
            const args = ["-ss", startSec.toString(), "-i", "input.mp4", "-t", (endSec - startSec).toString()];
            if (config.audioFile) {
              args.push("-ss", startSec.toString(), "-i", "input_audio", "-t", (endSec - startSec).toString());
            }
            if (withAudio) {
              args.push("-c:v", "libx264", "-c:a", "aac", "-b:a", "128k");
            } else {
              args.push("-c:v", "libx264", "-an");
            }
            args.push("-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", "output.mp4");
            return args;
          };

          const buildComplexArgs = (withAudio: boolean): string[] => {
            const videoFilters: string[] = [];
            const audioFilters: string[] = [];
            const concatInputs: string[] = [];

            config.segments.forEach((seg, i) => {
              const startSec = timeToSeconds(seg.start);
              const endSec = timeToSeconds(seg.end);
              const duration = endSec - startSec;
              const shouldFadeIn = seg.fadeIn || (i === 0 && config.globalFadeIn);
              const shouldFadeOut = seg.fadeOut || (i === numSegments - 1 && config.globalFadeOut);

              let vFilter = `[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS`;
              if (shouldFadeIn) vFilter += `,fade=t=in:st=0:d=${fadeDuration}`;
              if (shouldFadeOut) vFilter += `,fade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`;
              vFilter += `[v${i}]`;
              videoFilters.push(vFilter);

              if (withAudio) {
                const audioInput = config.audioFile ? "1:a" : "0:a";
                let aFilter = `[${audioInput}]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS`;
                if (shouldFadeIn) aFilter += `,afade=t=in:st=0:d=${fadeDuration}`;
                if (shouldFadeOut) aFilter += `,afade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`;
                aFilter += `[a${i}]`;
                audioFilters.push(aFilter);
                concatInputs.push(`[v${i}][a${i}]`);
              } else {
                concatInputs.push(`[v${i}]`);
              }
            });

            let filterComplex: string;
            if (withAudio) {
              filterComplex = [...videoFilters, ...audioFilters, `${concatInputs.join("")}concat=n=${numSegments}:v=1:a=1[outv][outa]`].join(";");
            } else {
              filterComplex = [...videoFilters, `${concatInputs.join("")}concat=n=${numSegments}:v=1:a=0[outv]`].join(";");
            }

            const args = ["-i", "input.mp4"];
            if (config.audioFile) args.push("-i", "input_audio");
            args.push("-filter_complex", filterComplex, "-map", "[outv]");
            if (withAudio) args.push("-map", "[outa]", "-c:a", "aac", "-b:a", "128k");
            args.push("-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", "output.mp4");
            return args;
          };

          const buildProcessingArgs = canUseSimpleMode ? buildSimpleArgs : buildComplexArgs;
          addLog("info", `Using ${canUseSimpleMode ? "simple" : "complex filter"} mode`);

          // ── Execute with audio fallback ──
          let attemptWithAudio = processAudio;
          let success = false;

          while (!success) {
            const args = buildProcessingArgs(attemptWithAudio);
            addLog("info", `Processing ${attemptWithAudio ? "with" : "without"} audio...`);
            addLog("info", `Command: ffmpeg ${args.join(" ")}`);

            if (signal.aborted) throw new Error("Processing cancelled");

            const exitCode = await ffmpeg.exec(args);

            if (exitCode !== 0) {
              addLog("warn", `FFmpeg exited with code ${exitCode}`);
              if (attemptWithAudio) {
                addLog("warn", "Audio processing failed, retrying without audio...");
                attemptWithAudio = false;
                await safeUnlink(ffmpeg, "output.mp4");
                continue;
              } else {
                throw new Error(`FFmpeg exited with code ${exitCode}`);
              }
            }

            if (signal.aborted) throw new Error("Processing cancelled");

            addLog("info", "Reading output file...");
            let data: Uint8Array | null = (await ffmpeg.readFile("output.mp4")) as Uint8Array;

            if (data.length < 1000) {
              addLog("warn", `Output file is too small (${data.length} bytes)`);
              data = null; // Release ref
              if (attemptWithAudio) {
                addLog("warn", "Output corrupted with audio, retrying without audio...");
                attemptWithAudio = false;
                await safeUnlink(ffmpeg, "output.mp4");
                continue;
              } else {
                throw new Error("Output file is corrupted or empty");
              }
            }

            // Success — create tracked blob URL
            success = true;
            const blob = new Blob([new Uint8Array(data)], { type: "video/mp4" });
            data = null; // Release the large Uint8Array reference
            const url = createTrackedUrl(blob);

            addLog("info", `Processing complete!${!attemptWithAudio && processAudio ? " (video only - audio failed)" : ""}`);

            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

            // Cleanup FS files before instance is terminated
            await safeUnlink(ffmpeg, "input.mp4");
            if (config.audioFile) await safeUnlink(ffmpeg, "input_audio");
            await safeUnlink(ffmpeg, "output.mp4");

            return url;
          }

          // Should never reach here, but satisfy TS
          throw new Error("Processing failed unexpectedly");
        }, loadCb);

        // Job completed successfully
        setState((s) => ({
          ...s,
          isProcessing: false,
          progress: 100,
          estimatedRemainingSeconds: 0,
          outputUrl,
        }));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Processing failed";

        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

        if (signal.aborted || errorMsg === "Processing cancelled") {
          addLog("warn", "Processing cancelled by user");
          setState((s) => ({
            ...s,
            isLoading: false,
            isProcessing: false,
            isCancelling: false,
            progress: 0,
            error: "Processing cancelled",
          }));
        } else {
          addLog("error", errorMsg);
          setState((s) => ({
            ...s,
            isLoading: false,
            isProcessing: false,
            isCancelling: false,
            error: errorMsg,
          }));
        }

        timeoutCancelledRef.current = false;
      }
    },
    [addLog, clearLogs],
  );

  const reset = useCallback(() => {
    if (state.outputUrl) {
      revokeTrackedUrl(state.outputUrl);
    }
    timeoutCancelledRef.current = false;
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
    // isReady is always true since we load per-job; the button checks isLoading instead
    isReady: true,
    process,
    cancel,
    reset,
    clearLogs,
  };
}
