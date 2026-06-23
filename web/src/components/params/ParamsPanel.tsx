import { useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'

export default function ParamsPanel() {
  const { params, setParams, detect } = useAppStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedule = (patch: Parameters<typeof setParams>[0]) => {
    setParams(patch)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => detect(), 300)
  }

  return (
    <div className="bg-bg-secondary rounded-md p-4 mb-4">
      <p className="text-text-secondary text-xs uppercase tracking-wide mb-2.5">
        Parâmetros
      </p>
      <div className="grid grid-cols-1 min-[680px]:grid-cols-2 gap-x-6 gap-y-[18px]">
        <div>
          <label className="flex justify-between items-baseline mb-1.5">
            <span className="font-medium">Limiar de silêncio</span>
            <span className="text-text-secondary tabular-nums">{params.threshold} dB</span>
          </label>
          <input type="range" min="-60" max="-10" step="1" value={params.threshold}
            onChange={(e) => schedule({ threshold: parseFloat(e.target.value) })}
            className="w-full accent-accent" />
          <div className="text-text-secondary text-xs mt-1">Abaixo disso é silêncio. Mais negativo corta só o silêncio mais profundo.</div>
        </div>
        <div>
          <label className="flex justify-between items-baseline mb-1.5">
            <span className="font-medium">Silêncio mínimo</span>
            <span className="text-text-secondary tabular-nums">{params.min_silence.toFixed(1)} s</span>
          </label>
          <input type="range" min="0.1" max="10" step="0.1" value={params.min_silence}
            onChange={(e) => schedule({ min_silence: parseFloat(e.target.value) })}
            className="w-full accent-accent" />
          <div className="text-text-secondary text-xs mt-1">Quão longa a pausa precisa ser para virar corte. Evita cortar respiros.</div>
        </div>
        <div>
          <label className="flex justify-between items-baseline mb-1.5">
            <span className="font-medium">Margem (alças)</span>
            <span className="text-text-secondary tabular-nums">{params.margin.toFixed(2)} s</span>
          </label>
          <input type="range" min="0" max="0.5" step="0.01" value={params.margin}
            onChange={(e) => schedule({ margin: parseFloat(e.target.value) })}
            className="w-full accent-accent" />
          <div className="text-text-secondary text-xs mt-1">Folga preservada ao redor da fala. Evita cortar o início/fim das palavras.</div>
        </div>
        <div>
          <label className="flex justify-between items-baseline mb-1.5">
            <span className="font-medium">Clipe mínimo</span>
            <span className="text-text-secondary tabular-nums">{params.min_clip.toFixed(1)} s</span>
          </label>
          <input type="range" min="0" max="2" step="0.1" value={params.min_clip}
            onChange={(e) => schedule({ min_clip: parseFloat(e.target.value) })}
            className="w-full accent-accent" />
          <div className="text-text-secondary text-xs mt-1">Descarta trechos mantidos curtos demais.</div>
        </div>
      </div>
    </div>
  )
}
