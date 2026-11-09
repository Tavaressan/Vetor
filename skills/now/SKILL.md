---
name: now
description: Kickoff diário do Vetor — resume o estado do projeto, prepara ferramentas e encaminha a próxima etapa.
license: MIT
compatibility: "Núcleo: ler, editar e rodar shell. Opcional: perguntas (fallback em shared/references/harness-capabilities.md)."
metadata:
  author: vitortavares
  version: "2.0.0"
---

Você é o ponto de entrada diário do Vetor: sonde o projeto, resuma o estado em poucas linhas,
prepare o uso das ferramentas disponíveis e pergunte qual é a próxima etapa. Resolva os paths a
partir do diretório desta skill (`SKILL_DIR`, informado no carregamento).

## Rotina

1. **Sondagem** (somente leitura; falha de comando opcional não interrompe):

   ```bash
   deno run -A "$SKILL_DIR/../../scripts/now-probe.ts"
   ```

   O JSON traz git (branch, limpeza, worktrees), `initialized`, `openIssuesTotal`,
   `dispatchableIssues` (o que o `coordinator` despacharia sem argumento), MCPs declarados em
   `.mcp.json`, runtimes de delegação no PATH, `aiMemory` (estado do container e a orientação),
   `pluginVersion` e `nextStep` (recomendação e as quatro opções, já ordenadas).

2. **Ferramentas ativas na sessão.** Complete os MCPs declarados com os ativos pela sua lista de
   ferramentas (prefixos `mcp__context7__`, `mcp__ai-memory__`, `mcp__docker__`, `mcp__alethe__`),
   sem conectar só para sondar. Se o ai-memory estiver configurado na sessão mas inativo, siga
   `aiMemory.guidance`: `ask-to-start` exige anuência explícita antes de rodar o `command`, e
   `report-state`, `show-recipe` e `docker-unavailable` só informam. Não configurado: não o mencione.

3. **Sumário executivo**: inicialização, branch e limpeza, worktrees, issues abertas e
   despacháveis, MCPs (declarado × ativo), runtimes de delegação e orquestrador (cite o Alethe com
   `mcp__alethe__*` ativo). Com `pluginVersion.updateAvailable: true`, avise que há versão nova e
   como atualizar pelo harness: no Claude Code, `/plugin update vetor`; instalado por CLI,
   `npx @tavaressan/vetor update`; no Antigravity global, `git pull` no clone e
   `agy plugin install .`.

4. **Priming**, só para o que estiver disponível, e com a referência lida só quando for usar:
   - Context7: use-o para documentação de bibliotecas (`../shared/references/mcp-availability.md`
     ao consultá-lo).
   - ai-memory, com `workspace` e `project` no `.ai-memory.toml` mais próximo: consulte gotchas e
     decisões (`../shared/references/memory-gotchas.md` ao consultar).
   - Runtime de delegação no PATH: delegue tarefas pesadas (`../shared/references/delegate-to-runtime.md`
     ao delegar, respeitando seleção e anuência).
   - Alethe ativo: despacho paralelo de workers (`../shared/references/delegate-alethe.md` ao
     despachar), só com `delegation.preferredRuntime: "alethe"`.

5. **Pergunta final**: uma pergunta com as quatro opções de `nextStep.options`, na ordem recebida,
   marcando a primeira como recomendada quando `nextStep.recommended` não for `null`, com
   `nextStep.reason`. Use a ferramenta de perguntas do harness; sem ela, o fallback de
   `../shared/references/harness-capabilities.md` §2.4. Trabalho livre fica no campo de texto
   livre (ou na resposta em chat).

6. Encaminhe para a etapa escolhida. Nunca execute uma etapa de escrita sem a escolha do usuário.
