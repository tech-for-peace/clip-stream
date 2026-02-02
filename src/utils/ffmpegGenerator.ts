import { ClipConfig, TimeSegment } from "@/types/clip";

function timeToSeconds(time: string): number {
  const parts = time.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

function formatDuration(start: string, end: string): string {
  const startSec = timeToSeconds(start);
  const endSec = timeToSeconds(end);
  const duration = endSec - startSec;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function generateFFmpegCommand(config: ClipConfig): string {
  if (!config.videoFile || config.segments.length === 0) {
    return '# Please add a video file and at least one time segment';
  }

  const videoFileName = config.videoFile.name;
  const audioFileName = config.audioFile?.name;
  const outputName = config.outputName || 'output';
  const extension = videoFileName.split('.').pop() || 'mp4';
  const fadeDuration = config.fadeDuration;

  const lines: string[] = [];
  
  if (config.segments.length === 1) {
    // Single segment - simpler command
    const seg = config.segments[0];
    const startSec = timeToSeconds(seg.start);
    const endSec = timeToSeconds(seg.end);
    const duration = endSec - startSec;
    
    let filterComplex = '';
    const filters: string[] = [];
    
    // Video filters
    const videoFilters: string[] = [];
    const shouldFadeIn = seg.fadeIn || config.globalFadeIn;
    const shouldFadeOut = seg.fadeOut || config.globalFadeOut;
    
    if (shouldFadeIn) {
      videoFilters.push(`fade=t=in:st=0:d=${fadeDuration}`);
    }
    if (shouldFadeOut) {
      videoFilters.push(`fade=t=out:st=${duration - fadeDuration}:d=${fadeDuration}`);
    }
    
    // Audio filters
    const audioFilters: string[] = [];
    if (shouldFadeIn) {
      audioFilters.push(`afade=t=in:st=0:d=${fadeDuration}`);
    }
    if (shouldFadeOut) {
      audioFilters.push(`afade=t=out:st=${duration - fadeDuration}:d=${fadeDuration}`);
    }
    
    if (videoFilters.length > 0 || audioFilters.length > 0) {
      if (videoFilters.length > 0) {
        filters.push(`[0:v]${videoFilters.join(',')}[v]`);
      }
      if (audioFilters.length > 0) {
        const audioInput = audioFileName ? '1:a' : '0:a';
        filters.push(`[${audioInput}]${audioFilters.join(',')}[a]`);
      }
      filterComplex = `-filter_complex "${filters.join(';')}"`;
    }
    
    let cmd = `ffmpeg -ss ${seg.start} -i "${videoFileName}"`;
    if (audioFileName) {
      cmd += ` -i "${audioFileName}"`;
    }
    cmd += ` -t ${formatDuration(seg.start, seg.end)}`;
    
    if (filterComplex) {
      cmd += ` ${filterComplex}`;
      const maps = [];
      if (videoFilters.length > 0) maps.push('-map "[v]"');
      else maps.push('-map 0:v');
      if (audioFilters.length > 0) maps.push('-map "[a]"');
      else if (audioFileName) maps.push('-map 1:a');
      else maps.push('-map 0:a');
      cmd += ` ${maps.join(' ')}`;
    } else if (audioFileName) {
      cmd += ` -map 0:v -map 1:a`;
    }
    
    cmd += ` -c:v libx264 -c:a aac "${outputName}.${extension}"`;
    lines.push(cmd);
  } else {
    // Multiple segments - need to extract and concatenate
    lines.push('# Step 1: Extract segments');
    
    config.segments.forEach((seg, i) => {
      const startSec = timeToSeconds(seg.start);
      const endSec = timeToSeconds(seg.end);
      const duration = endSec - startSec;
      
      const shouldFadeIn = seg.fadeIn || (i === 0 && config.globalFadeIn);
      const shouldFadeOut = seg.fadeOut || (i === config.segments.length - 1 && config.globalFadeOut);
      
      let filterComplex = '';
      const filters: string[] = [];
      
      const videoFilters: string[] = [];
      if (shouldFadeIn) {
        videoFilters.push(`fade=t=in:st=0:d=${fadeDuration}`);
      }
      if (shouldFadeOut) {
        videoFilters.push(`fade=t=out:st=${duration - fadeDuration}:d=${fadeDuration}`);
      }
      
      const audioFilters: string[] = [];
      if (shouldFadeIn) {
        audioFilters.push(`afade=t=in:st=0:d=${fadeDuration}`);
      }
      if (shouldFadeOut) {
        audioFilters.push(`afade=t=out:st=${duration - fadeDuration}:d=${fadeDuration}`);
      }
      
      if (videoFilters.length > 0 || audioFilters.length > 0) {
        if (videoFilters.length > 0) {
          filters.push(`[0:v]${videoFilters.join(',')}[v]`);
        }
        if (audioFilters.length > 0) {
          const audioInput = audioFileName ? '1:a' : '0:a';
          filters.push(`[${audioInput}]${audioFilters.join(',')}[a]`);
        }
        filterComplex = `-filter_complex "${filters.join(';')}"`;
      }
      
      let cmd = `ffmpeg -ss ${seg.start} -i "${videoFileName}"`;
      if (audioFileName) {
        cmd += ` -i "${audioFileName}"`;
      }
      cmd += ` -t ${formatDuration(seg.start, seg.end)}`;
      
      if (filterComplex) {
        cmd += ` ${filterComplex}`;
        const maps = [];
        if (videoFilters.length > 0) maps.push('-map "[v]"');
        else maps.push('-map 0:v');
        if (audioFilters.length > 0) maps.push('-map "[a]"');
        else if (audioFileName) maps.push('-map 1:a');
        else maps.push('-map 0:a');
        cmd += ` ${maps.join(' ')}`;
      } else if (audioFileName) {
        cmd += ` -map 0:v -map 1:a`;
      }
      
      cmd += ` -c:v libx264 -c:a aac "segment_${i + 1}.${extension}"`;
      lines.push(cmd);
    });
    
    lines.push('');
    lines.push('# Step 2: Create file list (save as segments.txt)');
    config.segments.forEach((_, i) => {
      lines.push(`# file 'segment_${i + 1}.${extension}'`);
    });
    
    lines.push('');
    lines.push('# Step 3: Concatenate segments');
    lines.push(`ffmpeg -f concat -safe 0 -i segments.txt -c copy "${outputName}.${extension}"`);
    
    lines.push('');
    lines.push('# Step 4: Clean up (optional)');
    const cleanupFiles = config.segments.map((_, i) => `segment_${i + 1}.${extension}`).join(' ');
    lines.push(`# rm ${cleanupFiles} segments.txt`);
  }
  
  return lines.join('\n');
}
