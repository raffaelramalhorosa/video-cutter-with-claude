import { useAppStore } from '../../store/useAppStore'
import { playerRef } from '../player/VideoPlayer'

function toMMSS(s: number) {
  s = Math.max(0, Math.round(s))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function EditSuggestionsCard() {
  const sugs = useAppStore((s) => s.analysis?.edit_suggestions)
  if (!sugs?.length) return null
  return (
    <div className="bg-bg-secondary rounded-md p-4 mb-4">
      <p className="text-text-secondary text-xs uppercase tracking-wide mb-2.5">Sugestões de edição</p>
      <div className="flex flex-col gap-2">
        {sugs.map((s, i) => (
          <div key={i} className="text-[13px]">
            <span
              className="t text-text-muted tabular-nums cursor-pointer hover:text-text-primary"
              onClick={() => { if (playerRef.current) { playerRef.current.currentTime = s.start_s; playerRef.current.play() } }}
            >
              {toMMSS(s.start_s)}–{toMMSS(s.end_s)}
            </span>{' '}
            <span className="text-accent-soft">({s.tipo})</span>{' '}
            <span className="text-text-secondary">{s.sugestao}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
