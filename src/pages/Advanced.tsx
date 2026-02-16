import { useState, useEffect, useRef, useMemo } from "react";
import {
  Wand2,
  Upload,
  Video,
  Music,
  X,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  Play,
  Download,
  RotateCcw,
  Loader2,
  Terminal,
  ChevronDown,
  ChevronUp,
  Zap,
  Sparkles,
  MessageSquare,
  FileText,
  AlertCircle,
  Scissors,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useFFmpegRawProcessor, type LogEntry } from "@/hooks/useFFmpegRawProcessor";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

interface UploadedFile {
  id: string;
  file: File;
  type: "video" | "audio";
  mappedName: string;
}

const logTypeColors: Record<LogEntry["type"], string> = {
  info: "text-muted-foreground",
  warn: "text-warning",
  error: "text-destructive",
  progress: "text-primary",
};

const STEPS = [
  { label: "Upload", icon: Upload },
  { label: "Describe", icon: MessageSquare },
  { label: "Get Command", icon: FileText },
  { label: "Run", icon: Play },
];

const phaseLabels: Record<string, string> = {
  idle: "Initializing...",
  core: "Loading FFmpeg core...",
  wasm: "Loading WebAssembly module...",
  worker: "Loading multi-thread worker...",
  ready: "Ready",
};

export default function Advanced() {
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [prompt, setPrompt] = useState("");
  const [command, setCommand] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const processor = useFFmpegRawProcessor();

  useEffect(() => {
    processor.load();
  }, [processor.load]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [processor.logs]);

  // Build the ChatGPT prompt
  const generatedPrompt = useMemo(() => {
    if (files.length === 0) return "";

    const fileDescriptions = files
      .map((f, i) => {
        const sizeMB = (f.file.size / 1024 / 1024).toFixed(2);
        return `- File ${i + 1}: "${f.mappedName}" (${f.type}, ${sizeMB} MB, original: "${f.file.name}")`;
      })
      .join("\n");

    return `I need an FFmpeg command to process media files in my browser using ffmpeg.wasm (version 5.1.4).

**My files:**
${fileDescriptions}

**What I want to do:**
${prompt}

**Important constraints for ffmpeg.wasm compatibility:**
1. Use ONLY these input filenames exactly as listed above (e.g., ${files.map((f) => `"${f.mappedName}"`).join(", ")})
2. The output file MUST be named "output.mp4" for video or "output.mp3" for audio
3. Use libx264 for video encoding (H.265/HEVC is NOT supported)
4. Use aac for audio encoding in video files, or libmp3lame for MP3 output
5. Add "-y" flag to overwrite output
6. Add "-movflags +faststart" for MP4 output
7. Use "-pix_fmt yuv420p" for maximum compatibility
8. Do NOT use hardware acceleration flags (no -hwaccel, no cuda, no vaapi)
9. Do NOT use "-threads" flag (threading is handled by the runtime)
10. Keep the command as a single ffmpeg command (no piping or chaining)

Please provide ONLY the ffmpeg command, nothing else. Start with "ffmpeg" directly.`;
  }, [files, prompt]);

  const addFile = (file: File, type: "video" | "audio") => {
    const ext = file.name.split(".").pop() || (type === "video" ? "mp4" : "mp3");
    const idx = files.filter((f) => f.type === type).length;
    const mappedName = `input_${type}${idx > 0 ? idx + 1 : ""}.${ext}`;
    setFiles((prev) => [
      ...prev,
      { id: crypto.randomUUID(), file, type, mappedName },
    ]);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(generatedPrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleRun = () => {
    if (!command.trim()) return;
    const mapped = files.map((f) => ({ name: f.mappedName, file: f.file }));
    processor.execute(command, mapped);
  };

  const handleDownload = () => {
    if (!processor.outputUrl) return;
    const ext = processor.outputType === "audio" ? "mp3" : "mp4";
    const a = document.createElement("a");
    a.href = processor.outputUrl;
    a.download = `output.${ext}`;
    a.click();
  };

  const handleReset = () => {
    processor.reset();
    setCommand("");
  };

  const canProceed = [
    files.length > 0,
    prompt.trim().length > 0,
    true, // step 2 always can proceed
    command.trim().length > 0,
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 glow-border">
                <Wand2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">
                  <span className="text-gradient">ClipStream</span>
                  <span className="text-muted-foreground font-normal text-sm ml-2">Advanced</span>
                </h1>
                <p className="text-xs text-muted-foreground">
                  AI-guided video & audio processing
                </p>
              </div>
            </div>
            <Link to="/">
              <Button variant="ghost" size="sm" className="text-xs">
                <Scissors className="h-3.5 w-3.5 mr-1" />
                Simple Mode
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <button
                key={s.label}
                onClick={() => i <= step && setStep(i)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                  isActive && "bg-primary text-primary-foreground",
                  isDone && "bg-primary/20 text-primary cursor-pointer",
                  !isActive && !isDone && "bg-secondary text-muted-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Step 0: Upload Files */}
        {step === 0 && (
          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Upload className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Upload your media files</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Add one or more video/audio files you want to process. These will be loaded into the browser for processing.
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              <FileDropZone type="video" onFile={(f) => addFile(f, "video")} />
              <FileDropZone type="audio" onFile={(f) => addFile(f, "audio")} />
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Uploaded files:</p>
                {files.map((f) => (
                  <div key={f.id} className="segment-card flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
                      {f.type === "video" ? (
                        <Video className="h-4 w-4 text-primary" />
                      ) : (
                        <Music className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Mapped as: <code className="font-mono text-primary">{f.mappedName}</code>
                        {" · "}
                        {(f.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <button
                      onClick={() => removeFile(f.id)}
                      className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 1: Describe what to do */}
        {step === 1 && (
          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Describe what you want to do</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Explain in plain language what you'd like to do with your files. Be specific about timing, effects, formats, etc.
            </p>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Example: Trim the video from 1:30 to 3:45, add a fade in at the start and fade out at the end, and convert to 720p resolution..."
              className="min-h-[120px] bg-secondary/50 border-border/50 font-sans text-sm"
            />
            <div className="flex flex-wrap gap-2">
              {[
                "Trim from 0:30 to 2:00",
                "Convert to 720p",
                "Extract audio as MP3",
                "Add fade in/out",
                "Compress to reduce file size",
                "Speed up 2x",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() =>
                    setPrompt((p) => (p ? `${p}\n${suggestion}` : suggestion))
                  }
                  className="text-xs px-2.5 py-1 rounded-full bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Get Command from ChatGPT */}
        {step === 2 && (
          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Get your FFmpeg command</h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 mt-0.5">
                  <span className="text-sm font-bold text-primary">1</span>
                </div>
                <div className="space-y-2 flex-1">
                  <p className="text-sm font-medium">Copy this prompt and paste it into ChatGPT</p>
                  <div className="code-block p-3 max-h-[250px] overflow-y-auto scrollbar-thin">
                    <pre className="text-xs whitespace-pre-wrap break-words text-foreground/80">
                      {generatedPrompt}
                    </pre>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleCopyPrompt} size="sm" variant="outline" className="text-xs">
                      {copiedPrompt ? (
                        <>
                          <Check className="h-3.5 w-3.5 mr-1 text-success" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 mr-1" />
                          Copy Prompt
                        </>
                      )}
                    </Button>
                    <a
                      href="https://chat.openai.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button size="sm" variant="outline" className="text-xs">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" />
                        Open ChatGPT
                      </Button>
                    </a>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 mt-0.5">
                  <span className="text-sm font-bold text-primary">2</span>
                </div>
                <div className="space-y-2 flex-1">
                  <p className="text-sm font-medium">Paste the FFmpeg command you got back</p>
                  <Textarea
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder='Paste the ffmpeg command here, e.g.: ffmpeg -i input_video.mp4 -ss 90 -t 135 -c:v libx264 ...'
                    className="min-h-[80px] bg-secondary/50 border-border/50 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Run & Preview */}
        {step === 3 && (
          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Play className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Run & Preview</h2>
              {processor.isReady && processor.isMultiThreaded && (
                <span className="flex items-center gap-1 text-xs text-success font-medium">
                  <Zap className="h-3 w-3" />
                  Multi-threaded
                </span>
              )}
            </div>

            {/* Command preview */}
            <div className="code-block p-3 max-h-[120px] overflow-y-auto scrollbar-thin">
              <pre className="text-xs whitespace-pre-wrap break-all text-foreground/80 font-mono">
                {command}
              </pre>
            </div>

            {/* Loading FFmpeg */}
            {processor.isLoading && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {phaseLabels[processor.loadPhase] || "Loading..."} {processor.loadProgress}%
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary/60 transition-all duration-300" style={{ width: `${processor.loadProgress}%` }} />
                </div>
              </div>
            )}

            {/* Error */}
            {processor.error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {processor.error}
              </div>
            )}

            {/* Processing */}
            {processor.isProcessing && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing... {processor.progress}%
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-300" style={{ width: `${processor.progress}%` }} />
                </div>
              </div>
            )}

            {/* Output */}
            {processor.outputUrl && (
              <div className="space-y-3">
                {processor.outputType === "video" ? (
                  <video src={processor.outputUrl} controls className="w-full rounded-lg border border-border" />
                ) : (
                  <audio src={processor.outputUrl} controls className="w-full" />
                )}
                <div className="flex gap-2">
                  <Button onClick={handleDownload} size="sm" className="flex-1">
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                  <Button onClick={handleReset} variant="outline" size="sm">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Run button */}
            {!processor.isProcessing && !processor.outputUrl && (
              <Button
                onClick={handleRun}
                disabled={!processor.isReady || !command.trim()}
                size="sm"
                className="w-full"
              >
                <Play className="h-4 w-4 mr-1" />
                Run FFmpeg Command
              </Button>
            )}

            {/* Logs */}
            {processor.logs.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-secondary/50 hover:bg-secondary/70 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Logs</span>
                    <span className="text-xs text-muted-foreground">({processor.logs.length})</span>
                  </div>
                  {showLogs ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
                {showLogs && (
                  <div ref={logRef} className="max-h-48 overflow-y-auto bg-background/50 p-2 font-mono text-xs space-y-0.5">
                    {processor.logs.map((log, i) => (
                      <div key={i} className={`${logTypeColors[log.type]} leading-relaxed`}>
                        <span className="text-muted-foreground/60">[{log.timestamp.toLocaleTimeString()}]</span> {log.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between">
          <Button
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
            variant="outline"
            size="sm"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          {step < 3 && (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed[step]}
              size="sm"
            >
              Next
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-border/50 pt-4">
          <p className="text-xs text-muted-foreground text-center">
            Made with ❤️ by{" "}
            <a href="https://techforpeace.co.in" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              techforpeace.co.in
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}

/* ────────────────────────── File Drop Zone ────────────────────────── */

function FileDropZone({ type, onFile }: { type: "video" | "audio"; onFile: (f: File) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const Icon = type === "video" ? Video : Music;
  const accept = type === "video" ? "video/*" : "audio/*,.mkv";
  const label = type === "video" ? "Video File" : "Audio File";
  const inputId = `adv-file-${type}-${Math.random().toString(36).slice(2)}`;

  return (
    <div
      className={cn("file-drop-zone p-6 text-center", isDragging && "active")}
      onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        type="file"
        accept={accept}
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }}
        className="hidden"
        id={inputId}
      />
      <label htmlFor={inputId} className="cursor-pointer block">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
            <Icon className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">Drag & drop or click</p>
        </div>
      </label>
    </div>
  );
}
