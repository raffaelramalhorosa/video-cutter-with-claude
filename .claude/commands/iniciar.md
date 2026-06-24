---
description: Liga tudo que o claude-to-premier precisa (monitor de transcrição + servidor do painel) e abre o preview
allowed-tools: Bash, Read, Monitor, TaskList, mcp__Claude_Preview__preview_list, mcp__Claude_Preview__preview_start
---

# Tarefa: iniciar o ambiente do claude-to-premier

Execute os passos abaixo NA ORDEM, sem perguntar nada ao usuário. No final,
mostre um resumo curto do que ficou ligado e o link do preview.

## Passo 1A — Monitor de transcrição (análise automática da IA)

1. Rode `TaskList` para ver se já existe um monitor com a descrição
   "Detecta nova transcrição em output/transcricao.srt".
2. Se NÃO existir, suba com a tool `Monitor`:
   - description: "Detecta nova transcrição em output/transcricao.srt"
   - persistent: true
   - timeout_ms: 300000
   - command (Bash/POSIX):
     ```
     cd "C:/Users/user/Documents/Ambiente/Ferramentas/claude-to-premier" && last=$(stat -c %Y output/transcricao.srt 2>/dev/null || echo ""); while true; do sleep 4; mkdir -p output; touch output/.ia_heartbeat; if [ -f output/transcricao.srt ]; then cur=$(stat -c %Y output/transcricao.srt 2>/dev/null); if [ -n "$cur" ] && [ "$cur" != "$last" ]; then sleep 3; chk=$(stat -c %Y output/transcricao.srt 2>/dev/null); if [ "$chk" = "$cur" ]; then echo "NOVA_TRANSCRICAO mtime=$cur arquivo=output/transcricao.srt"; last="$cur"; fi; fi; fi; done
     ```
3. Se JÁ existir, não suba outro (evita duplicar).

## Passo 1B — Monitor de chat (mensagens do colaborador)

1. Rode `TaskList` para ver se já existe um monitor com a descrição
   "Detecta nova mensagem de chat em output/chat_request.json".
2. Se NÃO existir, suba com a tool `Monitor`:
   - description: "Detecta nova mensagem de chat em output/chat_request.json"
   - persistent: true
   - timeout_ms: 300000
   - command (Bash/POSIX):
     ```
     cd "C:/Users/user/Documents/Ambiente/Ferramentas/claude-to-premier" && last=$(stat -c %Y output/chat_request.json 2>/dev/null || echo ""); while true; do sleep 2; if [ -f output/chat_request.json ]; then cur=$(stat -c %Y output/chat_request.json 2>/dev/null); if [ -n "$cur" ] && [ "$cur" != "$last" ]; then echo "NOVA_CHAT_REQUEST file=output/chat_request.json"; last="$cur"; fi; fi; done
     ```
3. Se JÁ existir, não suba outro (evita duplicar).

## Passo 2 — Servidor do painel (preview)

1. Rode `preview_list` para ver se já há um servidor rodando (config "painel",
   porta 8765).
2. Se NÃO houver, inicie com `preview_start` usando a config "painel"
   (definida em `.claude/launch.json`: `python server.py --port 8765`).
3. Se já houver, reaproveite o `serverId` existente — não inicie outro.

## Passo 3 — Contexto do vault (rápido)

Leia, sem comentar a menos que algo esteja desatualizado:
- `C:\Users\user\Documents\Dara-Cofre\claude-to-premier\resumo.md`
- as primeiras entradas de `C:\Users\user\Documents\Dara-Cofre\claude-to-premier\mudancas.md`

## Passo 4 — Resumo final

Mostre ao usuário, em formato curto:
- ✅ Monitor de transcrição: ligado (ou já estava) — task id.
- ✅ Monitor de chat: ligado (ou já estava) — task id.
- ✅ Painel: rodando na porta 8765 — link clicável do preview.
- Uma linha sobre onde o projeto parou (da última entrada de `mudancas.md`).
- Pergunte o que ele quer fazer agora.

## Regras

- NÃO faça download nem instale nada aqui. Se algo essencial faltar (ex.: Python,
  FFmpeg, modelo Whisper), avise e sugira rodar a skill `/setup`.
- NÃO suba monitor nem servidor duplicado: sempre cheque antes.
- O usuário final não é técnico — explique o resultado em linguagem simples.
