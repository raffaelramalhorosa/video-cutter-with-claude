---
description: Faz commit de todas as mudanças pendentes no projeto
allowed-tools: Bash
---

# Tarefa: fazer commit das mudanças

Execute os passos abaixo sem perguntar nada ao usuário.

## Passo 1 — Ver o que mudou

```bash
git status --short
git diff --stat
```

## Passo 2 — Montar a mensagem de commit

- Leia o `git diff --cached` e o `git diff` para entender o que mudou.
- Escreva uma mensagem curta em português (máximo 72 caracteres na primeira linha).
- Se houver arquivos novos relevantes, mencione-os.
- Não inclua arquivos de output (`output/*`), mesmo que apareçam como untracked — eles estão no `.gitignore`.

## Passo 3 — Stagear e commitar

Stagear apenas arquivos rastreáveis (sem `output/`, `models/`, `web/tools/`, `remotion/node_modules/`):

```bash
git add -A
git status --short
```

Confirme que nada sensível foi incluído, depois faça o commit:

```bash
git commit -m "<mensagem gerada>"
```

## Passo 4 — Confirmar

Mostre ao usuário:
- Quais arquivos foram commitados
- O hash curto do commit
- Uma linha dizendo que está pronto para `/push` quando quiser enviar ao GitHub
