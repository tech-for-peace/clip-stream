import type { ClipConfig } from "@/types/clip";
import { timeToSeconds } from "@/utils/timeUtils";

/**
 * Sanitize a filename/path for safe shell command embedding.
 * Escapes characters that could enable command injection when
 * the generated command is copied and executed in a terminal.
 */
function shellEscape(str: string): string {
  // Replace backslashes first, then escape all shell-sensitive characters
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/!/g, "\\!")
    .replace(/\n/g, "")
    .replace(/\r/g, "");
}

// Extended File interface to include path property for desktop environments
// Browser File objects don't expose paths for security reasons
// But in Electron/NW.js apps, the File object may have a path property
interface FileWithPath extends File {
  path?: string;
}

export function generateFFmpegCommand(config: ClipConfig): string {
  if (!config.videoFile || config.segments.length === 0) {
    return "# Please add a video file and at least one time segment";
  }

  const videoFileWithPath = config.videoFile as FileWithPath;
  const audioFileWithPath = config.audioFile as FileWithPath | undefined;

  const videoFilePath = shellEscape(videoFileWithPath.path || config.videoFile.name);
  const audioFilePath = audioFileWithPath?.path
    ? shellEscape(audioFileWithPath.path)
    : config.audioFile
      ? shellEscape(config.audioFile.name)
      : undefined;

  const baseName = config.videoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^/.]+$/, "");
  const outputName = `${baseName}-clipped.mp4`;

  const outputPath = videoFileWithPath.path
    ? `${shellEscape(videoFileWithPath.path.replace(/[^/]*$/, ""))}${outputName}`
    : outputName;

  const fadeDuration = config.fadeDuration;
  const numSegments = config.segments.length;

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

    let vFilter = `[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS`;
    if (shouldFadeIn) {
      vFilter += `,fade=t=in:st=0:d=${fadeDuration}`;
    }
    if (shouldFadeOut) {
      vFilter += `,fade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`;
    }
    vFilter += `[v${i}]`;
    videoFilters.push(vFilter);

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

  const allFilters = [...videoFilters, ...audioFilters];
  const concatFilter = `${concatInputs.join("")}concat=n=${numSegments}:v=1:a=1[outv][outa]`;
  allFilters.push(concatFilter);

  const filterComplex = allFilters.join(";\n  ");

  let cmd = `ffmpeg -i "${videoFilePath}"`;
  if (audioFilePath) {
    cmd += ` \\\n  -i "${audioFilePath}"`;
  }
  cmd += ` \\\n  -filter_complex "\n  ${filterComplex}\n  "`;
  cmd += ` \\\n  -map "[outv]" -map "[outa]"`;
  cmd += ` \\\n  -c:v libx264 -c:a aac "${outputPath}"`;

  return cmd;
}
