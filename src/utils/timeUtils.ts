/**
 * Validates a time string format (H:MM:SS, MM:SS, or SS).
 * Returns true if the format and ranges are valid.
 */
export function isValidTimeString(time: string): boolean {
  const trimmed = time.trim();
  if (!/^\d{1,3}:\d{2}(:\d{2})?$|^\d+$/.test(trimmed)) return false;

  const parts = trimmed.split(":").map(Number);
  if (parts.some((p) => isNaN(p) || p < 0)) return false;

  if (parts.length === 3) {
    // H:MM:SS — hours unlimited, minutes < 60, seconds < 60
    return parts[1] < 60 && parts[2] < 60;
  } else if (parts.length === 2) {
    // MM:SS — minutes unlimited, seconds < 60
    return parts[1] < 60;
  }
  return parts.length === 1;
}

export function timeToSeconds(time: string): number {
  const trimmed = time.trim();
  if (!isValidTimeString(trimmed)) {
    return 0;
  }

  const parts = trimmed.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}
