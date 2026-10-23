---
id: spec:hook-antigravity-deno
type: spec
project: Vetor
status: draft
created: 2026-10-23
updated: 2026-10-23
---
# Hook do Antigravity em Deno com política de segurança compartilhada

## Summary

Reimplementar o hook `PreToolUse` do Antigravity em Deno e compartilhar a política de segurança existente em `scripts/safety-check.ts`. O hook deve decidir usando o JSON recebido no `stdin`, responder exclusivamente com JSON de decisão no `stdout` e tolerar falhas internas liberando o comando com diagnóstico em `stderr`.

## Context

- O `hooks.json` da raiz registra `PreToolUse` para `run_command` e atualmente chama `node ./scripts/safety-check-antigravity.js` (hooks.json:4-10).
- `scripts/safety-check-antigravity.js` contém a implementação Node atual, lê `toolCall.args.CommandLine` e `toolCall.args.Cwd`, emite decisão JSON e contém política para git destrutivo, branches protegidas e status do worker (scripts/safety-check-antigravity.js:5-19, 29-35, 142-191).
- `scripts/safety-check.ts` já protege contra push a branches protegidas, comandos git destrutivos e push/PR de worker em estado não-GREEN; hoje chama `Deno.exit(2)` ao bloquear e não exporta a política (scripts/safety-check.ts:8-10, 90-92, 138-200, 267-292).
- O hook do Claude Code chama esse arquivo Deno via `deno run -A` (hooks/hooks.json:3-10). Assim, a extração de política compartilhada precisa preservar o contrato de bloqueio do Claude Code e oferecer ao Antigravity uma decisão sem encerrar o processo.
- `scripts/safety-check.sh` é somente um adaptador para o runner Node (scripts/safety-check.sh:1-8); a decisão de removê-lo, mantê-lo ou alterar seu propósito está pendente.
- A suíte Node atual cobre, entre outros cenários, o payload oficial, os bloqueios de git, estados RUNNING/GREEN com `Cwd` informado e execução do processo fora do repositório (cli/test/safety-check-antigravity.test.js:34-45, 48-105, 158-232). O escopo da issue determina migrá-la para `scripts/tests/` em Deno.
- A wiki ainda descreve o runner Node e a cobertura Antigravity (wiki/Compatibilidade-Antigravity.md:46-57; wiki/Hooks.md:10). O README declara Deno como runtime essencial e não menciona Node como pré-requisito (README.md:70-80).
- A cópia espelho `opencode/scripts/safety-check.ts` também menciona o runner Antigravity em seu comentário inicial (opencode/scripts/safety-check.ts:1-9). A issue relacionada #477 remove as cópias OpenCode, inclusive esse espelho; essa dependência deve ser coordenada.
- A documentação oficial descreve a entrada de `PreToolUse` em JSON no `stdin`, incluindo `toolCall.args`, e a resposta em JSON no `stdout`, com `decision` obrigatório, `reason` opcional e `deny` como bloqueio imediato. O exemplo `run_command` inclui `CommandLine` e `Cwd`. Consulta em 2026-10-23: https://www.antigravity.google/docs/hooks
- A documentação consultada não especifica de qual diretório é resolvido o caminho relativo do comando configurado em `hooks.json`. O resultado observado precisa ser confirmado no Antigravity real no host Windows.

## Goals

- Remover a dependência de Node do hook Antigravity e consolidar a política de segurança numa implementação usada pelo Claude Code e pelo Antigravity.
- Preservar o contrato do Antigravity, seus cenários de política atuais e a tolerância a entrada inválida/erro interno.
- Validar a resolução real do caminho relativo no `hooks.json` através de instalação e execução no Antigravity em Windows.

## Non-Goals

- Alterar as políticas de escrita/worktree específicas de outros eventos do Claude Code ou adicionar controles que o matcher `run_command` do Antigravity não consegue observar.
- Remover ou modificar as cópias OpenCode que são escopo da issue #477; a integração entre as issues deve ser coordenada.
- Alterar a política de permissões nativa do Antigravity ou o comportamento dos comandos permitidos pelo próprio harness.

## Users / Personas

- Usuário do plugin Vetor no Antigravity que espera executar comandos comuns e bloquear comandos cobertos pelo safety gate.
- Mantenedor do Vetor que precisa manter uma política comum entre hooks e verificar a instalação em ambiente Windows real.

## Functional Requirements

### RF-01 - Política de segurança compartilhada

**Priority:** Must

**Description:** A política comum deve avaliar comando e contexto e devolver uma decisão consumível pelo hook, sem finalizar diretamente o processo. Claude Code e Antigravity devem usar essa política para comandos de shell. O contrato de bloqueio existente do Claude Code deve continuar atendido.

**Acceptance Criteria:**

- [ ] Os testes confirmam que as verificações de push para `main`, `master` e `production`, git destrutivo e gate de worker não-GREEN são executadas pela política compartilhada.
- [ ] Os testes confirmam que o hook do Claude Code continua bloqueando com o código de saída esperado para o contrato atual após consumir a decisão compartilhada.
- [ ] Uma busca no código confirma que não há uma segunda implementação independente dessas três regras no ponto de entrada Antigravity.

**Happy Path:**

1. O hook recebe o comando e o contexto do harness.
2. A política avalia as regras compartilhadas.
3. O adaptador do harness traduz a decisão para o contrato correspondente.

**Alternative Flows:**

- Se nenhuma regra bloquear o comando, a decisão é permitir.
- ⚠️ ABERTO: definir durante implementação o comportamento da política para contexto insuficiente de worktree, preservando o comportamento atual documentado nos testes.

### RF-02 - Contrato de entrada e saída do Antigravity

**Priority:** Must

**Description:** O entrypoint Antigravity lê o evento JSON do `stdin`, obtém o comando de `toolCall.args.CommandLine` e o diretório de trabalho de `toolCall.args.Cwd`, e escreve no `stdout` a decisão JSON reconhecida pelo Antigravity. A resposta de bloqueio contém `reason`; ambas as decisões terminam com código 0.

**Acceptance Criteria:**

- [ ] Testes Deno enviam JSON com `toolCall.args.CommandLine` e `toolCall.args.Cwd` pelo `stdin` e validam a decisão parseada no `stdout`.
- [ ] Para permitir, o `stdout` contém `{"decision":"allow"}`; para negar, contém `{"decision":"deny","reason":"..."}` com motivo não vazio; o processo retorna código 0 nos dois casos.
- [ ] O `stdout` contém somente a resposta JSON do hook; mensagens diagnósticas são escritas em `stderr`.
- [ ] O caminho de comando em `hooks.json` da raiz invoca Deno e não requer Node.

**Happy Path:**

1. O hook recebe JSON válido de `run_command`.
2. Avalia `CommandLine` usando `Cwd` como contexto.
3. Emite allow ou deny em JSON e termina com código 0.

**Alternative Flows:**

- Se não houver campo de comando reconhecido, liberar com código 0.

### RF-03 - Falha aberta com diagnóstico

**Priority:** Must

**Description:** JSON inválido ou erro interno inesperado não deve travar a execução do agente; o hook libera e registra o diagnóstico em `stderr`.

**Acceptance Criteria:**

- [ ] O teste Deno de JSON inválido verifica código 0, JSON `allow` no `stdout` e diagnóstico no `stderr`.
- [ ] Um teste de falha interna verificável confirma o mesmo resultado de liberação e logging em `stderr`.

### RF-04 - Migração da suíte de testes e documentação

**Priority:** Must

**Description:** Migrar os casos do teste Node atual para testes Deno em `scripts/tests/`, manter cenários de payload e contexto relevantes, atualizar a configuração e documentação e remover o runner Node dedicado.

**Acceptance Criteria:**

- [ ] Testes Deno cobrem comando comum liberado, push para branch protegida, git destrutivo, worker RUNNING bloqueado com `toolCall.args.Cwd` enquanto o processo roda fora do repositório, worker GREEN liberado e JSON inválido com allow.
- [ ] `deno task test` e `npm test` do CLI concluem com sucesso.
- [ ] `scripts/safety-check-antigravity.js` é removido e nenhuma configuração/documentação ativa ainda o invoca.
- [ ] `wiki/Compatibilidade-Antigravity.md` e `wiki/Hooks.md` descrevem o hook Deno e seus limites atualizados.
- [ ] Comentários de espelho em `scripts/safety-check.ts` são atualizados; comentário em `opencode/scripts/safety-check.ts` é coordenado com #477.
- [ ] O destino de `scripts/safety-check.sh` é decidido e refletido de forma consistente em configuração, documentação e testes: o arquivo é removido (ver Decisions).

## Non-Functional Requirements

### RNF-01 - Execução multiplataforma sem Node

**Priority:** Must

**Description:** O hook Antigravity deve executar com o runtime Deno declarado como pré-requisito do Vetor e não depender do runtime Node.

**Acceptance Criteria:**

- [ ] Inspeção de `hooks.json` confirma chamada Deno para o hook.
- [ ] Testes e verificação de instalação confirmam que o hook funciona sem invocar `node`.
- [ ] `deno task test` e `npm test` do CLI concluem com sucesso.

### RNF-02 - Compatibilidade real no host Windows

**Priority:** Must

**Description:** A instalação global por `agy plugin install` em Windows deve carregar e executar o hook Antigravity. A checagem deve ocorrer no host pelo coordenador, não ser substituída por simulação local.

**Acceptance Criteria:**

- [ ] No Antigravity real instalado no Windows via `agy plugin install`, um `run_command` comum é executado e não é bloqueado pelo hook.
- [ ] O registro da checagem inclui versão do Antigravity/`agy`, sistema Windows e sua versão, comando utilizado, resultado observado, caminho absoluto do plugin instalado, diretório de trabalho do teste e se o hook foi carregado/executado.
- [ ] O registro identifica de qual diretório o Antigravity resolveu o caminho relativo definido em `hooks.json`, ou registra explicitamente que o resultado permanece inconclusivo, com evidência observada.

## Behavior / States

- Comando permitido: `allow` em JSON e exit code 0.
- Comando bloqueado por política: `deny` com motivo em JSON e exit code 0.
- Entrada JSON inválida ou falha interna: `allow`, diagnóstico em `stderr` e exit code 0.
- O uso de `toolCall.args.Cwd` deve permitir resolver o worktree e consultar o estado do worker mesmo quando o processo do hook foi iniciado fora do repositório.

## Data

- Entrada: objeto de evento Antigravity JSON em `stdin`; campos utilizados: `toolCall.name`, `toolCall.args.CommandLine`, `toolCall.args.Cwd`.
- Saída: objeto JSON com `decision`; `reason` presente para decisão `deny`.
- ⚠️ ABERTO: comportamento para payload JSON válido cujo formato/tipos não contenham os campos esperados deve ser confirmado e documentado pelos testes.

## Integrations / Dependencies

- Deno runtime, `git` para detectar repositório/worktree e arquivos de status do Vetor para o gate não-GREEN.
- Antigravity `PreToolUse` e instalação do plugin por `agy plugin install`.
- Claude Code continua integrado por `hooks/hooks.json` e precisa preservar sua semântica de bloqueio.
- Issue #477 remove cópias OpenCode, incluindo `opencode/scripts/safety-check.ts`; coordenar comentários espelhados e ordem da migração para evitar referência obsoleta ou cópia conflitante.

## Edge Cases

- **JSON inválido:** permitir, registrar diagnóstico em `stderr` e retornar código 0.
- **Processo iniciado fora do repositório, com Cwd dentro de worktree:** aplicar o gate usando o `Cwd` do payload; RUNNING deve negar e GREEN deve permitir.
- **Erro interno ao avaliar política:** permitir e registrar erro em `stderr`, sem emitir diagnóstico no `stdout` junto do JSON.
- **Caminho relativo do comando de hook:** a documentação não determina o diretório-base; o teste real no Windows deve identificar o diretório observado ou registrar inconclusividade. ⚠️ ABERTO: confirmação do mantenedor/coordenador no host.

## Error Handling

Falhas na leitura/parsing da entrada ou durante a avaliação devem seguir fail-open para o Antigravity, produzir diagnóstico em `stderr` e emitir JSON `allow` válido no `stdout`. A política compartilhada não deve encerrar o processo do adaptador Antigravity.

## Security / Privacy

A decisão `deny` impede execução do comando antes da ferramenta prosseguir. A política cobre somente comandos de `run_command` configurados no matcher; não oferece ao Antigravity o guard de escrita de arquivo que o Claude Code pode aplicar. Os logs de falha omitem o payload e o comando (ver Decisions).

## Rollout

Atualizar o hook de raiz e documentação junto da remoção do runner Node. Validar testes automatizados e executar a instalação real no host Windows com `agy plugin install`; registrar os dados listados em RNF-02 antes de considerar a verificação de compatibilidade concluída. O registro vai na PR do #476 (ver Decisions).

## Open Questions

> Todas as perguntas abaixo foram decididas pelo mantenedor em 2026-10-23, seguindo a recomendação de cada uma; ver `## Decisions`.

- **Qual deve ser o destino de `scripts/safety-check.sh`**, atualmente adaptador exclusivo para o runner Node? Fato (`git grep` em 2026-10-23): nenhum manifesto, script ou página da wiki o invoca; só documentos de `docs/proposals/` o citam. Recomendação: removê-lo se não houver consumidores identificados; caso seja contrato usado externamente, convertê-lo em adaptador documentado para Deno e adicionar cobertura própria.
- **Qual deve ser a resposta para payload JSON válido sem `CommandLine` string ou sem `Cwd`?** Recomendação: permitir comandos sem `CommandLine` e usar o diretório de execução do processo como fallback para `Cwd`, preservando fail-open e testando ambos.
- **Onde o coordenador registrará o resultado do teste real no host Windows?** Recomendação: anexar versão do Antigravity/`agy`, OS, comando, diretório do plugin, diretório-base resolvido e evidência de execução ao registro da issue/entrega #476.
- **Como coordenar o comentário espelhado em `opencode/scripts/safety-check.ts` com #477?** Recomendação: remover a referência no âmbito de #477, evitando uma edição temporária em cópia que será apagada.
- **Quais limites de logging aplicar ao `stderr` em caso de erro?** Recomendação: registrar classe/mensagem do erro sem despejar o JSON bruto nem valores de comandos que possam conter dados sensíveis.
- **A documentação oficial deve ser tratada como evidência suficiente do esquema no runtime CLI/IDE usado no host?** Recomendação: registrar qual Antigravity foi testado e reportar diferenças observadas; a documentação acessada cobre o contrato PreToolUse, mas não o diretório-base do comando relativo.

## Decisions

- Reimplementar o hook Antigravity em Deno foi decisão do mantenedor em 2026-10-22.
- A política passa a ter uma implementação reutilizável, consumida pelos hooks do Claude Code e Antigravity; a interface deve devolver decisão ao invés de encerrar o processo.
- O contrato Antigravity mantém JSON no `stdin` com `toolCall.args.CommandLine` e `toolCall.args.Cwd`; saída JSON `allow` ou `deny` com `reason` para bloqueio, sempre com código 0.
- Falhas internas e JSON inválido seguem fail-open com diagnóstico em `stderr`.
- A verificação de caminho relativo de `hooks.json` será empírica no Antigravity real em Windows porque a documentação oficial consultada não informa o diretório-base.

Decididas pelo mantenedor em 2026-10-23 (Open Questions):

- `scripts/safety-check.sh` é removido, por não ter consumidor.
- Payload JSON válido sem `CommandLine` string resulta em `allow`; sem `Cwd`, usa-se o diretório do processo do hook; os dois casos têm teste.
- O resultado do teste real no host Windows é registrado na PR do #476: versão do Antigravity/`agy`, sistema, comando, diretório do plugin, diretório-base resolvido e evidência de execução.
- O comentário de espelho em `opencode/scripts/safety-check.ts` fica para o #477, que remove a cópia.
- Logs em `stderr` trazem a classe e a mensagem do erro, sem o JSON bruto nem o comando.
- Registrar a versão do Antigravity testada e as diferenças observadas em relação à documentação.

## References

- `templates/spec.md` — estrutura desta Spec.
- `skills/spec/SKILL.md` §5.1–5.6 — convenções de Decisions, IDs, prioridade, critérios e seções.
- `hooks.json`; `hooks/hooks.json`.
- `scripts/safety-check.ts`; `scripts/safety-check-antigravity.js`; `scripts/safety-check.sh`.
- `cli/test/safety-check-antigravity.test.js`.
- `wiki/Compatibilidade-Antigravity.md`; `wiki/Hooks.md`; `README.md`.
- Issue #476 e issue relacionada #477.
- Google Antigravity Docs, Hooks: https://www.antigravity.google/docs/hooks (consultada em 2026-10-23). Entrada PreToolUse por `stdin`, saída por `stdout` e decisão `allow`/`deny` confirmadas; diretório de resolução de caminho relativo do comando em `hooks.json` não especificado na documentação consultada.

## Revision History

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-23 | Codex (via Alethe) | rascunho inicial gerado por /vetor:spec |
| 2026-10-23 | Claude Code (coordinator) | revisão: correções factuais e decisões do mantenedor nas Open Questions |

- Relacionado: proposals/multi-harness-deduplication.md
