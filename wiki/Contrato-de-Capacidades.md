# Contrato de capacidades dos harnesses

O Vetor roda em Claude Code, OpenCode, Antigravity, Codex, Cursor e em qualquer outro harness que
ofereça o núcleo abaixo (issue #568). Esta página diz o que o núcleo pode assumir e o que cada
harness oferece além disso. Os fallbacks de cada capacidade opcional ficam num único lugar, que as
skills leem:
[`skills/shared/references/harness-capabilities.md`](../skills/shared/references/harness-capabilities.md).

## Capacidades obrigatórias do núcleo

1. **Ler arquivos.**
2. **Editar arquivos.**
3. **Rodar shell** (`bash`; Git Bash no Windows), com `git`, `gh` e `deno` disponíveis.

Todo fluxo suportado funciona só com isso. Recurso exclusivo de um harness entra como otimização
aditiva, com fallback portátil, e nunca como requisito. Uma skill nunca supõe que outro harness tem
subagentes, hooks, isolamento de worktree, `context: fork` ou `bin/`.

## Capacidades opcionais por harness

Legenda: ✅ nativo · ⚠️ parcial ou por outro mecanismo · ❌ ausente · ❓ não verificado (vale o
fallback).

| Capacidade              | Claude Code                                                                      | OpenCode                                                                              | Antigravity                                                                 | Codex                                                                                        | Cursor                                            |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Subagentes              | ✅ `Agent()`                                                                     | ⚠️ `task` herda o cwd; o Vetor usa um processo `opencode run --dir` por worker        | ✅ subagentes em Markdown                                                   | ✅ subagentes em TOML, sem allowlist de tools                                                | ✅ custom subagents                               |
| Hooks                   | ✅ `PreToolUse`, `PostToolUse`, `SubagentStop`, `SessionStart`, `WorktreeCreate` | ⚠️ plugin `tool.execute.before`/`after`; sem fim de subagente nem criação de worktree | ⚠️ só `PreToolUse` de `run_command`; sem `SubagentStop`                     | ⚠️ mesmo formato do Claude Code, payload não verificado em sessão real; sem `WorktreeCreate` | ⚠️ traduzidos na instalação; sem `WorktreeCreate` |
| Isolamento de worktree  | ✅ `isolation: worktree`                                                         | ⚠️ por processo com `--dir`                                                           | ❌                                                                          | ❌ só por instrução                                                                          | ⚠️ pedido por instrução, não por frontmatter      |
| Ferramenta de perguntas | ✅ `AskUserQuestion`                                                             | ❓                                                                                    | ⚠️ `implementation_plan.md` com `request_feedback`, para aprovação de plano | ❓                                                                                           | ❓                                                |
| Execução em background  | ✅ `run_in_background`, `Monitor`                                                | ⚠️ processos do SO pelo shell                                                         | ❓                                                                          | ❓                                                                                           | ⚠️ `is_background` no subagente                   |
| Agendamento             | ✅ `CronCreate` e rotinas                                                        | ❓                                                                                    | ❓                                                                          | ❓                                                                                           | ❓                                                |

**Fontes:** [Compatibilidade-OpenCode](Compatibilidade-OpenCode.md) (código-fonte e SDK
`@opencode-ai/plugin` 1.19.x), [Compatibilidade-Antigravity](Compatibilidade-Antigravity.md)
(`antigravity.google/docs/subagents` e `/docs/plugins`, consultadas em 2026-10-15 e 2026-10-19),
[Compatibilidade-Codex](Compatibilidade-Codex.md) (documentação de subagentes consultada em
2026-10-15), [Compatibilidade-Cursor](Compatibilidade-Cursor.md) (`cursor.com/docs/subagents` e
`/docs/hooks`, consultadas em 2026-10-15) e [Hooks](Hooks.md). Um ❓ só muda depois de confirmado
numa dessas páginas, com fonte e data.

## Campo `compatibility` das skills

O `compatibility` do frontmatter segue esta matriz: diz que a skill exige só o núcleo e lista as
capacidades opcionais que ela usa quando existem. O fallback de cada uma está na referência citada
acima.

## Campos opcionais de frontmatter por engine

Campos do Claude Code que reduzem custo ou risco entram só como otimização: o comportamento sem eles
continua correto em todos os harnesses (issue #576). Fontes consultadas em 2026-11-09:
https://code.claude.com/docs/en/skills.md, https://code.claude.com/docs/en/sub-agents.md e
https://code.claude.com/docs/en/plugins/components.md.

| Campo                                    | Avaliado para                                        | Decisão          | Motivo                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disable-model-invocation: true` (skill) | `ship`, `coordinator`, `install`, `guardian`         | não adotado      | Além de tirar a descrição do contexto, impede o modelo de invocar a skill, o pré-carregamento em subagentes e a execução por tarefa agendada. O `/vetor:now` encaminha para `coordinator` e `install` pelo modelo; o Pre-Ship de fallback roda `/vetor:ship --prepare` dentro de um subagente; `coordinator --headless` e `guardian --cron` existem para rotinas agendadas. |
| `context: fork` (skill)                  | `guardian`, `architecture-review`, validação de Spec | não adotado      | O fork roda a skill num subagente sem o histórico e sem conversa com o usuário. O `guardian` pede aprovação antes de corrigir, o `architecture-review` pergunta qual candidato aprofundar, e a validação virou o modo `/vetor:spec --validate` (#580), que roda um CLI determinístico e barato.                                                                             |
| `maxTurns` (agent)                       | `issue-worker`                                       | **adotado: 120** | Dá teto real ao orçamento de 5 iterações do `fix` (#156). Ao atingir o limite, o Claude Code devolve saída parcial; o status fica não terminal e o coordinator reconcilia pela Fase 5.g. Calibração no comentário do frontmatter de `agents/issue-worker.md`.                                                                                                               |

Nos outros harnesses: o `agy plugin validate` aceita `maxTurns` no agent (verificado em 2026-11-09);
o instalador o remove da cópia do Cursor, cuja documentação não lista o campo; o Codex usa
`agents/issue-worker/codex.toml`, sem equivalente, e o OpenCode tem o próprio
`opencode/agent/issue-worker.md`. Em todos eles o orçamento continua sendo o sugerido pelo `fix`.

## Capability Registry: perfis e evidências

O Capability Registry descreve o que um harness declara oferecer e o que foi observado sobre ele; um
perfil não substitui a matriz de compatibilidade acima nem as regras de autorização. Na Fase 1, os
tipos comuns estão em `scripts/lib/capabilities/types.ts:19-70`, e o contrato refinado está em
`docs/adr/ADR-002-capability-based-execution-routing.md:555-571`.

### Níveis de evidência

| Nível         | O que significa                                                                                                                                                                 | Onde fica                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `declared`    | Afirmação estática do perfil, com uma origem citável (`source`). Ausência no mapa significa `unknown`, não `unsupported`.                                                       | `HarnessDescriptor.declared`       |
| `verified`    | Observação de runtime que confirma uma capacidade, sem alterar o perfil. A descoberta passiva pode confirmar `terminal`, `filesystem` e `git` quando o executável está no PATH. | `HarnessObservation`; `discover`   |
| `operational` | Evidência opt-in de comportamento operacional real. Não há sonda operacional na Fase 1; não a presuma a partir de uma declaração ou de descoberta passiva.                      | `HarnessObservation`; sonda futura |

`resolveEffective` combina perfil e observações; evidência de nível maior prevalece, e conflitos no
mesmo nível são resolvidos conservadoramente a favor de `unsupported`. O modo assistido aceita
`declared`; o autônomo exige `verified`. Um requisito pode pedir nível mínimo `operational`, que
falha fechado enquanto não houver uma sonda que o produza
(`scripts/lib/capabilities/evidence.ts:279-345`; ADR-002:570-571).

### Declaração não é autorização

**Capacidade declarada não é autorização.** O matching de capacidades nunca concede permissão para
selecionar ou encaminhar uma tarefa: só harnesses autorizados podem ser selecionados, e as
permissões permanecem explícitas (ADR-002:348-362). A lista autorizada usa a chave
`authorizedExecutors`, com IDs iguais ao `HarnessDescriptor.id`
(`scripts/lib/capabilities/types.ts:32-43`). A autorização é um filtro separado da resolução de
evidências; `resolveEffective` não a concede nem a verifica
(`scripts/lib/capabilities/evidence.ts:275-283`).

### Como adicionar um harness

O princípio de extensibilidade da ADR-002 exige que adicionar um harness não altere o algoritmo
central de roteamento (ADR-002:87). Siga estes passos:

1. **Descreva apenas capacidades sustentadas por evidência.** Use os nomes fechados em
   `CAPABILITY_NAMES`; cada afirmação deve ter `state` (`supported`, `unsupported` ou `unknown`) e
   `source`. Os três recursos do núcleo continuam obrigatórios para um harness suportado. Para cada
   recurso opcional, preserve um fallback portátil: nenhuma interface ou fluxo pode exigir uma
   capacidade exclusiva de um harness (`scripts/lib/capabilities/types.ts:5-27`; ADR-002:563-565;
   [capacidades obrigatórias](#capacidades-obrigatórias-do-núcleo)).
2. **Crie um perfil declarado.** Adicione um módulo em `scripts/lib/capabilities/profiles/` que
   exporte um `HarnessDescriptor` com `descriptorVersion: 1`, `id` em kebab-case, `kind` (`cli` ou
   `orchestrator`) e o mapa `declared`. Para `kind: "cli"`, informe `command`; não inclua
   observações verificadas ou operacionais no perfil (`scripts/lib/capabilities/types.ts:32-44`).
3. **Inclua-o no catálogo embutido.** Importe o perfil e acrescente-o à lista `embeddedProfiles` em
   `scripts/lib/capabilities/profiles/mod.ts:1-15`. Assim, ele segue o padrão existente de um módulo
   por perfil.
4. **Valide e descubra, sem sondas implícitas.** `CapabilityRegistry.register` chama
   `validateDescriptor`, rejeita descritores inválidos e IDs duplicados; `query` considera apenas os
   descritores registrados que atendem à capacidade e ao nível pedidos
   (`scripts/lib/capabilities/registry.ts:34-82`; `scripts/lib/capabilities/validate.ts:35-45`).
   Para um CLI, `discover` usa `Probe.resolveExecutable` sem iniciar o processo e só promove as
   capacidades do núcleo declaradas como `supported`. A sonda opcional de versão exige solicitação
   explícita e pode ter efeitos colaterais (`scripts/lib/capabilities/discovery.ts:9-48,57-86`).
5. **Autorize separadamente.** Antes que o harness possa ser selecionado pela política de execução,
   inclua seu `id` em `authorizedExecutors` somente se ele estiver autorizado para esse uso. Ter
   perfil válido ou satisfazer um requisito de capacidade não adiciona autorização.

Sem perfil válido registrado, o harness não participa das consultas do Registry e não é
selecionável. Registro válido também não basta: a seleção ainda precisa cumprir as evidências
mínimas exigidas e passar pelo filtro independente de `authorizedExecutors`
(`scripts/lib/capabilities/registry.ts:41-52,66-82`; ADR-002:348-362). A implementação da Fase 1
reaproveita `types.ts`, `validate.ts`, `evidence.ts`, `registry.ts`, `discovery.ts` e `profiles/`;
não exige mudanças no coordinator nem no algoritmo de roteamento.
