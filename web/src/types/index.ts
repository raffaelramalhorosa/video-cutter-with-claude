export interface Keep {
  in: number
  out: number
  in_frame: number
  out_frame: number
}

export interface Params {
  threshold: number
  min_silence: number
  margin: number
  min_clip: number
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface Issue {
  trecho: string
  correcao: string
  tipo: string
  nota: string
}

export interface AnalysisSegment {
  index: number
  issues: Issue[]
  suggestion?: string
  cut?: boolean
}

export interface Chapter {
  title: string
  start_s: number
}

export interface MotionItem {
  frase: string
  start_s: number
  end_s: number
}

export interface EditSuggestion {
  start_s: number
  end_s: number
  tipo: string
  sugestao: string
}

export interface Analysis {
  available: boolean
  summary: string
  segments: AnalysisSegment[]
  chapters?: Chapter[]
  motion_design?: MotionItem[]
  edit_suggestions?: EditSuggestion[]
}

export interface MotionEntry {
  generating: boolean
  path?: string
  included: boolean
  ts?: number
  position: string
  animationStyle: string
  entryDirection: string
  accentWord: string
  accentColor: string
  showBgBox: boolean
  capsMode: boolean
  staggerSpeed: number
}

export interface MediaMeta {
  duration: number
  fps: number
  width: number
  height: number
  channels: number
}

export interface SegOverlay {
  status: 'kept' | 'cut' | 'partial'
  tl_start_s?: number
  tl_end_s?: number
}

export interface DetectResult {
  keeps: Keep[]
  stats: { duration: number; kept: number; removed: number; cuts: number }
  transcript_overlay: SegOverlay[]
}

export interface ExportOpts {
  includeSrt: boolean
  includeMotion: boolean
  includeChapters: boolean
}
