import { Player } from '@remotion/player'
import { useAppStore } from '../../store/useAppStore'
// Fonte única: o MESMO componente que o backend renderiza no .mov (remotion/src).
// O preview ao vivo e o export final não podem divergir.
import { MotionText, type MotionTextProps } from '../../../../remotion/src/MotionText'
import type { MotionItem, MotionEntry } from '../../types'

interface Props {
  item: MotionItem
  st: MotionEntry
}

export default function MotionPlayerPreview({ item, st }: Props) {
  const meta = useAppStore((s) => s.mediaMeta)
  // usa as dimensões/fps REAIS do vídeo — o render do .mov (server.py) faz o mesmo,
  // então o preview bate com o export em qualquer formato (9:16, 16:9, etc.)
  const width = meta?.width ?? 1080
  const height = meta?.height ?? 1920
  const fps = meta?.fps ?? 30

  const durationInSeconds = Math.max(0.5, item.end_s - item.start_s)
  const durationInFrames = Math.max(1, Math.round(durationInSeconds * fps))

  const inputProps: MotionTextProps = {
    text: item.frase,
    durationInSeconds,
    fps,
    width,
    height,
    position: st.position as MotionTextProps['position'],
    animationStyle: st.animationStyle as MotionTextProps['animationStyle'],
    entryDirection: st.entryDirection as MotionTextProps['entryDirection'],
    accentWord: st.accentWord,
    accentColor: st.accentColor as MotionTextProps['accentColor'],
    showBgBox: st.showBgBox,
    capsMode: st.capsMode,
    staggerSpeed: st.staggerSpeed,
  }

  return (
    <Player
      component={MotionText}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      compositionWidth={width}
      compositionHeight={height}
      fps={fps}
      loop
      autoPlay
      acknowledgeRemotionLicense
      style={{ width: '100%', aspectRatio: `${width} / ${height}`, background: '#0a0b0e', borderRadius: 8 }}
    />
  )
}
