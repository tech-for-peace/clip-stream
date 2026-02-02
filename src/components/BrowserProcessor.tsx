import { useEffect, useRef, useState } from "react";
import {
  Cpu,
  Download,
  Loader2,
  AlertCircle,
  RotateCcw,
  Zap,
  Terminal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFFmpegProcessor, type LogEntry } from "@/hooks/useFFmpegProcessor";
import type { ClipConfig } from "@/types/clip";

interface BrowserProcessorProps {
  config: ClipConfig;
}

const phaseLabels: Record<string, string> = {
  idle: "Initializing...",
  core: "Loading FFmpeg core...",
  wasm: "Loading WebAssembly module...",
  worker: "Loading multi-thread worker...",
  ready: "Ready",
};

const logTypeColors: Record<LogEntry["type"], string> = {
  info: "text-muted-foreground",
  warn: "text-yellow-500",
  error: "text-destructive",
  progress: "text-primary",
};

export function BrowserProcessor({ config }: BrowserProcessorProps) {
  const {
    isLoading,
    loadProgress,
    loadPhase,
    isMultiThreaded,
    isProcessing,
    isReady,
    progress,
    error,
    outputUrl,
    logs,
    load,
    process,
    reset,
  } = useFFmpegProcessor();

  const [showLogs, setShowLogs] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const canProcess = config.videoFile && config.segments.length > 0;
  const baseName = config.videoFile?.name.replace(/\.[^/.]+$/, "") || "output";

  const handleDownload = () => {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `${baseName}_clipped.mp4`;
    a.click();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">Process in Browser</h3>
        {isReady && isMultiThreaded && (
          <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
            <Zap className="h-3 w-3" />
            Multi-threaded
          </span>
        )}
        {isReady && !isMultiThreaded && (
          <span className="text-xs text-muted-foreground">
            (single-threaded)
          </span>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {phaseLabels[loadPhase] || "Loading..."} {loadProgress}%
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/60 transition-all duration-300"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Downloading ~32MB WebAssembly module (first time only)
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {isProcessing && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing... {progress}%
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {outputUrl && (
        <div className="space-y-3">
          <video
            src={outputUrl}
            controls
            className="w-full rounded-lg border border-border"
          />
          <div className="flex gap-2">
            <Button onClick={handleDownload} size="sm" className="flex-1">
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
            <Button onClick={reset} variant="outline" size="sm">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !isProcessing && !outputUrl && (
        <Button
          onClick={() => process(config)}
          disabled={!isReady || !canProcess}
          size="sm"
          className="w-full"
        >
          <Cpu className="h-4 w-4 mr-1" />
          Process Video
        </Button>
      )}

      {!isLoading && !outputUrl && (
        <p className="text-xs text-muted-foreground">
          Process entirely in your browser. No uploads needed.
        </p>
      )}

      {/* Log Panel */}
      {logs.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="w-full flex items-center justify-between px-3 py-2 bg-secondary/50 hover:bg-secondary/70 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Processing Logs</span>
              <span className="text-xs text-muted-foreground">
                ({logs.length})
              </span>
            </div>
            {showLogs ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          {showLogs && (
            <div
              ref={logContainerRef}
              className="max-h-48 overflow-y-auto bg-background/50 p-2 font-mono text-xs space-y-0.5"
            >
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={`${logTypeColors[log.type]} leading-relaxed`}
                >
                  <span className="text-muted-foreground/60">
                    [{log.timestamp.toLocaleTimeString()}]
                  </span>{" "}
                  {log.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
