import { Composition } from "remotion";
import { LegendaAnimada } from "./LegendaAnimada";

// Formato vertical 9:16 (1080x1920), igual aos shorts que o projeto edita.
// durationInFrames = 90 a 30fps = 3 segundos.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LegendaAnimada"
      component={LegendaAnimada}
      durationInFrames={90}
      width={1080}
      height={1920}
      fps={30}
      defaultProps={{
        frase: "A Queima Diária mudou tudo",
        palavraDestaque: "Queima Diária",
      }}
    />
  );
};
