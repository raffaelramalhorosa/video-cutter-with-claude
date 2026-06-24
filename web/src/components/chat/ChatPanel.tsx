import { useState, useEffect, useRef } from 'react'
import { apiChatPost, apiChatResponse } from '../../api/client'

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export default function ChatPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingId])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // poll para resposta enquanto aguarda
  useEffect(() => {
    if (!pendingId) return
    const timer = setInterval(async () => {
      try {
        const d = await apiChatResponse()
        if (d.available && d.id === pendingId && d.response) {
          setMessages((prev) => [...prev, { id: d.id!, role: 'assistant', text: d.response! }])
          setPendingId(null)
        }
      } catch (_) {}
    }, 1500)
    return () => clearInterval(timer)
  }, [pendingId])

  const send = async () => {
    const text = input.trim()
    if (!text || pendingId) return
    const id = `req_${Date.now()}`
    setMessages((prev) => [...prev, { id, role: 'user', text }])
    setInput('')
    setPendingId(id)
    try {
      await apiChatPost({ id, message: text })
    } catch (_) {
      setMessages((prev) => [...prev, {
        id: `${id}_err`,
        role: 'assistant',
        text: 'Erro ao enviar. Verifique se o servidor está rodando.',
      }])
      setPendingId(null)
    }
  }

  return (
    <>
      {/* botão flutuante */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Fechar chat' : 'Chat com Claude IA'}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-accent hover:bg-accent-hover shadow-lg flex items-center justify-center text-on-accent text-xl transition-colors"
      >
        {open ? '✕' : '💬'}
      </button>

      {/* painel flutuante */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-80 flex flex-col bg-bg border border-text-muted/20 rounded-lg shadow-xl overflow-hidden" style={{ maxHeight: '480px' }}>

          {/* cabeçalho */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-bg-secondary border-b border-text-muted/15 shrink-0">
            <span className="text-sm font-semibold text-text-primary">Claude IA</span>
            <span className="text-[11px] text-text-muted">· animações, análise, perguntas</span>
          </div>

          {/* histórico de mensagens */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5" style={{ minHeight: '200px' }}>
            {messages.length === 0 && (
              <p className="text-text-muted text-[12px] text-center mt-6 leading-relaxed px-2">
                Olá! Posso criar animações, ajustar a análise ou responder perguntas sobre o vídeo.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={[
                  'text-[12px] rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap break-words max-w-[92%]',
                  m.role === 'user'
                    ? 'self-end bg-accent/25 text-text-primary rounded-br-sm'
                    : 'self-start bg-bg-secondary text-text-secondary rounded-bl-sm',
                ].join(' ')}
              >
                {m.text}
              </div>
            ))}

            {/* indicador de digitação (aguardando resposta) */}
            {pendingId && (
              <div className="self-start flex gap-1 items-center px-3 py-2 bg-bg-secondary rounded-lg rounded-bl-sm">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* campo de entrada */}
          <div className="flex gap-1.5 p-2.5 border-t border-text-muted/15 shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              placeholder={pendingId ? 'Aguardando resposta…' : 'Escreva uma mensagem…'}
              disabled={!!pendingId}
              className="flex-1 bg-bg-secondary text-text-primary text-[12px] rounded-md px-2.5 py-2 border border-text-muted/20 outline-none focus:border-accent/60 disabled:opacity-50 placeholder:text-text-muted"
            />
            <button
              onClick={send}
              disabled={!!pendingId || !input.trim()}
              title="Enviar (Enter)"
              className="px-3 py-2 bg-accent text-on-accent text-[13px] rounded-md hover:bg-accent-hover disabled:opacity-40 transition-colors"
            >
              ▶
            </button>
          </div>

        </div>
      )}
    </>
  )
}
