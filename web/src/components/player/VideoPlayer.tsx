import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { createTikTokStyleCaptions, type TikTokPage } from '@remotion/captions'
import { useAppStore } from '../../store/useAppStore'
import { FinalVideo, type CaptionSeg } from '../../remotion/FinalVideo'
import { playerRef, PlayerAdapter } from './playerRef'

const CAPTION_EFFECTS: Record<string, string> = {
  nenhum: 'none',
  fade:   'cap-fade   0.2s ease forwards',
  subir:  'cap-slide-up   0.2s ease forwards',
  descer: 'cap-slide-down 0.2s ease forwards',
  pop:    'cap-pop    0.18s ease forwards',
  bounce: 'cap-bounce 0.3s ease forwards',
}

/** Renderiza palavras com coreografia em 3 grupos: primeira | meio | última (abaixo) */
function CaptionCoreografia({ text, font, bg, color, stroke, fontSize }: { text: string; font: string; bg: boolean; color: string; stroke?: string; fontSize?: number }) {
  const words = text.trim().split(/\s+/)
  const fontStyle = `'${font}', Impact, sans-serif`
  const baseStyle: React.CSSProperties = {
    display: 'inline-block',
    animationFillMode: 'both',
    fontFamily: fontStyle,
    fontWeight: 700,
    fontSize: fontSize ?? 20,
    lineHeight: 1.3,
    color,
    textShadow: '0 2px 8px rgba(0,0,0,0.9)',
    WebkitTextStroke: stroke,
    paintOrder: stroke ? 'stroke fill' : undefined,
  }

  // grupo 1: primeira palavra; grupo 2: palavras do meio; grupo 3: última
  const first = words.slice(0, 1)
  const mid   = words.length >= 3 ? words.slice(1, -1) : []
  const last  = words.length >= 2 ? words.slice(-1) : []

  const wrapStyle: React.CSSProperties = {
    padding: bg ? '6px 14px' : '0',
    background: bg ? 'rgba(0,0,0,0.65)' : 'transparent',
    borderRadius: bg ? 8 : 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    overflow: 'hidden',
  }

  return (
    <div style={wrapStyle}>
      {/* linha 1: primeira + meio */}
      <div style={{ display: 'flex', gap: '0.3em', overflow: 'hidden' }}>
        <span style={{ ...baseStyle, animation: 'cap-coro-first 0.28s 0s ease both' }}>
          {first.join(' ')}
        </span>
        {mid.length > 0 && (
          <span style={{ ...baseStyle, animation: 'cap-coro-mid 0.38s 0.18s ease both' }}>
            {mid.join(' ')}
          </span>
        )}
      </div>
      {/* linha 2: última palavra sobe de baixo */}
      {last.length > 0 && (
        <span style={{ ...baseStyle, animation: 'cap-coro-last 0.35s 0.44s ease both' }}>
          {last.join(' ')}
        </span>
      )}
    </div>
  )
}

const SEC_PER_WORD = 0.35  // fallback para transcrições sem timestamps por palavra
const TAIL_BUFFER_MS = 400  // ms após a última palavra antes de apagar a legenda

type WordTime = { start: number; end: number }
type CaptionSource = {
  id: string
  start: number; end: number; text: string
  words?: WordTime[]; removedWords?: number[]
}

// pausa natural entre palavras — acima disso o Remotion cria nova página
const NATURAL_PAUSE_MS = 200

/**
 * Converte um CaptionBlock para páginas do @remotion/captions.
 *
 * wordsPerCaption=0 → frase inteira (sem limite de palavras).
 * wordsPerCaption=N → máx N palavras por página com quebra em pausas naturais:
 *   1. Remotion agrupa palavras que estão a ≤ NATURAL_PAUSE_MS entre si.
 *   2. Se algum grupo resultante tem > N palavras, sub-divide em fatias de N.
 *   Resultado: breaks acontecem nas pausas reais da fala; dentro de uma fala
 *   contínua, nunca passa de N palavras na tela ao mesmo tempo.
 * Sem `words` (transcrição antiga): fallback com distribuição uniforme.
 */
function blockToPages(src: CaptionSource, wordsPerCaption: number): TikTokPage[] {
  const allWords = src.text.trim().split(/\s+/)
  if (allWords.length === 0 || allWords[0] === '') return []
  const removed = new Set(src.removedWords ?? [])
  const haveWords = !!src.words && src.words.length === allWords.length

  const vis = allWords
    .map((w, i) => ({ w, t: haveWords ? src.words![i] : undefined }))
    .filter((_, i) => !removed.has(i))
  if (vis.length === 0) return []

  if (!haveWords) {
    // fallback sem timestamps reais: distribui uniformemente
    const wc = vis.length
    const totalDurMs = Math.round(wc * SEC_PER_WORD * 1000) + TAIL_BUFFER_MS
    const n = wordsPerCaption === 0 ? wc : wordsPerCaption
    const pages: TikTokPage[] = []
    for (let k = 0; k < vis.length; k += n) {
      const grp = vis.slice(k, k + n)
      const startMs = src.start * 1000 + Math.round((k / wc) * totalDurMs)
      const durationMs = Math.round((grp.length / wc) * totalDurMs)
      pages.push({ text: grp.map((v) => v.w).join(' '), startMs, durationMs, tokens: [] })
    }
    return pages
  }

  // converte cada palavra visível em Caption com espaço à esquerda
  // (o algoritmo Remotion usa leading-space para detectar quebras de página)
  const captions = vis.map(({ w, t }) => ({
    text: ' ' + w,
    startMs: Math.round(t!.start * 1000),
    endMs: Math.round(t!.end * 1000),
    timestampMs: Math.round(t!.start * 1000),
    confidence: null,
  }))

  const combineMs = wordsPerCaption === 0 ? 99999 : NATURAL_PAUSE_MS
  const { pages: naturalPages } = createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: combineMs })

  if (wordsPerCaption === 0) return naturalPages

  // sub-divide páginas que ainda têm mais de N palavras
  const result: TikTokPage[] = []
  for (const page of naturalPages) {
    const tokens = page.tokens
    const words = page.text.trim().split(/\s+/)
    if (words.length <= wordsPerCaption) {
      result.push(page)
      continue
    }
    for (let k = 0; k < words.length; k += wordsPerCaption) {
      const grp = words.slice(k, k + wordsPerCaption)
      const tStart = tokens[k]?.fromMs ?? (page.startMs + (k / words.length) * page.durationMs)
      const tEnd   = tokens[Math.min(k + wordsPerCaption - 1, words.length - 1)]?.toMs
                  ?? (page.startMs + ((k + grp.length) / words.length) * page.durationMs)
      result.push({ text: grp.join(' '), startMs: Math.round(tStart), durationMs: Math.round(tEnd - tStart), tokens: [] })
    }
  }

  // corrige durationMs de todas menos a última: usar gap até a próxima página
  for (let i = 0; i < result.length - 1; i++) {
    result[i] = { ...result[i], durationMs: result[i + 1].startMs - result[i].startMs }
  }

  return result
}

export default function VideoPlayer() {
  const remRef = useRef<PlayerRef>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const mediaMeta = useAppStore((s) => s.mediaMeta)
  const dur = useAppStore((s) => s.dur)
  const videoTs = useAppStore((s) => s.videoTs)
  const previewTs = useAppStore((s) => s.previewTs)
  const keeps = useAppStore((s) => s.keeps)
  const skipMode = useAppStore((s) => s.skipMode)
  const setSkipMode = useAppStore((s) => s.setSkipMode)
  const transSegs = useAppStore((s) => s.transSegs)
  const transOverlay = useAppStore((s) => s.transOverlay)
  const captionBlocks = useAppStore((s) => s.captionBlocks)
  const captionStyle  = useAppStore((s) => s.captionStyle)
  const setCaptionStyle = useAppStore((s) => s.setCaptionStyle)

  // texto da legenda atualizado a cada 100ms
  const [captionText, setCaptionText] = useState('')

  const fps = mediaMeta?.fps ?? 30
  const fpsRef = useRef(fps)
  fpsRef.current = fps

  // useMemo: evita que o Player receba inputProps com nova referência a cada render
  // (transOverlay muda quando detect() roda, o que pausava o Player internamente)
  const segments: CaptionSeg[] = useMemo(() =>
    transSegs.map((s, i) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      cut: transOverlay[i]?.status === 'cut',
    })),
    [transSegs, transOverlay]
  )
  const segmentsRef = useRef(segments)
  segmentsRef.current = segments

  // pré-computa TikTokPages por bloco; recalcula quando blocos ou wordsPerCaption mudam
  const pagesMap = useMemo(() => {
    const wpc = captionStyle.wordsPerCaption
    const map = new Map<string, TikTokPage[]>()
    const sources = captionBlocks.length > 0
      ? captionBlocks.map((b) => ({ id: b.id, start: b.start, end: b.end, text: b.text, words: b.words, removedWords: b.removedWords }))
      : transSegs.map((s, i) => ({ id: `seg-${i}`, start: s.start, end: s.end, text: s.text, words: s.words, removedWords: undefined }))
    for (const src of sources) {
      map.set(src.id, blockToPages(src, wpc))
    }
    return map
  }, [captionBlocks, transSegs, captionStyle.wordsPerCaption])

  const pagesMapRef = useRef(pagesMap)
  pagesMapRef.current = pagesMap
  const captionBlocksRef = useRef(captionBlocks)
  captionBlocksRef.current = captionBlocks

  // adaptador criado uma vez
  const adapterRef = useRef<PlayerAdapter | null>(null)
  if (!adapterRef.current) {
    adapterRef.current = new PlayerAdapter(() => remRef.current, () => fpsRef.current)
  }
  useEffect(() => {
    playerRef.current = adapterRef.current
    return () => { playerRef.current = null }
  }, [])

  // modo "reproduzir só os cortes" via rAF
  useEffect(() => {
    if (!skipMode || keeps.length === 0) return
    let raf = 0
    const tick = () => {
      const r = remRef.current
      if (r) {
        const t = r.getCurrentFrame() / fpsRef.current
        const inKeep = keeps.find((k) => t >= k.in && t < k.out)
        if (!inKeep) {
          const next = keeps.find((k) => k.in > t)
          if (next) r.seekTo(Math.round(next.in * fpsRef.current))
          else { r.pause(); setSkipMode(false); return }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [skipMode, keeps, setSkipMode])

  // bloco ativo — overrides de fonte/efeito/tamanho por bloco
  const [activeBlockFont, setActiveBlockFont] = useState<string | undefined>(undefined)
  const [activeBlockEffect, setActiveBlockEffect] = useState<string | undefined>(undefined)
  const [activeBlockFontSize, setActiveBlockFontSize] = useState<number | undefined>(undefined)
  const [activeBlockMaxWidth, setActiveBlockMaxWidth] = useState<number | undefined>(undefined)

  // poll do tempo atual para atualizar a legenda overlay
  useEffect(() => {
    if (!captionStyle.on) return
    const timer = setInterval(() => {
      const tMs = (playerRef.current?.currentTime ?? 0) * 1000
      const blocks = captionBlocksRef.current
      const map = pagesMapRef.current

      const findPage = (id: string) => {
        const pages = map.get(id) ?? []
        return pages.find((p) => tMs >= p.startMs && tMs < p.startMs + p.durationMs + TAIL_BUFFER_MS)
      }

      if (blocks.length > 0) {
        const block = blocks.find((b) => tMs >= b.start * 1000 && tMs < b.end * 1000 + TAIL_BUFFER_MS)
        if (block) {
          const page = findPage(block.id)
          setCaptionText(page?.text.trim() ?? '')
          setActiveBlockFont(block.font)
          setActiveBlockEffect(block.effect)
          setActiveBlockFontSize(block.fontSize)
          setActiveBlockMaxWidth(block.maxWidth)
        } else {
          setCaptionText('')
          setActiveBlockFont(undefined)
          setActiveBlockEffect(undefined)
          setActiveBlockFontSize(undefined)
          setActiveBlockMaxWidth(undefined)
        }
      } else {
        const seg = segmentsRef.current.find((s) => !s.cut && tMs >= s.start * 1000 && tMs < s.end * 1000 + TAIL_BUFFER_MS)
        const page = seg ? findPage(`seg-${segmentsRef.current.indexOf(seg)}`) : undefined
        setCaptionText(page?.text.trim() ?? '')
        setActiveBlockFont(undefined)
        setActiveBlockEffect(undefined)
        setActiveBlockFontSize(undefined)
        setActiveBlockMaxWidth(undefined)
      }
    }, 80)
    return () => clearInterval(timer)
  }, [captionStyle.on])

  // --- drag da legenda ---
  const dragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartPct = useRef(0)

  const onCaptionMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    dragStartY.current = e.clientY
    dragStartPct.current = captionStyle.yPct
  }, [captionStyle.yPct])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !wrapperRef.current) return
      const wrapperH = wrapperRef.current.getBoundingClientRect().height
      const deltaPx = e.clientY - dragStartY.current
      const deltaPct = (deltaPx / wrapperH) * 100
      const newY = Math.min(95, Math.max(5, dragStartPct.current + deltaPct))
      setCaptionStyle({ yPct: newY })
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // inputProps estável — deve ficar antes do early return (Rules of Hooks)
  const videoSrc = previewTs > 0 ? `/preview_media?ts=${previewTs}` : `/media?ts=${videoTs}`
  const inputProps = useMemo(
    () => ({ src: videoSrc, segments, captionsOn: false }),
    [videoSrc, segments]
  )

  if (!mediaMeta || dur <= 0) {
    return (
      <div className="w-full h-[360px] bg-black rounded-md flex items-center justify-center text-text-muted text-sm">
        Carregue um vídeo em "Abrir vídeo".
      </div>
    )
  }

  // key do Player: muda ao trocar vídeo original OU ao entrar/sair do preview
  const playerKey = previewTs > 0 ? `prev-${previewTs}` : `orig-${videoTs}`
  const durationInFrames = Math.max(1, Math.round(dur * fps))

  return (
    <div>
      {/* wrapper relativo para o overlay da legenda */}
      <div ref={wrapperRef} className="relative w-full max-h-[360px] flex justify-center bg-black rounded-md overflow-hidden">
        <Player
          key={playerKey}
          ref={remRef}
          component={FinalVideo}
          inputProps={inputProps}
          durationInFrames={durationInFrames}
          compositionWidth={mediaMeta.width}
          compositionHeight={mediaMeta.height}
          fps={fps}
          controls
          acknowledgeRemotionLicense
          style={{ width: '100%', maxHeight: 360 }}
        />

        {/* overlay da legenda — arrastável */}
        {captionStyle.on && captionText && (() => {
          const activeEffect   = activeBlockEffect   ?? captionStyle.effect
          const activeFont     = activeBlockFont     ?? captionStyle.font
          const activeFontSize = activeBlockFontSize ?? captionStyle.fontSize
          const activeMaxWidth = activeBlockMaxWidth ?? captionStyle.maxWidth
          const stroke = captionStyle.strokeWidth > 0
            ? `${captionStyle.strokeWidth}px ${captionStyle.strokeColor}`
            : undefined
          return (
            <div
              onMouseDown={onCaptionMouseDown}
              style={{
                position: 'absolute',
                top: `${captionStyle.yPct}%`,
                left: '50%',
                transform: 'translate(-50%, -50%)',
                cursor: 'ns-resize',
                userSelect: 'none',
                maxWidth: `${activeMaxWidth}%`,
                textAlign: 'center',
                pointerEvents: 'auto',
                zIndex: 10,
              }}
            >
              {activeEffect === 'coreografia' ? (
                <CaptionCoreografia
                  key={captionText}
                  text={captionText}
                  font={activeFont}
                  bg={captionStyle.bg}
                  color={captionStyle.color}
                  stroke={stroke}
                  fontSize={activeFontSize}
                />
              ) : (
                <div
                  key={captionText}
                  style={{
                    padding: captionStyle.bg ? '6px 14px' : '0',
                    background: captionStyle.bg ? 'rgba(0,0,0,0.65)' : 'transparent',
                    borderRadius: captionStyle.bg ? 8 : 0,
                    color: captionStyle.color,
                    fontFamily: `'${activeFont}', Impact, sans-serif`,
                    fontWeight: 700,
                    fontSize: activeFontSize,
                    lineHeight: 1.3,
                    textShadow: '0 2px 8px rgba(0,0,0,0.9)',
                    WebkitTextStroke: stroke,
                    paintOrder: stroke ? 'stroke fill' : undefined,
                    animation: CAPTION_EFFECTS[activeEffect] ?? 'none',
                  }}
                >
                  {captionText}
                </div>
              )}
            </div>
          )
        })()}
      </div>

    </div>
  )
}
