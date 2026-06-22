import React from "react";
import { Composition } from "remotion";
import { MotionText, calcMotionMetadata, defaultMotionProps } from "./MotionText";

// Uma unica composicao: o texto animado. As dimensoes, fps e duracao reais
// vem por props (calculateMetadata) -- o servidor passa os valores do video.
export const RemotionRoot: React.FC = () => {
  return (
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
  );
};
