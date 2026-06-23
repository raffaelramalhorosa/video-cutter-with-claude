import { useAppStore } from '../../store/useAppStore'
import { playerRef } from '../player/VideoPlayer'

function toMMSS(s: number) {
  s = Math.max(0, Math.round(s))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export default function ChaptersCard() {
  const chapters = useAppStore((s) => s.analysis?.chapters)
  if (!chapters?.length) return null

  const copyChapters = () => {
    const text = chapters.map((c) => `${toMMSS(c.start_s)} - ${c.title}`).join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <div className="bg-bg-secondary rounded-md p-4 mb-4">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <p className="text-text-secondary text-xs uppercase tracking-wide m-0">Capítulos</p>
        <button onClick={copyChapters} className="bg-bg-secondary text-text-primary rounded-sm px-2.5 py-1.5 text-xs hover:bg-bg-secondary/70 transition-colors">
          Copiar lista
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {chapters.map((c, i) => (
          <div
            key={i}
            className="flex gap-3 text-[13px] cursor-pointer rounded-[4px] px-1 py-1 hover:bg-bg/40"
            onClick={() => { if (playerRef.current) { playerRef.current.currentTime = c.start_s; playerRef.current.play() } }}
          >
            <span className="text-text-muted tabular-nums whitespace-nowrap">{toMMSS(c.start_s)}</span>
            <span className="text-text-primary">{c.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
