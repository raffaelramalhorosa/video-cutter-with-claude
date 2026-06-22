import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Props que o servidor passa via --props (JSON). As dimensoes/fps/duracao
// reais vem daqui e viram a metadata da composicao (calcMotionMetadata).
export type MotionTextProps = {
  text: string;
  durationInSeconds: number;
  fps: number;
  width: number;
  height: number;
  position: "bottom" | "center" | "top";
};

export const defaultMotionProps: MotionTextProps = {
  text: "Texto de exemplo do motion design",
  durationInSeconds: 3,
  fps: 30,
  width: 1080,
  height: 1920,
  position: "bottom",
};

// Define duracao/dimensoes/fps reais da composicao a partir das props.
export const calcMotionMetadata = ({
  props,
}: {
  props: MotionTextProps;
}) => {
  return {
    durationInFrames: Math.max(1, Math.round(props.durationInSeconds * props.fps)),
    fps: props.fps,
    width: props.width,
    height: props.height,
  };
};

// Posicao vertical do BLOCO de texto. Como o container e flex row + wrap, quem
// controla a posicao vertical das linhas e o alignContent (eixo cruzado), nao o
// justifyContent (que e o alinhamento horizontal das palavras dentro da linha).
const layoutByPosition: Record<MotionTextProps["position"], React.CSSProperties> = {
  top: { alignContent: "flex-start", padding: "12% 8% 0" },
  center: { alignContent: "center", padding: "0 8%" },
  bottom: { alignContent: "flex-end", padding: "0 8% 12%" },
};

export const MotionText: React.FC<MotionTextProps> = ({
  text,
  position,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const words = text.split(/\s+/).filter(Boolean);
  const fontSize = Math.round(width * 0.058);
  const strokeW = Math.max(2, Math.round(fontSize * 0.09));

  // Fade-out global nos ultimos ~0.3s (igual ao comportamento antigo)
  const fadeOutFrames = Math.round(fps * 0.3);
  const globalOpacity = interpolate(
    frame,
    [durationInFrames - fadeOutFrames, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        ...layoutByPosition[position],
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: `${fontSize * 0.12}px ${fontSize * 0.28}px`,
        boxSizing: "border-box",
        opacity: globalOpacity,
      }}
    >
      {words.map((word, i) => {
        // Cada palavra entra escalonada (palavra-por-palavra) com pop + slide + fade.
        const delay = i * 2;
        const enter = spring({
          frame: frame - delay,
          fps,
          config: { damping: 12, mass: 0.6, stiffness: 120 },
        });
        const translateY = interpolate(enter, [0, 1], [height * 0.035, 0]);
        const scale = interpolate(enter, [0, 1], [0.7, 1]);
        const opacity = interpolate(enter, [0, 1], [0, 1], {
          extrapolateRight: "clamp",
        });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${translateY}px) scale(${scale})`,
              opacity,
              fontFamily: "'Segoe UI Black', 'Arial Black', 'Segoe UI', sans-serif",
              fontWeight: 900,
              fontSize,
              lineHeight: 1.05,
              color: "white",
              WebkitTextStroke: `${strokeW}px black`,
              // paintOrder garante o contorno ATRAS do preenchimento (letra nitida)
              paintOrder: "stroke fill",
              textShadow: `0 ${Math.round(fontSize * 0.05)}px ${Math.round(
                fontSize * 0.06
              )}px rgba(0,0,0,0.45)`,
              whiteSpace: "pre",
            }}
          >
            {word}
          </span>
        );
      })}
    </AbsoluteFill>
  );
};
