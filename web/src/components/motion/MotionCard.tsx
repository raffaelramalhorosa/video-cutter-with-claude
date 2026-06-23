import { useAppStore } from '../../store/useAppStore'
import MotionRow from './MotionRow'

export default function MotionCard() {
  const items = useAppStore((s) => s.analysis?.motion_design)
  if (!items?.length) return (
    <div className="bg-bg-secondary rounded-md p-6 text-center text-text-secondary text-[13px]">
      Nenhuma análise carregada ainda. Transcreva o vídeo e aguarde a análise da IA.
    </div>
  )
  return (
    <div className="bg-bg-secondary rounded-md p-4 mb-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-text-secondary text-xs uppercase tracking-wide m-0">Motion design</p>
        <span className="text-text-muted text-xs">Clique em "Gerar" para criar o clipe .mov para o Premiere</span>
      </div>
      <div className="flex flex-col gap-4">
        {items.map((it, i) => <MotionRow key={i} index={i} item={it} />)}
      </div>
    </div>
  )
}
