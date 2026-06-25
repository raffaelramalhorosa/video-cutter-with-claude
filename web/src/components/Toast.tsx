import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'

export default function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)
  const removeToast = useAppStore((s) => s.removeToast)

  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50 pointer-events-none">
      {toasts.map((t) => (
        <Toast key={t.id} id={t.id} msg={t.msg} icon={t.icon} onDone={removeToast} />
      ))}
    </div>
  )
}

function Toast({ id, msg, icon, onDone }: { id: string; msg: string; icon: string; onDone: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(id), 5000)
    return () => clearTimeout(timer)
  }, [id, onDone])

  return (
    <div className="pointer-events-auto flex items-center gap-2.5 bg-bg-secondary border border-text-muted/20 rounded-md px-4 py-2.5 shadow-lg text-[13px] text-text-primary animate-fade-in">
      <span className="text-base">{icon}</span>
      <span>{msg}</span>
      <button
        onClick={() => onDone(id)}
        className="ml-2 text-text-muted hover:text-text-primary transition-colors text-[11px]"
      >
        ✕
      </button>
    </div>
  )
}
