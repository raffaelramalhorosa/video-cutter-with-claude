import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Keep, Params, TranscriptSegment, Analysis, MotionEntry, ExportOpts, MediaMeta, SegOverlay, CaptionBlock, CaptionStyle, CustomFont, WaveformData, DetectSnapshot } from '../types'
import {
  apiInfo, apiDetect, apiExport, apiAnalysis, apiTranscribe,
  apiExportSrt, apiExportAss, apiPick, apiMotionRender, apiTranscript, apiWaveform, apiLoadVideo,
} from '../api/client'

interface Status { msg: string; ok: boolean }

interface AppState {
  // vídeo
  dur: number
  mediaMeta: MediaMeta | null
  videoLabel: string
  videoDir: string
  videoTs: number
  lastVideoPath: string   // path completo do último vídeo — usado para recarregar na abertura
  previewTs: number  // > 0 quando o player está exibindo o preview gerado

  // cortes
  keeps: Keep[]
  manualCuts: [number, number][]
  params: Params

  // reprodução
  skipMode: boolean
  detecting: boolean

  // transcrição + análise
  transSegs: TranscriptSegment[]
  transOverlay: SegOverlay[]
  captionBlocks: CaptionBlock[]
  transLang: string
  analysis: Analysis | null
  analysisPollTimer: ReturnType<typeof setInterval> | null
  motionState: Record<number, MotionEntry>

  // estilo global da legenda
  captionStyle: CaptionStyle

  // UI
  activeTab: 'revisao' | 'motion'
  status: Status
  transStatus: Status
  exportModalOpen: boolean
  analysisPollTries: number
  toasts: { id: string; msg: string; icon: string }[]
  waveform: WaveformData | null
  paramsHistory: DetectSnapshot[]
  paramsHistoryIndex: number
  transProgressLines: string[]   // linhas de progresso ao vivo da transcrição

  // actions
  init: () => Promise<void>
  detect: () => Promise<void>
  pickVideo: () => Promise<void>
  transcribe: () => Promise<void>
  startAnalysisPoll: () => void
  stopAnalysisPoll: () => void
  applyAnalysis: (a: Analysis) => void
  addToast: (msg: string, icon?: string) => void
  removeToast: (id: string) => void
  fetchWaveform: () => Promise<void>
  undoDetect: () => void
  redoDetect: () => void
  exportXml: (opts: ExportOpts) => Promise<void>
  setParams: (p: Partial<Params>) => void
  toggleManualCut: (start: number, end: number) => void
  applyAllCuts: (indices: number[]) => void
  updateTransSeg: (i: number, text: string) => void
  initCaptionBlocks: () => void
  splitCaptionBlock: (blockId: string, afterWordIndex: number) => void
  mergeCaptionBlock: (blockId: string) => void
  setCaptionBlockStyle: (blockId: string, patch: { effect?: string; font?: string; fontSize?: number; maxWidth?: number }) => void
  toggleCaptionBlockWord: (blockId: string, wordIndex: number) => void
  setCaptionStyle: (patch: Partial<CaptionStyle>) => void
  addCustomFont: (font: CustomFont) => void
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

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
  dur: 0,
  mediaMeta: null,
  videoLabel: '',
  videoDir: '',
  videoTs: 0,
  lastVideoPath: '',
  previewTs: 0,
  keeps: [],
  manualCuts: [],
  params: { threshold: -30, min_silence: 0.5, margin: 0.15, min_clip: 0.3 },
  skipMode: false,
  detecting: false,
  transSegs: [],
  transOverlay: [],
  captionBlocks: [],
  transLang: 'pt',
  analysis: null,
  analysisPollTimer: null,
  motionState: {},
  captionStyle: {
    on: true,
    bg: true,
    wordsPerCaption: 0,
    effect: 'fade',
    font: 'Inter',
    color: '#F2F3F5',
    strokeColor: '#000000',
    strokeWidth: 0,
    yPct: 88,
    fontSize: 20,
    maxWidth: 82,
    minChunkDur: 0.4,
    customFonts: [],
  },
  activeTab: 'revisao',
  status: { msg: '', ok: false },
  transStatus: { msg: '', ok: false },
  exportModalOpen: false,
  analysisPollTries: 0,
  toasts: [],
  waveform: null,
  paramsHistory: [],
  paramsHistoryIndex: -1,
  transProgressLines: [],

  init: async () => {
    try {
      let d = await apiInfo()
      // se o servidor não tem vídeo mas tínhamos um salvo, tenta recarregar automaticamente
      if (!d.video && get().lastVideoPath) {
        try {
          const r = await apiLoadVideo(get().lastVideoPath)
          if (r.ok) d = await apiInfo()
        } catch (_) {}
      }
      // não sobrescreve params — o usuário pode ter ajustado e eles ficam no localStorage
      set({
        dur: d.media?.duration ?? 0,
        mediaMeta: d.media ?? null,
        videoLabel: d.video ?? '',
        videoDir: d.video_dir ?? '',
        lastVideoPath: d.video_path ?? get().lastVideoPath,
      })
      // se transSegs estava vazio (localStorage antigo ou limpado), restaura do disco
      if (get().transSegs.length === 0) {
        try {
          const t = await apiTranscript()
          if (t.available && t.segments.length > 0) {
            set({ transSegs: t.segments })
            get().initCaptionBlocks()
          }
        } catch (_) {}
      }
      await get().detect()
      get().fetchWaveform()
      // tenta carregar análise do disco (versão mais recente);
      // se não disponível, o cache do localStorage permanece intacto
      try {
        const a = await apiAnalysis()
        if (a.available) get().applyAnalysis(a)
      } catch (_) { /* sem análise ainda — tudo bem */ }
    } catch (e) {
      // servidor sem vídeo — se havia estado em cache, restaura transOverlay
      if (get().videoTs > 0) {
        try { await get().detect() } catch (_) {}
      } else {
        set({ status: { msg: 'Erro ao carregar informações do vídeo.', ok: false } })
      }
    }
  },

  detect: async () => {
    const { params, manualCuts, transSegs, paramsHistory, paramsHistoryIndex } = get()
    set({ detecting: true })
    try {
      const segments = transSegs.map((s) => ({ start: s.start, end: s.end }))
      const d = await apiDetect({ ...params, manual_cuts: manualCuts, segments })
      const snapshot: DetectSnapshot = { params, manualCuts, keeps: d.keeps, transOverlay: d.transcript_overlay ?? [] }
      // trunca ramo de redo e limita a 30 entradas
      const newHistory = [...paramsHistory.slice(0, paramsHistoryIndex + 1), snapshot].slice(-30)
      set({ keeps: d.keeps, transOverlay: d.transcript_overlay ?? [], detecting: false, paramsHistory: newHistory, paramsHistoryIndex: newHistory.length - 1 })
    } catch (e) {
      set({ detecting: false, status: { msg: 'Erro ao calcular cortes.', ok: false } })
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
        lastVideoPath: (d as { video_path?: string }).video_path ?? get().lastVideoPath,
        videoTs: Date.now(),
        manualCuts: [],
        keeps: [],
        transSegs: [],
        transOverlay: [],
        captionBlocks: [],
        analysis: null,
        motionState: {},
        waveform: null,
        paramsHistory: [],
        paramsHistoryIndex: -1,
        status: { msg: 'Vídeo carregado: ' + d.video, ok: true },
        transStatus: { msg: '', ok: false },
      })
      await get().detect()
      get().fetchWaveform()
      await get().transcribe()
    } catch (e) {
      set({ status: { msg: 'Erro ao abrir vídeo.', ok: false } })
    }
  },

  transcribe: async () => {
    const { transLang } = get()
    set({
      transSegs: [],
      transOverlay: [],
      analysis: null,
      motionState: {},
      transProgressLines: [],
      transStatus: { msg: 'Transcrevendo com Whisper… pode demorar alguns minutos.', ok: false },
    })
    // polling de progresso ao vivo enquanto o whisper processa
    const progressTimer = setInterval(async () => {
      try {
        const r = await fetch('/api/trans_progress')
        const d = await r.json()
        if (d.lines?.length) set({ transProgressLines: d.lines })
        if (d.done) clearInterval(progressTimer)
      } catch (_) {}
    }, 1500)
    try {
      const d = await apiTranscribe({ language: transLang })
      clearInterval(progressTimer)
      set({ transProgressLines: [] })
      if (!d.ok) {
        set({ transStatus: { msg: 'Erro: ' + (d.error ?? 'falha'), ok: false } })
        return
      }
      set({
        transSegs: d.segments,
        transStatus: {
          msg: `${d.count} segmentos · ${d.model} — gerando análise da IA automaticamente…`,
          ok: false,
        },
      })
      get().initCaptionBlocks()
      get().addToast(`Transcrição pronta · ${d.count} segmentos`, '🎙️')
      await get().detect()  // classifica a transcricao contra o corte atual
      get().startAnalysisPoll()  // aplica a analise sozinho assim que o Claude grava analise.json
    } catch (e) {
      clearInterval(progressTimer)
      set({ transProgressLines: [], transStatus: { msg: 'Erro ao transcrever.', ok: false } })
    }
  },

  startAnalysisPoll: () => {
    get().stopAnalysisPoll()
    let tries = 0
    const timer = setInterval(async () => {
      tries++
      set({ analysisPollTries: tries })
      // ~10 min sem análise: para o poll e avisa (evita spinner girando para sempre)
      if (tries > 150) {
        get().stopAnalysisPoll()
        set({ transStatus: { msg: 'A análise da IA não chegou. Peça ao Claude: "analise a transcrição".', ok: false } })
        return
      }
      try {
        const d = await apiAnalysis()
        if (d.available) {
          get().applyAnalysis(d)
          const n = (d.segments ?? []).reduce((a: number, s) => a + (s.issues?.length ?? 0), 0)
          set({ transStatus: { msg: `Análise carregada automaticamente · ${n} apontamento(s).`, ok: true } })
          get().addToast(`Análise de IA pronta · ${n} apontamento(s)`, '🤖')
          get().stopAnalysisPoll()
        }
      } catch (_) {}
    }, 4000)
    set({ analysisPollTimer: timer })
  },

  stopAnalysisPoll: () => {
    const t = get().analysisPollTimer
    if (t) clearInterval(t)
    set({ analysisPollTimer: null, analysisPollTries: 0 })
  },

  applyAnalysis: (a: Analysis) => {
    set({ analysis: a })
  },

  addToast: (msg: string, icon = '✅') => {
    const id = `toast-${Date.now()}-${Math.random()}`
    set((s) => ({ toasts: [...s.toasts, { id, msg, icon }] }))
  },

  removeToast: (id: string) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  fetchWaveform: async () => {
    try {
      const d = await apiWaveform()
      if (d.available) set({ waveform: d })
    } catch (_) { /* falha silenciosa — waveform é visual apenas */ }
  },

  undoDetect: () => {
    const { paramsHistory, paramsHistoryIndex } = get()
    if (paramsHistoryIndex <= 0) return
    const idx = paramsHistoryIndex - 1
    const snap = paramsHistory[idx]
    set({ params: snap.params, manualCuts: snap.manualCuts, keeps: snap.keeps, transOverlay: snap.transOverlay, paramsHistoryIndex: idx })
  },

  redoDetect: () => {
    const { paramsHistory, paramsHistoryIndex } = get()
    if (paramsHistoryIndex >= paramsHistory.length - 1) return
    const idx = paramsHistoryIndex + 1
    const snap = paramsHistory[idx]
    set({ params: snap.params, manualCuts: snap.manualCuts, keeps: snap.keeps, transOverlay: snap.transOverlay, paramsHistoryIndex: idx })
  },

  exportXml: async (opts: ExportOpts) => {
    set({ status: { msg: 'Exportando…', ok: false } })
    const { params, manualCuts, analysis, transSegs, motionState, captionStyle } = get()
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
          const sd = await apiExportAss({ segments: transSegs, caption_style: captionStyle as Record<string, unknown>, ...params, manual_cuts: manualCuts })
          msg += sd.ok ? ` · legenda (${sd.count} seg)` : ' · falha na legenda'
        } catch (_) { msg += ' · falha na legenda' }
      }
      set({ status: { msg, ok: true } })
      fetch('/api/open_folder').catch(() => {/* silencioso se falhar */})
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
      // propaga a edição para o bloco de legenda correspondente, senão a correção
      // (digitada ou via "Aplicar sugestão") não aparece na legenda do preview.
      // Só trata o caso comum 1:1 (segmento não dividido na timeline de legenda):
      // se o segmento virou vários blocos, não há como redistribuir o texto sozinho.
      const matching = s.captionBlocks.filter((b) => b.segIndex === i)
      let captionBlocks = s.captionBlocks
      if (matching.length === 1 && matching[0].id === `seg-${i}`) {
        const newWords = text.trim().split(/\s+/)
        // mantém o tempo por palavra só se a contagem de palavras não mudou;
        // se mudou (ex.: "quimidiária" -> "Queima Diária"), cai na heurística
        const words = segs[i].words && segs[i].words!.length === newWords.length
          ? segs[i].words
          : undefined
        captionBlocks = s.captionBlocks.map((b) =>
          b.id === `seg-${i}` ? { ...b, text, words } : b
        )
      }
      return { transSegs: segs, captionBlocks }
    })
  },

  initCaptionBlocks: () => {
    const blocks: CaptionBlock[] = get().transSegs.map((s, i) => ({
      id: `seg-${i}`,
      segIndex: i,
      start: s.start,
      end: s.end,
      text: s.text,
      words: s.words,
    }))
    set({ captionBlocks: blocks })
  },

  splitCaptionBlock: (blockId, afterWordIndex) => {
    const blocks = get().captionBlocks
    const idx = blocks.findIndex((b) => b.id === blockId)
    if (idx === -1) return
    const b = blocks[idx]
    const words = b.text.trim().split(/\s+/)
    if (afterWordIndex < 1 || afterWordIndex >= words.length) return
    // se há tempo por palavra, corta no início da palavra de quebra (preciso);
    // senão, estima proporcionalmente como antes
    const wt = b.words && b.words.length === words.length ? b.words : undefined
    const splitT = wt ? wt[afterWordIndex].start : b.start + (afterWordIndex / words.length) * (b.end - b.start)
    const bA: CaptionBlock = { ...b, id: `${b.id}-L${afterWordIndex}`, text: words.slice(0, afterWordIndex).join(' '), end: splitT, words: wt?.slice(0, afterWordIndex) }
    const bB: CaptionBlock = { ...b, id: `${b.id}-R${afterWordIndex}`, text: words.slice(afterWordIndex).join(' '), start: splitT, words: wt?.slice(afterWordIndex) }
    const next = [...blocks]
    next.splice(idx, 1, bA, bB)
    set({ captionBlocks: next })
  },

  mergeCaptionBlock: (blockId) => {
    const blocks = get().captionBlocks
    const idx = blocks.findIndex((b) => b.id === blockId)
    if (idx === -1 || idx >= blocks.length - 1) return
    const a = blocks[idx], b = blocks[idx + 1]
    if (a.segIndex !== b.segIndex) return  // só merge dentro do mesmo segmento original
    const mergedWords = a.words && b.words ? [...a.words, ...b.words] : undefined
    const merged: CaptionBlock = { ...a, end: b.end, text: `${a.text} ${b.text}`, words: mergedWords }
    const next = [...blocks]
    next.splice(idx, 2, merged)
    set({ captionBlocks: next })
  },

  setCaptionBlockStyle: (blockId, patch) => {
    set((s) => ({
      captionBlocks: s.captionBlocks.map((b) => b.id === blockId ? { ...b, ...patch } : b),
    }))
  },

  toggleCaptionBlockWord: (blockId, wordIndex) => {
    set((s) => ({
      captionBlocks: s.captionBlocks.map((b) => {
        if (b.id !== blockId) return b
        const removed = new Set(b.removedWords ?? [])
        if (removed.has(wordIndex)) removed.delete(wordIndex)
        else removed.add(wordIndex)
        return { ...b, removedWords: [...removed] }
      }),
    }))
  },

  setCaptionStyle: (patch) => set((s) => ({ captionStyle: { ...s.captionStyle, ...patch } })),

  addCustomFont: (font) => set((s) => ({
    captionStyle: {
      ...s.captionStyle,
      customFonts: [...s.captionStyle.customFonts, font],
    },
  })),

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
    }),
    {
      name: 'claude-to-premier',
      partialize: (state) => ({
        params: state.params,
        captionStyle: state.captionStyle,
        transSegs: state.transSegs,
        transLang: state.transLang,
        analysis: state.analysis,
        videoDir: state.videoDir,
        videoLabel: state.videoLabel,
        videoTs: state.videoTs,
        lastVideoPath: state.lastVideoPath,
        mediaMeta: state.mediaMeta,
        dur: state.dur,
        manualCuts: state.manualCuts,
        captionBlocks: state.captionBlocks,
        keeps: state.keeps,
        // persiste motionState mas reseta flags de geração em andamento
        motionState: Object.fromEntries(
          Object.entries(state.motionState).map(([k, v]) => [k, { ...v, generating: false }])
        ),
        // waveform, paramsHistory, paramsHistoryIndex e toasts são excluídos
        // intencionalmente — waveform é grande demais para localStorage, paramsHistory
        // depende da sessão atual, e toasts são efêmeros.
      }),
    }
  )
)
