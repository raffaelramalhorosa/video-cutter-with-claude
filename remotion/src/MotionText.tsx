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
  // Posicao vertical do bloco de texto
  position: "bottom" | "center" | "top";
  // Estilo de animacao de entrada
  animationStyle: "spring" | "typewriter" | "highlight" | "lateral" | "punch";
  // Direcao de entrada (para spring e lateral)
  entryDirection: "bottom" | "top" | "left" | "right";
  // Palavra que recebe cor de destaque (case-insensitive, vazio = nenhuma)
  accentWord: string;
  // Cor do destaque
  accentColor: "amber" | "white" | "red";
  // Caixa semi-transparente atras de cada palavra
  showBgBox: boolean;
  // Texto em maiusculas
  capsMode: boolean;
  // Multiplicador do delay entre palavras (1 = padrao, 2 = mais lento, 0.5 = mais rapido)
  staggerSpeed: number;
};

export const defaultMotionProps: MotionTextProps = {
  text: "Texto de exemplo do motion design",
  durationInSeconds: 3,
  fps: 30,
  width: 1080,
  height: 1920,
  position: "bottom",
  animationStyle: "spring",
  entryDirection: "bottom",
  accentWord: "",
  accentColor: "amber",
  showBgBox: false,
  capsMode: false,
  staggerSpeed: 1,
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

// Posicao vertical do BLOCO de texto via alignContent (eixo cruzado do flex-wrap).
const layoutByPosition: Record<MotionTextProps["position"], React.CSSProperties> = {
  top:    { alignContent: "flex-start", padding: "12% 8% 0" },
  center: { alignContent: "center",     padding: "0 8%" },
  bottom: { alignContent: "flex-end",   padding: "0 8% 12%" },
};

// Cores de destaque por token
const ACCENT_COLORS: Record<MotionTextProps["accentColor"], string> = {
  amber: "#C98A2E",
  white: "#FFFFFF",
  red:   "#E05050",
};

// --------------------------------------------------------------------------
// Calculos de animacao por estilo
// --------------------------------------------------------------------------

type WordStyle = {
  transform: string;
  opacity: number;
  color?: string;
  background?: string;
  borderRadius?: string;
  padding?: string;
  WebkitTextStroke?: string;
  paintOrder?: string;
};

function useWordAnimation(
  word: string,
  i: number,
  frame: number,
  fps: number,
  width: number,
  height: number,
  props: MotionTextProps,
  fontSize: number,
  totalWords: number,
): WordStyle {
  const {
    animationStyle,
    entryDirection,
    accentWord,
    accentColor,
    showBgBox,
    capsMode,
    staggerSpeed,
  } = props;

  const baseDelay = i * 2 * staggerSpeed;
  const isAccent =
    accentWord.trim() !== "" &&
    word.toLowerCase() === accentWord.trim().toLowerCase();

  const strokeW = Math.max(2, Math.round(fontSize * 0.09));

  // Cor da palavra
  const color = isAccent ? ACCENT_COLORS[accentColor] : "white";

  // Caixa de fundo por palavra
  const bgBox: React.CSSProperties = showBgBox
    ? {
        background: "rgba(0,0,0,0.45)",
        borderRadius: `${Math.round(fontSize * 0.18)}px`,
        padding: `${Math.round(fontSize * 0.06)}px ${Math.round(fontSize * 0.18)}px`,
      }
    : {};

  // Estilo do contorno (sem contorno quando ha caixa de fundo -- fica estranho)
  const strokeStyle: React.CSSProperties = showBgBox
    ? {}
    : {
        WebkitTextStroke: `${strokeW}px black`,
        paintOrder: "stroke fill",
      };

  // --- spring (entrada de baixo/cima/esquerda/direita) ---
  if (animationStyle === "spring" || animationStyle === "lateral") {
    const enter = spring({
      frame: frame - baseDelay,
      fps,
      config: { damping: 12, mass: 0.6, stiffness: 120 },
    });

    let tx = 0;
    let ty = 0;
    const dist = animationStyle === "lateral"
      ? width * 0.12  // slide lateral menor para nao cortar o frame
      : height * 0.035;

    if (animationStyle === "lateral") {
      tx = entryDirection === "left"
        ? interpolate(enter, [0, 1], [-dist, 0])
        : entryDirection === "right"
        ? interpolate(enter, [0, 1], [dist, 0])
        : 0;
      ty = entryDirection === "top"
        ? interpolate(enter, [0, 1], [-dist, 0])
        : entryDirection === "bottom"
        ? interpolate(enter, [0, 1], [dist, 0])
        : 0;
    } else {
      // spring padrao: entra sempre na direcao escolhida
      const raw = interpolate(enter, [0, 1], [dist, 0]);
      ty = entryDirection === "bottom" ? raw
        : entryDirection === "top"    ? -raw
        : 0;
      tx = entryDirection === "left"  ? -raw * 3
        : entryDirection === "right"  ? raw * 3
        : 0;
    }

    const scale   = interpolate(enter, [0, 1], [0.7, 1]);
    const opacity = interpolate(enter, [0, 1], [0, 1], { extrapolateRight: "clamp" });

    return {
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      opacity,
      color,
      ...bgBox,
      ...strokeStyle,
    };
  }

  // --- typewriter: cada palavra aparece de uma vez (sem slide) ---
  if (animationStyle === "typewriter") {
    // Cada palavra aparece em 1 frame exato no seu delay
    const visible = frame >= baseDelay ? 1 : 0;
    // Pequeno pop de escala ao aparecer
    const popFrame = frame - baseDelay;
    const pop = spring({ frame: popFrame, fps, config: { damping: 18, stiffness: 200, mass: 0.4 } });
    const scale = interpolate(pop, [0, 1], [1.15, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return {
      transform: `scale(${scale})`,
      opacity: visible,
      color,
      ...bgBox,
      ...strokeStyle,
    };
  }

  // --- highlight: palavras ja visiveis, caixa de fundo varre da esquerda p/ direita ---
  if (animationStyle === "highlight") {
    // Todas as palavras aparecem com fade inicial curto
    const fadeIn = spring({ frame, fps, config: { damping: 20, stiffness: 80, mass: 1 } });
    const opacity = interpolate(fadeIn, [0, 1], [0, 0.35], { extrapolateRight: "clamp" });

    // Destaque progressivo: fundo ambar aparece na vez de cada palavra
    const highlightDelay = baseDelay;
    const highlightEnter = spring({
      frame: frame - highlightDelay,
      fps,
      config: { damping: 18, stiffness: 160, mass: 0.5 },
    });
    const highlightOpacity = interpolate(highlightEnter, [0, 1], [0, 1], {
      extrapolateRight: "clamp",
    });
    const highlightColor = ACCENT_COLORS[accentColor];

    // Palavra ativa = totalmente visivel; as outras ficam semi-transparentes ate serem ativadas
    const wordVisible = frame >= highlightDelay ? 1 : opacity;

    return {
      transform: "scale(1)",
      opacity: wordVisible,
      color: highlightOpacity > 0.5 ? color : "white",
      background: `rgba(${hexToRgb(highlightColor)}, ${highlightOpacity * (showBgBox ? 0.7 : 0.3)})`,
      borderRadius: `${Math.round(fontSize * 0.18)}px`,
      padding: `${Math.round(fontSize * 0.06)}px ${Math.round(fontSize * 0.18)}px`,
      ...strokeStyle,
    };
  }

  // --- punch: palavra entra grande e encolhe ao tamanho final (impacto) ---
  if (animationStyle === "punch") {
    const enter = spring({
      frame: frame - baseDelay,
      fps,
      config: { damping: 8, mass: 0.8, stiffness: 200 },
    });
    const scale   = interpolate(enter, [0, 1], [2.2, 1], { extrapolateRight: "clamp" });
    const opacity = interpolate(enter, [0, 1], [0, 1],   { extrapolateRight: "clamp" });
    return {
      transform: `scale(${scale})`,
      opacity,
      color,
      ...bgBox,
      ...strokeStyle,
    };
  }

  // fallback (nao deve chegar aqui)
  return { transform: "scale(1)", opacity: 1, color, ...bgBox, ...strokeStyle };
}

// Converte hex (#C98A2E) para "r,g,b" para usar no rgba()
function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// --------------------------------------------------------------------------
// Componente principal
// --------------------------------------------------------------------------

export const MotionText: React.FC<MotionTextProps> = (props) => {
  const { text, position, capsMode } = props;
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const displayText = capsMode ? text.toUpperCase() : text;
  const words = displayText.split(/\s+/).filter(Boolean);
  const fontSize = Math.round(width * 0.058);

  // Fade-out global nos ultimos ~0.3s
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
        const ws = useWordAnimation(word, i, frame, fps, width, height, props, fontSize, words.length);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: ws.transform,
              opacity: ws.opacity,
              fontFamily: "'Segoe UI Black', 'Arial Black', 'Segoe UI', sans-serif",
              fontWeight: 900,
              fontSize,
              lineHeight: 1.05,
              color: ws.color ?? "white",
              ...(ws.WebkitTextStroke ? { WebkitTextStroke: ws.WebkitTextStroke } : {}),
              ...(ws.paintOrder      ? { paintOrder: ws.paintOrder }             : {}),
              textShadow: `0 ${Math.round(fontSize * 0.05)}px ${Math.round(fontSize * 0.06)}px rgba(0,0,0,0.45)`,
              whiteSpace: "pre",
              background:    ws.background    ?? undefined,
              borderRadius:  ws.borderRadius  ?? undefined,
              padding:       ws.padding       ?? undefined,
            }}
          >
            {word}
          </span>
        );
      })}
    </AbsoluteFill>
  );
};
