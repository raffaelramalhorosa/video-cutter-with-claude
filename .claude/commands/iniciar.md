---
description: Liga tudo que o claude-to-premier precisa (monitor de transcrição + servidor do painel) e abre o preview
allowed-tools: Bash, Read, Monitor, mcp__Claude_Preview__preview_list, mcp__Claude_Preview__preview_start
---

# Tarefa: iniciar o ambiente do claude-to-premier

Execute os passos abaixo NA ORDEM, sem perguntar nada ao usuário. No final,
mostre um resumo curto do que ficou ligado e o link do preview.

## Passo 1 — Monitor de transcrição (análise automática da IA)

1. Rode `TaskList` para ver se já existe um monitor com a descrição
   "Detecta nova transcrição em output/transcricao.srt".
2. Se NÃO existir (ou o TaskList não listar nenhum), suba com a tool `Monitor`:
   - description: "Detecta nova transcrição em output/transcricao.srt"
   - persistent: true
   - timeout_ms: 300000
   - command (Bash/POSIX) — inicializa `last` com o mtime atual ANTES do loop
     (evita falso positivo na primeira volta), usa DEBOUNCE de 3s (a transcrição
     é escrita incrementalmente; só emite quando o mtime fica estável) e toca
     `output/.ia_heartbeat` a cada ciclo (o backend usa isso em `/api/ia_status`
     para o painel mostrar "IA conectada/desconectada"):
     ```
     cd "C:/Users/user/Documents/Ambiente/Ferramentas/claude-to-premier" && last=$(stat -c %Y output/transcricao.srt 2>/dev/null || echo ""); while true; do sleep 4; mkdir -p output; touch output/.ia_heartbeat; if [ -f output/transcricao.srt ]; then cur=$(stat -c %Y output/transcricao.srt 2>/dev/null); if [ -n "$cur" ] && [ "$cur" != "$last" ]; then sleep 3; chk=$(stat -c %Y output/transcricao.srt 2>/dev/null); if [ "$chk" = "$cur" ]; then echo "NOVA_TRANSCRICAO mtime=$cur arquivo=output/transcricao.srt"; last="$cur"; fi; fi; fi; done
     ```
3. Se JÁ existir um monitor com essa descrição, não suba outro (evita duplicar).

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
- ✅ Painel: rodando na porta 8765 — link clicável do preview.
- Uma linha sobre onde o projeto parou (da última entrada de `mudancas.md`).
- Pergunte o que ele quer fazer agora.

## Regras

- NÃO faça download nem instale nada aqui. Se algo essencial faltar (ex.: Python,
  FFmpeg, modelo Whisper), avise e sugira rodar a skill `/setup`.
- NÃO suba monitor nem servidor duplicado: sempre cheque antes.
- O usuário final não é técnico — explique o resultado em linguagem simples.
