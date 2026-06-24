import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import TranscriptSegment from './TranscriptSegment'
import { apiExportSrt } from '../../api/client'
import { playerRef } from '../player/playerRef'

export default function TranscriptPanel() {
  const { transSegs, transOverlay, params, manualCuts, transLang, setTransLang, transcribe, analysis, transStatus, applyAllCuts, analysisPollTries } = useAppStore()

  // acompanha o tempo do vídeo para brilhar o segmento que está passando agora
  const [playingIndex, setPlayingIndex] = useState(-1)
  const lastIndexRef = useRef(-1)
  useEffect(() => {
    const tick = () => {
      const t = playerRef.current?.currentTime
      if (t == null) return
      const idx = transSegs.findIndex((s) => t >= s.start && t < s.end)
      if (idx !== lastIndexRef.current) {
        lastIndexRef.current = idx
        setPlayingIndex(idx)
      }
    }
    const timer = setInterval(tick, 150)
    return () => clearInterval(timer)
  }, [transSegs])

  const handleExportSrt = async () => {
    if (!transSegs.length) return
    try {
      const d = await apiExportSrt({ segments: transSegs, ...params, manual_cuts: manualCuts })
      if (d.ok) useAppStore.setState({ transStatus: { msg: `Legenda exportada (${d.count} seg) → ${d.srt_path}`, ok: true } })
      else useAppStore.setState({ transStatus: { msg: 'Erro ao exportar legenda.', ok: false } })
    } catch (_) {
      useAppStore.setState({ transStatus: { msg: 'Erro ao exportar legenda.', ok: false } })
    }
  }

  const cutSegs = (analysis?.segments ?? []).filter((s) => s.cut)
  const segMap = new Map((analysis?.segments ?? []).map((s) => [s.index, s]))

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <span className="flex items-center gap-2 flex-wrap">
          <p className="text-text-secondary text-xs uppercase tracking-wide m-0">Transcrição</p>
          {(transStatus.msg?.includes('Transcrevendo') || transStatus.msg?.includes('gerando análise')) && (
            <span className="w-3 h-3 rounded-full border-2 border-text-muted/30 border-t-accent animate-spin shrink-0" />
          )}
          {analysisPollTries > 0 && (
            <span className="text-text-muted text-[11px] tabular-nums">
              análise {analysisPollTries}/150 · ~{Math.max(1, Math.ceil((150 - analysisPollTries) * 4 / 60))} min
            </span>
          )}
        </span>
        <div className="flex gap-2 items-center">
          <select
            value={transLang}
            onChange={(e) => setTransLang(e.target.value)}
            className="text-text-primary bg-bg-secondary rounded-sm px-2.5 py-2 text-[13px] border border-text-muted/20"
          >
            <option value="pt">Português</option>
            <option value="en">Inglês</option>
            <option value="auto">Detectar idioma</option>
          </select>
          <button
            onClick={transcribe}
            className="bg-accent text-on-accent rounded-sm px-3.5 py-2 text-[13px] font-medium hover:bg-accent-hover transition-colors"
          >
            Transcrever
          </button>
        </div>
      </div>

      <div className="transcript flex-1 min-h-0 overflow-y-auto">
        {transSegs.length === 0 && (
          <div className="text-text-secondary text-[13px] py-2">
            Carregue um vídeo em "Abrir vídeo" para transcrever automaticamente.
          </div>
        )}
        {analysis?.summary && (
          <div className="ai-summary text-[13px] bg-bg-secondary rounded-md px-2.5 py-2 mb-2.5">
            {analysis.summary}
            {cutSegs.length > 0 && (() => {
              const allApplied = cutSegs.every((s) => {
                const seg = transSegs[s.index]
                return seg && manualCuts.some(([a, b]) => a === seg.start && b === seg.end)
              })
              return (
                <>
                  <br />
                  <button
                    disabled={allApplied}
                    onClick={() => applyAllCuts(cutSegs.map((s) => s.index))}
                    className={`ai-cuts-all mt-2 rounded-sm px-2.5 py-1 text-xs border ${allApplied ? 'bg-transparent text-text-muted border-text-muted/30 cursor-not-allowed opacity-60' : 'bg-transparent text-accent-soft border-accent/50 hover:bg-accent/10'}`}
                  >
                    {allApplied ? `✓ ${cutSegs.length} trechos removidos` : `Remover todos os ${cutSegs.length} trechos repetidos do vídeo`}
                  </button>
                </>
              )
            })()}
          </div>
        )}
        {transSegs.map((s, i) => (
          <TranscriptSegment
            key={i}
            index={i}
            start={s.start}
            end={s.end}
            text={s.text}
            seg={segMap.get(i)}
            overlay={transOverlay[i]}
            active={i === playingIndex}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 pt-2.5 mt-2 flex-wrap">
        <span className={`flex items-center gap-2 text-xs break-all ${transStatus.ok ? 'text-keep' : 'text-text-secondary'}`}>
          {!transStatus.msg?.includes('Transcrevendo') && transStatus.msg}
        </span>
        <span className="flex gap-2 flex-wrap">
          <button
            onClick={handleExportSrt}
            className="bg-bg-secondary text-text-primary rounded-sm px-2.5 py-1.5 text-xs hover:bg-bg-secondary/70 transition-colors"
          >
            Exportar legenda (SRT)
          </button>
        </span>
      </div>
    </div>
  )
}
