---
id: spec:opencode-deduplicacao-scripts-coordinator
type: spec
project: Vetor
status: draft
created: 2026-10-23
updated: 2026-10-23
---
# Deduplicação de scripts e coordinator no OpenCode

## Summary

Unificar os oito scripts duplicados do OpenCode com os canônicos em `scripts/` e reduzir o agente `issue-coordinator` a uma camada de execução que consome `skills/coordinator` e suas referências. A instalação do CLI precisa disponibilizar ambos os conteúdos no projeto-alvo.

## Context

A árvore `opencode/scripts/` mantém cópias independentes de oito arquivos; o próprio `cli/scripts/sync-templates.js` sincroniza as árvores `skills`, `agents`, `hooks` e `opencode` (linhas 33–47), mas não materializa scripts canônicos dentro de `opencode/scripts/`. O instalador usa `ENGINE_NATIVE_SOURCE_DIR.opencode` para copiar a árvore nativa e exclui `skills`, `agents` e `hooks` da cópia genérica (`cli/lib/installer/writer.js:68-89`). O plugin calcula `SCRIPTS_DIR` como `join(HERE, "..", "scripts")` (`opencode/plugin/vetor.ts:23`), portanto essa pasta deve existir no pacote instalado.

O agente OpenCode tem 593 linhas segundo o contexto desta solicitação; seu próprio cabeçalho declara ser uma cópia autocontida e descreve adaptações de execução em `opencode/agent/issue-coordinator.md:11-30`. A skill canônica e referências compartilhadas já existem em `skills/coordinator/SKILL.md` e `skills/shared/references/`. A proposta do spike de deduplicação aponta a wrapper fina e as diferenças de dispatch (`docs/proposals/multi-harness-deduplication.md:12-14, 201-208`). A compatibilidade do OpenCode registra que o agente precisa permanecer em `.opencode/agent/` para ser invocado por `--agent` e que `$CLAUDE_PLUGIN_ROOT` não é aplicável (`wiki/Compatibilidade-OpenCode.md:140-161`).

Medição atual dos oito pares via `git diff --no-index --numstat <canônico> <cópia>`: "add" são linhas que só existem na cópia OpenCode e "del" são linhas que só existem no canônico (conferido em 2026-10-23 com `scripts/check-edit.ts`, cujo canônico tem o filtro Next ausente na cópia). A numstat mede alteração textual, não determina sozinha a intenção; a classificação abaixo deriva do conteúdo e do papel de cada arquivo:

| Canônico | Cópia OpenCode | Numstat (add / del) | Classificação das diferenças relevantes |
|---|---|---:|---|
| `scripts/check-edit.ts` | `opencode/scripts/check-edit.ts` | 2 / 25 | Drift: a cópia não contém o filtro de diagnósticos Next adicionado no canônico. Adaptação intencional: execução incondicional como entrypoint em vez de `import.meta.main`; preservar em wrapper/parâmetro de execução. |
| `scripts/safety-check.ts` | `opencode/scripts/safety-check.ts` | 23 / 178 | Drift predominante no canônico, com diferença relevante de adaptação de integração OpenCode. Extrair comportamento de harness em parâmetro/módulo antes de remover. A #476 também altera o canônico para extrair política reutilizável; incluir o novo módulo de `scripts/lib/` na geração. |
| `scripts/vetor-checks.sh` | `opencode/scripts/vetor-checks.sh` | 6 / 220 | Drift predominante no canônico; preservar eventuais ajustes de caminhos/exclusões específicos do OpenCode em parâmetro ou camada própria. |
| `scripts/vetor-status.sh` | `opencode/scripts/vetor-status.sh` | 2 / 9 | Drift no canônico, sem adaptação funcional relevante identificada. |
| `scripts/lib/guard.ts` | `opencode/scripts/lib/guard.ts` | 6 / 26 | Drift predominante; verificar diferenças de caminhos ou mensagens específicas do harness antes de unificar. |
| `scripts/lib/project.ts` | `opencode/scripts/lib/project.ts` | 42 / 53 | Drift: o canônico contém `hasDedicatedTests` e detecção mais recente do comando de teste; a cópia OpenCode não as contém. Adaptação intencional: `normalizeCwd` para Git Bash/Windows (#307); preservar como tratamento condicionado ao sistema ou adaptador OpenCode. |
| `scripts/lib/status.ts` | `opencode/scripts/lib/status.ts` | 1 / 1 | Drift pequeno, sem adaptação relevante identificada. |
| `scripts/lib/worktree.ts` | `opencode/scripts/lib/worktree.ts` | 2 / 7 | Drift no canônico, sem adaptação funcional relevante identificada. |

O sinal das colunas pode variar conforme a versão do Git e a orientação dos caminhos; a tabela conserva a saída observada nesta execução. Total observado: 84 adições e 519 remoções (603 linhas alteradas no total).

A documentação oficial consultada em 2026-10-23 (https://opencode.ai/docs/skills/) informa que OpenCode descobre skills de projeto em `.opencode/skills/<nome>/SKILL.md`, `.claude/skills/<nome>/SKILL.md` e `.agents/skills/<nome>/SKILL.md`, subindo do diretório atual até a raiz do git worktree; num projeto que também instala Claude Code, Codex ou Antigravity, as skills do Vetor já estão num desses diretórios. A mesma página oferece ao agente a ferramenta `skill` para carregar uma skill descoberta e aceita `instructions` em `opencode.json` para arquivos de instrução. A mesma documentação não menciona `AGENTS.md` na página de agents. O mecanismo existe no produto, mas o instalador atual exclui `skills` para OpenCode; portanto, uma skill não estará disponível ao agente instalado até que a distribuição a inclua em um caminho reconhecido. A documentação consultada indica atualização em 23 de outubro de 2026 na página de configuração; versão específica do OpenCode não foi confirmada.

## Goals

- Eliminar as oito cópias espelhadas da árvore versionada `opencode/scripts/` e gerar os scripts necessários ao OpenCode a partir da fonte canônica durante empacotamento/instalação.
- Preservar scripts e módulos exclusivos do OpenCode: `model-health.ts`, `resolve-model.ts`, `ensure-external-directory-permission.ts` e `lib/model-health.ts`, além dos respectivos testes.
- Fazer com que o agente OpenCode continue invocável por `--agent` e siga o fluxo canônico do coordinator, preservando as diferenças de execução necessárias ao OpenCode.
- Disponibilizar no destino OpenCode a skill e referências canônicas necessárias ao agente, ou registrar bloqueio para a #478 se a instalação não puder fazê-lo.

## Non-Goals

- Reescrever a política ou o fluxo funcional do coordinator.
- Remover módulos exclusivos do OpenCode ou substituir sua cobertura de testes.
- Alterar outros harnesses ou migrar o plugin OpenCode para outra arquitetura.
- Decidir nesta Spec os detalhes de implementação do instalador ou a política de versão mínima suportada.

## Users / Personas

- Mantenedor do Vetor: mantém uma fonte de verdade para scripts e coordinator.
- Usuário do CLI com OpenCode: instala o engine e espera que o plugin encontre scripts executáveis e que o agente coordinator siga o fluxo suportado.

## Functional Requirements

### RF-01 - Scripts OpenCode gerados da fonte canônica

**Priority:** Must

**Description:** A distribuição e instalação OpenCode devem entregar em `.opencode/scripts/` os scripts compartilhados necessários, derivados dos arquivos canônicos em `scripts/`, incluindo dependências compartilhadas novas em `scripts/lib/`.

**Acceptance Criteria:**

- [ ] Após empacotamento e `vetor install --engines opencode`, os oito caminhos espelhados são obtidos dos correspondentes canônicos, sem versões independentes versionadas em `opencode/scripts/`.
- [ ] `opencode/plugin/vetor.ts` resolve os scripts instalados sob `.opencode/scripts/` sem caminho ausente.
- [ ] Um novo módulo compartilhado importado pelos scripts canônicos também aparece no destino instalado e pode ser resolvido pelos imports.
- [ ] `deno task test` e `npm test` do CLI concluem com código de saída zero.

### RF-02 - Diferenças específicas preservadas e explícitas

**Priority:** Must

**Description:** Diferenças OpenCode necessárias devem permanecer explícitas como opções de comportamento nos scripts canônicos ou como módulos/adaptadores exclusivos do OpenCode; nenhuma diferença funcional relevante deve desaparecer silenciosamente na deduplicação.

**Acceptance Criteria:**

- [ ] Cada um dos oito pares possui uma classificação de drift ou adaptação intencional registrada na alteração de implementação/PR.
- [ ] A revisão identifica, para cada adaptação mantida, se virou parâmetro canônico ou módulo exclusivo do OpenCode.
- [ ] Os quatro módulos exclusivos listados em Goals continuam no pacote e seus testes existentes continuam executáveis.

### RF-03 - Agente fino segue a skill canônica

**Priority:** Must

**Description:** O agente `issue-coordinator` continua sendo um agent OpenCode invocável e mantém somente metadados/permissões necessários e diferenças de execução, delegando o procedimento às instruções canônicas de `skills/coordinator/SKILL.md` e `skills/shared/references/`.

**Acceptance Criteria:**

- [ ] O agente permanece disponível para `opencode run --agent issue-coordinator`.
- [ ] O conteúdo do agente não reproduz as fases, regras ou referências operacionais que já pertencem à skill e aos documentos compartilhados.
- [ ] O agente instrui o uso da skill descoberta e conserva as diferenças necessárias, incluindo dispatch por `opencode run --dir <worktree>` em processo separado.
- [ ] A instalação do CLI disponibiliza a skill em um caminho que a documentação oficial reconhece. Se não for possível confirmar essa disponibilidade, a #478 é bloqueada e recebe evidência, URL consultada, versão (ou registro explícito de versão não confirmada), mecanismo tentado e a lacuna concreta do instalador.

### RF-04 - Contratos do coordinator atualizados

**Priority:** Must

**Description:** Testes que protegem o agente e a paridade do fluxo devem validar a arquitetura fina sem exigir cópia textual do coordinator.

**Acceptance Criteria:**

- [ ] `opencode/scripts/issue-coordinator_test.ts` e `scripts/tests/coordinator-footer-origin-contract_test.ts` cobrem os contratos compatíveis com o agente fino e passam.
- [ ] Os testes não exigem que o texto completo das fases canônicas seja duplicado no agent.

## Non-Functional Requirements

### RNF-01 - Fonte única verificável

**Priority:** Must

**Description:** Alterações nos scripts compartilhados devem chegar à instalação OpenCode pelo mesmo processo de empacotamento do CLI, sem backport manual de conteúdo espelhado.

**Acceptance Criteria:**

- [ ] O empacotamento do CLI sincroniza a árvore necessária a partir das fontes mantidas no repositório.
- [ ] Um teste do sincronizador/instalador comprova a presença de arquivos canônicos e dependências importadas no template e no destino OpenCode.

### RNF-02 - Compatibilidade documentada

**Priority:** Must

**Description:** A solução deve respeitar os locais de descoberta de skills e instruções documentados pelo OpenCode e manter as instruções legíveis a partir do projeto-alvo.

**Acceptance Criteria:**

- [ ] A skill é descoberta por OpenCode numa localização suportada pela documentação oficial e pode ser carregada pelo agente via ferramenta `skill`.
- [ ] As referências locais necessárias à skill existem no destino e são resolvidas a partir do projeto-alvo.

## Behavior / States

1. Empacotamento sincroniza scripts canônicos e módulos compartilhados para a distribuição.
2. Instalação OpenCode copia a árvore do plugin e os scripts gerados para `.opencode/`.
3. Plugin usa os scripts instalados pela localização relativa já definida.
4. O agente é invocado pelo nome, carrega a skill canônica disponível e executa o dispatch OpenCode através de processos `opencode run --dir`.
5. Se skill ou referência não estiver acessível, o agente não tenta executar um fluxo duplicado ou incompleto; a lacuna é reportada e a #478 fica bloqueada até a instalação ser corrigida.

## Data

⚠️ ABERTO: confirmar se o pacote publicado mantém manifesto ou proveniência dos arquivos gerados que permita distinguir conteúdo sincronizado de alterações locais no projeto-alvo.

## Integrations / Dependencies

- CLI npm: `cli/scripts/sync-templates.js` e `cli/lib/installer/writer.js` empacotam e instalam a árvore por engine.
- Plugin OpenCode: `opencode/plugin/vetor.ts` depende de `.opencode/scripts/`.
- Skill canônica: `skills/coordinator/SKILL.md` e referências em `skills/shared/references/`.
- Issue #476: altera `scripts/safety-check.ts` e pode introduzir módulo reutilizável em `scripts/lib/`; esse módulo precisa acompanhar os scripts sincronizados.
- Compatibilidade do OpenCode: o agent continua em `.opencode/agent/` e não depende de `$CLAUDE_PLUGIN_ROOT`.

## Edge Cases

- Uma cópia OpenCode contém adaptação funcional não presente no canônico: a adaptação deve ser convertida em parâmetro ou mantida em módulo OpenCode antes de eliminar a cópia; não pode ser descartada sem classificação.
- Um script canônico passa a importar módulo novo em `scripts/lib/`: a geração inclui o módulo recursivamente ou a instalação falha de forma observável e bloqueia release/aceite.
- OpenCode não descobre a skill no projeto-alvo: o agente não presume que a skill está disponível; a #478 fica bloqueada com diagnóstico da localização e do mecanismo de instalação ausentes.

## Error Handling

Falha ao gerar/copiar arquivo ou dependência importada deve fazer o empacotamento/instalação ou verificação de aceite falhar com indicação do path ausente. ⚠️ ABERTO: definir formato de mensagem e se a instalação deve ser transacional.

## Security / Privacy

As permissões OpenCode existentes do agente devem ser preservadas durante a redução. ⚠️ ABERTO: rever se `bash: allow` e `edit: allow` continuam sendo o conjunto mínimo necessário após carregar a skill.

## Rollout

Aplicar a deduplicação em conjunto para #477 e #478, pois ambas alteram empacotamento/instalador. A #478 depende de a skill estar acessível no ambiente instalado. Validar comportamento contra instalação via pacote CLI, além da árvore fonte. Critérios de conclusão incluem `deno task test` e `npm test` do CLI verdes.

## Open Questions

> Todas as perguntas abaixo foram decididas pelo mantenedor em 2026-10-23, seguindo a recomendação de cada uma; ver `## Decisions`.

- O instalador deve passar a incluir `skills/coordinator` e as referências compartilhadas em `.opencode/skills/` (local de descoberta oficial), ou usar outro caminho suportado? **Recomendação:** copiar apenas a skill e dependências necessárias para `.opencode/skills/coordinator/` e dar permissão `skill` ao agent, evitando instalar o diretório `skills/` inteiro.
- A geração dos scripts será recursiva para toda `scripts/` ou manterá uma lista explícita de arquivos compartilhados? **Recomendação:** usar uma lista explícita de entradas e calcular/copiar recursivamente suas dependências locais, para evitar empacotar utilitários não usados.
- Quais diferenças dos arquivos `check-edit.ts`, `safety-check.ts`, `vetor-checks.sh`, `lib/guard.ts` e `lib/project.ts` são adaptações intencionais que devem virar parâmetros ou módulos? **Recomendação:** auditar os diffs linha a linha na implementação e registrar decisão por par na PR antes da remoção.
- A versão mínima suportada do OpenCode é compatível com descoberta de skills e ferramenta `skill` descritas na documentação consultada? **Recomendação:** confirmar contra a versão suportada pelo projeto e registrar versão e teste de integração na PR; na ausência de confirmação, manter a #478 bloqueada.
- O caminho antigo `opencode/agent/issue-coordinator.md` deve continuar apontando para skill instalada via caminho relativo explícito ou apenas orientar o uso da ferramenta `skill` pelo nome? **Recomendação:** preferir descoberta e carregamento pela ferramenta nativa, com permissão explícita no frontmatter do agent.

## Decisions

- Uma Spec cobre #477 e #478 porque ambas alteram a distribuição e instalação do CLI; #478 depende da entrega da skill e scripts pelo mecanismo de instalação.
- Os arquivos canônicos ficam em `scripts/`; a árvore `opencode/scripts/` deixa de versionar os oito espelhos.
- Os módulos exclusivos do OpenCode e seus testes permanecem no pacote.
- A fonte de instrução do coordinator permanece `skills/coordinator/SKILL.md` e `skills/shared/references/`; o agent OpenCode retém somente o bootstrap, permissões e diferenças operacionais do harness.
- A verificação oficial de 2026-10-23 encontrou suporte de OpenCode a skills nativas e à chave `instructions`; não confirmou versão instalada suportada pelo Vetor. Documentação consultada: https://opencode.ai/docs/agents/, https://opencode.ai/docs/config/, https://opencode.ai/docs/skills/.

Decididas pelo mantenedor em 2026-10-23 (Open Questions):

- O instalador copia só `skills/coordinator/` para `.opencode/skills/coordinator/` e as referências necessárias para `.opencode/skills/shared/references/`, preservando os caminhos relativos `../shared/references/` usados pela skill; o agent recebe permissão `skill`.
- A geração dos scripts usa uma lista explícita de entradas, com cópia das dependências locais de cada uma.
- As diferenças de cada par são auditadas linha a linha na implementação e registradas por par na PR antes da remoção.
- A versão mínima do OpenCode com descoberta de skills e ferramenta `skill` é confirmada e registrada na PR, com teste de integração; sem confirmação, o #478 fica bloqueado.
- O agent carrega a skill pela ferramenta nativa `skill`, pelo nome, com permissão explícita no frontmatter.

## References

- `templates/spec.md` — estrutura-base da Spec.
- `docs/proposals/multi-harness-deduplication.md` — proposta de deduplicação, especialmente §4 e §6.
- `opencode/plugin/vetor.ts:23` — resolução de `SCRIPTS_DIR`.
- `cli/scripts/sync-templates.js:33-47` — árvores sincronizadas no empacotamento.
- `cli/lib/installer/writer.js:68-89, 396-423` — exclusões e origem nativa OpenCode.
- `opencode/agent/issue-coordinator.md:1-30` — agent e adaptação OpenCode.
- `wiki/Compatibilidade-OpenCode.md:140-161` — localização e compatibilidade do agent.
- `skills/coordinator/SKILL.md` e `skills/shared/references/` — instrução canônica.
- OpenCode Agents: https://opencode.ai/docs/agents/ (consulta: 2026-10-23; versão específica não identificada).
- OpenCode Config: https://opencode.ai/docs/config/ (consulta: 2026-10-23; página indicava atualização em 2026-10-23).
- OpenCode Agent Skills: https://opencode.ai/docs/skills/ (consulta: 2026-10-23; versão específica não identificada).

## Revision History

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-23 | Codex (via Alethe) | rascunho inicial gerado por /vetor:spec |
| 2026-10-23 | Claude Code (coordinator) | revisão: correções factuais e decisões do mantenedor nas Open Questions |

- Relacionado: proposals/multi-harness-deduplication.md
