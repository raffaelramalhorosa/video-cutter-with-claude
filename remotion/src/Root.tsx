import React from "react";
import { Composition } from "remotion";
import { MotionText, calcMotionMetadata, defaultMotionProps } from "./MotionText";

// Composições customizadas criadas por Claude sob demanda:
// import { MinhaComposicao } from "./composicoes/MinhaComposicao";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Composição base de texto animado (usada pelo painel via CLI) */}
      <Composition
        id="MotionText"
        component={MotionText}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultMotionProps}
        calculateMetadata={calcMotionMetadata}
      />

      {/* Composições customizadas aparecem aqui conforme criadas */}
    </>
  );
};
