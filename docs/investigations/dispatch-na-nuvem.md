# Investigação: dispatch de workers em sessões na nuvem

**Issue:** #565 — spike(coordinator): dispatch de workers em sessões na nuvem quando houver vantagem
de crédito ou desempenho
**Data:** 2026-11-09
**Base:** `master` em `90d819f` (v1.4.0)
**Arquivos afetados (não alterados aqui):** `skills/coordinator/SKILL.md` (Fases 2 e 4),
`skills/shared/references/issue-coordinator-dispatch.md`,
`skills/shared/references/delegate-to-runtime.md`, `.claude/vetor/config.json`.

**Rótulos:** **[Fato]** lido na fonte citada ou verificado neste repositório · **[Inferência]** ·
**[Opinião]** · **[Não verificado]**.

**Fontes** (documentação do Claude Code, lida em 2026-11-09; as páginas não mostram data, só versões
do CLI):
`https://code.claude.com/docs/en/claude-code-on-the-web.md`, `…/cloud-environments.md`,
`…/routines.md`, `…/sub-agents.md`, `…/costs.md`. Parte de `claude-code-on-the-web.md`,
`cloud-environments.md` e `routines.md` só foi obtida por resumo; esses trechos estão marcados
**[resumo]**.

---

## 1. Pergunta

Quando vale a pena o coordinator despachar workers como sessões na nuvem (subagente com
`isolation: "remote"`, sessões do Claude Code na web, rotinas agendadas) em vez de subagentes locais
com `isolation: "worktree"`? O critério é crédito e custo, desempenho ou liberar a máquina e o humano
local? Como o coordinator escolheria de forma determinística?

## 2. Resumo

- **[Fato]** **Um worker do Vetor não funcionaria na nuvem hoje:**
  - a sessão na nuvem começa de um clone limpo do GitHub;
  - plugins declarados no `.claude/settings.json` do repositório **não são carregados**, e plugins do
    usuário também não;
  - o Deno, de que todos os scripts do Vetor dependem, **não vem pré-instalado**.
  Sem as skills, os hooks e os scripts, o worker não segue o contrato do Vetor.
- **[Fato]** **Não há vantagem de crédito.** A sessão na nuvem "counts toward your plan's usage limits
  alongside the rest of your Claude and Claude Code usage, and there's no separate charge for the
  cloud VM". O limite é compartilhado, e rodar em paralelo consome proporcionalmente mais.
- **[Fato]** **`isolation: "remote"` não está documentado.** A documentação de subagentes só lista
  `worktree`. O valor aparece na descrição da ferramenta `Agent()` de algumas sessões, como
  "availability is gated", e não há como detectá-lo sem ser pela própria lista de ferramentas.
- **[Fato]** A vantagem real seria tirar carga da máquina e do humano local: a VM tem ~4 vCPUs e
  16 GB, e o modo de permissão é escolhido por sessão.
- **[Opinião]** **Recomendação:** ficar **só local** por enquanto, com o motivo registrado. Abrir o
  caminho remoto primeiro para o `--headless` (rotinas agendadas), e só depois de três pré-condições
  (§6).

## 3. Evidências

### 3.1 Disponibilidade e detecção (escopo 1)

| Fato | Fonte |
| --- | --- |
| "Cloud sessions are available on Pro, Max, Ultra, and Team plans, and for Enterprise users with premium seats or Chat + Claude Code seats." | claude-code-on-the-web.md |
| Para `claude --cloud`: "Your organization's `allow_remote_sessions` policy must also be enabled." | claude-code-on-the-web.md |
| `isolation` no frontmatter de subagente: "Set to `worktree` to run the subagent in a temporary git worktree" (nenhum outro valor) | sub-agents.md |
| Dentro de uma sessão na nuvem: "Subagents work the same way they do locally." | claude-code-on-the-web.md |
| Nesta sessão (Claude Code 2.1.319), a descrição do `Agent()` oferece `isolation: "remote"`: "launches the agent in a remote cloud environment (always runs in background; availability is gated)" | lista de ferramentas da sessão |

**[Inferência]** A detecção segue a regra que o Vetor já tem (`harness-capabilities.md` §1): usar a
capacidade só quando ela aparece na lista de ferramentas da sessão, nunca chamando para ver se
funciona. Como o valor não está documentado, nada garante que o comportamento seja estável entre
versões.

### 3.2 Crédito e custo (escopo 2)

| Fato | Fonte |
| --- | --- |
| "It counts toward your plan's usage limits alongside the rest of your Claude and Claude Code usage, and there's no separate charge for the cloud VM." | claude-code-on-the-web.md |
| Os limites de taxa são compartilhados, e "Running multiple tasks in parallel consumes more rate limits proportionately." **[resumo]** | claude-code-on-the-web.md |
| Tarefas agendadas "draw down subscription usage the same way interactive sessions do"; com créditos de uso ligados, seguem "on metered overage" **[resumo]** | routines.md |
| Cada subagente "sends its own requests, which count toward the same usage limits as your main conversation." | sub-agents.md |

**[Fato]** Não há cota separada nem crédito promocional documentado para a nuvem. A pergunta "a nuvem
sai mais barata?" tem resposta negativa: o custo em tokens de um worker é o mesmo, e o que muda é só
onde ele roda.

### 3.3 Limites e ambiente (escopos 4 e 5)

| Tema | Fato | Fonte |
| --- | --- | --- |
| Clone | "Cloud sessions start from a fresh clone of your repository."; o `--cloud` clona "your current directory's GitHub remote at your current branch, not your local checkout" | cloud-environments.md, claude-code-on-the-web.md |
| Configuração carregada | do repositório: `CLAUDE.md`, hooks e regras de permissão do `.claude/settings.json` ("in a session with one repository"), `.claude/skills/`, `agents/` e `commands/`. **Não** são carregados: plugins declarados no `.claude/settings.json` do repositório, nem arquivos e plugins do usuário (`~/.claude/`) | cloud-environments.md (tabela) |
| Toolchains | Python, Node 20/21/22, Ruby, PHP, Java, Go, Rust, C/C++, Docker, PostgreSQL, Redis, Chrome. "Toolchains outside this list … aren't pre-installed … Install them with a setup script." O Deno não está na lista | cloud-environments.md |
| Setup | script Bash que roda como root antes do Claude Code; o cache vale por ~7 dias **[resumo]** | cloud-environments.md |
| Máquina | aproximadamente 4 vCPUs, 16 GB de RAM e 30 GB de disco, Ubuntu 24.04 x86_64 **[resumo]** | cloud-environments.md |
| Rede | níveis `None`, `Trusted` (registries de pacotes, GitHub, SDKs de nuvem), `Full` e `Custom` | cloud-environments.md |
| Comandos | 2 min por comando em primeiro plano, até 10 min **[resumo]** | cloud-environments.md |
| Concorrência | nenhum número documentado; tarefas agendadas podem não iniciar porque "your organization had reached its limit on cloud sessions running at once" **[resumo]** | routines.md |
| Resultado | "When a session completes, you can create a PR from claude.ai/code or teleport the session to your terminal"; tarefas agendadas enviam para uma branch `claude/` **[resumo]** | claude-code-on-the-web.md, routines.md |
| Push | o proxy do GitHub "doesn't limit which branches a push can update. To do that, use branch protection rules or rulesets on GitHub." | cloud-environments.md |
| Permissões | o modo é escolhido por sessão no seletor; tarefas agendadas começam em `auto` quando disponível **[resumo]** | claude-code-on-the-web.md, routines.md |

**[Fato]** O Vetor é instalado no Claude Code como plugin (`/plugin install vetor@vetor`) ou por
projeto (`npx @tavaressan/vetor install --engines claude-code`, que copia `skills/`, `agents/` e `hooks/`
para `.claude/`; `cli/lib/installer/writer.js:51`). Pela tabela acima, o plugin não carrega na nuvem.
**[Não verificado]** se a instalação por projeto bastaria: as skills chamam `scripts/` do plugin, e os
hooks do Claude Code são lidos do `settings.json`, não de `.claude/hooks/`.

### 3.4 Desempenho (escopo 3): por que não houve medição

O critério de aceite pede ao menos uma medição local contra remota "ou a justificativa de por que não
foi possível". Ela não foi feita, porque um worker remoto hoje **não executaria o contrato do Vetor**:
- sem as skills e os hooks do plugin;
- sem o Deno para `vetor-checks.sh`, `verify-status` e a suíte;
- com o status file apontando para um root que não existe na VM (§3.5).

Medir o tempo de um agente genérico na nuvem contra um `vetor:issue-worker` local compararia coisas
diferentes. **[Inferência]** Dos números da #564 dá para estimar o que a nuvem mudaria: o
desenvolvimento local levou de 2 a 8 minutos por worker, e o gargalo foi a fila de merge (15 a 23
minutos do PR ao merge com 5 workers), que continuaria local e serializada. A nuvem aliviaria a CPU
local (a suíte de ~25 s por worker) e, com o modo de permissão próprio, a fila de aprovação. Não
mudaria a entrega.

### 3.5 O contrato do Vetor no remoto (escopo 4)

| Item do contrato | Hoje (local) | No remoto |
| --- | --- | --- |
| Repositório, hooks, `module-test-map` | worktree local com o plugin | clone do GitHub; plugin ausente; `.claude/vetor/module-test-map*` só existe se estiver versionado |
| Status file | `<root>/.claude/vetor/status/<branch>.md`, com fallback em `<worktree>/.claude/vetor-status.md` (#540) | não há root local. O único canal que volta é o **git**: o fallback commitado na branch do worker, ou um comentário na issue ou no PR |
| Push e PR | o worker faz push só com `GREEN` (safety hook); o PR é do `ship --prepare` | a sessão faz push para a própria branch (`claude/…` nas rotinas) e pode abrir o PR. O safety hook não roda (plugin ausente), então a proteção da branch default precisa vir de **branch protection no GitHub** |
| Pre-Ship e merge serializado | locais, no coordinator | devem continuar locais: o Fast Merge Gate e o merge serializado dependem do root sincronizado |

### 3.6 Segurança e permissões (escopo 5)

- **[Fato]** Na nuvem, o modo de permissão é por sessão, e as rotinas começam em `auto`. As proibições
  do contrato (nunca merge, nunca push para a default) hoje são garantidas pelo safety hook do
  plugin, **que não carrega na nuvem**.
- **[Inferência]** Sem o hook, a garantia teria de vir do próprio GitHub (branch protection ou
  rulesets na default) e da instrução no prompt. É o mesmo fallback "por instrução" que o
  `harness-capabilities.md` §2.2 aceita para harnesses sem hook, mas com risco maior, porque a sessão
  remota tem credencial de push.

### 3.7 Interação com o teto de workers (escopo 6)

**[Inferência]** Um worker remoto não usa a CPU local e, com modo de permissão próprio, não entra na
fila de aprovação do humano local. Os dois motivos do teto local da #564 deixam de valer para ele.
Mas ele ainda consome a mesma cota de uso e ainda entra na fila de merge local. Ele deve ficar fora do
`N` local e entrar num teto próprio, limitado pela fila de merge (grupos com módulos disjuntos, #564
§6).

## 4. Opções avaliadas

| Opção | Avaliação |
| --- | --- |
| **Só local, documentando por quê** | **Recomendada agora.** Sem o plugin e o Deno na nuvem, o worker remoto não segue o contrato |
| Remoto opt-in por config (`dispatchTarget: "local" \| "remote" \| "auto"`) e pergunta na aprovação do plano | Só depois das pré-condições do §6; antes disso, a opção existiria sem funcionar |
| Política `auto` (remoto quando o grupo é grande ou a suíte é pesada) | Não há vantagem de custo para pesar, e o ganho de tempo é limitado pela fila de merge. Critério difícil de justificar com os dados atuais |
| **Remoto só para o `--headless`** (rotinas agendadas) | **Primeiro alvo quando as pré-condições existirem.** Não há humano para aprovar permissões, a rotina já roda na nuvem, e o coordinator headless já suspende quem pede permissão |

## 5. Critério de escolha proposto (para quando houver remoto)

Determinístico, na Fase 2 do coordinator:

1. Remoto só se `isolation: "remote"` estiver na lista de ferramentas **e** `dispatchTarget` não for
   `local` **e** as três pré-condições do §6 estiverem verificadas no repositório (setup script com
   Deno, Vetor carregado por projeto, branch protection na default).
2. Em `--headless`: remoto por padrão quando o item 1 vale.
3. Interativo: remoto só com `dispatchTarget: "remote"` explícito; `auto` não escolhe remoto em
   sessão interativa, porque o ganho não compensa a perda do safety hook.
4. Workers remotos ficam fora do `N` local e respeitam um teto próprio, que é o número de grupos com
   módulos disjuntos.

## 6. Recomendação

**[Opinião]**

1. **Agora: só local.** Registrar na referência de dispatch que sessões na nuvem não são usadas
   porque o plugin não carrega, o Deno não vem instalado e o status file pressupõe o root local.
2. **Pré-condições para reabrir:**
   1. instalar o Vetor por projeto de forma que a nuvem carregue skills, agents, hooks (no
      `.claude/settings.json`) e scripts, e verificar isso numa sessão real;
   2. um setup script que instala o Deno;
   3. branch protection na branch default, como substituto do safety hook.
3. **Contrato no remoto, quando reabrir:**
   - o status file volta pelo **git**: o fallback `<worktree>/.claude/vetor-status.md` é commitado na
     branch do worker, e o coordinator lê com `git show origin/<branch>:.claude/vetor-status.md`;
   - a sessão remota faz push só da própria branch e **nunca** abre PR nem faz merge;
   - Pre-Ship e merge serializado continuam no coordinator local.
4. **Primeiro uso: `--headless`** em rotina agendada, que é onde a falta de um humano para aprovar
   permissões mais pesa.
5. **Medição:** quando as pré-condições existirem, rodar a mesma issue pequena local e remota e
   comparar o tempo até `GREEN` e o tempo de parede. É a medição que este spike não pôde fazer
   (§3.4).

A decisão continua humana: este spike não altera a skill nem cria issues de follow-up.
