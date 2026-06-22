---
extends: instrumento-tecnico-ambar
---

Sem overrides — o painel usa o estilo global tal como definido. Eixos
específicos deste projeto que motivaram as escolhas do estilo base:

- Timeline de cortes usa `--color-keep` / `--color-cut` para os blocos
  mantido/cortado — é o único lugar onde verde/vermelho podem aparecer.
- Caixas de apontamento de IA na transcrição usam o cartão padrão
  (`--color-bg-secondary`, radius 10px) com `--color-accent-soft` para
  destacar a correção sugerida dentro do texto.
- Botão "Remover do vídeo" usa o padrão de botão destrutivo do estilo base.
