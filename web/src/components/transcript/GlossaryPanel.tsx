import { useEffect, useState } from 'react'

interface GlossaryState {
  words: string[]
  open: boolean
  input: string
  loading: boolean
}

async function fetchWords(): Promise<string[]> {
  const r = await fetch('/api/glossary')
  const d = await r.json()
  return d.words ?? []
}

async function addWord(word: string): Promise<void> {
  await fetch('/api/glossary/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  })
}

async function removeWord(word: string): Promise<void> {
  await fetch('/api/glossary/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  })
}

export default function GlossaryPanel() {
  const [state, setState] = useState<GlossaryState>({ words: [], open: false, input: '', loading: false })

  const load = async () => {
    const words = await fetchWords()
    setState((s) => ({ ...s, words }))
  }

  useEffect(() => {
    load()
  }, [])

  const toggle = () => {
    setState((s) => ({ ...s, open: !s.open }))
    if (!state.open) load()
  }

  const handleAdd = async () => {
    const word = state.input.trim()
    if (!word) return
    setState((s) => ({ ...s, loading: true }))
    await addWord(word)
    const words = await fetchWords()
    setState((s) => ({ ...s, words, input: '', loading: false }))
  }

  const handleRemove = async (word: string) => {
    await removeWord(word)
    const words = await fetchWords()
    setState((s) => ({ ...s, words }))
  }

  return (
    <div className="border-t border-text-muted/10 pt-2 mt-1">
      <button
        onClick={toggle}
        className="text-text-muted text-xs hover:text-text-primary transition-colors flex items-center gap-1"
      >
        {state.open ? '▾' : '▸'} Glossário ({state.words.length} palavras)
      </button>

      {state.open && (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {state.words.length === 0 && (
              <span className="text-text-muted text-xs italic">Nenhuma palavra ainda.</span>
            )}
            {state.words.map((w) => (
              <span
                key={w}
                className="flex items-center gap-1 bg-bg-secondary rounded-sm px-2 py-0.5 text-xs text-text-secondary"
              >
                {w}
                <button
                  onClick={() => handleRemove(w)}
                  className="text-text-muted hover:text-danger-text transition-colors leading-none"
                  title="Remover"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={state.input}
              onChange={(e) => setState((s) => ({ ...s, input: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Adicionar palavra…"
              className="flex-1 bg-bg-secondary text-text-primary text-xs rounded-sm px-2 py-1 outline-none border border-text-muted/20 focus:border-accent/50"
            />
            <button
              onClick={handleAdd}
              disabled={state.loading || !state.input.trim()}
              className="bg-bg-secondary text-text-secondary text-xs rounded-sm px-2.5 py-1 hover:bg-bg-secondary/70 disabled:opacity-50 transition-colors"
            >
              Adicionar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
