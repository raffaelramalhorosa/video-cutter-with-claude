import type { DetectResult, Keep, MediaMeta, Analysis, TranscriptSegment } from '../types'

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json() as Promise<T>
}

const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(path)
  return res.json() as Promise<T>
}

export interface InfoResponse {
  video: string
  media: MediaMeta
  video_dir: string
  defaults: { threshold: number; min_silence: number; margin: number; min_clip: number }
}

export const apiInfo = () => get<InfoResponse>('/api/info')

export const apiAnalysis = () => get<Analysis & { available: boolean }>('/api/analysis')

export const apiDetect = (params: {
  threshold: number
  min_silence: number
  margin: number
  min_clip: number
  manual_cuts: [number, number][]
}) => post<DetectResult>('/api/detect', params)

export const apiExport = (params: {
  threshold: number
  min_silence: number
  margin: number
  min_clip: number
  manual_cuts: [number, number][]
  seq_name: string
  chapters_on: boolean
  motion_indices: number[]
}) => post<{ ok: boolean; xml_path: string; cuts: number; error?: string }>('/api/export', params)

export const apiPreview = (params: {
  threshold: number
  min_silence: number
  margin: number
  min_clip: number
  manual_cuts: [number, number][]
}) => post<{ ok: boolean; path: string; error?: string }>('/api/preview', params)

export const apiTranscribe = (params: { language: string }) =>
  post<{ ok: boolean; segments: TranscriptSegment[]; count: number; model: string; error?: string }>(
    '/api/transcribe', params
  )

export const apiExportSrt = (params: { segments: TranscriptSegment[] }) =>
  post<{ ok: boolean; count: number; srt_path: string; error?: string }>('/api/export_srt', params)

export const apiPick = () =>
  post<{ ok: boolean; cancelled?: boolean; video: string; media: MediaMeta; video_dir: string; error?: string }>(
    '/api/pick', {}
  )

export const apiMotionRender = (params: {
  index: number
  frase: string
  start_s: number
  end_s: number
  position: string
  animationStyle: string
  entryDirection: string
  accentWord: string
  accentColor: string
  showBgBox: boolean
  capsMode: boolean
  staggerSpeed: number
}) => post<{ ok: boolean; path: string; error?: string }>('/api/motion/render', params)

export const motionPreviewUrl = (i: number, ts: number) => `/motion/${i}.preview.mp4?ts=${ts}`

export const keeps2ManualCuts = (keeps: Keep[]): [number, number][] =>
  keeps.map((k) => [k.in, k.out])
