import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type MotionTextProps = {
  text: string;
  durationInSeconds: number;
  fps: number;
  width: number;
  height: number;
  position: "bottom" | "center" | "top";
  animationStyle: "spring" | "typewriter" | "highlight" | "lateral" | "punch" | "hq";
  entryDirection: "bottom" | "top" | "left" | "right";
  accentWord: string;
  accentColor: "amber" | "white" | "red";
  showBgBox: boolean;
  capsMode: boolean;
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

export const calcMotionMetadata = ({
  props,
}: {
  props: MotionTextProps;
}) => ({
  durationInFrames: Math.max(1, Math.round(props.durationInSeconds * props.fps)),
  fps: props.fps,
  width: props.width,
  height: props.height,
});

const layoutByPosition: Record<MotionTextProps["position"], React.CSSProperties> = {
  top:    { alignContent: "flex-start", padding: "12% 8% 0" },
  center: { alignContent: "center",     padding: "0 8%" },
  bottom: { alignContent: "flex-end",   padding: "0 8% 12%" },
};

const ACCENT_COLORS: Record<MotionTextProps["accentColor"], string> = {
  amber: "#C98A2E",
  white: "#FFFFFF",
  red:   "#E05050",
};

function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// --------------------------------------------------------------------------
// SPRING — slide na direção escolhida + bounce + fade
// Assinatura: física suave, palavras deslizam de uma direção
// --------------------------------------------------------------------------
function animSpring(
  frame: number, fps: number, i: number,
  height: number,
  entryDirection: MotionTextProps["entryDirection"],
  staggerSpeed: number,
): { transform: string; opacity: number } {
  const delay = i * 3 * staggerSpeed;
  const enter = spring({ frame: frame - delay, fps,
    config: { damping: 14, mass: 0.7, stiffness: 130 } });

  const dist = height * 0.06;   // 6% da altura — slide perceptível mas não exagerado
  let tx = 0, ty = 0;
  if (entryDirection === "bottom") ty = interpolate(enter, [0, 1], [dist, 0]);
  else if (entryDirection === "top") ty = interpolate(enter, [0, 1], [-dist, 0]);
  else if (entryDirection === "left") tx = interpolate(enter, [0, 1], [-dist * 1.5, 0]);
  else if (entryDirection === "right") tx = interpolate(enter, [0, 1], [dist * 1.5, 0]);

  const scale   = interpolate(enter, [0, 1], [0.65, 1]);
  const opacity = interpolate(enter, [0, 1], [0, 1], { extrapolateRight: "clamp" });
  return { transform: `translate(${tx}px,${ty}px) scale(${scale})`, opacity };
}

// --------------------------------------------------------------------------
// TYPEWRITER — palavras aparecem instantaneamente, uma de cada vez
// Assinatura: pop brusco de escala (1.5→1), sem slide, efeito mecânico
// --------------------------------------------------------------------------
function animTypewriter(
  frame: number, fps: number, i: number,
  staggerSpeed: number,
): { transform: string; opacity: number } {
  const delay = i * 4 * staggerSpeed;
  const visible = frame >= delay ? 1 : 0;
  // Pop de escala pronunciado ao aparecer: 1.5× → 1.0×
  const pop = spring({ frame: frame - delay, fps,
    config: { damping: 10, stiffness: 280, mass: 0.3 } });
  const scale = interpolate(pop, [0, 1], [1.5, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return { transform: `scale(${scale})`, opacity: visible };
}

// --------------------------------------------------------------------------
// HIGHLIGHT — todas as palavras aparecem juntas (fade-in rápido),
// depois um brilho colorido varre palavra por palavra
// Assinatura: texto nasce apagado, cada palavra "acende" na sua vez
// --------------------------------------------------------------------------
function animHighlight(
  frame: number, fps: number, i: number,
  accentColor: MotionTextProps["accentColor"],
  staggerSpeed: number,
): { transform: string; opacity: number; extra: React.CSSProperties } {
  // Fade-in global rápido — todas as palavras chegam a 60% de opacidade
  const fadeIn = spring({ frame, fps, config: { damping: 18, stiffness: 100, mass: 0.8 } });
  const baseOpacity = interpolate(fadeIn, [0, 1], [0, 0.6], { extrapolateRight: "clamp" });

  // "Acensão" da palavra: vai de 60% para 100% e ganha cor de fundo
  const lightDelay = i * 4 * staggerSpeed;
  const light = spring({ frame: frame - lightDelay, fps,
    config: { damping: 16, stiffness: 180, mass: 0.5 } });
  const lightOpacity = interpolate(light, [0, 1], [0, 1], { extrapolateRight: "clamp" });

  const color = ACCENT_COLORS[accentColor];
  const opacity = frame < lightDelay ? baseOpacity : 1;

  return {
    transform: "scale(1)",
    opacity,
    extra: {
      // Caixa colorida com opacidade proporcional ao progresso da "acensão"
      background: lightOpacity > 0.01
        ? `rgba(${hexToRgb(color)}, ${lightOpacity * 0.55})`
        : "transparent",
      borderRadius: "6px",
      padding: "2px 8px",
      // A palavra fica na cor de destaque enquanto está sendo "acesa"
      color: lightOpacity > 0.5 ? (accentColor === "white" ? "#000" : "#fff") : "white",
      transition: "color 0.1s",
    },
  };
}

// --------------------------------------------------------------------------
// LATERAL — slide horizontal puro, sem escala
// Assinatura: palavras entram voando da lateral, overshoot pronunciado
// --------------------------------------------------------------------------
function animLateral(
  frame: number, fps: number, i: number,
  width: number,
  entryDirection: MotionTextProps["entryDirection"],
  staggerSpeed: number,
): { transform: string; opacity: number } {
  const delay = i * 2 * staggerSpeed;
  // Spring com overshoot (underdamped) para "voar" da lateral
  const enter = spring({ frame: frame - delay, fps,
    config: { damping: 9, mass: 0.5, stiffness: 160 } });

  const dist = width * 0.55;   // vem de fora do frame
  let tx = 0, ty = 0;

  // Por padrão (bottom/top), força entrada da esquerda para deixar claro o efeito lateral
  if (entryDirection === "right") {
    tx = interpolate(enter, [0, 1], [dist, 0], { extrapolateRight: "clamp" });
  } else if (entryDirection === "top") {
    ty = interpolate(enter, [0, 1], [-dist * 0.5, 0], { extrapolateRight: "clamp" });
  } else if (entryDirection === "bottom") {
    ty = interpolate(enter, [0, 1], [dist * 0.5, 0], { extrapolateRight: "clamp" });
  } else {
    // left (padrão)
    tx = interpolate(enter, [0, 1], [-dist, 0], { extrapolateRight: "clamp" });
  }

  const opacity = interpolate(enter, [0, 1], [0, 1], { extrapolateRight: "clamp" });
  return { transform: `translate(${tx}px,${ty}px)`, opacity };
}

// --------------------------------------------------------------------------
// PUNCH — cada palavra entra GRANDE (3.5×) e encolhe com bounce
// Assinatura: impacto visual forte, cada palavra "bate" no tamanho final
// --------------------------------------------------------------------------
function animPunch(
  frame: number, fps: number, i: number,
  staggerSpeed: number,
): { transform: string; opacity: number } {
  const delay = i * 5 * staggerSpeed;   // stagger maior — cada palavra bem separada
  // Underdamped: overshoot abaixo de 1.0 antes de assentar (efeito de "bounce")
  const enter = spring({ frame: frame - delay, fps,
    config: { damping: 6, mass: 1.0, stiffness: 260 } });

  const scale   = interpolate(enter, [0, 1], [3.5, 1], { extrapolateRight: "clamp" });
  const opacity = interpolate(enter, [0, 1], [0, 1],   { extrapolateRight: "clamp" });
  return { transform: `scale(${scale})`, opacity };
}

// --------------------------------------------------------------------------
// HQ — quadrinhos: entrada grande + rotação alternada, fundo estampado por palavra
// Assinatura: impacto de quadrinhos, cada palavra "bate" e torce antes de assentar
// --------------------------------------------------------------------------
function animHQ(
  frame: number, fps: number, i: number,
  staggerSpeed: number,
): { transform: string; opacity: number } {
  const delay = i * 7 * staggerSpeed;
  const enter = spring({ frame: frame - delay, fps,
    config: { damping: 6, mass: 0.9, stiffness: 320 } });

  // Escala: entra grandão (2.5×) e assenta com overshoot abaixo de 1
  const scale = interpolate(enter, [0, 1], [2.5, 1], { extrapolateRight: "clamp" });
  // Rotação: palavras alternadas entram de lados opostos (±14°)
  const rotStart = i % 2 === 0 ? 14 : -14;
  const rot = interpolate(enter, [0, 1], [rotStart, 0], { extrapolateRight: "clamp" });
  const opacity = interpolate(enter, [0, 1], [0, 1], { extrapolateRight: "clamp" });

  return { transform: `scale(${scale}) rotate(${rot}deg)`, opacity };
}

// --------------------------------------------------------------------------
// Componente principal
// --------------------------------------------------------------------------
export const MotionText: React.FC<MotionTextProps> = (props) => {
  const {
    text, position, capsMode,
    animationStyle, entryDirection, accentWord, accentColor, showBgBox, staggerSpeed,
  } = props;

  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  const displayText = capsMode ? text.toUpperCase() : text;
  const words = displayText.split(/\s+/).filter(Boolean);
  const fontSize = Math.round(width * 0.058);
  const strokeW  = Math.max(2, Math.round(fontSize * 0.09));

  // Fade-out global nos últimos 0.3s
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
        const isAccent =
          accentWord.trim() !== "" &&
          word.toLowerCase() === accentWord.trim().toLowerCase();

        const baseColor = isAccent ? ACCENT_COLORS[accentColor] : "white";

        // Caixa de fundo opcional (showBgBox sobrepõe o estilo do highlight)
        const bgBoxStyle: React.CSSProperties = showBgBox
          ? { background: "rgba(0,0,0,0.45)", borderRadius: `${Math.round(fontSize * 0.18)}px`,
              padding: `${Math.round(fontSize * 0.06)}px ${Math.round(fontSize * 0.18)}px` }
          : {};

        // Contorno — desligado quando há caixa de fundo, highlight ou hq
        const hasStroke = !showBgBox && animationStyle !== "highlight" && animationStyle !== "hq";
        const strokeStyle: React.CSSProperties = hasStroke
          ? { WebkitTextStroke: `${strokeW}px black`, paintOrder: "stroke fill" }
          : {};

        // ---- Calcula anim por estilo ----
        let transform = "scale(1)";
        let opacity   = 1;
        let extraStyle: React.CSSProperties = {};

        if (animationStyle === "spring") {
          const a = animSpring(frame, fps, i, height, entryDirection, staggerSpeed);
          transform = a.transform; opacity = a.opacity;
        } else if (animationStyle === "typewriter") {
          const a = animTypewriter(frame, fps, i, staggerSpeed);
          transform = a.transform; opacity = a.opacity;
        } else if (animationStyle === "highlight") {
          const a = animHighlight(frame, fps, i, accentColor, staggerSpeed);
          transform = a.transform; opacity = a.opacity; extraStyle = a.extra;
        } else if (animationStyle === "lateral") {
          const a = animLateral(frame, fps, i, width, entryDirection, staggerSpeed);
          transform = a.transform; opacity = a.opacity;
        } else if (animationStyle === "punch") {
          const a = animPunch(frame, fps, i, staggerSpeed);
          transform = a.transform; opacity = a.opacity;
        } else if (animationStyle === "hq") {
          const a = animHQ(frame, fps, i, staggerSpeed);
          transform = a.transform; opacity = a.opacity;
          // fundo estampado alternado: amarelo e preto por palavra
          const hqBg   = i % 2 === 0 ? ACCENT_COLORS[accentColor] : "#111";
          const hqText = i % 2 === 0 ? "#000" : ACCENT_COLORS[accentColor];
          extraStyle = {
            background: hqBg,
            color: hqText,
            borderRadius: `${Math.round(fontSize * 0.12)}px`,
            padding: `${Math.round(fontSize * 0.05)}px ${Math.round(fontSize * 0.22)}px`,
            WebkitTextStroke: `${Math.max(1, Math.round(strokeW * 0.5))}px rgba(0,0,0,0.4)`,
            paintOrder: "stroke fill",
          };
        }

        // highlight e hq definem sua própria cor; os outros usam baseColor
        const wordColor = (animationStyle === "highlight" || animationStyle === "hq") && extraStyle.color
          ? extraStyle.color
          : baseColor;

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform,
              opacity,
              fontFamily: "'Segoe UI Black', 'Arial Black', 'Segoe UI', sans-serif",
              fontWeight: 900,
              fontSize,
              lineHeight: 1.05,
              color: wordColor as string,
              textShadow: `0 ${Math.round(fontSize * 0.05)}px ${Math.round(fontSize * 0.06)}px rgba(0,0,0,0.45)`,
              whiteSpace: "pre",
              ...strokeStyle,
              ...bgBoxStyle,
              // extraStyle do highlight e hq sobrepõe bgBoxStyle
              ...(animationStyle === "highlight" || animationStyle === "hq" ? {
                background:        extraStyle.background,
                borderRadius:      extraStyle.borderRadius,
                padding:           extraStyle.padding,
                WebkitTextStroke:  extraStyle.WebkitTextStroke,
                paintOrder:        extraStyle.paintOrder,
              } : {}),
            }}
          >
            {word}
          </span>
        );
      })}
    </AbsoluteFill>
  );
};
