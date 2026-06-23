---
description: Envia os commits locais para o GitHub
allowed-tools: Bash
---

# Tarefa: fazer push para o GitHub

Execute os passos abaixo sem perguntar nada ao usuário.

## Passo 1 — Verificar se há commits para enviar

```bash
git status
git log origin/main..HEAD --oneline
```

Se não houver nenhum commit à frente do origin, avise o usuário que não há nada novo para enviar e sugira rodar `/commit` primeiro.

## Passo 2 — Fazer o push

```bash
git push
```

## Passo 3 — Confirmar

Mostre ao usuário:
- Quantos commits foram enviados
- O link do repositório no GitHub: https://github.com/raffaelramalhorosa/video-cutter-with-claude
