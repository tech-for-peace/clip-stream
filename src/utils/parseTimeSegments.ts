import type { TimeSegment } from "@/types/clip";

// Generate simple unique IDs without external dependency
function generateId(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

export function parseTimeSegments(input: string): TimeSegment[] {
  const segments: TimeSegment[] = [];

  // Split by newlines, commas, or semicolons
  const lines = input
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Match patterns like "26:05-27:27" or "1:26:05-1:27:27" or "26:05 - 27:27"
    const match = line.match(
      /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)/,
    );

    if (match) {
      segments.push({
        id: generateId(),
        start: match[1],
        end: match[2],
        fadeIn: false,
        fadeOut: false,
      });
    }
  }

  return segments;
}

export function formatSegmentDisplay(segment: TimeSegment): string {
  return `${segment.start} → ${segment.end}`;
}

export function validateTimeFormat(time: string): boolean {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(time);
}
