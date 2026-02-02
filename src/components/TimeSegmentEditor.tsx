import { useState } from "react";
import type { TimeSegment } from "@/types/clip";
import { parseTimeSegments } from "@/utils/parseTimeSegments";
import { Edit2, Plus, Trash2, X, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface TimeSegmentEditorProps {
  segments: TimeSegment[];
  onSegmentsChange: (segments: TimeSegment[]) => void;
}

export function TimeSegmentEditor({
  segments,
  onSegmentsChange,
}: TimeSegmentEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const handleEditClick = () => {
    const text = segments.map((s) => `${s.start}-${s.end}`).join("\n");
    setEditText(text);
    setIsEditing(true);
  };

  const handleSave = () => {
    const newSegments = parseTimeSegments(editText);
    // Preserve fade settings for matching segments
    const updatedSegments = newSegments.map((newSeg) => {
      const existing = segments.find(
        (s) => s.start === newSeg.start && s.end === newSeg.end,
      );
      if (existing) {
        return {
          ...newSeg,
          fadeIn: existing.fadeIn,
          fadeOut: existing.fadeOut,
        };
      }
      return newSeg;
    });
    onSegmentsChange(updatedSegments);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditText("");
  };

  const toggleFadeIn = (id: string) => {
    onSegmentsChange(
      segments.map((s) => (s.id === id ? { ...s, fadeIn: !s.fadeIn } : s)),
    );
  };

  const toggleFadeOut = (id: string) => {
    onSegmentsChange(
      segments.map((s) => (s.id === id ? { ...s, fadeOut: !s.fadeOut } : s)),
    );
  };

  const removeSegment = (id: string) => {
    onSegmentsChange(segments.filter((s) => s.id !== id));
  };

  const addEmptySegment = () => {
    const newSegment: TimeSegment = {
      id: Math.random().toString(36).substring(2, 15),
      start: "00:00",
      end: "00:00",
      fadeIn: false,
      fadeOut: false,
    };
    onSegmentsChange([...segments, newSegment]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Time Segments</h3>
        <div className="flex gap-2">
          {!isEditing && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={addEmptySegment}
                className="h-7 px-2 text-xs"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleEditClick}
                className="h-7 px-2 text-xs"
              >
                <Edit2 className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="Paste time ranges, one per line:
26:05-27:27
28:41-28:53
30:21-32:50"
            className="min-h-[120px] font-mono text-sm bg-secondary border-border"
          />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Check className="h-4 w-4 mr-1" />
              Apply
            </Button>
          </div>
        </div>
      ) : segments.length === 0 ? (
        <div className="segment-card text-center py-6">
          <p className="text-sm text-muted-foreground">
            No segments defined. Click "Edit" to paste time ranges.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[280px] overflow-y-auto scrollbar-thin pr-1">
          {segments.map((segment, index) => (
            <div key={segment.id} className="segment-card">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-5">
                  {index + 1}.
                </span>
                <div className="flex-1 font-mono text-sm">
                  {segment.start}{" "}
                  <span className="text-muted-foreground">→</span> {segment.end}
                </div>
                <button
                  onClick={() => removeSegment(segment.id)}
                  className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex gap-4 mt-2 ml-8">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={segment.fadeIn}
                    onCheckedChange={() => toggleFadeIn(segment.id)}
                    className="scale-75"
                  />
                  Fade In
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={segment.fadeOut}
                    onCheckedChange={() => toggleFadeOut(segment.id)}
                    className="scale-75"
                  />
                  Fade Out
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
