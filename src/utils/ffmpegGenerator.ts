import type { ClipConfig } from "@/types/clip";

// Extended File interface to include path property for desktop environments
// Browser File objects don't expose paths for security reasons
// But in Electron/NW.js apps, the File object may have a path property
interface FileWithPath extends File {
  path?: string;
}

function timeToSeconds(time: string): number {
  const parts = time.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

export function generateFFmpegCommand(config: ClipConfig): string {
  if (!config.videoFile || config.segments.length === 0) {
    return "# Please add a video file and at least one time segment";
  }

  // Try to get absolute paths from file objects
  // In browser environments, File objects don't expose paths for security reasons
  // In desktop environments (Electron, Node.js), the path property may be available
  const videoFileWithPath = config.videoFile as FileWithPath;
  const audioFileWithPath = config.audioFile as FileWithPath | undefined;

  // Use actual file paths if available, otherwise fall back to just filenames
  // NOTE: In browsers, videoFileWithPath.path will always be undefined, so we get filenames only
  // In desktop apps, this would return full paths like "/Users/username/video.mp4"
  const videoFilePath = videoFileWithPath.path || config.videoFile.name;
  const audioFilePath =
    audioFileWithPath?.path ||
    (config.audioFile ? config.audioFile.name : undefined);

  // Current behavior in browser:
  // videoFilePath = "video.mp4" (filename only)
  // audioFilePath = "audio.mp3" (filename only, if provided)
  //
  // Expected behavior in desktop app:
  // videoFilePath = "/full/path/to/video.mp4" (absolute path)
  // audioFilePath = "/full/path/to/audio.mp3" (absolute path, if provided)

  const baseName = config.videoFile.name.replace(/\.[^/.]+$/, "");
  const outputName = `${baseName}-clipped.mp4`;

  // For output path, use current directory if running in desktop environment
  // or just the filename for browser environments
  const outputPath = videoFileWithPath.path
    ? `${videoFileWithPath.path.replace(/[^/]*$/, "")}${outputName}`
    : outputName;

  const fadeDuration = config.fadeDuration;
  const numSegments = config.segments.length;

  // Build filter_complex for all segments in one command
  const videoFilters: string[] = [];
  const audioFilters: string[] = [];
  const concatInputs: string[] = [];

  config.segments.forEach((seg, i) => {
    const startSec = timeToSeconds(seg.start);
    const endSec = timeToSeconds(seg.end);
    const duration = endSec - startSec;

    const shouldFadeIn = seg.fadeIn || (i === 0 && config.globalFadeIn);
    const shouldFadeOut =
      seg.fadeOut || (i === numSegments - 1 && config.globalFadeOut);

    // Video filter chain for this segment
    let vFilter = `[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS`;
    if (shouldFadeIn) {
      vFilter += `,fade=t=in:st=0:d=${fadeDuration}`;
    }
    if (shouldFadeOut) {
      vFilter += `,fade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`;
    }
    vFilter += `[v${i}]`;
    videoFilters.push(vFilter);

    // Audio filter chain for this segment
    const audioInput = audioFilePath ? "1:a" : "0:a";
    let aFilter = `[${audioInput}]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS`;
    if (shouldFadeIn) {
      aFilter += `,afade=t=in:st=0:d=${fadeDuration}`;
    }
    if (shouldFadeOut) {
      aFilter += `,afade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`;
    }
    aFilter += `[a${i}]`;
    audioFilters.push(aFilter);

    concatInputs.push(`[v${i}][a${i}]`);
  });

  // Build the complete filter_complex
  const allFilters = [...videoFilters, ...audioFilters];

  // Add concat filter
  const concatFilter = `${concatInputs.join("")}concat=n=${numSegments}:v=1:a=1[outv][outa]`;
  allFilters.push(concatFilter);

  const filterComplex = allFilters.join(";\n  ");

  // Build the command with actual file paths when available
  let cmd = `ffmpeg -i "${videoFilePath}"`;
  if (audioFilePath) {
    cmd += ` \\\n  -i "${audioFilePath}"`;
  }
  cmd += ` \\\n  -filter_complex "\n  ${filterComplex}\n  "`;
  cmd += ` \\\n  -map "[outv]" -map "[outa]"`;
  cmd += ` \\\n  -c:v libx264 -c:a aac "${outputPath}"`;

  return cmd;
}
