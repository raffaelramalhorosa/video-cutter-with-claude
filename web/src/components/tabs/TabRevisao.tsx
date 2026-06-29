import { useState } from 'react'
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { Download, Pause, Play, Scissors, SlidersHorizontal, WandSparkles } from 'lucide-react'
import VideoPlayer from '../player/VideoPlayer'
import ParamsPanel from '../params/ParamsPanel'
import { useAppStore } from '../../store/useAppStore'
import { useTimelineSync } from '../../store/useTimelineSync'
import { apiPreview } from '../../api/client'
import { playerRef } from '../player/playerRef'
import ScriptRail from '../hud/ScriptRail'
import MediaBin from '../hud/MediaBin'
import InspectorPanel from '../hud/InspectorPanel'
import TimelineEditor from '../timeline/TimelineEditor'
import { timelineDocumentToKeeps } from '../../timeline-core'

function ResizeHandle({ axis = 'vertical' }: { axis?: 'vertical' | 'horizontal' }) {
  return (
    <PanelResizeHandle
      className={[
        'group relative shrink-0 bg-transparent outline-none',
        axis === 'vertical' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
      ].join(' ')}
    >
      <span
        className={[
          'absolute bg-white/8 group-hover:bg-fuchsia-400/45 transition-colors',
          axis === 'vertical' ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
        ].join(' ')}
      />
    </PanelResizeHandle>
  )
}

function fmt(s: number) {
  if (!Number.isFinite(s) || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function TabRevisao() {
  useTimelineSync()
  const [renderingPreview, setRenderingPreview] = useState(false)
  const { keeps, skipMode, setSkipMode, status, params, manualCuts, detecting, transSegs, captionStyle, mediaMeta, timelineDocument } = useAppStore()
  const previewTs = useAppStore((s) => s.previewTs)
  const dur = useAppStore((s) => s.dur)
  const kept = keeps.reduce((a, k) => a + k.out - k.in, 0)
  const removed = Math.max(0, dur - kept)

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
    useAppStore.setState({ status: { msg: 'Renderizando preview...', ok: false } })
    try {
      const d = await apiPreview({
        ...params,
        manual_cuts: manualCuts,
        timeline_keeps: timelineDocumentToKeeps(timelineDocument),
        segments: transSegs,
        caption_style: captionStyle,
      })
      if (d.ok) {
        useAppStore.setState({ previewTs: Date.now(), status: { msg: '', ok: true } })
      } else {
        useAppStore.setState({ status: { msg: 'Erro: ' + (d.error ?? 'falha'), ok: false } })
      }
    } finally {
      setRenderingPreview(false)
    }
  }

  return (
    <div className="h-full min-h-0 bg-[#050608] text-text-primary overflow-hidden">
      <PanelGroup orientation="horizontal" className="h-full min-h-0">

        {/* Coluna esquerda: Script / IA — altura total */}
        <Panel defaultSize={18} minSize={15} maxSize={28}>
          <ScriptRail />
        </Panel>
        <ResizeHandle />

        {/* Coluna direita: cards em cima + timeline em baixo */}
        <Panel defaultSize={82} minSize={60}>
          <PanelGroup orientation="vertical" className="h-full min-h-0">

            {/* Linha de cima: Media | Preview | Inspector */}
            <Panel defaultSize={58} minSize={40}>
              <PanelGroup orientation="horizontal" className="h-full min-h-0">

                {/* Card Media Bin */}
                <Panel defaultSize={18} minSize={14} maxSize={28}>
                  <MediaBin />
                </Panel>
                <ResizeHandle />

                {/* Card Preview */}
                <Panel defaultSize={55} minSize={35}>
                  <section className="h-full min-h-0 flex flex-col bg-[#07090b]">
                    <div className="h-9 px-3 border-b border-white/8 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-text-secondary font-medium">Program Monitor</span>
                        {detecting && (
                          <span className="text-[10px] text-fuchsia-200/80 animate-pulse">calculando cortes...</span>
                        )}
                        {previewTs > 0 && (
                          <button
                            onClick={() => useAppStore.setState({ previewTs: 0 })}
                            className="text-[10px] px-2 py-0.5 rounded-sm bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-400/20"
                          >
                            preview ativo · voltar ao original
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-text-muted tabular-nums">
                        <span>16:9</span>
                        <span>{mediaMeta ? `${mediaMeta.fps} fps` : '24 fps'}</span>
                        <span>{mediaMeta ? `${mediaMeta.width}x${mediaMeta.height}` : '1920x1080'}</span>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 flex items-center justify-center px-4 py-3 bg-[#050608]">
                      <div className="w-full max-w-[980px]">
                        <VideoPlayer />
                      </div>
                    </div>

                    <div className="h-12 px-3 border-t border-white/8 flex items-center gap-2 bg-[#090b0e]">
                      <span className="text-[11px] text-fuchsia-200 tabular-nums min-w-[54px]">{fmt(kept)}</span>
                      <button onClick={handleSkip} className="hud-icon-btn" title={skipMode ? 'Parar revisao' : 'Revisar cortes'}>
                        {skipMode ? <Pause size={15} /> : <Play size={15} />}
                      </button>
                      <button onClick={handlePreview} disabled={renderingPreview} className="hud-action-btn" title="Gerar preview">
                        <WandSparkles size={14} />
                        {renderingPreview ? 'Gerando' : 'Preview'}
                      </button>
                      <button
                        onClick={() => useAppStore.setState({ exportModalOpen: true })}
                        className="hud-action-btn hud-action-primary"
                        title="Exportar para Premiere"
                      >
                        <Download size={14} />
                        Export
                      </button>
                      {status.msg && (
                        <span className={`ml-auto text-[11px] truncate ${status.ok ? 'text-keep' : 'text-text-secondary'}`}>
                          {status.msg}
                        </span>
                      )}
                    </div>
                  </section>
                </Panel>
                <ResizeHandle />

                {/* Card Inspector */}
                <Panel defaultSize={27} minSize={18} maxSize={36}>
                  <InspectorPanel />
                </Panel>

              </PanelGroup>
            </Panel>

            <ResizeHandle axis="horizontal" />

            {/* Timeline — largura máxima */}
            <Panel defaultSize={42} minSize={25}>
              <section className="h-full min-h-0 flex flex-col bg-[#07090b] border-t border-white/8">
                <div className="h-10 px-3 border-b border-white/8 flex items-center gap-2">
                  <span className="text-[11px] text-text-secondary font-medium mr-2">Timeline</span>
                  <button className="hud-icon-btn" title="Ferramenta de corte">
                    <Scissors size={14} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <ParamsPanel />
                  </div>
                  <div className="ml-auto flex items-center gap-4 text-[10px] text-text-muted tabular-nums">
                    <span>Original {fmt(dur)}</span>
                    <span>Final {fmt(kept)}</span>
                    <span>Removed {fmt(removed)}</span>
                    <span>{keeps.length} cuts</span>
                    <SlidersHorizontal size={13} />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <TimelineEditor />
                </div>
              </section>
            </Panel>

          </PanelGroup>
        </Panel>

      </PanelGroup>
    </div>
  )
}
