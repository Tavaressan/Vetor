Status: **decidido em 2026-10-15** — dois tiers; escalação só no Claude Code e no OpenCode; spike #337 encerrado

# Estratégia de escalação de modelo por harness (Issue #337)

## Decisão (2026-10-15)

- **Recomendação aprovada:** contrato `simple`/`complex`, sem tier `max`.
  - O Claude Code já cumpre: `haiku`/`sonnet` e um redespacho com `sonnet` ao esgotar as iterações.
  - Issues de implementação:
    - **#395:** OpenCode escala para `complex` após `FAILED_MAX_ITERATIONS` e tira o `model:` fixo dos agentes.
    - **#396:** Cursor instala `model: inherit`; Codex fica documentado.
    - **#397:** Antigravity passa a ter agentes em Markdown nativo.
- **Correção da hipótese (c): verificada** para o caminho que o Vetor usa, `opencode run --agent ... --model ...`.
  - Fonte: código do OpenCode na tag `v1.19.0`, `packages/opencode/src/session/prompt.ts:646` → `input.model ?? ag.model ?? currentModel(...)`.
  - Evidência empírica: no E2E de 2026-10-15, um worker com `anthropic/claude-haiku-4-5` no frontmatter rodou com `--model opencode/deepseek-v4.1-flash-free`.
  - No Task tool, o subagente usa o próprio `model:` ou herda o do pai (`packages/opencode/src/tool/task.ts:181`), mas o dispatch do Vetor não passa por ele.
  - A nota sobre o erro `EEXIST` na tabela abaixo está obsoleta: o opencode 1.19.0 roda nesta máquina.

Consulta às fontes oficiais: 2026-10-15. Esta proposta toma como ponto de partida a tabela de documentação registrada na issue em 2026-09-29 e atualiza/qualifica fatos que foram possíveis de verificar nesta investigação.

## Decisão recomendada

Adotar um contrato comum com dois tiers semânticos: `simple` e `complex`. Não adicionar um terceiro tier (`max`/`opus`) agora: nenhuma regra do fluxo atual define quando esse nível deve ser escolhido, e ele ampliaria configuração e manutenção entre harnesses sem benefício demonstrado.

Separar intenção comum de configuração nativa. O dispatch classifica `simple`/`complex` e aplica a regra de segunda tentativa após esgotamento. A configuração de mapeamento por harness reside no próprio formato/configuração nativo daquele harness; não transformar `.claude/vetor/config.json` em configuração global de instalação, pois o OpenCode já o lê por compatibilidade, mas Codex, Cursor e Antigravity não o consomem como contrato nativo. No OpenCode, manter `modelFallback` por enquanto, com migração futura para configuração OpenCode própria como decisão separada.

Recomendação de escopo: implementar escalação efetiva só em Claude Code e OpenCode. Codex, Cursor e Antigravity usam `inherit` na primeira entrega e documentam a limitação; não simular precisão onde o harness não oferece ou não distribui o controle de modo confiável. Não alterar nesta issue.

## Mapeamento por harness

| Harness | Tier → formato nativo recomendado | Limites / observações |
|---|---|---|
| Claude Code | `simple` → `haiku`; `complex` e retry → `sonnet`, no parâmetro `model` de `Agent()` | Aliases oficiais aceitos; override por invocação já corresponde ao fluxo existente. IDs fixos não são necessários para a intenção do Vetor. |
| OpenCode | `simple`/`complex` → listas configuráveis `modelFallback.<tier>` resolvidas para provider/model; retry por exaustão escolhe `complex`; passar sempre `--model` no dispatch | A CLI documenta `--model` e prioridade na escolha do modelo da sessão, mas a precedência contra frontmatter depende do modo de chamada/agente. O teste de fonte e help local foi bloqueado pelo erro de inicialização abaixo; usar `--model` é recomendação conservadora, não resultado de execução local. Manter os workers `mode: primary` por compatibilidade intencional #314. |
| Codex | Ambos os tiers → `inherit` (omitir `model`); retry pode elevar `model_reasoning_effort` apenas se uma futura configuração validada definir níveis suportados | O formato `codex.toml` atual declara `medium`. A documentação permite `model`/`model_reasoning_effort` por spawn e defaults em `[agents]`, mas escalar esforço não equivale universalmente a trocar modelo. Primeira versão não altera modelo/esforço automaticamente. |
| Cursor | Ambos → `inherit`; usar ID específico só por configuração explícita do usuário | Documentação de subagents lista `inherit` e IDs; aliases Claude não são IDs Cursor documentados. Restrições de plano/admin podem trocar o modelo efetivo. |
| Antigravity | Ambos → `inherit`; variantes estáticas `flash`/`pro` somente se adotadas futuramente em agente Markdown nativo | Não escala dinamicamente por despacho. O instalador atual não instala destino Antigravity; investigação/port do instalador deve preceder configuração. `agent.json` deste repo não é o formato documentado para custom subagents. |

## Hipóteses e evidências

| Hipótese | Estado | Evidência |
|---|---|---|
| (a) Cursor trata `model: haiku` como desconhecido | **Não verificável** | A documentação oficial consultada enumera `inherit` e ID específico (com exemplos de IDs Cursor), sem especificar comportamento para alias Claude desconhecido; não se inferiu rejeição silenciosa. URL: https://cursor.com/docs/subagents — consultada em 2026-10-15. Verificação local não disponível: `cursor-agent --help` falhou porque `cursor-agent` não foi reconhecido pelo PowerShell. |
| (b) `agent.json` do repo é aceito pelo Antigravity (`agy plugin validate`) | **Refutada para o artefato verificado** | Comando `agy plugin validate` → `✔ skills: 13 processed`, `✔ hooks: 1 processed`, `agents: skipped (not found)`. Isto não valida os `agent.json` como agentes Antigravity. A documentação oficial descreve arquivos `.md` com YAML frontmatter, em locais de descoberta próprios. URL: https://antigravity.google/docs/cli/subagents — consultada em 2026-10-15. |
| (c) `opencode run --model` sobrescreve frontmatter `model:` | **Verificada em documentação para seleção do modelo da sessão; não provada para tarefa de subagente** | Docs oficiais do CLI descrevem `--model` como modelo da execução; docs de modelos declaram precedência de `--model` na seleção do modelo para execução. Não há evidência direta de que propague/sobrescreva o modelo estático de um agente filho invocado por Task. URL: https://dev.opencode.ai/docs/cli/ e https://dev.opencode.ai/v2/docs/models/ — consultadas em 2026-10-15. Inspeção local tentativa: `opencode --version`, `opencode agent list` e `opencode run --help` encerraram com `EEXIST: file already exists, mkdir 'C:\Users\vitor\.config\opencode'`; sem execução paga realizada. |

### Tabela documental oficial fornecida pela issue (#337, consulta 2026-09-29)

| Harness | Valores de `model` | Trocar por despacho | Fonte |
|---|---|---|---|
| Claude Code | aliases (`sonnet`, `opus`, `haiku`, `fable`), IDs, `inherit` | Sim; parâmetro por invocação tem maior precedência | https://code.claude.com/docs/en/sub-agents |
| OpenCode | `provider/model-id`; subagente herda o do primário | `opencode run --model/-m` documentado; precedência sobre `model:` do agente e override no Task não documentados na data da issue | https://opencode.ai/docs/agents/ , https://opencode.ai/docs/cli/ |
| Codex | `model` e `model_reasoning_effort` opcionais; sem `model`, herda do pai | Sim, valor explícito no spawn (ordem: spawn, `[agents]`, pai) | https://learn.chatgpt.com/docs/agent-configuration/subagents |
| Cursor | `inherit` ou ID específico; não cita aliases Claude | Não documentado | https://cursor.com/docs/subagents |
| Antigravity | `inherit`, `flash` ou `pro`, estático no frontmatter | Não | https://antigravity.google/docs/subagents/ |

Fontes atuais adicionais: Claude Code https://code.claude.com/docs/en/sub-agents; OpenCode https://docs.opencode.ai/docs/agents/, https://dev.opencode.ai/docs/cli/, https://dev.opencode.ai/v2/docs/models/; Codex https://learn.chatgpt.com/docs/agent-configuration/subagents; Cursor https://cursor.com/docs/subagents; Antigravity https://antigravity.google/docs/cli/subagents. Todas consultadas em 2026-10-15.

## IDs pinados

Não há evidência no repositório de que `claude-sonnet-4-5`, `claude-sonnet-5` e `claude-haiku-4-5` sejam pins intencionais: aparecem em fallback, frontmatter e testes por uso explícito, sem comentário de política de pin. **Fato (fonte oficial, consultada em 2026-10-15 — https://platform.claude.com/docs/en/about-claude/models/overview):** os modelos atuais são Claude Fable 5.1 (`claude-fable-5-1`), Opus 5.5 (`claude-opus-5-5`), Sonnet 5.5 (`claude-sonnet-5-5`) e Haiku 5.5 (`claude-haiku-5-5`); `claude-sonnet-5` e `claude-haiku-4-5` aparecem como *legacy (still available)*, e Sonnet 4.5 nem consta da lista de legados da página (ver https://platform.claude.com/docs/en/about-claude/model-deprecations). Recomendação: manter os IDs sob controle do usuário via config e, numa issue de implementação própria, atualizar os defaults/exemplos para os IDs atuais — no OpenCode, usando o formato `provider/model-id` que o provider configurado realmente expõe (ex.: via OpenRouter os IDs têm outro formato), confirmado com `opencode models`. *(Correção da revisão: uma versão anterior deste rascunho afirmava, com base numa leitura incorreta da página de deprecações, que os ativos eram `claude-fable-5`/`claude-opus-5`/`claude-sonnet-5`/`claude-haiku-4-5`.)*

## Issues derivadas propostas (não criadas)

1. **feat(compat): alinhar escalação de tier no Claude Code e OpenCode** — Implementar contrato `simple`/`complex`, retry para `complex` e resolver/configurar modelo nativo; conservar fallback por saúde OpenCode sem confundi-lo com retry por exaustão. **Aceite:** dispatch Claude usa alias do tier; OpenCode seleciona `modelFallback` e fornece `--model` explícito; exaustão redespacha uma vez no tier complexo; teste sem chamada ao provedor cobre escolha dos argumentos.
2. **docs(compat): documentar tiers herdados em Codex** — Definir `inherit` para ambos os tiers e explicitar que escalação por esforço/modelo está fora da primeira versão. **Aceite:** agentes Codex não fixam um esforço artificialmente variável e a documentação comunica o comportamento e eventual configuração explícita do usuário.
3. **docs(compat): documentar tiers herdados em Cursor** — Garantir `inherit` em frontmatter dos subagents quando instalado e documentar que alias Claude não é válido como contrato. **Aceite:** arquivos instalados contêm `model: inherit`; documentação explica limites de plano/admin e IDs opt-in.
4. **feat(compat): instalar agentes Antigravity em Markdown nativo** — Verificar e adotar layout documentado `.md`, deixando `inherit` nos agentes padrão; suporte a `flash`/`pro` fica estático e opt-in. **Aceite:** `agy plugin validate` processa os agentes gerados e a instalação possui âncora/destino explícito, sem tratar `agent.json` como entrada válida.

## Verificação local pendente

Para repetir em ambiente com binários/configuração funcionais, o mantenedor deve executar sem prompt: `opencode --version`, `opencode agent list`, `opencode run --help`, `cursor-agent --help`, `agy plugin validate`. Para confirmar especificamente a precedência subagent OpenCode sem custo, inspecionar o código-fonte/documentação do caminho `Task` na versão instalada; não executar prompt de modelo.
