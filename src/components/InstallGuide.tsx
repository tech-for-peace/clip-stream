import { useState } from "react";
import { cn } from "@/lib/utils";
import { Apple, MonitorIcon, Laptop } from "lucide-react";

type OS = "mac" | "windows" | "linux";

const installInstructions: Record<OS, { title: string; steps: string[] }> = {
  mac: {
    title: "macOS",
    steps: [
      "# Using Homebrew (recommended)",
      "brew install ffmpeg",
      "",
      "# Or using MacPorts",
      "sudo port install ffmpeg",
      "",
      "# Verify installation",
      "ffmpeg -version",
    ],
  },
  windows: {
    title: "Windows",
    steps: [
      "# Using Chocolatey (recommended)",
      "choco install ffmpeg",
      "",
      "# Using winget",
      "winget install ffmpeg",
      "",
      "# Manual installation:",
      "# 1. Download from https://ffmpeg.org/download.html",
      "# 2. Extract to C:\\ffmpeg",
      "# 3. Add C:\\ffmpeg\\bin to your PATH",
      "",
      "# Verify installation",
      "ffmpeg -version",
    ],
  },
  linux: {
    title: "Linux",
    steps: [
      "# Ubuntu/Debian",
      "sudo apt update && sudo apt install ffmpeg",
      "",
      "# Fedora",
      "sudo dnf install ffmpeg",
      "",
      "# Arch Linux",
      "sudo pacman -S ffmpeg",
      "",
      "# Verify installation",
      "ffmpeg -version",
    ],
  },
};

const icons: Record<OS, React.ReactNode> = {
  mac: <Apple className="h-4 w-4" />,
  windows: <MonitorIcon className="h-4 w-4" />,
  linux: <Laptop className="h-4 w-4" />,
};

export function InstallGuide() {
  const [activeOS, setActiveOS] = useState<OS>("mac");

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Install FFmpeg</h3>

      <div className="flex gap-1 p-1 bg-secondary rounded-lg">
        {(["mac", "windows", "linux"] as OS[]).map((os) => (
          <button
            key={os}
            onClick={() => setActiveOS(os)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors",
              activeOS === os
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {icons[os]}
            {installInstructions[os].title}
          </button>
        ))}
      </div>

      <div className="code-block p-4 overflow-x-auto max-h-[300px] overflow-y-auto scrollbar-thin">
        <pre className="text-sm">
          {installInstructions[activeOS].steps.map((line, i) => (
            <div
              key={i}
              className={cn(
                line.startsWith("#")
                  ? "text-muted-foreground"
                  : "text-foreground/90",
              )}
            >
              {line || "\n"}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
