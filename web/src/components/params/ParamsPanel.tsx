import { useRef, useState, useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'

const PRESETS = {
  Conservador: { threshold: -40, min_silence: 1.0, margin: 0.2,  min_clip: 0.5 },
  Normal:      { threshold: -30, min_silence: 0.5, margin: 0.15, min_clip: 0.3 },
  Agressivo:   { threshold: -20, min_silence: 0.3, margin: 0.05, min_clip: 0.2 },
}

function fmtSec(s: number) {
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  return m > 0 ? `${m}m ${r}s` : `${r}s`
}

function activePreset(params: { threshold: number; min_silence: number; margin: number; min_clip: number }) {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (p.threshold === params.threshold && p.min_silence === params.min_silence
        && p.margin === params.margin && p.min_clip === params.min_clip) return name
  }
  return null
}

export default function ParamsPanel() {
  const { params, setParams, detect, detecting, keeps, dur, paramsHistory, paramsHistoryIndex, undoDetect, redoDetect } = useAppStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)

  const schedule = (patch: Parameters<typeof setParams>[0]) => {
    setParams(patch)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => detect(), 300)
  }

  const applyPreset = (name: keyof typeof PRESETS) => {
    setParams(PRESETS[name])
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => detect(), 300)
  }

  // Ctrl+Z / Ctrl+Shift+Z globais para undo/redo de parâmetros
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoDetect() }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redoDetect() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [undoDetect, redoDetect])

  // stats da timeline atual
  const keptTime    = keeps.reduce((a, k) => a + (k.out - k.in), 0)
  const removedTime = Math.max(0, dur - keptTime)
  const removedPct  = dur > 0 ? Math.round((removedTime / dur) * 100) : 0
  const cutsCount   = keeps.length

  const preset     = activePreset(params)
  const canUndo    = paramsHistoryIndex > 0
  const canRedo    = paramsHistoryIndex < paramsHistory.length - 1

  return (
    <div className="relative border-b border-text-muted/10">
      {/* barra sempre visível */}
      <div className="w-full flex items-center gap-3 px-4 py-2 text-[12px]">

        {/* stats */}
        {dur > 0 && (
          <span className="flex gap-3 text-text-secondary tabular-nums shrink-0">
            <span title="Clipes mantidos">{cutsCount} clipes</span>
            <span className="text-text-muted">·</span>
            <span title="Tempo removido" className={removedPct > 60 ? 'text-cut' : ''}>
              −{fmtSec(removedTime)} ({removedPct}%)
            </span>
          </span>
        )}

        {/* spin enquanto detecta */}
        {detecting && (
          <span className="text-text-muted text-[11px] animate-pulse shrink-0">calculando…</span>
        )}

        {/* undo/redo */}
        <span className="flex gap-1 ml-auto shrink-0">
          <button
            disabled={!canUndo}
            onClick={undoDetect}
            title="Desfazer (Ctrl+Z)"
            className="w-6 h-6 flex items-center justify-center rounded text-[13px] text-text-muted disabled:opacity-25 enabled:hover:text-text-primary enabled:hover:bg-bg-secondary transition-colors"
          >↩</button>
          <button
            disabled={!canRedo}
            onClick={redoDetect}
            title="Refazer (Ctrl+Shift+Z)"
            className="w-6 h-6 flex items-center justify-center rounded text-[13px] text-text-muted disabled:opacity-25 enabled:hover:text-text-primary enabled:hover:bg-bg-secondary transition-colors"
          >↪</button>
        </span>

        {/* toggle painel */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors shrink-0"
        >
          ⚙ {open ? 'Fechar' : 'Parâmetros'}
        </button>
      </div>

      {/* overlay flutuante */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="params-overlay-panel absolute left-0 right-0 top-full z-50 bg-bg border-b border-text-muted/10 shadow-[0_8px_24px_rgba(0,0,0,0.4)] px-4 pb-4 pt-3">

            {/* presets */}
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-text-muted/10">
              <span className="text-[11px] text-text-muted uppercase tracking-wide shrink-0">Preset:</span>
              {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((name) => (
                <button
                  key={name}
                  onClick={() => applyPreset(name)}
                  className={[
                    'px-3 py-1 rounded-sm text-[12px] border transition-colors',
                    preset === name
                      ? 'bg-accent/15 border-accent/60 text-accent font-medium'
                      : 'border-text-muted/20 text-text-secondary hover:border-text-muted/40 hover:text-text-primary',
                  ].join(' ')}
                >
                  {name}
                </button>
              ))}
              {!preset && (
                <button
                  onClick={() => applyPreset('Normal')}
                  className="ml-auto px-2.5 py-1 text-[11px] text-text-muted border border-text-muted/20 rounded-sm hover:text-text-secondary transition-colors"
                  title="Voltar para Normal"
                >
                  ↺ Reset
                </button>
              )}
            </div>

            {/* sliders */}
            <div className="grid grid-cols-2 min-[900px]:grid-cols-4 gap-x-6 gap-y-4">
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
          </div>
        </>
      )}
    </div>
  )
}
