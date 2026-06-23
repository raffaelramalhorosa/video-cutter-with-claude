import { useAppStore } from '../store/useAppStore'

export default function Header() {
  const { activeTab, setActiveTab, videoLabel, mediaMeta, pickVideo } = useAppStore()

  return (
    <header className="flex items-center justify-between gap-4 mb-4 flex-wrap">
      <div className="flex items-center gap-5">
        <h1 className="text-lg font-medium m-0">Painel de revisão</h1>
        <nav className="flex gap-0.5 bg-bg rounded-md p-0.5">
          <button
            onClick={() => setActiveTab('revisao')}
            className={`tab-btn px-3.5 py-1.5 text-[13px] rounded-[5px] transition-colors ${activeTab === 'revisao' ? 'tab-active' : ''}`}
          >
            Revisão de cortes
          </button>
          <button
            onClick={() => setActiveTab('motion')}
            className={`tab-btn px-3.5 py-1.5 text-[13px] rounded-[5px] transition-colors ${activeTab === 'motion' ? 'tab-active' : ''}`}
          >
            Cortes e animações
          </button>
        </nav>
      </div>
      <div className="flex items-center gap-3.5">
        <div className="text-text-secondary text-xs tabular-nums">
          {mediaMeta
            ? `${videoLabel} · ${mediaMeta.duration.toFixed(1)}s · ${mediaMeta.fps} fps · ${mediaMeta.width}×${mediaMeta.height} · ${mediaMeta.channels} canal(is)`
            : 'carregando…'}
        </div>
        <button
          onClick={pickVideo}
          className="bg-bg-secondary text-text-primary rounded-sm px-3.5 py-2 text-[13px] hover:bg-bg-secondary/70 transition-colors"
        >
          Abrir vídeo
        </button>
      </div>
    </header>
  )
}
