import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { apiIaStatus } from '../api/client'

export default function Navbar() {
  const { activeTab, setActiveTab, videoLabel, mediaMeta, pickVideo } = useAppStore()
  const [iaConnected, setIaConnected] = useState<boolean | null>(null)
  const [iaPopover, setIaPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const check = () =>
      apiIaStatus()
        .then((d) => { if (alive) setIaConnected(d.connected) })
        .catch(() => { if (alive) setIaConnected(false) })
    check()
    const timer = setInterval(check, 6000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // fecha popover ao clicar fora
  useEffect(() => {
    if (!iaPopover) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIaPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [iaPopover])

  return (
    <header className="sticky top-0 z-40 h-11 flex items-center gap-0 border-b border-text-muted/10 bg-bg px-4">
      {/* logo */}
      <span className="text-[13px] font-semibold tracking-tight text-text-primary pr-5 border-r border-text-muted/15 mr-3 shrink-0">
        claude-to-premier
      </span>

      {/* tabs */}
      <nav className="flex gap-0.5 mr-auto">
        <button
          onClick={() => setActiveTab('revisao')}
          className={`tab-btn px-3 py-1.5 text-[13px] rounded-[5px] transition-colors ${activeTab === 'revisao' ? 'tab-active' : ''}`}
        >
          Revisão de cortes
        </button>
        <button
          onClick={() => setActiveTab('motion')}
          className={`tab-btn px-3 py-1.5 text-[13px] rounded-[5px] transition-colors ${activeTab === 'motion' ? 'tab-active' : ''}`}
        >
          Cortes e animações
        </button>
      </nav>

      {/* IA status */}
      {iaConnected !== null && (
        <div className="relative px-3 border-r border-text-muted/15 mr-3 shrink-0" ref={popoverRef}>
          <button
            onClick={() => !iaConnected && setIaPopover((v) => !v)}
            className={`flex items-center gap-1.5 text-[11px] transition-opacity ${iaConnected ? 'text-keep cursor-default' : 'text-danger-text hover:opacity-80'}`}
            title={iaConnected ? 'A escuta da IA está ativa — análise sai automaticamente ao transcrever.' : undefined}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${iaConnected ? 'bg-keep animate-pulse' : 'bg-danger-text'}`} />
            {iaConnected ? 'IA conectada' : 'IA desconectada'}
          </button>

          {/* popover de instruções */}
          {iaPopover && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-bg-secondary border border-text-muted/20 rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.5)] p-3.5 z-50 text-[12px] text-text-secondary leading-relaxed">
              <p className="text-text-primary font-medium mb-1.5">Como reconectar a IA</p>
              <p className="mb-2">A análise automática depende do Claude Code estar rodando neste projeto.</p>
              <ol className="list-decimal list-inside space-y-1 text-text-secondary">
                <li>Abra o <span className="text-text-primary font-mono">claude</span> no terminal deste projeto</li>
                <li>Digite <span className="text-text-primary font-mono">/iniciar</span> e pressione Enter</li>
                <li>O badge vai ficar verde em até 10s</li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* video info */}
      <span className="text-text-muted text-xs tabular-nums mr-3 shrink-0 hidden min-[700px]:block">
        {mediaMeta
          ? `${videoLabel} · ${mediaMeta.duration.toFixed(1)}s · ${mediaMeta.fps}fps · ${mediaMeta.width}×${mediaMeta.height}`
          : 'nenhum vídeo'}
      </span>

      {/* abrir vídeo */}
      <button
        onClick={pickVideo}
        className="bg-bg-secondary text-text-primary rounded-sm px-3 py-1.5 text-[13px] hover:bg-bg-secondary/70 transition-colors shrink-0"
      >
        Abrir vídeo
      </button>
    </header>
  )
}
