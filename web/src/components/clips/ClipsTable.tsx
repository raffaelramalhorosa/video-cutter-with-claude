import { useAppStore } from '../../store/useAppStore'

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const r = (s - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${r}`
}

export default function ClipsTable() {
  const keeps = useAppStore((s) => s.keeps)
  return (
    <div className="bg-bg-secondary rounded-md p-4 mb-4">
      <p className="text-text-secondary text-xs uppercase tracking-wide mb-2.5">Trechos mantidos</p>
      <table className="w-full border-collapse tabular-nums">
        <thead>
          <tr className="text-text-secondary text-xs font-medium">
            <th className="text-left py-1.5 px-2.5">#</th>
            <th className="text-left py-1.5 px-2.5">Entra</th>
            <th className="text-left py-1.5 px-2.5">Sai</th>
            <th className="text-right py-1.5 px-2.5">Duração</th>
            <th className="text-right py-1.5 px-2.5">Frames</th>
          </tr>
        </thead>
        <tbody>
          {keeps.length === 0 ? (
            <tr><td colSpan={5} className="py-1.5 px-2.5 text-text-secondary">Nenhum trecho. Afrouxe o limiar.</td></tr>
          ) : keeps.map((k, i) => (
            <tr key={i}>
              <td className="py-1.5 px-2.5 border-t border-bg">{i + 1}</td>
              <td className="py-1.5 px-2.5 border-t border-bg">{fmt(k.in)}</td>
              <td className="py-1.5 px-2.5 border-t border-bg">{fmt(k.out)}</td>
              <td className="py-1.5 px-2.5 border-t border-bg text-right">{(k.out - k.in).toFixed(2)}s</td>
              <td className="py-1.5 px-2.5 border-t border-bg text-right">{k.in_frame}–{k.out_frame}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
