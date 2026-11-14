# Planejamento de execução (dry-run)

O CLI `scripts/execution-plan.ts` aplica o planner da Fase 2 a uma issue, sem despachá-la:

```sh
deno run -A scripts/execution-plan.ts --issue 657
deno run -A scripts/execution-plan.ts --issue-json /tmp/issue.json \
  --root /caminho/do/repo --write-log
```

`--issue` lê título, corpo e labels por `gh issue view`; `--issue-json` aceita esses metadados
offline, no formato `{ "number": 657, "title": "...", "body": "...", "labels": ["scripts"] }`
(labels também podem ser objetos `{ "name": "scripts" }`). A configuração é lida de
`.claude/vetor/config.json` e o mapa de módulos de `.claude/vetor/module-test-map.md`, ambos sob
`--root` ou em caminhos explícitos via `--config` e `--module-test-map`. Configuração inválida ou
mapa ausente encerra com erro, sem gravar decisão. `--interactive` afeta apenas a recomendação para
uma preferência indisponível; `--attempt` informa o número da tentativa. `--help` lista as opções.

A saída padrão é JSON com `plan` e `decision`. A descoberta de executáveis é passiva: resolve nomes
no `PATH`, não inicia processos, nem executa sondas de versão ou `--help`. O registro é desligado por
padrão; só `--write-log` acrescenta a decisão ao JSONL local em
`.claude/vetor/status/routing-log.jsonl`.

## Modos da política

O campo `execution.mode` aceita:

| Modo | Como o planner avalia | Significado no CLI |
| --- | --- | --- |
| `manual` | Desliga o roteamento e retorna `inline`. | Sugere manter a execução inline; não escolhe nem despacha executor. |
| `assisted` | Aceita capacidades declaradas (`declared`); autorização e política de sensibilidade continuam obrigatórias. | Recomenda um executor para avaliação humana; não o invoca. |
| `autonomous` | Exige evidência `verified`, além das mesmas regras de autorização e sensibilidade. | Mostra a decisão que o planner tomaria; continua sem dispatch automático. |

Em `assisted` e `autonomous`, configure `authorizedExecutors` com IDs do Capability Registry e
`dataSensitivityPolicy` para cada nível. Uma capacidade declarada não concede autorização.
`delegation.preferredRuntime`, se configurado, é respeitado quando elegível e não é substituído
silenciosamente se estiver indisponível ou inelegível.

## `RejectedBy`

Cada candidato rejeitado pode incluir `rejectedBy`, que identifica o primeiro filtro que o eliminou:

| Valor | Significado |
| --- | --- |
| `authorization` | O executor não consta em `execution.authorizedExecutors`. |
| `dataSensitivity` | O executor não está permitido em `dataSensitivityPolicy` para a sensibilidade da tarefa. |
| `capability` | O executor não suporta uma capacidade obrigatória. |
| `evidence` | A capacidade não alcança o nível mínimo de evidência exigido pelo modo ou requisito. |
| `availability` | A observação mais recente marca o executor como indisponível. `degraded` ainda pode ser elegível. |
| `attempted` | O executor já foi tentado nesta execução. |
| `preference` | Uma preferência explícita aponta para outro executor ou não pode ser atendida sem substituição. |

`rejectedBy` pode estar ausente quando o candidato era elegível, mas ficou fora do limite de
retentativas. Os valores representam filtros e não são uma ordem global de prioridade.

## Sem alteração no comportamento da delegação

Este comando é uma ferramenta de observação independente: roda `planExecution`, imprime a
recomendação e, somente com `--write-log`, persiste a decisão. Ele não chama seletores de runtime,
não envia prompts e não despacha tarefas. O dry-run não é integrado ao coordinator e **não muda o
comportamento atual da delegação**, independentemente do modo configurado.

---

[← Wiki do Vetor](Home.md)
