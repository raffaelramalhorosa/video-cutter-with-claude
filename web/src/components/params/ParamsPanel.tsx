import { useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'

export default function ParamsPanel() {
  const { params, setParams, detect } = useAppStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)

  const schedule = (patch: Parameters<typeof setParams>[0]) => {
    setParams(patch)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => detect(), 300)
  }

  return (
    <div className="relative border-b border-text-muted/10">
      {/* barra compacta sempre visível — não empurra conteúdo */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-4 px-4 py-2 text-[12px] hover:bg-bg-secondary/40 transition-colors text-left"
      >
        <span className="text-text-muted shrink-0">⚙ Parâmetros</span>
        <span className="flex gap-4 flex-wrap text-text-secondary tabular-nums">
          <span>Limiar <b className="text-text-primary">{params.threshold} dB</b></span>
          <span>Silêncio <b className="text-text-primary">{params.min_silence.toFixed(1)} s</b></span>
          <span>Margem <b className="text-text-primary">{params.margin.toFixed(2)} s</b></span>
          <span>Clipe mín. <b className="text-text-primary">{params.min_clip.toFixed(1)} s</b></span>
        </span>
        <span className="ml-auto text-text-muted">{open ? '▲' : '▼'}</span>
      </button>

      {/* overlay flutuante — não empurra o conteúdo abaixo */}
      {open && (
        <>
          {/* fundo clicável para fechar */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="params-overlay-panel absolute left-0 right-0 top-full z-50 bg-bg border-b border-text-muted/10 shadow-[0_8px_24px_rgba(0,0,0,0.4)] px-4 pb-4 pt-3 grid grid-cols-2 min-[900px]:grid-cols-4 gap-x-6 gap-y-4">
            <div>
              <label className="flex justify-between items-baseline mb-1.5 text-[13px]">
                <span className="font-medium">Limiar de silêncio</span>
                <span className="text-text-secondary tabular-nums">{params.threshold} dB</span>
              </label>
              <input type="range" min="-60" max="-10" step="1" value={params.threshold}
                onChange={(e) => schedule({ threshold: parseFloat(e.target.value) })}
                className="w-full accent-accent" />
              <p className="text-text-muted text-[11px] mt-1">Abaixo disso é silêncio.</p>
            </div>
            <div>
              <label className="flex justify-between items-baseline mb-1.5 text-[13px]">
                <span className="font-medium">Silêncio mínimo</span>
                <span className="text-text-secondary tabular-nums">{params.min_silence.toFixed(1)} s</span>
              </label>
              <input type="range" min="0.1" max="10" step="0.1" value={params.min_silence}
                onChange={(e) => schedule({ min_silence: parseFloat(e.target.value) })}
                className="w-full accent-accent" />
              <p className="text-text-muted text-[11px] mt-1">Duração mínima da pausa para cortar.</p>
            </div>
            <div>
              <label className="flex justify-between items-baseline mb-1.5 text-[13px]">
                <span className="font-medium">Margem (alças)</span>
                <span className="text-text-secondary tabular-nums">{params.margin.toFixed(2)} s</span>
              </label>
              <input type="range" min="0" max="0.5" step="0.01" value={params.margin}
                onChange={(e) => schedule({ margin: parseFloat(e.target.value) })}
                className="w-full accent-accent" />
              <p className="text-text-muted text-[11px] mt-1">Folga ao redor da fala.</p>
            </div>
            <div>
              <label className="flex justify-between items-baseline mb-1.5 text-[13px]">
                <span className="font-medium">Clipe mínimo</span>
                <span className="text-text-secondary tabular-nums">{params.min_clip.toFixed(1)} s</span>
              </label>
              <input type="range" min="0" max="2" step="0.1" value={params.min_clip}
                onChange={(e) => schedule({ min_clip: parseFloat(e.target.value) })}
                className="w-full accent-accent" />
              <p className="text-text-muted text-[11px] mt-1">Descarta trechos mantidos curtos.</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
