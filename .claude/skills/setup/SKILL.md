---
name: setup
description: Verifica se a máquina tem tudo que o claude-to-premier precisa (Python, FFmpeg com filtro whisper, modelo Whisper, binário do Tailwind, tkinter) e baixa/instala o que faltar. Use quando o usuário pedir para "configurar o projeto", "rodar o setup", "preparar a máquina" ou logo depois de clonar este repositório pela primeira vez.
---

# Setup do claude-to-premier

Esta skill existe porque o projeto depende de peças que **não vêm no `git clone`**
(são grandes demais para o GitHub) e de uma peça fácil de confundir com "já
está instalado" (FFmpeg comum vs. FFmpeg com suporte a Whisper). O objetivo é
checar tudo, mostrar um checklist simples e resolver o que faltar — perguntando
antes de qualquer download grande ou instalação.

## Passo 1 — Detectar o sistema

Rode (Bash):
```bash
uname -s 2>/dev/null || echo Windows
python3 --version 2>/dev/null || python --version
```
Use o resultado para decidir o nome do binário do Tailwind (passo 5) e os
comandos de instalação sugeridos (winget no Windows, brew no macOS, apt/dnf no
Linux).

## Passo 2 — Checar Python

- Precisa de Python 3 (qualquer versão recente). O projeto usa só a biblioteca
  padrão — não há `requirements.txt` para instalar.
- Se faltar: peça para o usuário instalar (https://www.python.org/downloads/
  no Windows/macOS; gerenciador de pacotes no Linux). Não tente instalar
  Python sozinho sem perguntar — é uma ferramenta de sistema.

## Passo 3 — Checar FFmpeg + ffprobe

```bash
ffmpeg -version
ffprobe -version
```
- Se nenhum dos dois for encontrado no PATH, isso é esperado — `silence_cut.py`
  e `server.py` também procuram em `FFMPEG_DIR` (variável de ambiente) e, no
  Windows, na pasta padrão do winget. Pergunte ao usuário se ele já tem FFmpeg
  em outro lugar (defina `FFMPEG_DIR`) ou se quer instalar agora.

## Passo 4 — Checar o filtro `whisper` do FFmpeg (o passo que mais gente esquece)

Ter FFmpeg instalado **não é suficiente**. A transcrição usa o filtro de áudio
`whisper`, que só existe em builds compiladas com `--enable-whisper`. Um
FFmpeg "normal" (ex.: baixado direto do site oficial, ou de muitos pacotes
Linux) passa o passo 3 mas falha silenciosamente na transcrição.

Confirme assim:
```bash
ffmpeg -hide_banner -filters | grep -i whisper
```
- **Se aparecer uma linha com `whisper`**: ok, build correta.
- **Se não aparecer nada**: o FFmpeg atual não serve para transcrição (o resto
  do projeto — corte de silêncio, exportar XML — funciona normalmente, só a
  transcrição via Whisper que não). Avise o usuário e pergunte se ele quer
  instalar a build correta. No Windows, a build testada neste projeto foi:
  ```bash
  winget install Gyan.FFmpeg
  ```
  (testado na versão 8.1.1, que inclui o filtro whisper). Em outros sistemas,
  não existe um pacote único confirmado — diga isso ao usuário com clareza e
  sugira compilar FFmpeg com `--enable-whisper` ou procurar uma build da
  comunidade, em vez de inventar um comando que pode não funcionar.
- Depois de instalar, repita o comando deste passo para confirmar antes de
  seguir.

## Passo 5 — Checar o modelo Whisper (`models/ggml-*.bin`)

```bash
ls models/*.bin 2>/dev/null
```
- Se já existir um arquivo `ggml-*.bin`, ok (o `server.py` escolhe o maior/
  "turbo"/"large" automaticamente, ou usa a variável `WHISPER_MODEL` se
  definida).
- Se não existir: **esse arquivo é grande (o modelo `large-v3-turbo` usado
  neste projeto tem ~1.6 GB)**. Nunca baixe sem perguntar. Explique o
  tamanho ao usuário e pergunte se ele quer baixar agora. Se confirmar, baixe
  de `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin`
  para `models/ggml-large-v3-turbo.bin`. Se ele preferir um modelo menor (mais
  rápido, menos preciso), os nomes seguem o mesmo padrão (`ggml-base.bin`,
  `ggml-small.bin`, etc.) no mesmo repositório do Hugging Face.

## Passo 6 — Checar o binário do Tailwind CSS

```bash
ls web/tools/ 2>/dev/null
```
- Precisa existir um executável da CLI standalone do Tailwind v4 ali dentro
  (no Windows, `tailwindcss.exe`; ~107 MB, por isso não vai para o git).
- Se faltar, pergunte ao usuário se pode baixar (~100 MB) e, se sim, baixe o
  binário certo para o sistema/arquitetura detectados no Passo 1 a partir das
  releases oficiais: `https://github.com/tailwindlabs/tailwindcss/releases/latest`
  (arquivos `tailwindcss-windows-x64.exe`, `tailwindcss-macos-x64`,
  `tailwindcss-macos-arm64`, `tailwindcss-linux-x64`, `tailwindcss-linux-arm64`).
  Salve em `web/tools/` com o nome que o sistema operacional precisa (no
  Windows, renomeie para `tailwindcss.exe`; em macOS/Linux, dê permissão de
  execução com `chmod +x`).
- Depois de garantir o binário, gere o CSS compilado (ainda não existe no
  primeiro clone, pois `web/tailwind.css` também não é versionado por ser
  gerado):
  ```bash
  ./web/tools/tailwindcss.exe -i src/input.css -o tailwind.css --cwd web --minify
  ```
  (em macOS/Linux, troque pelo nome do binário baixado, ex.:
  `./web/tools/tailwindcss-macos-arm64 ...`).

## Passo 7 — Checar Node.js + dependências do Remotion

O motion design usa Remotion (React/Node.js) para gerar clipes animados. O
projeto principal é Python puro — o Remotion fica isolado na pasta `remotion/`.

```bash
node --version
npm --version
```
- Precisa de **Node.js 18+** (qualquer versão LTS recente serve).
- Se Node.js não estiver instalado: sugira instalar de `https://nodejs.org/`
  (LTS). Não instale sem perguntar — é uma ferramenta de sistema.

Depois de confirmar que o Node.js existe, cheque se as dependências já foram
instaladas:

```bash
ls remotion/node_modules 2>/dev/null && echo "ok" || echo "faltando"
```

- Se `node_modules` não existir (falta na primeira vez que clona): **são ~300 MB
  de downloads do npm**. Explique ao usuário e pergunte se pode instalar agora.
  Se confirmar:
  ```bash
  cd remotion && npm install
  ```
  Em Windows via Bash/Git Bash, `npx` é um `.cmd` — o servidor já trata isso
  automaticamente; o `npm install` funciona normalmente.
- Se já existir: ok.

Nota: a pasta `remotion/node_modules/` está no `.gitignore` — nunca vai para
o git. Quem clonar o repo precisa rodar este passo.

## Passo 8 — Checar tkinter (diálogo nativo de "Abrir vídeo")

```bash
python3 -c "import tkinter" 2>&1 || python -c "import tkinter" 2>&1
```
- Se der erro, o botão "Abrir vídeo" do painel não vai funcionar (o resto
  continua normal; o usuário pode editar `--video` em `.claude/launch.json`
  manualmente como alternativa).
- No Windows/macOS, tkinter normalmente já vem com o Python — erro aqui é raro.
- No Linux, é comum faltar o pacote do sistema. Diga ao usuário para instalar
  com o gerenciador da distribuição dele, por exemplo:
  - Debian/Ubuntu: `sudo apt install python3-tk`
  - Fedora: `sudo dnf install python3-tkinter`
  - Arch: `sudo pacman -S tk`

## Passo 9 — Relatório final

Depois de checar tudo, mostre um checklist simples e literal (sem jargão sem
explicação), por exemplo:

```
1. Python 3           — OK (3.12.4)
2. FFmpeg/ffprobe     — OK
3. Filtro whisper     — FALTANDO (FFmpeg atual não tem suporte a transcrição)
4. Modelo Whisper     — OK (models/ggml-large-v3-turbo.bin)
5. Tailwind CLI       — FALTANDO
6. Node.js + npm      — OK (v22.3.0 / 10.8.1)
7. remotion/node_modules — OK
8. tkinter            — OK
```

Para cada item "FALTANDO", já deixe claro qual foi a decisão tomada (baixado
agora / usuário disse para pular / aguardando confirmação) e o que ainda falta
o usuário decidir. Sem essas peças, diga exatamente qual funcionalidade fica
indisponível (ex.: "sem o filtro whisper, o botão Transcrever não vai
funcionar, mas cortar silêncio e exportar para o Premiere funciona normal"; "sem
Node.js/Remotion, o botão Gerar do Motion Design não funciona").

## Passo 10 — Validar (opcional, com permissão do usuário)

Se tudo estiver OK (ou o usuário aceitou seguir com algo faltando), ofereça
subir o painel para confirmar que está tudo funcionando:
```bash
python server.py --video samples/fala_teste.mp4 --port 8765
```
e abrir `http://localhost:8765` no preview.
