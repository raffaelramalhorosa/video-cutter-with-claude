import { create } from 'zustand'
import type { Keep, Params, TranscriptSegment, Analysis, MotionEntry, ExportOpts, MediaMeta } from '../types'
import {
  apiInfo, apiDetect, apiExport, apiAnalysis, apiTranscribe,
  apiExportSrt, apiPick, apiMotionRender,
} from '../api/client'

interface Status { msg: string; ok: boolean }

interface AppState {
  // vídeo
  dur: number
  mediaMeta: MediaMeta | null
  videoLabel: string
  videoDir: string

  // cortes
  keeps: Keep[]
  manualCuts: [number, number][]
  params: Params

  // reprodução
  skipMode: boolean

  // transcrição + análise
  transSegs: TranscriptSegment[]
  transLang: string
  analysis: Analysis | null
  analysisPollTimer: ReturnType<typeof setInterval> | null
  motionState: Record<number, MotionEntry>

  // UI
  activeTab: 'revisao' | 'motion'
  status: Status
  transStatus: Status
  exportModalOpen: boolean

  // actions
  init: () => Promise<void>
  detect: () => Promise<void>
  pickVideo: () => Promise<void>
  transcribe: () => Promise<void>
  loadAnalysis: () => Promise<void>
  startAnalysisPoll: () => void
  stopAnalysisPoll: () => void
  applyAnalysis: (a: Analysis) => void
  exportXml: (opts: ExportOpts) => Promise<void>
  setParams: (p: Partial<Params>) => void
  toggleManualCut: (start: number, end: number) => void
  applyAllCuts: (indices: number[]) => void
  updateTransSeg: (i: number, text: string) => void
  setMotionState: (i: number, p: Partial<MotionEntry>) => void
  generateMotion: (i: number) => Promise<void>
  setSkipMode: (on: boolean) => void
  setActiveTab: (t: 'revisao' | 'motion') => void
  setTransLang: (l: string) => void
}

const defaultMotionEntry = (): MotionEntry => ({
  generating: false,
  path: undefined,
  included: true,
  ts: 0,
  position: 'bottom',
  animationStyle: 'spring',
  entryDirection: 'bottom',
  accentWord: '',
  accentColor: 'amber',
  showBgBox: false,
  capsMode: false,
  staggerSpeed: 1,
})

export const useAppStore = create<AppState>((set, get) => ({
  dur: 0,
  mediaMeta: null,
  videoLabel: '',
  videoDir: '',
  keeps: [],
  manualCuts: [],
  params: { threshold: -30, min_silence: 0.5, margin: 0.15, min_clip: 0.3 },
  skipMode: false,
  transSegs: [],
  transLang: 'pt',
  analysis: null,
  analysisPollTimer: null,
  motionState: {},
  activeTab: 'revisao',
  status: { msg: '', ok: false },
  transStatus: { msg: '', ok: false },
  exportModalOpen: false,

  init: async () => {
    try {
      const d = await apiInfo()
      set({
        dur: d.media.duration,
        mediaMeta: d.media,
        videoLabel: d.video,
        videoDir: d.video_dir ?? '',
        params: {
          threshold: d.defaults.threshold,
          min_silence: d.defaults.min_silence,
          margin: d.defaults.margin,
          min_clip: d.defaults.min_clip,
        },
      })
      await get().detect()
    } catch (e) {
      set({ status: { msg: 'Erro ao carregar informações do vídeo.', ok: false } })
    }
  },

  detect: async () => {
    const { params, manualCuts } = get()
    try {
      const d = await apiDetect({ ...params, manual_cuts: manualCuts })
      set({ keeps: d.keeps })
    } catch (e) {
      set({ status: { msg: 'Erro ao calcular cortes.', ok: false } })
    }
  },

  pickVideo: async () => {
    set({ status: { msg: 'Abrindo explorador de arquivos…', ok: false } })
    try {
      const d = await apiPick()
      if (d.cancelled) { set({ status: { msg: '', ok: false } }); return }
      if (!d.ok) { set({ status: { msg: 'Erro: ' + (d.error ?? 'falha'), ok: false } }); return }
      get().stopAnalysisPoll()
      set({
        dur: d.media.duration,
        mediaMeta: d.media,
        videoLabel: d.video,
        videoDir: d.video_dir ?? '',
        manualCuts: [],
        keeps: [],
        transSegs: [],
        analysis: null,
        motionState: {},
        status: { msg: 'Vídeo carregado: ' + d.video, ok: true },
        transStatus: { msg: '', ok: false },
      })
      await get().detect()
      await get().transcribe()
    } catch (e) {
      set({ status: { msg: 'Erro ao abrir vídeo.', ok: false } })
    }
  },

  transcribe: async () => {
    const { transLang } = get()
    set({
      transSegs: [],
      analysis: null,
      motionState: {},
      transStatus: { msg: '', ok: false },
    })
    try {
      const d = await apiTranscribe({ language: transLang })
      if (!d.ok) {
        set({ transStatus: { msg: 'Erro: ' + (d.error ?? 'falha'), ok: false } })
        return
      }
      set({
        transSegs: d.segments,
        transStatus: {
          msg: `${d.count} segmentos · ${d.model} — edite os textos e clique em Exportar legenda`,
          ok: true,
        },
      })
      get().startAnalysisPoll()
    } catch (e) {
      set({ transStatus: { msg: 'Erro ao transcrever.', ok: false } })
    }
  },

  loadAnalysis: async () => {
    set({ transStatus: { msg: 'Carregando análise…', ok: false } })
    try {
      const d = await apiAnalysis()
      if (!d.available) {
        set({ transStatus: { msg: 'Nenhuma análise ainda. Peça ao Claude: "analise a transcrição".', ok: false } })
        return
      }
      get().applyAnalysis(d)
      const n = (d.segments ?? []).reduce((a: number, s) => a + (s.issues?.length ?? 0), 0)
      set({ transStatus: { msg: `Análise carregada · ${n} apontamento(s).`, ok: true } })
    } catch (e) {
      set({ transStatus: { msg: 'Erro ao carregar análise.', ok: false } })
    }
  },

  startAnalysisPoll: () => {
    get().stopAnalysisPoll()
    let tries = 0
    const timer = setInterval(async () => {
      tries++
      if (tries > 150) { get().stopAnalysisPoll(); return }
      try {
        const d = await apiAnalysis()
        if (d.available) {
          get().applyAnalysis(d)
          const n = (d.segments ?? []).reduce((a: number, s) => a + (s.issues?.length ?? 0), 0)
          set({ transStatus: { msg: `Análise carregada automaticamente · ${n} apontamento(s).`, ok: true } })
          get().stopAnalysisPoll()
        }
      } catch (_) {}
    }, 4000)
    set({ analysisPollTimer: timer })
  },

  stopAnalysisPoll: () => {
    const t = get().analysisPollTimer
    if (t) clearInterval(t)
    set({ analysisPollTimer: null })
  },

  applyAnalysis: (a: Analysis) => {
    set({ analysis: a })
  },

  exportXml: async (opts: ExportOpts) => {
    set({ status: { msg: 'Exportando…', ok: false } })
    const { params, manualCuts, analysis, transSegs, motionState } = get()
    const motionIndices = opts.includeMotion
      ? Object.keys(motionState).filter((i) => motionState[+i].path && motionState[+i].included).map(Number)
      : []
    try {
      const d = await apiExport({
        ...params,
        manual_cuts: manualCuts,
        seq_name: 'Auto-Cut',
        chapters_on: opts.includeChapters && !!(analysis?.chapters?.length),
        motion_indices: motionIndices,
      })
      if (!d.ok) { set({ status: { msg: 'Erro: ' + (d.error ?? 'falha'), ok: false } }); return }
      let msg = `XML gerado (${d.cuts} cortes)`
      if (motionIndices.length) msg += ` · ${motionIndices.length} motion`
      if (opts.includeSrt && transSegs.length) {
        try {
          const sd = await apiExportSrt({ segments: transSegs })
          msg += sd.ok ? ` · legenda (${sd.count} seg)` : ' · falha na legenda'
        } catch (_) { msg += ' · falha na legenda' }
      }
      set({ status: { msg: `${msg} → ${d.xml_path}`, ok: true } })
    } catch (e) {
      set({ status: { msg: 'Erro ao exportar.', ok: false } })
    }
  },

  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

  toggleManualCut: (start, end) => {
    const { manualCuts } = get()
    const exists = manualCuts.some(([s, e]) => s === start && e === end)
    const next = exists
      ? manualCuts.filter(([s, e]) => !(s === start && e === end))
      : [...manualCuts, [start, end] as [number, number]]
    set({ manualCuts: next })
    get().detect()
  },

  applyAllCuts: (indices) => {
    const { transSegs, manualCuts } = get()
    const next = [...manualCuts]
    for (const idx of indices) {
      const s = transSegs[idx]
      if (s && !next.some(([a, b]) => a === s.start && b === s.end)) {
        next.push([s.start, s.end])
      }
    }
    set({ manualCuts: next })
    get().detect()
  },

  updateTransSeg: (i, text) => {
    set((s) => {
      const segs = [...s.transSegs]
      segs[i] = { ...segs[i], text }
      return { transSegs: segs }
    })
  },

  setMotionState: (i, p) => {
    set((s) => ({
      motionState: {
        ...s.motionState,
        [i]: { ...(s.motionState[i] ?? defaultMotionEntry()), ...p },
      },
    }))
  },

  generateMotion: async (i) => {
    const { motionState, analysis } = get()
    const item = analysis?.motion_design?.[i]
    if (!item) return
    const st = motionState[i] ?? defaultMotionEntry()
    get().setMotionState(i, { generating: true })
    try {
      const d = await apiMotionRender({
        index: i,
        frase: item.frase,
        start_s: item.start_s,
        end_s: item.end_s,
        position: st.position,
        animationStyle: st.animationStyle,
        entryDirection: st.entryDirection,
        accentWord: st.accentWord,
        accentColor: st.accentColor,
        showBgBox: st.showBgBox,
        capsMode: st.capsMode,
        staggerSpeed: st.staggerSpeed,
      })
      if (d.ok) {
        get().setMotionState(i, { generating: false, path: d.path, included: true, ts: Date.now() })
      } else {
        get().setMotionState(i, { generating: false })
      }
    } catch (_) {
      get().setMotionState(i, { generating: false })
    }
  },

  setSkipMode: (on) => set({ skipMode: on }),
  setActiveTab: (t) => set({ activeTab: t }),
  setTransLang: (l) => set({ transLang: l }),
}))
