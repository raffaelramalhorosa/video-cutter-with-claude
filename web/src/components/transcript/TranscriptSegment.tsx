import { useRef, useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { AnalysisSegment, SegOverlay, TranscriptSegment as TSeg } from '../../types'
import { playerRef } from '../player/playerRef'

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const r = (s - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${r}`
}

interface Props {
  index: number
  start: number
  end: number
  text: string
  seg?: AnalysisSegment
  overlay?: SegOverlay
  active?: boolean
  isFiller?: boolean
  isRepetition?: boolean
}

async function addToGlossary(word: string) {
  await fetch('/api/glossary/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  })
}

export default function TranscriptSegment({ index, start, end, text, seg, overlay, active, isFiller, isRepetition }: Props) {
  const { toggleManualCut, manualCuts, updateTransSeg, transSegs } = useAppStore()
  const xRef = useRef<HTMLSpanElement>(null)
  const [suggestionApplied, setSuggestionApplied] = useState(false)

  const isCut = manualCuts.some(([s, e]) => s === transSegs[index]?.start && e === transSegs[index]?.end)

  // deve ficar ANTES do early return — Rules of Hooks não permite hooks condicionais
  // controla o DOM do contentEditable diretamente para não resetar o cursor a cada keystroke:
  // só sincroniza quando o campo não está em foco (ex: atualização externa, "Aplicar sugestão")
  useEffect(() => {
    if (xRef.current && document.activeElement !== xRef.current) {
      xRef.current.textContent = text
    }
  }, [text])

  // overlay reflete o resultado final do corte (silencio + manual_cuts) -- por isso
  // nao precisa de logica separada para "frase repetida" vs "silencio".
  if (overlay?.status === 'cut') {
    // isCut = usuário marcou manualmente (ou via análise de IA); !isCut = silêncio automático
    const isManual = isCut
    return (
      <div className={`seg flex items-center gap-2 py-1 ${isManual ? 'opacity-60' : 'opacity-35'} ${active ? 'playing' : ''}`}>
        <span className="t text-text-muted text-xs tabular-nums whitespace-nowrap min-w-[116px]">
          {fmt(start)} → {fmt(end)}
        </span>
        <span className={`text-[13px] line-through ${isManual ? 'text-cut' : 'text-text-muted'}`}>
          {isManual ? '✂️' : '🔇'} {text}
        </span>
        {isManual && (
          <button
            onClick={() => toggleManualCut(start, end)}
            className="ml-auto px-2 py-0.5 text-xs rounded-sm border border-cut/60 text-danger-text hover:bg-cut/20 on"
          >
            Removido ✓ (desfazer)
          </button>
        )}
      </div>
    )
  }

  const handleMouseEnter = () => {
    const fn = (window as unknown as Record<string, unknown>).__hlSegment as ((s: number, e: number) => void) | undefined
    fn?.(start, end)
  }
  const handleMouseLeave = () => {
    const fn = (window as unknown as Record<string, unknown>).__hideHL as (() => void) | undefined
    fn?.()
  }

  const handleTimeClick = () => {
    if (playerRef.current) { playerRef.current.currentTime = start; playerRef.current.play() }
  }

  const applySuggestion = async () => {
    if (!seg?.suggestion) return
    updateTransSeg(index, seg.suggestion)
    if (xRef.current) xRef.current.textContent = seg.suggestion
    setSuggestionApplied(true)
    // se a sugestão for uma correção de transcrição, oferece adicionar ao glossário
    const issue = seg.issues?.find((i) => i.tipo === 'transcrição')
    if (issue) {
      await addToGlossary(issue.correcao)
    }
  }

  return (
    <div
      className={`seg flex flex-wrap gap-x-3 gap-y-1.5 py-2 ${isCut ? 'cut' : ''} ${seg ? 'has-issue' : ''} ${active ? 'playing' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        className="t text-text-muted text-xs tabular-nums whitespace-nowrap min-w-[116px] cursor-pointer hover:text-text-primary"
        onClick={handleTimeClick}
      >
        {fmt(start)} → {fmt(end)}
      </span>
      {isFiller && (
        <span
          title="Filler detectado (uh, né, tipo…) — candidato a corte"
          className="text-[11px] text-text-muted/60 border border-text-muted/20 rounded-sm px-1.5 py-0.5 self-center whitespace-nowrap"
        >
          filler
        </span>
      )}
      {isRepetition && (
        <span
          title="Última palavra repetida no início do próximo segmento — possível falso começo"
          className="text-[11px] text-amber-500/70 border border-amber-500/25 rounded-sm px-1.5 py-0.5 self-center whitespace-nowrap"
        >
          repetição
        </span>
      )}
      {overlay?.status === 'partial' && (() => {
        const sideLabel = overlay.cut_side === 'start' ? 'início' : overlay.cut_side === 'end' ? 'fim' : 'ambos'
        const pct = overlay.kept_pct
        const lost = overlay.lost_words
        const lostLabel = lost && lost.length > 0 ? `"${lost.join(' ')}"` : null
        return (
          <span
            title={`${sideLabel} deste trecho cai num silêncio/corte removido${lostLabel ? ` — palavras perdidas: ${lostLabel}` : ''}`}
            className="text-[11px] text-amber-400/80 border border-amber-400/30 rounded-sm px-1.5 py-0.5 self-center whitespace-nowrap"
          >
            ✂ {lostLabel ? `${lostLabel} cortado` : pct != null ? `${pct}% cortado` : 'borda cortada'} ({sideLabel})
          </span>
        )
      })()}
      {overlay?.anchored && overlay.status !== 'cut' && (
        <span
          title="Timestamp ancorado: a legenda pode estar ±100ms deslocada neste trecho"
          className="text-[11px] text-text-muted/50 border border-text-muted/15 rounded-sm px-1 py-0.5 self-center whitespace-nowrap"
        >
          ⚓
        </span>
      )}
      <span
        ref={xRef}
        className="x text-text-primary flex-1 outline-none rounded-[4px] px-1 py-0.5 hover:bg-bg/40 focus:outline focus:outline-1 focus:outline-accent"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={(e) => updateTransSeg(index, (e.target as HTMLSpanElement).textContent ?? '')}
      />
      {seg && (
        <div className="issues basis-full mt-0.5 ml-[116px] text-xs">
          {(seg.issues ?? []).map((it, ii) => (
            <div key={ii} className="iss text-text-secondary mb-0.5">
              "{it.trecho}" → <b className="text-accent-soft font-medium">{it.correcao}</b>{' '}
              <span className="note text-text-muted">({it.tipo}: {it.nota})</span>
            </div>
          ))}
          {seg.suggestion && (
            <button
              disabled={suggestionApplied}
              onClick={applySuggestion}
              className={`apply mt-1 rounded-sm px-2.5 py-1 text-xs border ${suggestionApplied ? 'bg-transparent text-text-muted border-text-muted/30 cursor-not-allowed opacity-60' : 'bg-transparent text-accent-soft border-accent/50 hover:bg-accent/10'}`}
            >
              {suggestionApplied ? '✓ Sugestão aplicada' : 'Aplicar sugestão'}
            </button>
          )}
          {seg.cut && (
            <button
              onClick={() => toggleManualCut(start, end)}
              className={`cut-btn mt-1 ml-1.5 px-2.5 py-1 text-xs rounded-sm border border-cut/60 text-danger-text hover:bg-cut/20 ${isCut ? 'on' : ''}`}
            >
              {isCut ? 'Removido ✓ (desfazer)' : 'Remover do vídeo'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
