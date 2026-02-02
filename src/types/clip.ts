export interface TimeSegment {
  id: string;
  start: string;
  end: string;
  fadeIn: boolean;
  fadeOut: boolean;
}

export interface ClipConfig {
  videoFile: File | null;
  audioFile: File | null;
  outputName: string;
  segments: TimeSegment[];
  globalFadeIn: boolean;
  globalFadeOut: boolean;
  fadeDuration: number;
}
