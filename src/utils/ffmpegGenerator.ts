import type { ClipConfig } from "@/types/clip";

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

  const videoFileName = config.videoFile.name;
  const audioFileName = config.audioFile?.name;
  const baseName = videoFileName.replace(/\.[^/.]+$/, "");
  const outputName = `${baseName}_clipped.mp4`;
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
    const audioInput = audioFileName ? "1:a" : "0:a";
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
  // Build the command
  let cmd = `ffmpeg -i "${videoFileName}"`;
  if (audioFileName) {
    cmd += ` \\\n  -i "${audioFileName}"`;
  }
  cmd += ` \\\n  -filter_complex "\n  ${filterComplex}\n  "`;
  cmd += ` \\\n  -map "[outv]" -map "[outa]"`;
  cmd += ` \\\n  -c:v libx264 -c:a aac "${outputName}"`;

  return cmd;
}
