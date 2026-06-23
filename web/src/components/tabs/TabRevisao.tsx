import VideoPlayer from '../player/VideoPlayer'
import Timeline from '../player/Timeline'
import ParamsPanel from '../params/ParamsPanel'
import ClipsTable from '../clips/ClipsTable'
import { useAppStore } from '../../store/useAppStore'
import { apiPreview } from '../../api/client'
import { playerRef } from '../player/VideoPlayer'

export default function TabRevisao() {
  const { keeps, skipMode, setSkipMode, status, params, manualCuts, detecting } = useAppStore()

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
    useAppStore.setState({ status: { msg: 'Renderizando preview.mp4…', ok: false } })
    const d = await apiPreview({ ...params, manual_cuts: manualCuts })
    if (d.ok) useAppStore.setState({ status: { msg: 'Preview gerado → ' + d.path, ok: true } })
    else useAppStore.setState({ status: { msg: 'Erro: ' + (d.error ?? 'falha'), ok: false } })
  }

  const dur = useAppStore((s) => s.dur)
  const kept = keeps.reduce((a, k) => a + k.out - k.in, 0)
  const removed = dur - kept

  return (
    <div>
      {detecting && (
        <div className="flex items-center gap-3 bg-bg-secondary rounded-md px-4 py-3 mb-4">
          <span className="w-4 h-4 rounded-full border-2 border-text-muted/30 border-t-accent animate-spin shrink-0" />
          <span className="text-text-secondary text-[13px]">Calculando cortes… pode levar alguns minutos em vídeos longos.</span>
        </div>
      )}
      <div className="bg-bg-secondary rounded-md p-4 mb-4">
        <VideoPlayer />
        <Timeline />
      </div>

      <div className="bg-bg-secondary rounded-md p-4 mb-4">
        <div className="flex gap-6 flex-wrap">
          <div><div className="text-text-secondary text-xs">Duração original</div><div className="text-[20px] font-medium tabular-nums">{dur.toFixed(2)}s</div></div>
          <div><div className="text-text-secondary text-xs">Duração final</div><div className="text-[20px] font-medium tabular-nums text-keep">{kept.toFixed(2)}s</div></div>
          <div><div className="text-text-secondary text-xs">Removido</div><div className="text-[20px] font-medium tabular-nums">{removed.toFixed(2)}s</div></div>
          <div><div className="text-text-secondary text-xs">Cortes</div><div className="text-[20px] font-medium tabular-nums">{keeps.length}</div></div>
        </div>
      </div>

      <ParamsPanel />

      <div className="bg-bg-secondary rounded-md p-4 mb-4">
        <div className="flex gap-2.5 flex-wrap items-center">
          <button onClick={handleSkip} className="bg-bg-secondary text-text-primary rounded-sm px-3.5 py-2 text-[13px] hover:bg-bg-secondary/70 transition-colors">
            {skipMode ? '⏸ Parar revisão' : '▶ Reproduzir só os cortes'}
          </button>
          <button onClick={handlePreview} className="bg-bg-secondary text-text-primary rounded-sm px-3.5 py-2 text-[13px] hover:bg-bg-secondary/70 transition-colors">
            Gerar preview.mp4
          </button>
          <button
            onClick={() => useAppStore.setState({ exportModalOpen: true })}
            className="bg-accent text-on-accent rounded-sm px-3.5 py-2 text-[13px] font-medium hover:bg-accent-hover transition-colors"
          >
            Exportar para o Premiere (XML)
          </button>
          <span className={`text-[13px] min-h-[18px] ${status.ok ? 'text-keep' : 'text-text-secondary'}`}>
            {status.msg}
          </span>
        </div>
      </div>

      <ClipsTable />
    </div>
  )
}
