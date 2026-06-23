import { useAppStore } from '../../store/useAppStore'
import TranscriptSegment from './TranscriptSegment'
import { apiExportSrt } from '../../api/client'

export default function TranscriptPanel() {
  const { transSegs, transLang, setTransLang, transcribe, loadAnalysis, analysis, transStatus, applyAllCuts } = useAppStore()

  const handleExportSrt = async () => {
    if (!transSegs.length) return
    try {
      const d = await apiExportSrt({ segments: transSegs })
      if (d.ok) useAppStore.setState({ transStatus: { msg: `Legenda exportada (${d.count} seg) → ${d.srt_path}`, ok: true } })
      else useAppStore.setState({ transStatus: { msg: 'Erro ao exportar legenda.', ok: false } })
    } catch (_) {
      useAppStore.setState({ transStatus: { msg: 'Erro ao exportar legenda.', ok: false } })
    }
  }

  const cutSegs = (analysis?.segments ?? []).filter((s) => s.cut)
  const segMap = new Map((analysis?.segments ?? []).map((s) => [s.index, s]))

  return (
    <div className="bg-bg-secondary rounded-md p-4 flex flex-col max-h-none min-[900px]:max-h-[calc(100vh-40px)]">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <p className="text-text-secondary text-xs uppercase tracking-wide m-0">Transcrição</p>
        <div className="flex gap-2 items-center">
          <select
            value={transLang}
            onChange={(e) => setTransLang(e.target.value)}
            className="text-text-primary bg-bg-secondary rounded-sm px-2.5 py-2 text-[13px] border border-text-muted/20"
          >
            <option value="pt">Português</option>
            <option value="en">Inglês</option>
            <option value="auto">Detectar idioma</option>
          </select>
          <button
            onClick={transcribe}
            className="bg-accent text-on-accent rounded-sm px-3.5 py-2 text-[13px] font-medium hover:bg-accent-hover transition-colors"
          >
            Transcrever
          </button>
        </div>
      </div>

      <div className="transcript flex-1 min-h-0 max-h-[60vh] min-[900px]:max-h-none overflow-y-auto">
        {transSegs.length === 0 && (
          <div className="text-text-secondary text-[13px] py-2">
            Carregue um vídeo em "Abrir vídeo" para transcrever automaticamente.
          </div>
        )}
        {analysis?.summary && (
          <div className="ai-summary text-[13px] bg-bg-secondary rounded-md px-2.5 py-2 mb-2.5">
            {analysis.summary}
            {cutSegs.length > 0 && (
              <>
                <br />
                <button
                  onClick={() => applyAllCuts(cutSegs.map((s) => s.index))}
                  className="ai-cuts-all mt-2 bg-transparent text-accent-soft border border-accent/50 rounded-sm px-2.5 py-1 text-xs hover:bg-accent/10"
                >
                  Remover todos os {cutSegs.length} trechos repetidos do vídeo
                </button>
              </>
            )}
          </div>
        )}
        {transSegs.map((s, i) => (
          <TranscriptSegment
            key={i}
            index={i}
            start={s.start}
            end={s.end}
            text={s.text}
            seg={segMap.get(i)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 pt-2.5 mt-2 flex-wrap">
        <span className={`text-xs break-all ${transStatus.ok ? 'text-keep' : 'text-text-secondary'}`}>
          {transStatus.msg}
        </span>
        <span className="flex gap-2 flex-wrap">
          <button
            onClick={loadAnalysis}
            className="bg-bg-secondary text-text-primary rounded-sm px-2.5 py-1.5 text-xs hover:bg-bg-secondary/70 transition-colors"
          >
            Carregar análise da IA
          </button>
          <button
            onClick={handleExportSrt}
            className="bg-bg-secondary text-text-primary rounded-sm px-2.5 py-1.5 text-xs hover:bg-bg-secondary/70 transition-colors"
          >
            Exportar legenda (SRT)
          </button>
        </span>
      </div>
    </div>
  )
}
