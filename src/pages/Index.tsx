import { useState, useMemo } from "react";
import { FileUpload } from "@/components/FileUpload";
import { TimeSegmentEditor } from "@/components/TimeSegmentEditor";
import { GlobalFadeSettings } from "@/components/GlobalFadeSettings";
import { CommandOutput } from "@/components/CommandOutput";
import { InstallGuide } from "@/components/InstallGuide";

import type { ClipConfig } from "@/types/clip";
import { generateFFmpegCommand } from "@/utils/ffmpegGenerator";
import { Scissors, Sparkles } from "lucide-react";

const Index = () => {
  const [config, setConfig] = useState<ClipConfig>({
    videoFile: null,
    audioFile: null,
    segments: [],
    globalFadeIn: false,
    globalFadeOut: false,
    fadeDuration: 1,
  });

  const command = useMemo(() => generateFFmpegCommand(config), [config]);

  const updateConfig = <K extends keyof ClipConfig>(
    key: K,
    value: ClipConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 glow-border">
              <Scissors className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                <span className="text-gradient">ClipStream</span>
              </h1>
              <p className="text-xs text-muted-foreground">
                Generate FFmpeg commands for video clipping
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-7xl mx-auto px-4 py-4">
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Left Column - Configuration */}
          <div className="space-y-4">
            {/* File Inputs Section */}
            <section className="glass-panel p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Input Files</h2>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FileUpload
                  type="video"
                  file={config.videoFile}
                  onFileChange={(file) => updateConfig("videoFile", file)}
                />
                <FileUpload
                  type="audio"
                  file={config.audioFile}
                  onFileChange={(file) => updateConfig("audioFile", file)}
                  optional
                />
              </div>
            </section>

            {/* Time Segments & Global Fade Settings */}
            <section className="glass-panel p-4">
              <div className="grid md:grid-cols-2 gap-4">
                <TimeSegmentEditor
                  segments={config.segments}
                  onSegmentsChange={(segments) =>
                    updateConfig("segments", segments)
                  }
                />
                <GlobalFadeSettings
                  fadeIn={config.globalFadeIn}
                  fadeOut={config.globalFadeOut}
                  fadeDuration={config.fadeDuration}
                  onFadeInChange={(v) => updateConfig("globalFadeIn", v)}
                  onFadeOutChange={(v) => updateConfig("globalFadeOut", v)}
                  onFadeDurationChange={(v) => updateConfig("fadeDuration", v)}
                />
              </div>
            </section>
          </div>

          {/* Right Column - Output */}
          <div className="space-y-4">
            {/* Command Output */}
            <section className="glass-panel p-4">
              <CommandOutput command={command} />
            </section>

            {/* Installation Guide */}
            <section className="glass-panel p-4">
              <InstallGuide />
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-12">
        <div className="container max-w-7xl mx-auto px-4 py-4">
          <p className="text-xs text-muted-foreground text-center">
            ClipStream runs entirely in your browser. No data is sent to any
            server.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
