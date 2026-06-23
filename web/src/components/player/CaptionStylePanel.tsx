import { useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'

const BUILT_IN_FONTS = [
  { name: 'Inter',       label: 'Inter' },
  { name: 'Montserrat',  label: 'Montserrat' },
  { name: 'Oswald',      label: 'Oswald' },
  { name: 'Bebas Neue',  label: 'Bebas' },
  { name: 'Anton',       label: 'Anton' },
  { name: 'Impact',      label: 'Impact' },
]

const EFFECT_OPTIONS = [
  { id: 'nenhum',      label: 'Nenhum' },
  { id: 'fade',        label: 'Fade' },
  { id: 'subir',       label: 'Subir' },
  { id: 'descer',      label: 'Descer' },
  { id: 'pop',         label: 'Pop' },
  { id: 'bounce',      label: 'Bounce' },
  { id: 'coreografia', label: 'Coreografia' },
]

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] text-text-muted uppercase tracking-wide mb-2 mt-0">{children}</p>
  )
}

export default function CaptionStylePanel() {
  const captionStyle    = useAppStore((s) => s.captionStyle)
  const setCaptionStyle = useAppStore((s) => s.setCaptionStyle)
  const addCustomFont   = useAppStore((s) => s.addCustomFont)
  const fontInputRef    = useRef<HTMLInputElement>(null)

  const allFonts = [...BUILT_IN_FONTS, ...captionStyle.customFonts]

  const handleFontUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    // usa o nome do arquivo (sem extensão) como nome da fonte
    const name = file.name.replace(/\.[^.]+$/, '')
    const face = new FontFace(name, `url(${url})`)
    face.load().then((loaded) => {
      document.fonts.add(loaded)
      addCustomFont({ name, label: name, url })
      setCaptionStyle({ font: name })
    }).catch(() => URL.revokeObjectURL(url))
    e.target.value = ''
  }

  return (
    <div className="w-[210px] shrink-0 border-l border-text-muted/10 bg-bg-secondary/20 overflow-y-auto flex flex-col">
      {/* cabeçalho */}
      <div className="px-3 py-2.5 border-b border-text-muted/10 flex items-center justify-between">
        <span className="text-text-secondary text-[10px] uppercase tracking-wide">Legenda</span>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={captionStyle.on}
            onChange={(e) => setCaptionStyle({ on: e.target.checked })}
            className="accent-accent"
          />
          <span className="text-[11px] text-text-secondary">{captionStyle.on ? 'Ativa' : 'Oculta'}</span>
        </label>
      </div>

      {captionStyle.on && (
        <div className="px-3 py-3 flex flex-col gap-4">

          {/* Aparência */}
          <section>
            <SectionTitle>Aparência</SectionTitle>
            <div className="flex flex-col gap-2.5">
              <label className="flex items-center gap-2 cursor-pointer select-none text-[12px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={captionStyle.bg}
                  onChange={(e) => setCaptionStyle({ bg: e.target.checked })}
                  className="accent-accent"
                />
                Fundo escuro
              </label>

              <div className="flex items-center justify-between text-[12px] text-text-secondary">
                <span>Cor do texto</span>
                <input
                  type="color"
                  value={captionStyle.color}
                  onChange={(e) => setCaptionStyle({ color: e.target.value })}
                  className="w-8 h-6 rounded cursor-pointer border border-text-muted/20 bg-transparent p-0.5"
                />
              </div>
            </div>
          </section>

          {/* Contorno */}
          <section>
            <SectionTitle>Contorno das letras</SectionTitle>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[12px] text-text-secondary">
                <span>Cor</span>
                <input
                  type="color"
                  value={captionStyle.strokeColor}
                  onChange={(e) => setCaptionStyle({ strokeColor: e.target.value })}
                  className="w-8 h-6 rounded cursor-pointer border border-text-muted/20 bg-transparent p-0.5"
                />
              </div>
              <div className="flex flex-col gap-1 text-[12px] text-text-secondary">
                <div className="flex justify-between">
                  <span>Grossura</span>
                  <span className="tabular-nums text-text-muted">{captionStyle.strokeWidth}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={0.5}
                  value={captionStyle.strokeWidth}
                  onChange={(e) => setCaptionStyle({ strokeWidth: Number(e.target.value) })}
                  className="w-full accent-accent"
                />
              </div>
            </div>
          </section>

          {/* Palavras por vez */}
          <section>
            <SectionTitle>Palavras por vez</SectionTitle>
            <div className="flex gap-1">
              {([0, 1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setCaptionStyle({ wordsPerCaption: n })}
                  className={`flex-1 py-1 rounded-sm text-[11px] transition-colors ${
                    captionStyle.wordsPerCaption === n
                      ? 'bg-accent text-on-accent'
                      : 'bg-bg-secondary hover:bg-bg-secondary/70 text-text-secondary'
                  }`}
                >
                  {n === 0 ? 'Tudo' : n}
                </button>
              ))}
            </div>
          </section>

          {/* Efeito de entrada */}
          <section>
            <SectionTitle>Efeito de entrada</SectionTitle>
            <div className="flex flex-col gap-1">
              {EFFECT_OPTIONS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setCaptionStyle({ effect: id })}
                  className={`px-2.5 py-1 rounded-sm text-[11px] text-left transition-colors ${
                    captionStyle.effect === id
                      ? 'bg-accent text-on-accent'
                      : 'bg-bg-secondary hover:bg-bg-secondary/70 text-text-secondary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Fonte */}
          <section>
            <SectionTitle>Fonte</SectionTitle>
            <div className="flex flex-col gap-1">
              {allFonts.map(({ name, label }) => (
                <button
                  key={name}
                  onClick={() => setCaptionStyle({ font: name })}
                  className={`px-2.5 py-1 rounded-sm text-[11px] text-left transition-colors ${
                    captionStyle.font === name
                      ? 'bg-accent text-on-accent'
                      : 'bg-bg-secondary hover:bg-bg-secondary/70 text-text-secondary'
                  }`}
                  style={{ fontFamily: `'${name}', sans-serif` }}
                >
                  {label}
                </button>
              ))}

              <button
                onClick={() => fontInputRef.current?.click()}
                className="mt-1 px-2.5 py-1.5 rounded-sm text-[11px] text-left border border-dashed border-text-muted/30 text-text-muted hover:text-text-secondary hover:border-text-muted/60 transition-colors"
              >
                + Importar fonte (.ttf / .otf)
              </button>
              <input
                ref={fontInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                className="hidden"
                onChange={handleFontUpload}
              />
            </div>
          </section>

          <p className="text-[10px] text-text-muted italic mt-1">↕ arraste a legenda no vídeo para reposicionar</p>
        </div>
      )}
    </div>
  )
}
