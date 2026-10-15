---
name: now
description: Kickoff diário do Vetor — resume o estado do projeto, prepara ferramentas e encaminha a próxima etapa.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é o ponto de entrada diário do Vetor. Faça uma sondagem rápida, apresente o estado em poucas linhas, prepare o agente para usar as ferramentas disponíveis e pergunte qual deve ser a próxima etapa.

## Referências

Resolva os paths a partir do diretório desta skill. Defina `SKILL_DIR` com o caminho absoluto informado no carregamento e use `"$SKILL_DIR/../../scripts/..."` nos comandos.

- `../shared/references/mcp-availability.md` — detectar ferramentas MCP disponíveis na sessão; o script só lê configurações locais.
- `../shared/references/memory-gotchas.md` — consultar gotchas e decisões no ai-memory quando disponível.
- `../shared/references/delegate-to-runtime.md` — detecção estática dos runtimes de delegação disponíveis.

## Rotina

1. Rode no repositório atual:

   ```bash
   deno run -A "$SKILL_DIR/../../scripts/now-probe.ts"
   ```

   A sondagem é somente-leitura. Ela informa branch e limpeza do git, worktrees registrados, contagem de issues abertas com label `backlog` (ou `null` se `gh` faltar/falhar), MCPs declarados em `.mcp.json` e runtimes detectados. Falhas de comandos opcionais não devem interromper o kickoff.

2. Complemente a lista de MCPs declarados com os MCPs ativos na sessão conforme `mcp-availability.md`. Os servidores Context7, Docker e ai-memory são relevantes para o sumário; nunca tente conectar apenas para sondar.

3. Apresente um sumário executivo conciso: branch/estado limpo, worktrees existentes, issues de backlog e disponibilidade de MCPs e runtimes. Diferencie configuração declarada de ferramenta ativa na sessão.

4. Faça o priming explícito, condicionado a cada ferramenta estar disponível:
   - Se Context7 estiver disponível: **Use Context7 para documentação atualizada de bibliotecas.**
   - Se ai-memory estiver disponível: **Consulte ai-memory para gotchas e decisões** conforme `../shared/references/memory-gotchas.md`.
   - Se algum runtime estiver disponível: **Use agy/delegação para tarefas pesadas** conforme `../shared/references/delegate-to-runtime.md`; respeite a seleção e anuência descritas na referência.
   - Se Docker MCP estiver disponível, use-o apenas quando uma tarefa da sessão precisar inspecionar containers.

5. Use `AskUserQuestion` com uma única pergunta e quatro opções; a opção recomendada deve vir primeiro. O mecanismo oferece “Other” automaticamente. Escolha a recomendação pelo estado sondado: havendo issues `backlog` e nenhum worktree ativo além do principal, recomende `/vetor:coordinator`; sem issues abertas no backlog, recomende `/vetor:backlog`. Nos demais casos, recomende a etapa com melhor encaixe no pedido/contexto da sessão.

   Opções:
   - **Despachar issues** — `/vetor:coordinator` (recomendada quando houver backlog pronto e nenhum worktree ativo).
   - **Idear trabalho** — `/vetor:backlog` (recomendada quando o backlog estiver vazio).
   - **Especificar tema** — `/vetor:spec`.
   - **Auditar ou trabalho pontual** — `/vetor:guardian` para auditoria; use “Other” para trabalho livre pontual.

6. Encaminhe para a skill ou tarefa escolhida. Não execute automaticamente uma etapa de escrita sem a escolha do usuário.
