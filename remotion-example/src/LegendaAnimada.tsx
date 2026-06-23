import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Tokens de cor do STYLE.md do projeto (instrumento-tecnico-ambar).
const COR_FUNDO = "#13151A";
const COR_TEXTO = "#D7D9DD";
const COR_ACENTO = "#D9A256";

interface Props {
  frase: string;
  palavraDestaque: string;
}

/**
 * Legenda animada estilo motion design: cada palavra entra de baixo para cima
 * com spring (mola), em cascata (stagger). A "palavraDestaque" aparece em âmbar.
 *
 * Tudo é determinístico (depende só do frame atual) — requisito do Remotion para
 * renderizar quadro a quadro de forma consistente.
 */
export const LegendaAnimada: React.FC<Props> = ({ frase, palavraDestaque }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const palavras = frase.split(" ");
  // marca quais palavras fazem parte do trecho de destaque
  const destaqueTokens = palavraDestaque.toLowerCase().split(" ");

  return (
    <AbsoluteFill style={{ backgroundColor: COR_FUNDO }}>
      {/* container centralizado na faixa inferior, como uma legenda de short */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 320,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "0 18px",
            maxWidth: 900,
            fontFamily: "Inter, sans-serif",
            fontWeight: 800,
            fontSize: 84,
            lineHeight: 1.15,
            textAlign: "center",
          }}
        >
          {palavras.map((palavra, i) => {
            // cada palavra começa a animar 4 frames depois da anterior (cascata)
            const inicio = i * 4;
            const entrada = spring({
              fps,
              frame: frame - inicio,
              config: { damping: 200 },
            });

            const translateY = interpolate(entrada, [0, 1], [60, 0]);
            const opacity = interpolate(entrada, [0, 1], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });

            const ehDestaque = destaqueTokens.includes(
              palavra.toLowerCase().replace(/[.,!?]/g, "")
            );

            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  transform: `translateY(${translateY}px)`,
                  opacity,
                  color: ehDestaque ? COR_ACENTO : COR_TEXTO,
                }}
              >
                {palavra}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
