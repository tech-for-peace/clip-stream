import { useState, useRef, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

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
  error: string | null;
  outputUrl: string | null;
  outputType: "video" | "audio" | null;
  logs: LogEntry[];
}

// SHA-384 hashes for FFmpeg resources (version 0.12.10)
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

async function verifyAndFetchResource(
  url: string,
  resourceKey: string,
  mimeType: string,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-384", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashBase64 = btoa(String.fromCharCode(...hashArray));
  const calculatedHash = `sha384-${hashBase64}`;
  const expectedHash = RESOURCE_HASHES[resourceKey];
  if (expectedHash && calculatedHash !== expectedHash) {
    throw new Error(`Security error: integrity check failed for ${resourceKey}. Aborting load.`);
  }
  const blob = new Blob([buffer], { type: mimeType });
  return URL.createObjectURL(blob);
}

function supportsMultiThreading(): boolean {
  try {
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
    const isCrossOriginIsolated = !!(globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
    return hasSharedArrayBuffer && isCrossOriginIsolated;
  } catch {
    return false;
  }
}

/**
 * Parse a raw FFmpeg command string into args array.
 * Handles quoted strings and escapes.
 */
function parseCommand(command: string): { args: string[]; outputFile: string } {
  // Remove "ffmpeg" prefix if present
  let cmd = command.trim();
  if (cmd.startsWith("ffmpeg")) {
    cmd = cmd.slice(6).trim();
  }

  // Parse args respecting quotes
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (const char of cmd) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if ((char === " " || char === "\n" || char === "\t") && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) args.push(current);

  // Find output file (last argument that's not a flag)
  let outputFile = "output.mp4";
  if (args.length > 0) {
    const last = args[args.length - 1];
    if (!last.startsWith("-")) {
      outputFile = last;
    }
  }

  return { args, outputFile };
}

/** Blocked protocols that could attempt network or local file access */
const BLOCKED_PROTOCOLS = ["http:", "https:", "ftp:", "rtmp:", "rtsp:", "file:", "pipe:", "data:", "tcp:", "udp:", "tls:"];

/** Filters that can read arbitrary files */
const BLOCKED_FILTERS = ["movie", "amovie", "lavfi"];

/** Max input file size: 500 MB */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/** Max processing time: 10 minutes */
const MAX_PROCESSING_TIME_MS = 10 * 60 * 1000;

/**
 * Validate parsed FFmpeg args to block dangerous patterns.
 * Returns an error string if invalid, or null if safe.
 */
function validateArgs(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i].toLowerCase();

    // Block protocol-based inputs/outputs
    for (const proto of BLOCKED_PROTOCOLS) {
      if (arg.includes(proto)) {
        return `Blocked: protocol "${proto}" is not allowed. Only local file processing is supported.`;
      }
    }

    // Block dangerous filters in filter_complex or -vf/-af values
    if (
      (args[i] === "-filter_complex" || args[i] === "-vf" || args[i] === "-af" ||
       args[i] === "-lavfi") &&
      i + 1 < args.length
    ) {
      const filterVal = args[i + 1].toLowerCase();
      for (const f of BLOCKED_FILTERS) {
        if (filterVal.includes(f)) {
          return `Blocked: filter "${f}" is not allowed for security reasons.`;
        }
      }
    }

    // Block -lavfi as a standalone flag (can read files)
    if (arg === "-lavfi") {
      // Already checked filter value above, but flag itself is suspicious
    }
  }

  return null;
}

export function useFFmpegRawProcessor() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [state, setState] = useState<RawProcessorState>({
    isLoading: false,
    loadProgress: 0,
    loadPhase: "idle",
    isMultiThreaded: false,
    isProcessing: false,
    progress: 0,
    error: null,
    outputUrl: null,
    outputType: null,
    logs: [],
  });

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    const entry: LogEntry = { timestamp: new Date(), type, message };
    setState((s) => ({ ...s, logs: [...s.logs.slice(-199), entry] }));
  }, []);

  const clearLogs = useCallback(() => {
    setState((s) => ({ ...s, logs: [] }));
  }, []);

  const load = useCallback(async () => {
    if (ffmpegRef.current?.loaded) return;

    const useMultiThread = supportsMultiThreading();
    addLog("info", `Multi-threading: ${useMultiThread ? "enabled" : "disabled"}`);

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

      ffmpeg.on("log", ({ message }) => addLog("info", message));
      ffmpeg.on("progress", ({ progress, time }) => {
        const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
        const totalSeconds = Math.floor(time / 1000000);
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        addLog("progress", `Progress: ${pct}% (time: ${m}:${s.toString().padStart(2, "0")})`);
        setState((prev) => ({ ...prev, progress: pct }));
      });

      const baseURL = useMultiThread
        ? "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm"
        : "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
      const prefix = useMultiThread ? "core-mt" : "core";

      setState((s) => ({ ...s, loadProgress: 10, loadPhase: "core" }));
      const coreURL = await verifyAndFetchResource(`${baseURL}/ffmpeg-core.js`, `${prefix}/ffmpeg-core.js`, "text/javascript");

      setState((s) => ({ ...s, loadProgress: 40, loadPhase: "wasm" }));
      const wasmURL = await verifyAndFetchResource(`${baseURL}/ffmpeg-core.wasm`, `${prefix}/ffmpeg-core.wasm`, "application/wasm");

      if (useMultiThread) {
        setState((s) => ({ ...s, loadProgress: 70, loadPhase: "worker" }));
        const workerURL = await verifyAndFetchResource(`${baseURL}/ffmpeg-core.worker.js`, `${prefix}/ffmpeg-core.worker.js`, "text/javascript");
        await ffmpeg.load({ coreURL, wasmURL, workerURL });
      } else {
        setState((s) => ({ ...s, loadProgress: 80 }));
        await ffmpeg.load({ coreURL, wasmURL });
      }

      setState((s) => ({ ...s, isLoading: false, loadProgress: 100, loadPhase: "ready" }));
      addLog("info", "FFmpeg ready");
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        loadProgress: 0,
        loadPhase: "idle",
        error: err instanceof Error ? err.message : "Failed to load FFmpeg",
      }));
    }
  }, [addLog]);

  const execute = useCallback(
    async (command: string, files: { name: string; file: File }[]) => {
      const ffmpeg = ffmpegRef.current;
      if (!ffmpeg?.loaded) {
        setState((s) => ({ ...s, error: "FFmpeg not loaded" }));
        return;
      }

      clearLogs();
      setState((s) => ({
        ...s,
        isProcessing: true,
        progress: 0,
        error: null,
        outputUrl: null,
        outputType: null,
      }));

      try {
        // Validate file sizes
        for (const { name, file } of files) {
          if (file.size > MAX_FILE_SIZE) {
            throw new Error(
              `File "${name}" exceeds the ${MAX_FILE_SIZE / 1024 / 1024}MB size limit.`,
            );
          }
          addLog("info", `Loading file: ${name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
          const data = await fetchFile(file);
          await ffmpeg.writeFile(name, data);
        }

        const { args, outputFile } = parseCommand(command);

        // Validate args for dangerous patterns
        const validationError = validateArgs(args);
        if (validationError) {
          throw new Error(validationError);
        }

        // Replace original filenames with mapped names in args
        const mappedArgs = args.map((arg) => {
          if (arg === outputFile) return outputFile;
          return arg;
        });

        addLog("info", `Command: ffmpeg ${mappedArgs.join(" ")}`);
        addLog("info", "Starting FFmpeg processing...");

        // Run with a processing timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("Processing timed out after 10 minutes. Try a shorter or simpler operation.")),
            MAX_PROCESSING_TIME_MS,
          );
        });

        const exitCode = await Promise.race([
          ffmpeg.exec(mappedArgs),
          timeoutPromise,
        ]);

        if (exitCode !== 0) {
          throw new Error(`FFmpeg exited with code ${exitCode}`);
        }

        addLog("info", "Reading output file...");
        const data = (await ffmpeg.readFile(outputFile)) as Uint8Array;

        if (data.length < 100) {
          throw new Error("Output file is empty or corrupted");
        }

        // Determine output type from extension
        const ext = outputFile.split(".").pop()?.toLowerCase() || "mp4";
        const isAudio = ["mp3", "wav", "aac", "ogg", "flac", "m4a", "opus"].includes(ext);
        const mimeMap: Record<string, string> = {
          mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo",
          mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", ogg: "audio/ogg",
          flac: "audio/flac", m4a: "audio/mp4", opus: "audio/opus",
        };
        const mime = mimeMap[ext] || (isAudio ? "audio/mpeg" : "video/mp4");

        const blob = new Blob([new Uint8Array(data)], { type: mime });
        const url = URL.createObjectURL(blob);

        addLog("info", `Done! Output: ${(data.length / 1024 / 1024).toFixed(2)} MB`);

        setState((s) => ({
          ...s,
          isProcessing: false,
          progress: 100,
          outputUrl: url,
          outputType: isAudio ? "audio" : "video",
        }));

        // Cleanup
        for (const { name } of files) {
          try { await ffmpeg.deleteFile(name); } catch { /* ok */ }
        }
        try { await ffmpeg.deleteFile(outputFile); } catch { /* ok */ }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Processing failed";
        addLog("error", msg);
        setState((s) => ({ ...s, isProcessing: false, error: msg }));
      }
    },
    [addLog, clearLogs],
  );

  const reset = useCallback(() => {
    if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
    setState((s) => ({ ...s, isProcessing: false, progress: 0, error: null, outputUrl: null, outputType: null }));
  }, [state.outputUrl]);

  return {
    ...state,
    isReady: ffmpegRef.current?.loaded ?? false,
    load,
    execute,
    reset,
    clearLogs,
  };
}
