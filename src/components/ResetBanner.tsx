import { RotateCcw } from "lucide-react";
import { ffmpegFullReset } from "@/utils/ffmpegCleanup";
import { useState } from "react";

/**
 * Lightweight reset button shown in the app footer.
 * Allows users stuck in a bad browser state to clear FFmpeg caches and reload.
 */
export function ResetBanner() {
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    await ffmpegFullReset();
    // page will reload, but just in case:
    setResetting(false);
  };

  return (
    <button
      onClick={handleReset}
      disabled={resetting}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      title="Clear FFmpeg caches and reload. Use if the page is unresponsive or won't load."
    >
      <RotateCcw className="h-3 w-3" />
      {resetting ? "Resetting..." : "Reset Video Engine"}
    </button>
  );
}
