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

   A sondagem é somente-leitura. Ela informa branch e limpeza do git, worktrees registrados, se o projeto foi inicializado (`initialized` via existência de `.claude/vetor/config.json`), o label de despacho configurado (`defaultDispatchLabel`), a contagem total de issues abertas sem filtro (`openIssuesTotal`), a contagem do que o `coordinator` despacharia sem argumento (`dispatchableIssues` — issues com `defaultDispatchLabel` se configurado, senão todas as abertas), contagem de issues abertas com label `backlog` (`backlogIssues`), MCPs declarados em `.mcp.json`, runtimes detectados e `aiMemoryContainerState` (`running`, outro estado, `absent` ou `null` se Docker não responder). Falhas de comandos opcionais não devem interromper o kickoff.

2. Complemente a lista de MCPs declarados com os MCPs ativos na sessão conforme `mcp-availability.md`. Os servidores Context7, Docker e ai-memory são relevantes para o sumário. Nunca tente conectar apenas para sondar; a sondagem do container Docker no passo 1 é somente-leitura. Considere ai-memory configurado nesta sessão somente se estiver ativo ou aparecer entre os MCPs que falharam ao conectar. Se não estiver configurado, não mencione receita nem container ai-memory. Se estiver configurado, mas não ativo:
   - Com `aiMemoryContainerState` igual a `running`, oriente `/mcp` → Reconnect.
   - Se o estado for `exited` ou `created`, peça anuência explícita via `AskUserQuestion` antes de executar `docker start ai-memory`. Com anuência, execute somente esse comando e então verifique a disponibilidade do servidor até 10 vezes, com intervalo de 3 segundos, usando `deno run --allow-net "$SKILL_DIR/../../scripts/ai-memory-check.ts" <url>`. A `<url>` vem da configuração MCP `ai-memory` do usuário (por exemplo, da saída de `claude mcp get ai-memory`); a URL padrão da receita é `http://127.0.0.1:49374/mcp`. Se não passar após as tentativas, informe que o servidor não ficou disponível e pare. Se passar, oriente o usuário a rodar `/mcp` → Reconnect; as ferramentas só aparecem na sessão depois disso. Sem anuência, não inicie.
   - Para `paused`, `restarting`, `dead` ou qualquer outro estado, apenas informe o estado; não execute comandos nem tente iniciar o container.
   - Se `absent`, apenas indique a receita em `templates/docker-compose.ai-memory.yml` e `wiki/MCPs.md`; não crie nem inicie container.
   - Se `null`, informe que o Docker não respondeu — Docker pode não estar instalado ou o daemon pode estar parado.
   Nunca execute `docker run` nem `docker compose up` automaticamente. Alternativamente, como o container usa `restart: unless-stopped`, configurar o Docker para iniciar no login faz o container subir antes da sessão.

3. Apresente um sumário executivo conciso: inicialização do projeto (`config.json`), branch/estado limpo, worktrees existentes, total de issues abertas e no backlog, e disponibilidade de MCPs e runtimes. Diferencie configuração declarada de ferramenta ativa na sessão; informe o estado do container ai-memory somente se ele estiver configurado nesta sessão (ativo ou listado entre os MCPs que falharam ao conectar).

4. Faça o priming explícito, condicionado a cada ferramenta estar disponível:
   - Se Context7 estiver disponível: **Use Context7 para documentação atualizada de bibliotecas.**
   - Se ai-memory estiver disponível e o `.ai-memory.toml` mais próximo declarar `workspace` e `project`: **Consulte ai-memory para gotchas e decisões** conforme `../shared/references/memory-gotchas.md`, passando ambos os valores juntos. Sem esses valores, pule consulta e registro.
   - Se algum runtime estiver disponível: **Use agy/delegação para tarefas pesadas** conforme `../shared/references/delegate-to-runtime.md`; respeite a seleção e anuência descritas na referência.
   - Se Docker MCP estiver disponível, use-o apenas quando uma tarefa da sessão precisar inspecionar containers.

5. Use `AskUserQuestion` com uma única pergunta e quatro opções; a opção recomendada deve vir primeiro. O mecanismo oferece “Other” automaticamente. Escolha a recomendação pelo estado sondado:
   - **Projeto não inicializado (`initialized: false`)**: recomende `/vetor:install` como prioridade máxima para mapear comandos de teste e criar a configuração do projeto antes de qualquer dispatch ou fluxo automatizado.
   - **Projeto inicializado (`initialized: true`)**:
     - Com `dispatchableIssues > 0` e nenhum worktree ativo além do principal, recomende `/vetor:coordinator`. Use `dispatchableIssues`, não `backlogIssues`: é o filtro que o `coordinator` realmente aplica sem argumento.
     - Com `dispatchableIssues == 0`, recomende `/vetor:backlog`.
     - Nos demais casos (ex.: worktrees ativos em andamento), recomende a etapa com melhor encaixe no pedido/contexto da sessão (ex.: retomar `/vetor:coordinator --resume`).

   Opções (sempre quatro). Com o projeto inicializado:
   - **Despachar issues** — `/vetor:coordinator` (recomendada quando houver issues elegíveis prontas e nenhum worktree ativo).
   - **Idear trabalho** — `/vetor:backlog` (recomendada quando o repositório/backlog estiver vazio).
   - **Especificar tema** — `/vetor:spec`.
   - **Auditar ou trabalho pontual** — `/vetor:guardian` para auditoria; use “Other” para trabalho livre pontual.

   Com o projeto não inicializado, **Inicializar projeto** — `/vetor:install` entra como primeira opção (recomendada) e ocupa a vaga de **Auditar ou trabalho pontual**, que continua acessível via “Other”.

6. Encaminhe para a skill ou tarefa escolhida. Não execute automaticamente uma etapa de escrita sem a escolha do usuário.
