import {
  AbsoluteFill,
  Video,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

// Tokens do STYLE.md (instrumento-tecnico-ambar)
const COR_TEXTO = '#F2F3F5'

// Cada legenda já vem do painel (texto possivelmente editado pelo usuário).
// `cut` marca trechos que o corte atual remove — a legenda some para simular
// o resultado final.
export interface CaptionSeg {
  start: number
  end: number
  text: string
  cut?: boolean
}

export interface FinalVideoProps {
  src: string
  segments: CaptionSeg[]
  captionsOn: boolean
}

/**
 * Composição que o <Player> renderiza: o vídeo original com a legenda
 * sobreposta, sincronizada quadro a quadro. Determinística (depende só do
 * frame atual), como o Remotion exige.
 */
export const FinalVideo: React.FC<FinalVideoProps> = ({ src, segments, captionsOn }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* <Video> (não OffthreadVideo) para o <Player>: usa um <video> real que
          busca corretamente ao arrastar/clicar com o player pausado. */}
      <Video src={src} />
      {captionsOn && <Captions segments={segments} />}
    </AbsoluteFill>
  )
}

const Captions: React.FC<{ segments: CaptionSeg[] }> = ({ segments }) => {
  const frame = useCurrentFrame()
  const { fps, height } = useVideoConfig()
  const t = frame / fps

  // legenda ativa no instante atual; ignora trechos cortados
  const seg = segments.find((s) => !s.cut && t >= s.start && t < s.end)
  if (!seg) return null

  // fade-in rápido (≈5 frames) ao entrar no segmento
  const localFrame = (t - seg.start) * fps
  const opacity = interpolate(localFrame, [0, 5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // tamanhos relativos à altura do vídeo (funciona em 16:9 e 9:16)
  const fontSize = Math.round(height * 0.05)
  const bottom = Math.round(height * 0.08)

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center' }}>
      <div
        style={{
          opacity,
          marginBottom: bottom,
          maxWidth: '82%',
          padding: `${fontSize * 0.35}px ${fontSize * 0.7}px`,
          background: 'rgba(0,0,0,0.6)',
          borderRadius: 12,
          color: COR_TEXTO,
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          fontSize,
          lineHeight: 1.25,
          textAlign: 'center',
          textShadow: '0 2px 8px rgba(0,0,0,0.8)',
        }}
      >
        {seg.text}
      </div>
    </AbsoluteFill>
  )
}
