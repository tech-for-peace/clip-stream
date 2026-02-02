import { useEffect } from "react";
import { Cpu, Download, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFFmpegProcessor } from "@/hooks/useFFmpegProcessor";
import type { ClipConfig } from "@/types/clip";

interface BrowserProcessorProps {
  config: ClipConfig;
}

export function BrowserProcessor({ config }: BrowserProcessorProps) {
  const {
    isLoading,
    isProcessing,
    isReady,
    progress,
    error,
    outputUrl,
    load,
    process,
    reset,
  } = useFFmpegProcessor();

  useEffect(() => {
    load();
  }, [load]);

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
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading FFmpeg...
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
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
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

      {!isProcessing && !outputUrl && (
        <Button
          onClick={() => process(config)}
          disabled={!isReady || !canProcess || isLoading}
          size="sm"
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Loading...
            </>
          ) : (
            <>
              <Cpu className="h-4 w-4 mr-1" />
              Process Video
            </>
          )}
        </Button>
      )}

      <p className="text-xs text-muted-foreground">
        Process entirely in your browser using WebAssembly. No uploads needed.
      </p>
    </div>
  );
}
