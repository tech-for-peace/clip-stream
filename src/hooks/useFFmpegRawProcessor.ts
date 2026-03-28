import { useState, useRef, useCallback, useEffect } from "react";
import { fetchFile } from "@ffmpeg/util";
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

interface RawProcessorState {
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
  outputType: "video" | "audio" | null;
  logs: LogEntry[];
}

/** Blocked protocols that could attempt network or local file access */
const BLOCKED_PROTOCOLS = [
  "http:", "https:", "ftp:", "rtmp:", "rtsp:", "file:",
  "pipe:", "data:", "tcp:", "udp:", "tls:",
];

/** Filters that can read arbitrary files */
const BLOCKED_FILTERS = ["movie", "amovie", "lavfi"];

/**
 * Parse a raw FFmpeg command string into args array.
 * Handles quoted strings and escapes.
 */
function parseCommand(command: string): { args: string[]; outputFile: string } {
  let cmd = command.trim();
  if (cmd.startsWith("ffmpeg")) cmd = cmd.slice(6).trim();

  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (const char of cmd) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; continue; }
    if (char === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; continue; }
    if ((char === " " || char === "\n" || char === "\t") && !inSingleQuote && !inDoubleQuote) {
      if (current) { args.push(current); current = ""; }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);

  let outputFile = "output.mp4";
  if (args.length > 0) {
    const last = args[args.length - 1];
    if (!last.startsWith("-")) outputFile = last;
  }

  return { args, outputFile };
}

/** Find labels produced/consumed in filter_complex and detect dangling outputs. */
function findDanglingFilterLabels(args: string[]): string[] {
  const filterIndex = args.findIndex((arg) => arg === "-filter_complex");
  if (filterIndex === -1 || filterIndex + 1 >= args.length) return [];

  const filterGraph = args[filterIndex + 1];
  const labelMatches = [...filterGraph.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
  if (labelMatches.length === 0) return [];

  const counts = new Map<string, number>();
  for (const label of labelMatches) {
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  const mappedLabels = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "-map" || i + 1 >= args.length) continue;
    const match = args[i + 1].match(/^\[([^\]]+)\]$/);
    if (match) mappedLabels.add(match[1]);
  }

  return [...counts.entries()]
    .filter(([label, count]) => {
      if (count > 1) return false;
      if (mappedLabels.has(label)) return false;
      // Source stream references like [0:v], [1:a:0] are expected to appear once.
      if (/^\d+:[a-z](?::\d+)?$/i.test(label)) return false;
      return true;
    })
    .map(([label]) => label);
}

/** Validate parsed FFmpeg args to block dangerous patterns + malformed filter graphs */
function validateArgs(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i].toLowerCase();
    for (const proto of BLOCKED_PROTOCOLS) {
      if (arg.includes(proto)) {
        return `Blocked: protocol "${proto}" is not allowed. Only local file processing is supported.`;
      }
    }
    if (
      (args[i] === "-filter_complex" || args[i] === "-vf" || args[i] === "-af" || args[i] === "-lavfi") &&
      i + 1 < args.length
    ) {
      const filterVal = args[i + 1].toLowerCase();
      for (const f of BLOCKED_FILTERS) {
        if (filterVal.includes(f)) {
          return `Blocked: filter "${f}" is not allowed for security reasons.`;
        }
      }
    }
  }

  const danglingLabels = findDanglingFilterLabels(args);
  if (danglingLabels.length > 0) {
    return `Invalid filter graph: unconnected output label(s): ${danglingLabels
      .map((l) => `[${l}]`)
      .join(", ")}. Remove unused branches (e.g. extra anullsrc/aresample outputs) or connect them to concat/map.`;
  }

  return null;
}

export function useFFmpegRawProcessor() {
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [state, setState] = useState<RawProcessorState>({
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
    outputType: null,
    logs: [],
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disposeAll();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, []);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    const entry: LogEntry = { timestamp: new Date(), type, message };
    setState((s) => ({ ...s, logs: [...s.logs.slice(-199), entry] }));
  }, []);

  const clearLogs = useCallback(() => {
    setState((s) => ({ ...s, logs: [] }));
  }, []);

  const execute = useCallback(
    async (command: string, files: { name: string; file: File }[]) => {
      clearLogs();

      setState((s) => ({
        ...s,
        isLoading: true,
        isProcessing: false,
        loadProgress: 0,
        loadPhase: "core",
        progress: 0,
        elapsedSeconds: 0,
        estimatedRemainingSeconds: null,
        error: null,
        outputUrl: null,
        outputType: null,
      }));

      const loadCb: LoadProgressCallback = {
        onPhase: (phase, progress) => {
          setState((s) => ({ ...s, loadPhase: phase, loadProgress: progress }));
        },
        onLog: (message) => addLog("info", message),
      };

      try {
        const { url, outputType } = await runFFmpegJob(async (ffmpeg, isMultiThreaded) => {
          // Transition from loading to processing
          setState((s) => ({
            ...s,
            isLoading: false,
            loadProgress: 100,
            loadPhase: "ready",
            isMultiThreaded,
            isProcessing: true,
          }));

          // Wire up handlers
          ffmpeg.on("log", ({ message }) => addLog("info", message));
          ffmpeg.on("progress", ({ progress, time }) => {
            const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
            const totalSeconds = Math.floor(time / 1000000);
            const m = Math.floor(totalSeconds / 60);
            const s = totalSeconds % 60;
            addLog("progress", `Progress: ${pct}% (time: ${m}:${s.toString().padStart(2, "0")})`);
            const elapsed = (Date.now() - startTimeRef.current) / 1000;
            let remaining: number | null = null;
            if (pct > 2 && pct < 100) {
              remaining = Math.max(0, (elapsed / pct) * (100 - pct));
            }
            setState((prev) => ({ ...prev, progress: pct, estimatedRemainingSeconds: remaining }));
          });

          // Start elapsed timer
          startTimeRef.current = Date.now();
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
            setState((s) => ({ ...s, elapsedSeconds: elapsed }));
          }, 1000);

          // Write input files — null each buffer immediately after write
          for (const { name, file } of files) {
            addLog("info", `Loading file: ${name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
            let data: Uint8Array | null = await fetchFile(file);
            await ffmpeg.writeFile(name, data);
            data = null; // Release buffer reference
          }

          const { args, outputFile } = parseCommand(command);

          // Validate for dangerous patterns
          const validationError = validateArgs(args);
          if (validationError) throw new Error(validationError);

          addLog("info", `Command: ffmpeg ${args.join(" ")}`);
          addLog("info", "Starting FFmpeg processing...");

          const exitCode = await ffmpeg.exec(args);
          if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);

          addLog("info", "Reading output file...");
          let outputData: Uint8Array | null = (await ffmpeg.readFile(outputFile)) as Uint8Array;

          if (outputData.length < 100) {
            outputData = null;
            throw new Error("Output file is empty or corrupted");
          }

          // Determine output type
          const ext = outputFile.split(".").pop()?.toLowerCase() || "mp4";
          const isAudio = ["mp3", "wav", "aac", "ogg", "flac", "m4a", "opus"].includes(ext);
          const mimeMap: Record<string, string> = {
            mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo",
            mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", ogg: "audio/ogg",
            flac: "audio/flac", m4a: "audio/mp4", opus: "audio/opus",
          };
          const mime = mimeMap[ext] || (isAudio ? "audio/mpeg" : "video/mp4");

          const sizeMsg = `Done! Output: ${(outputData.length / 1024 / 1024).toFixed(2)} MB`;
          const blob = new Blob([new Uint8Array(outputData)], { type: mime });
          outputData = null; // Release the large buffer reference
          const url = createTrackedUrl(blob);

          addLog("info", sizeMsg);

          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

          // Cleanup FS files before instance is terminated
          for (const { name } of files) {
            await safeUnlink(ffmpeg, name);
          }
          await safeUnlink(ffmpeg, outputFile);

          return { url, outputType: (isAudio ? "audio" : "video") as "video" | "audio" };
        }, loadCb);

        setState((s) => ({
          ...s,
          isProcessing: false,
          progress: 100,
          estimatedRemainingSeconds: 0,
          outputUrl: url,
          outputType,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Processing failed";
        addLog("error", msg);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setState((s) => ({
          ...s,
          isLoading: false,
          isProcessing: false,
          error: msg,
        }));
      }
    },
    [addLog, clearLogs],
  );

  const reset = useCallback(() => {
    if (state.outputUrl) {
      revokeTrackedUrl(state.outputUrl);
    }
    setState((s) => ({
      ...s,
      isProcessing: false,
      progress: 0,
      error: null,
      outputUrl: null,
      outputType: null,
    }));
  }, [state.outputUrl]);

  return {
    ...state,
    isReady: true,
    execute,
    reset,
    clearLogs,
  };
}
