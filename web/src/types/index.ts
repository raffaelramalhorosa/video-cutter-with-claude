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

export interface WordTime {
  start: number
  end: number
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  words?: WordTime[]   // tempo de cada palavra (alinhado 1:1 com text.split(' '))
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

export interface CaptionBlock {
  id: string
  segIndex: number   // índice no transSegs original (para checar overlay de corte)
  start: number      // tempo absoluto no vídeo original
  end: number
  text: string
  effect?: string              // sobrescreve o efeito global (opcional)
  font?: string                // sobrescreve a fonte global (opcional)
  fontSize?: number            // sobrescreve o tamanho global em px (opcional)
  maxWidth?: number            // sobrescreve a largura máxima em % (opcional)
  removedWords?: number[]      // índices das palavras removidas do bloco
  words?: WordTime[]           // tempo de cada palavra (alinhado 1:1 com text.split(' '))
}

export interface CustomFont {
  name: string
  label: string
  url: string
}

export interface CaptionStyle {
  on: boolean
  bg: boolean
  wordsPerCaption: number
  effect: string
  font: string
  color: string
  strokeColor: string
  strokeWidth: number  // 0–8 px
  yPct: number          // posição vertical da legenda (% de cima para baixo)
  fontSize: number      // tamanho da fonte em px (padrão 20)
  maxWidth: number      // largura máxima do container em % do player (padrão 82)
  minChunkDur: number   // duração mínima por palavra/chunk em segundos (padrão 0.4)
  customFonts: CustomFont[]
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
