import { useState } from 'react'
import VideoPlayer from '../player/VideoPlayer'
import Timeline from '../player/Timeline'
import CaptionStylePanel from '../player/CaptionStylePanel'
import ParamsPanel from '../params/ParamsPanel'
import { useAppStore } from '../../store/useAppStore'
import { apiPreview } from '../../api/client'
import { playerRef } from '../player/playerRef'
import TranscriptPanel from '../transcript/TranscriptPanel'

export default function TabRevisao() {
  const [renderingPreview, setRenderingPreview] = useState(false)
  const { keeps, skipMode, setSkipMode, status, params, manualCuts, detecting } = useAppStore()
  const dur = useAppStore((s) => s.dur)
  const kept = keeps.reduce((a, k) => a + k.out - k.in, 0)
  const removed = dur - kept

  const handleSkip = () => {
    if (skipMode) { playerRef.current?.pause(); setSkipMode(false); return }
    if (!keeps.length) return
    setSkipMode(true)
    const t = playerRef.current?.currentTime ?? 0
    const inKeep = keeps.find((k) => t >= k.in && t < k.out)
    if (!inKeep && playerRef.current) playerRef.current.currentTime = keeps[0].in
    playerRef.current?.play()
  }

  const handlePreview = async () => {
    setRenderingPreview(true)
    useAppStore.setState({ status: { msg: 'Renderizando preview…', ok: false } })
    try {
      const d = await apiPreview({ ...params, manual_cuts: manualCuts })
      if (d.ok) useAppStore.setState({ status: { msg: 'Preview gerado → ' + d.path, ok: true } })
      else useAppStore.setState({ status: { msg: 'Erro: ' + (d.error ?? 'falha'), ok: false } })
    } finally {
      setRenderingPreview(false)
    }
  }

  return (
    <div className="flex">

      {/* sidebar de legenda — esquerda, altura total da página */}
      <div className="sticky top-11 h-[calc(100vh-44px)] shrink-0">
        <CaptionStylePanel />
      </div>

      {/* coluna principal — tudo à direita da sidebar */}
      <div className="flex-1 min-w-0 flex flex-col">

        <ParamsPanel />

        {/* player + timelines */}
        <div className="px-4 pt-3 pb-2">
          {detecting && (
            <div className="flex items-center gap-2 mb-2 text-text-secondary text-[12px]">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-text-muted/30 border-t-accent animate-spin shrink-0" />
              Calculando cortes… pode levar alguns minutos em vídeos longos.
            </div>
          )}
          <VideoPlayer />
          <Timeline />
        </div>

        {/* stats + ações */}
        <div className="px-4 py-4 border-t border-text-muted/10">
          <div className="flex gap-5 flex-wrap mb-4">
            <div>
              <div className="text-text-muted text-[11px] uppercase tracking-wide">Original</div>
              <div className="text-[22px] font-semibold tabular-nums">{dur.toFixed(1)}s</div>
            </div>
            <div>
              <div className="text-text-muted text-[11px] uppercase tracking-wide">Final</div>
              <div className="text-[22px] font-semibold tabular-nums text-keep">{kept.toFixed(1)}s</div>
            </div>
            <div>
              <div className="text-text-muted text-[11px] uppercase tracking-wide">Removido</div>
              <div className="text-[22px] font-semibold tabular-nums">{removed.toFixed(1)}s</div>
            </div>
            <div>
              <div className="text-text-muted text-[11px] uppercase tracking-wide">Cortes</div>
              <div className="text-[22px] font-semibold tabular-nums">{keeps.length}</div>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={handleSkip}
              className="bg-bg-secondary text-text-primary rounded-sm px-3.5 py-2 text-[13px] hover:bg-bg-secondary/70 transition-colors min-w-[160px] text-center">
              {skipMode ? '⏸ Parar revisão' : '▶ Revisar cortes'}
            </button>
            <button onClick={handlePreview} disabled={renderingPreview}
              className="bg-bg-secondary text-text-primary rounded-sm px-3.5 py-2 text-[13px] hover:bg-bg-secondary/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {renderingPreview ? '⏳ Gerando…' : 'Gerar preview'}
            </button>
            <button
              onClick={() => useAppStore.setState({ exportModalOpen: true })}
              className="bg-accent text-on-accent rounded-sm px-3.5 py-2 text-[13px] font-medium hover:bg-accent-hover transition-colors">
              Exportar para o Premiere (XML)
            </button>
            {status.msg && (
              <span className={`text-[12px] ${status.ok ? 'text-keep' : 'text-text-secondary'}`}>
                {status.msg}
              </span>
            )}
          </div>
        </div>

        {/* transcrição — sticky ao topo, scroll interno */}
        <div className="sticky top-11 h-[calc(100vh-44px)] overflow-hidden border-t border-text-muted/10">
          <TranscriptPanel />
        </div>

      </div>
    </div>
  )
}
