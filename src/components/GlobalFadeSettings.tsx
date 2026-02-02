import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Settings } from "lucide-react";

interface GlobalFadeSettingsProps {
  fadeIn: boolean;
  fadeOut: boolean;
  fadeDuration: number;
  onFadeInChange: (value: boolean) => void;
  onFadeOutChange: (value: boolean) => void;
  onFadeDurationChange: (value: number) => void;
}

export function GlobalFadeSettings({
  fadeIn,
  fadeOut,
  fadeDuration,
  onFadeInChange,
  onFadeOutChange,
  onFadeDurationChange,
}: GlobalFadeSettingsProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">Global Fade Settings</h3>
      </div>

      <div className="segment-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Fade In at Start</p>
            <p className="text-xs text-muted-foreground">
              Apply fade in to the first segment
            </p>
          </div>
          <Switch checked={fadeIn} onCheckedChange={onFadeInChange} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Fade Out at End</p>
            <p className="text-xs text-muted-foreground">
              Apply fade out to the last segment
            </p>
          </div>
          <Switch checked={fadeOut} onCheckedChange={onFadeOutChange} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Fade Duration</p>
            <span className="text-sm text-muted-foreground font-mono">
              {fadeDuration}s
            </span>
          </div>
          <Slider
            value={[fadeDuration]}
            onValueChange={([value]) => onFadeDurationChange(value)}
            min={0.5}
            max={5}
            step={0.5}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}
