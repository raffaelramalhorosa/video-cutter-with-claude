import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'

export default function ExportModal() {
  const { exportModalOpen, transSegs, analysis, motionState, exportXml } = useAppStore()
  const [srt, setSrt] = useState(true)
  const [motion, setMotion] = useState(true)
  const [chapters, setChapters] = useState(true)

  const hasSrt = transSegs.length > 0
  const genMotion = Object.keys(motionState).filter((i) => motionState[+i].path && motionState[+i].included)
  const hasMotion = genMotion.length > 0
  const hasChapters = !!(analysis?.chapters?.length)

  const close = () => useAppStore.setState({ exportModalOpen: false })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  if (!exportModalOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="bg-bg-secondary rounded-lg p-5 w-full max-w-[440px] shadow-2xl border border-text-muted/10">
        <h2 className="text-base font-medium m-0 mb-1">Exportar para o Premiere</h2>
        <p className="text-text-secondary text-xs mb-4">
          O XML de cortes sempre será gerado. Selecione o que mais deseja exportar junto:
        </p>
        <div className="flex flex-col gap-2 mb-5">
          {hasSrt && (
            <label className="flex items-start gap-3 cursor-pointer bg-bg rounded-md p-3 hover:bg-bg/60 transition-colors">
              <input type="checkbox" checked={srt} onChange={(e) => setSrt(e.target.checked)} className="accent-accent mt-0.5" />
              <span className="min-w-0">
                <span className="block text-[13px] text-text-primary">Legendas (.srt)</span>
                <span className="block text-text-muted text-xs">{transSegs.length} segmento(s) de transcrição</span>
              </span>
            </label>
          )}
          {hasMotion && (
            <label className="flex items-start gap-3 cursor-pointer bg-bg rounded-md p-3 hover:bg-bg/60 transition-colors">
              <input type="checkbox" checked={motion} onChange={(e) => setMotion(e.target.checked)} className="accent-accent mt-0.5" />
              <span className="min-w-0">
                <span className="block text-[13px] text-text-primary">Motion design</span>
                <span className="block text-text-muted text-xs">{genMotion.length} clipe(s) gerado(s) na 2ª trilha</span>
              </span>
            </label>
          )}
          {hasChapters && (
            <label className="flex items-start gap-3 cursor-pointer bg-bg rounded-md p-3 hover:bg-bg/60 transition-colors">
              <input type="checkbox" checked={chapters} onChange={(e) => setChapters(e.target.checked)} className="accent-accent mt-0.5" />
              <span className="min-w-0">
                <span className="block text-[13px] text-text-primary">Capítulos</span>
                <span className="block text-text-muted text-xs">{analysis!.chapters!.length} marcador(es) na timeline</span>
              </span>
            </label>
          )}
          {!hasSrt && !hasMotion && !hasChapters && (
            <p className="text-text-muted text-xs">Nenhuma opção extra disponível.</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={close} className="bg-bg text-text-primary rounded-sm px-3.5 py-2 text-[13px] hover:bg-bg/60 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => { close(); exportXml({ includeSrt: srt && hasSrt, includeMotion: motion && hasMotion, includeChapters: chapters && hasChapters }) }}
            className="bg-accent text-on-accent rounded-sm px-3.5 py-2 text-[13px] font-medium hover:bg-accent-hover transition-colors"
          >
            Exportar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
