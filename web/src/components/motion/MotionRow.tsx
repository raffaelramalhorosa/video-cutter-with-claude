import { useAppStore } from '../../store/useAppStore'
import type { MotionItem } from '../../types'
import { motionPreviewUrl } from '../../api/client'

function toMMSS(s: number) {
  s = Math.max(0, Math.round(s))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

interface Props { index: number; item: MotionItem }

const STYLE_OPTS = [['spring','Spring'],['typewriter','Typewriter'],['highlight','Highlight'],['lateral','Lateral'],['punch','Punch-in']]
const POS_OPTS   = [['bottom','Inferior'],['center','Centro'],['top','Superior']]
const DIR_OPTS   = [['bottom','↑ Baixo'],['top','↓ Cima'],['left','→ Esq.'],['right','← Dir.']]
const COLOR_OPTS = [['amber','Âmbar'],['white','Branco'],['red','Vermelho']]

export default function MotionRow({ index, item }: Props) {
  const { motionState, setMotionState, generateMotion } = useAppStore()
  const st = motionState[index] ?? {
    generating: false, path: undefined, included: true, ts: 0,
    position: 'bottom', animationStyle: 'spring', entryDirection: 'bottom',
    accentWord: '', accentColor: 'amber', showBgBox: false, capsMode: false, staggerSpeed: 1,
  }

  const sel = (label: string, key: keyof typeof st, opts: string[][], val: string) => (
    <div className="flex flex-col gap-1">
      <span className="text-text-muted text-xs">{label}</span>
      <select
        value={val}
        onChange={(e) => setMotionState(index, { [key]: e.target.value })}
        className="text-text-primary bg-bg text-xs rounded-sm px-2 py-1.5 border border-text-muted/20"
      >
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )

  return (
    <div className="motion-row pt-3 first:pt-0">
      <div className="flex justify-between items-baseline gap-3 mb-3">
        <span className="text-text-muted tabular-nums text-xs whitespace-nowrap">{toMMSS(item.start_s)}–{toMMSS(item.end_s)}</span>
        <span className="text-text-primary text-[13px] flex-1">"{item.frase}"</span>
      </div>
      <div className="flex gap-3 items-start">
        <div className="flex flex-col gap-2.5 flex-1 min-w-0">
          <div className="grid grid-cols-3 gap-2">
            {sel('Posição', 'position', POS_OPTS, st.position)}
            {sel('Animação', 'animationStyle', STYLE_OPTS, st.animationStyle)}
            {sel('Direção', 'entryDirection', DIR_OPTS, st.entryDirection)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {sel('Cor destaque', 'accentColor', COLOR_OPTS, st.accentColor)}
            <div className="flex flex-col gap-1">
              <span className="text-text-muted text-xs">Palavra em destaque</span>
              <input
                type="text" value={st.accentWord} placeholder="ex: propósito"
                onChange={(e) => setMotionState(index, { accentWord: e.target.value })}
                className="text-text-primary bg-bg text-xs rounded-sm px-2 py-1.5 border border-text-muted/20 placeholder:text-text-muted"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-text-muted text-xs flex justify-between">
              Velocidade do stagger <span>{st.staggerSpeed.toFixed(1)}×</span>
            </label>
            <input
              type="range" min="0.25" max="3" step="0.25" value={st.staggerSpeed}
              onChange={(e) => setMotionState(index, { staggerSpeed: parseFloat(e.target.value) })}
              className="w-full accent-accent"
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={st.showBgBox} onChange={(e) => setMotionState(index, { showBgBox: e.target.checked })} className="accent-accent" />
              Caixa de fundo
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={st.capsMode} onChange={(e) => setMotionState(index, { capsMode: e.target.checked })} className="accent-accent" />
              MAIÚSCULAS
            </label>
          </div>
          <div className="mt-auto pt-1">
            {st.generating ? (
              <div className="flex items-center gap-2 text-text-secondary text-xs">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-text-muted/30 border-t-text-primary animate-spin" />
                Gerando clipe…
              </div>
            ) : (
              <button onClick={() => generateMotion(index)} className="bg-accent text-on-accent rounded-sm px-3 py-1.5 text-xs font-medium hover:bg-accent-hover transition-colors">
                {st.path ? 'Regerar' : 'Gerar clipe'}
              </button>
            )}
          </div>
        </div>
        <div className="w-[160px] shrink-0 flex flex-col gap-1.5">
          {st.generating ? (
            <div className="w-full aspect-[9/16] bg-bg rounded-md flex flex-col items-center justify-center gap-2 border border-text-muted/10">
              <span className="w-6 h-6 rounded-full border-2 border-text-muted/20 border-t-accent animate-spin" />
              <span className="text-text-muted text-[11px]">Gerando…</span>
            </div>
          ) : st.path ? (
            <>
              <video src={motionPreviewUrl(index, st.ts ?? 0)} controls playsInline className="w-full aspect-[9/16] bg-black rounded-md object-contain" />
              <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer justify-center">
                <input type="checkbox" checked={st.included} onChange={(e) => setMotionState(index, { included: e.target.checked })} className="accent-accent" />
                Incluir na exportação
              </label>
            </>
          ) : (
            <div className="w-full aspect-[9/16] bg-bg rounded-md flex items-center justify-center border border-dashed border-text-muted/20">
              <span className="text-text-muted text-[11px] text-center px-3">Preview<br />após gerar</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
