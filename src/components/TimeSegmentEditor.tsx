import { useState } from "react";
import type { TimeSegment } from "@/types/clip";
import { parseTimeSegments } from "@/utils/parseTimeSegments";
import { Edit2, Plus, Trash2, X, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface SegmentRowProps {
  segment: TimeSegment;
  index: number;
  onUpdate: (segment: TimeSegment) => void;
  onRemove: () => void;
  onToggleFadeIn: () => void;
  onToggleFadeOut: () => void;
}

function SegmentRow({
  segment,
  index,
  onUpdate,
  onRemove,
  onToggleFadeIn,
  onToggleFadeOut,
}: SegmentRowProps) {
  const [editStart, setEditStart] = useState(segment.start);
  const [editEnd, setEditEnd] = useState(segment.end);
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = () => {
    onUpdate({ ...segment, start: editStart, end: editEnd });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditStart(segment.start);
    setEditEnd(segment.end);
    setIsEditing(false);
  };

  return (
    <div className="segment-card">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-4">{index + 1}.</span>
        {isEditing ? (
          <>
            <input
              type="text"
              value={editStart}
              onChange={(e) => setEditStart(e.target.value)}
              className="w-20 px-1.5 py-0.5 text-sm font-mono bg-secondary border border-border rounded"
              placeholder="00:00"
            />
            <span className="text-muted-foreground text-xs">→</span>
            <input
              type="text"
              value={editEnd}
              onChange={(e) => setEditEnd(e.target.value)}
              className="w-20 px-1.5 py-0.5 text-sm font-mono bg-secondary border border-border rounded"
              placeholder="00:00"
            />
            <button
              onClick={handleSave}
              className="p-1 rounded hover:bg-primary/20 text-primary transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleCancel}
              className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <div
              onClick={() => setIsEditing(true)}
              className="flex-1 font-mono text-sm cursor-pointer hover:text-primary transition-colors"
            >
              {segment.start} <span className="text-muted-foreground">→</span>{" "}
              {segment.end}
            </div>
            <button
              onClick={onRemove}
              className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      <div className="flex gap-3 mt-1.5 ml-6">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={segment.fadeIn}
            onCheckedChange={onToggleFadeIn}
            className="scale-[0.6]"
          />
          In
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={segment.fadeOut}
            onCheckedChange={onToggleFadeOut}
            className="scale-[0.6]"
          />
          Out
        </label>
      </div>
    </div>
  );
}

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
            <SegmentRow
              key={segment.id}
              segment={segment}
              index={index}
              onUpdate={(updated) =>
                onSegmentsChange(
                  segments.map((s) => (s.id === updated.id ? updated : s))
                )
              }
              onRemove={() => removeSegment(segment.id)}
              onToggleFadeIn={() => toggleFadeIn(segment.id)}
              onToggleFadeOut={() => toggleFadeOut(segment.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
