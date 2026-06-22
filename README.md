# claude-to-premier

Detecta silêncios em um vídeo com **FFmpeg**, gera uma **timeline FCP7 XML**
que o **Adobe Premiere Pro** importa, e tem um **painel web local** para
revisar os cortes, transcrever o áudio (Whisper) e pedir uma análise de
coerência/português ao Claude antes de exportar.

O XML referencia o vídeo original e grava apenas pontos IN/OUT por clipe —
sem perda de qualidade, sem gerar `.prproj`, e mantendo as "alças" (handles)
para o editor estender qualquer corte depois.

## Setup rápido (recomendado)

Este projeto depende de algumas peças que não vêm no `git clone` porque são
grandes demais para o GitHub (modelo do Whisper, binário do Tailwind), e de
uma peça fácil de confundir com "já está instalado" (FFmpeg comum não tem o
filtro de transcrição). Em vez de conferir tudo manualmente, abra este
projeto no Claude Code e rode:

```
/setup
```

A skill confere Python, FFmpeg/ffprobe, o filtro `whisper` do FFmpeg, o
modelo do Whisper, o binário do Tailwind e o tkinter, mostra um checklist
simples do que falta e baixa/instala — sempre perguntando antes de qualquer
download grande.

## Requisitos (se preferir configurar manualmente)

1. **Python 3** (qualquer versão recente). Todo o backend usa só a
   biblioteca padrão — não há `requirements.txt`.
2. **FFmpeg** (inclui `ffprobe`). O projeto acha o binário sozinho: procura
   no `PATH`, depois na variável `FFMPEG_DIR`, depois (Windows) na pasta
   padrão do winget.
3. **FFmpeg com filtro `whisper`** — só necessário para a transcrição
   automática no painel. Um FFmpeg comum **não** tem esse filtro; é preciso
   uma build compilada com `--enable-whisper`. No Windows, a build testada
   neste projeto é `winget install Gyan.FFmpeg` (v8.1.1). Confirme com:
   ```bash
   ffmpeg -hide_banner -filters | grep -i whisper
   ```
4. **Modelo do Whisper** (`models/ggml-*.bin`) — necessário para a
   transcrição. Baixe de
   `https://huggingface.co/ggerganov/whisper.cpp` para a pasta `models/`
   (este projeto usa `ggml-large-v3-turbo.bin`, ~1.6 GB).
5. **Binário do Tailwind CSS v4** (CLI standalone, sem Node.js) em
   `web/tools/` — necessário só para reconstruir o visual do painel
   (`web/index.html`) depois de editar `web/src/input.css`. Baixe de
   `https://github.com/tailwindlabs/tailwindcss/releases/latest` o arquivo
   certo para seu sistema. No Windows, o nome esperado é
   `web/tools/tailwindcss.exe`.
6. **tkinter** — só necessário para o botão "Abrir vídeo" (diálogo nativo de
   arquivo) do painel. Normalmente já vem com o Python; no Linux pode
   precisar instalar separado (`python3-tk` no Debian/Ubuntu).

## Uso 1 — linha de comando (só cortar silêncio)

```bash
python silence_cut.py samples/test.mp4
```

Com parâmetros:

```bash
python silence_cut.py video.mp4 --threshold -30 --min-silence 0.5 --margin 0.05
```

### Parâmetros (ajustar até os cortes ficarem bons)

| Flag | Padrão | O que faz |
|---|---|---|
| `--threshold` | `-30` | Limiar em dB. Abaixo disso é considerado silêncio. Mais negativo = só corta silêncio mais profundo. |
| `--min-silence` | `0.5` | Duração mínima (s) para um silêncio valer corte. Evita cortar respiros curtos. |
| `--margin` | `0.05` | Margem (s) preservada em volta da fala. Garante as alças e evita cortar o início/fim das palavras. |
| `--min-clip` | `0.3` | Descarta trechos mantidos menores que isto (s). Remove fragmentos inúteis. |
| `--seq-name` | `Auto-Cut` | Nome da sequência dentro do Premiere. |
| `--no-preview` | — | Não gerar o `preview.mp4`. |

### Saídas (pasta `output/`)

- `timeline.xml` — sequência para importar no Premiere.
- `cortes.json` — lista legível dos silêncios detectados e dos trechos mantidos.
- `preview.mp4` — corte rápido já aplicado, só para conferência (opcional).

## Uso 2 — painel web (revisar cortes, transcrever, pedir análise)

```bash
python server.py --video samples/fala_teste.mp4 --port 8765
```

Abra `http://localhost:8765` no navegador (ou use o preview do Claude Code,
que já tem um atalho configurado em `.claude/launch.json`).

O painel deixa:

- **Abrir qualquer vídeo do disco** (botão "Abrir vídeo", diálogo nativo via
  tkinter) sem precisar editar configuração.
- **Ajustar os cortes visualmente** (sliders de limiar, silêncio mínimo,
  margem, clipe mínimo) com a timeline atualizando ao vivo.
- **Transcrever o áudio** (Whisper via filtro do FFmpeg) automaticamente ao
  carregar um vídeo, ou pelo botão "Transcrever". Gera
  `output/transcricao.srt` (para o Premiere) e `output/transcricao.txt`.
  Os segmentos da transcrição são editáveis direto no painel.
- **Pedir uma análise de coerência/português ao Claude**: depois de
  transcrever, peça no chat do Claude Code para analisar a transcrição. O
  Claude lê `output/transcricao.srt`, escreve `output/analise.json` com
  apontamentos por trecho, e o painel mostra isso ao clicar em "Carregar
  análise da IA" (não usa nenhuma chave de API — é o próprio Claude lendo o
  texto, por decisão explícita do usuário).
- **Aplicar correções sugeridas** direto no texto da transcrição, e marcar
  trechos repetidos/falsos começos como corte (some da timeline e do XML
  final).
- **Exportar** a legenda (SRT) com o texto editado e a timeline XML para o
  Premiere.

## Como importar a timeline no Premiere

1. No Premiere: **Arquivo → Importar** e selecione `output/timeline.xml`.
2. Se ele pedir para localizar a mídia, aponte para o vídeo original.
3. Uma sequência nova aparece, com cada trecho mantido como um clipe separado.
4. Edite à vontade: mover, encurtar, estender (as alças recuperam o áudio/vídeo
   removido), apagar ou reorganizar. Depois exporte normalmente.

## Riscos conhecidos (validar com material real)

1. **Taxa de quadros variável (VFR)** — comum em gravação de tela e celular.
   O silêncio vem em segundos; a conversão para frames assume FPS constante.
   É o maior risco de corte sair fora do frame. Solução: normalizar o FPS antes.
2. **Manias do XML do Premiere** — a versão do Premiere é exigente com número de
   faixas de áudio e canais. Testar primeiro com um clipe curto na versão real.
3. **Timecode drop-frame** (29.97 / 59.94) — o script marca `ntsc TRUE` e `DF`
   nesses casos; conferir se o alinhamento dos cortes bate.

## Alternativa pronta

A biblioteca [`auto-editor`](https://github.com/WyattBlue/auto-editor) faz a mesma
detecção e exporta XML para o Premiere (`--export premiere`). Vale avaliar se for
preciso menos manutenção. Este projeto é a versão própria, com controle total do XML.
