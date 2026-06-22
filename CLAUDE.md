# claude-to-premier — instruções do projeto

O usuário final desta ferramenta não é técnico. Sempre que você (Claude) começar
a trabalhar neste projeto nesta sessão, faça isto SEM perguntar:

1. Rode `TaskList` (ou verifique tarefas em background) procurando um monitor
   chamado algo como "Detecta nova transcrição em output/transcricao.srt".
2. Se ele NÃO estiver rodando, suba de novo com a tool `Monitor`:
   - description: "Detecta nova transcrição em output/transcricao.srt"
   - persistent: true
   - command (Bash, Git Bash/POSIX) — IMPORTANTE: inicializar `last` com o mtime
     atual do arquivo ANTES do loop, senão dispara um falso positivo na primeira
     volta com a transcrição que já existia:
     ```
     cd "C:/Users/user/Documents/Ambiente/Ferramentas/claude-to-premier" && last=$(stat -c %Y output/transcricao.srt 2>/dev/null || echo ""); while true; do sleep 4; if [ -f output/transcricao.srt ]; then cur=$(stat -c %Y output/transcricao.srt 2>/dev/null); if [ -n "$cur" ] && [ "$cur" != "$last" ]; then echo "NOVA_TRANSCRICAO mtime=$cur arquivo=output/transcricao.srt"; last="$cur"; fi; fi; done
     ```
3. Quando o monitor emitir um evento, leia `output/transcricao.srt`, escreva a
   análise em `output/analise.json` (schema abaixo) e avise o usuário no chat
   que a análise está pronta — sem ele precisar pedir.

## Por quê
O usuário pediu para a análise de IA (coerência/português/cortes) ser feita
automaticamente, sem ele precisar clicar em nada nem lembrar de pedir. Como a
análise é o próprio Claude lendo o texto (sem chave de API, decisão explícita
do usuário), a única forma de automatizar é eu mesmo vigiar o arquivo de saída
da transcrição com a tool `Monitor` durante a sessão.

## Limitação importante
O monitor só existe enquanto esta sessão do Claude Code está aberta. Ele NÃO
sobrevive a um fechamento do app/terminal. Por isso o passo 1-2 acima precisa
rodar no início de toda sessão neste projeto.

## Schema de output/analise.json
```json
{
  "summary": "texto curto resumindo os achados",
  "segments": [
    {
      "index": 0,
      "issues": [{"trecho": "...", "correcao": "...", "tipo": "transcrição|português|coerência|repetição", "nota": "..."}],
      "suggestion": "texto completo corrigido do segmento (opcional)",
      "cut": true
    }
  ]
}
```
- `cut: true` marca trechos repetidos/falsos começos (a pessoa começou a falar,
  errou, e refez a frase do zero) — vira sugestão de corte no painel.
- `suggestion` só faz sentido para correções pontuais que cabem ler ler num só
  segmento (ex.: nome de empresa transcrito errado). Não usar em segmentos `cut`.

## Outras notas do projeto
Snapshot completo (decisões, arquivos-chave, pendências) fica no vault:
`C:\Users\user\Documents\Dara-Cofre\claude-to-premier\resumo.md` e
`mudancas.md` (ver regra global de memória do usuário). Leia-os antes de
perguntar contexto que já está documentado lá.
