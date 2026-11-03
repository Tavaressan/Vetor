# Decision Adapter — integração experimental de um modelo de decisão (2026-11-02)

**Pergunta:** consultar um modelo especializado em decisões estruturadas (API Jev / "System One"
do Ollama) melhora algum aspecto concreto do fluxo do Vetor em relação a regras determinísticas em
TypeScript?

**Resposta medida (com `tev1:0.8b`, CPU, 5 GB RAM):** não. A baseline determinística acertou 13 dos
15 cenários em que o modelo é consultado; o modelo acertou 6 (40%), não resolveu nenhum dos dois
casos que a baseline erra e acrescentou ~12 s por chamada. Com o timeout padrão de 2 s, 100% das
chamadas caíram no fallback. **Recomendação:** manter desligado, não integrar às skills; reavaliar só
com um modelo maior (`nimble`) em hardware que o comporte. Detalhes em [Resultados](#resultados).

## Arquitetura do Vetor relevante (Fase A)

- Não existe um processo de runtime de longa duração: o "runtime" são scripts Deno invocados por
  hooks (`hooks/hooks.json`: `PreToolUse`, `PostToolUse`, `SubagentStop`, `SessionStart`,
  `WorktreeCreate`) e por instruções em prosa das skills (`skills/*/SKILL.md`), executadas pelo
  agente principal.
- As decisões "falhou — e agora?" vivem em prosa: `skills/fix/SKILL.md` §3–§4 (orçamento de 5
  iterações, mesma assinatura de erro → nova hipótese, handover humano) e `skills/ship/SKILL.md`
  §8 (circuit breaker de infraestrutura via `scripts/detect-infra-failure.ts`, transiente →
  `gh run rerun`, até 3 fixes).
- Configuração: `.claude/vetor/config.json`, com chaves opt-in lidas de forma tolerante (ex.:
  `hooks.typecheckOnEdit` em `scripts/check-edit.ts`). Não há sistema de métricas nem de logging
  estruturado; scripts escrevem JSON no stdout e diagnóstico no stderr.
- Testes: `deno task test` (`scripts/tests/*_test.ts`, `@std/assert`).

**Ponto de integração escolhido:** um script CLI opt-in (`scripts/classify-failure.ts`), no mesmo
padrão de `detect-infra-failure.ts`. Nenhum hook nem skill foi alterado: editar a prosa das skills
mudaria o comportamento do agente mesmo com o experimento desligado. Se o experimento um dia se
justificar, o ponto natural de consulta é o fix §3.b/§4 e o ship §8.c, chamando o CLI com o
contexto da falha.

## Provedor: contrato verificado

Verificado em 2026-11-02 na documentação oficial
([API](https://docs.ollama.com/api/systemone),
[guia](https://docs.ollama.com/capabilities/decision), release notes da v0.35.0) e contra o Ollama
0.40.7 local:

- `POST /v1/systemone` (Ollama >= 0.35.0), sem autenticação no servidor local.
- Requisição: `{ model, state, questions: { <nome>: { type: "choice", instructions, criteria } } }`.
  Tipos de pergunta: `choice`, `noul` (sim/não), `score`.
- Resposta `choice`: `{ choice, probabilities: {<opção>: número}, confidence }`; probabilidades
  normalizadas sobre as opções enviadas; `confidence = 1 - H(p)/ln(N)`, documentada como **não
  calibrada**.
- Erros `{error}`: 400 modelo/runner não suportado, 404 modelo não encontrado. Verificado
  localmente: modelo ausente → `404 {"error":"model 'nimble' not found"}`; rota inexistente →
  `404 page not found` em texto puro. O adaptador usa essa diferença para separar
  `model_not_found` de `incompatible_endpoint`.
- Modelos de decisão: `nimble` (9B), `tev1`, `tev1:0.8b`, `clef`. Modelos de chat comuns não são
  compatíveis (não verificado como o servidor os recusa; o adaptador trata 400 "unsupported" como
  `incompatible_endpoint`). Não há fallback para `/api/generate`.

## Implementação

| Arquivo | Responsabilidade |
|---|---|
| `scripts/lib/decision-adapter/types.ts` | Contratos: alternativas, `FailureContext`, `DecisionProvider`, `DecisionResult` |
| `scripts/lib/decision-adapter/config.ts` | Chave `decisionAdapter`, defaults, validação do endpoint (só loopback) |
| `scripts/lib/decision-adapter/context.ts` | Validação da entrada, máscara de segredos, `state` limitado a 4 KiB |
| `scripts/lib/decision-adapter/policy.ts` | Alternativas permitidas por contexto e validação da resposta |
| `scripts/lib/decision-adapter/baseline.ts` | Classificação determinística de referência |
| `scripts/lib/decision-adapter/ollama.ts` | Adaptador HTTP para `/v1/systemone` (`fetch` nativo) |
| `scripts/lib/decision-adapter/classifier.ts` | Orquestração: baseline → provedor → validação → política → fallback |
| `scripts/lib/decision-adapter/metrics.ts` | Contadores e latência em memória |
| `scripts/classify-failure.ts` | CLI: `FailureContext` no stdin → `DecisionResult` no stdout |
| `scripts/decision-bench.ts` | Benchmark contra cenários rotulados |
| `scripts/tests/fixtures/decision-adapter/scenarios.json` | 18 cenários com rótulo e justificativa |
| `scripts/tests/decision-adapter_test.ts` | 25 testes unitários, de integração e de regressão |

Nenhuma dependência nova (só `@std/assert`, já usada nos testes). Nenhum arquivo existente alterado.

### Fluxo

1. A baseline é sempre calculada.
2. `allowedAlternatives` aplica as restrições rígidas: aprovação exigida, infraestrutura ou permissão
   → só `request_human_review`; orçamento esgotado → só `request_human_review`; `retry_operation` só
   com `retryable: true`.
3. Experimento desligado, ou só uma alternativa possível → resultado da baseline, **sem chamada de
   rede**.
4. Caso contrário, o provedor recebe apenas as alternativas permitidas. Uma única tentativa,
   limitada por `timeoutMs`; nunca há retry automático.
5. A resposta é validada: `choice` conhecida e permitida; probabilidades presentes, finitas, em
   [0,1], exatamente as chaves enviadas, somando 1 ± 0,01; `choice` é o argmax; `confidence` ≥
   `minimumConfidence` quando configurado.
6. Qualquer falha → fallback (`baseline` ou `request_human_review`) com `fallbackReason`:
   `unavailable`, `network_denied`, `timeout`, `http_error`, `model_not_found`,
   `incompatible_endpoint`, `invalid_json`, `incomplete_response`, `unknown_alternative`,
   `invalid_probabilities`, `policy_rejected`, `low_confidence`.

O módulo só devolve um JSON. Não executa ações, não lê arquivos do projeto além do config e não
grava nada.

### Segurança

- Resposta do modelo tratada como não confiável; só as três alternativas fixas são aceitas.
- Endpoint restrito a `http(s)://localhost|127.0.0.1|[::1][:porta]`, sem credenciais, caminho ou
  query; `redirect: "error"` no `fetch`; resposta limitada a 64 KiB.
- Contexto enviado: só os campos do `FailureContext` (campos extras da entrada são descartados),
  resumo truncado a 1500 caracteres e com padrões de segredo mascarados (`ghp_…`, `sk-…`, `Bearer`,
  `*token*=` etc.). A máscara é uma rede de segurança, não uma garantia.
- Permissões explícitas: o CLI roda com `--allow-read --allow-net=localhost:11434`. Sem
  `--allow-net`, o resultado é o fallback `network_denied`. As permissões globais do projeto não
  foram ampliadas.
- Logs: nada por padrão. Com `debug: true`, métricas e o detalhe do fallback vão para o stderr; o
  prompt nunca é registrado.

## Como habilitar, testar e desativar

Em `.claude/vetor/config.json` do projeto:

```json
{
  "decisionAdapter": {
    "enabled": true,
    "provider": "ollama",
    "endpoint": "http://localhost:11434",
    "model": "nimble",
    "timeoutMs": 2000,
    "minimumConfidence": null,
    "fallback": "baseline",
    "debug": false
  }
}
```

Requisitos: Ollama >= 0.35.0 rodando (`ollama serve`) e um modelo de decisão baixado
(`ollama pull nimble`, ou `tev1:0.8b` em máquinas pequenas).

```sh
# classificar uma falha
echo '{"operation":"test","exitCode":1,"errorCategory":"test_assertion","attempt":1,"maxAttempts":5}' \
  | deno run --allow-read --allow-net=localhost:11434 scripts/classify-failure.ts

# testes automatizados (sem rede externa nem modelo)
deno test -A scripts/tests/decision-adapter_test.ts

# benchmark (sem --model roda só a baseline)
deno run --allow-read --allow-net=localhost:11434 scripts/decision-bench.ts \
  --model tev1:0.8b --runs 3 --timeout 30000
```

**Desativar:** `"enabled": false`, ou remover a chave `decisionAdapter`. Sem a chave, o CLI devolve
a baseline sem abrir conexão (coberto por teste de regressão que roda o CLI sem `--allow-net`).

## Resultados

### Critério de correção (definido antes da execução)

`retry_operation` só quando a operação é explicitamente repetível **e** há evidência de falha
transitória. `request_human_review` quando há aprovação exigida, infraestrutura ou permissão,
orçamento esgotado, ou a mesma assinatura de erro em 3 tentativas seguidas. Nos demais casos (erro
de código ou evidência insuficiente), `inspect_failure`. Os rótulos e a justificativa de cada caso
estão em `scenarios.json`.

**Viés conhecido:** a baseline foi escrita com o mesmo critério, então sua concordância é alta por
construção. O benchmark mede o modelo contra esses rótulos. Os 4 cenários `text-only-*` foram
incluídos de propósito: o sinal está só no texto livre do erro, que a baseline não lê. São os casos
em que um modelo poderia acrescentar algo.

### Ambiente

Ollama 0.40.7, `tev1:0.8b` (833 MB), CPU, 5 GB de RAM, sem GPU. O `nimble` (9B) não cabe nesta
máquina e **não foi avaliado**.

### Números

| | Timeout 2 s (padrão) | Timeout 30 s |
|---|---|---|
| Cenários / execuções por cenário | 18 / 3 | 18 / 3 |
| Resolvidos por regra rígida, sem consultar o modelo | 3 | 3 |
| Chamadas ao modelo | 45 | 45 |
| Respostas válidas e aceitas | 0 | 44 |
| Respostas rejeitadas pela validação ou pela política | 0 | 0 |
| Timeouts → fallback | 45 | 1 |
| Latência média / p50 / p95 | 2002 / 2001 / 2003 ms | 11969 / 11184 / 16446 ms |
| Acerto do modelo nos 15 cenários consultados (dedup., respostas idênticas entre execuções) | — | **6/15** |
| Acerto da baseline nos mesmos 15 | 13/15 | 13/15 |
| Ação final correta (modelo + fallback + regras rígidas) | 48/54 (= baseline) | 28/54 |

Carga inicial (cold start) do `tev1:0.8b`: 16,7 s na primeira chamada. CPU e memória do processo
runner não foram medidos com precisão; nesta máquina a inferência satura a CPU durante ~11 s por
chamada.

### Observações

- **Os casos em que o modelo poderia ajudar** (`text-only-transient` e `text-only-transient-503`,
  sinal transitório só no texto) foram classificados como `inspect_failure`, igual à baseline.
  Nenhum ganho.
- **Erros que a baseline acerta:** o modelo escalou para humano erros de código simples (erro de tipo,
  asserção na primeira tentativa, ausência de evidência) e não escalou o loop travado (mesma
  assinatura 3 vezes). Nos dois casos de CI transitório com `errorCategory: "network"` ou timeout, o
  modelo escolheu `inspect_failure` em vez de `retry_operation`.
- **A confiança não serve de limite:** valores de 0,01 a 0,41, inclusive nas respostas corretas.
  Qualquer `minimumConfidence` útil rejeitaria praticamente tudo. Isso é coerente com a documentação,
  que diz que `confidence` não é calibrada.
- **Saída determinística:** as 3 execuções de cada cenário deram a mesma escolha e a mesma
  confiança. Repetir não acrescenta informação de qualidade.
- **Validação estrutural:** nenhuma resposta inválida em 44. O contrato do endpoint é estável; o
  problema medido é qualidade e latência, não formato.

## Limitações

- Só um modelo pequeno (`tev1:0.8b`) foi avaliado, em CPU. Um modelo maior pode ter outra qualidade
  e outra latência; o resultado não deve ser generalizado para `nimble` ou `clef`.
- 18 cenários sintéticos; amostra pequena para p95/p99 robustos.
- O CLI não está ligado a nenhuma skill: o comportamento do Vetor nos fluxos reais não mudou e não
  foi medido com o modelo.
- `FailureContext.errorCategory`, `retryable` e `requiresApproval` precisariam ser preenchidos pelo
  agente que chama o CLI. Isso não foi especificado nas skills.
- A alternativa barata aos dois casos `text-only-*` é uma regex de padrões transitórios na baseline
  (`Could not resolve host`, `503`, `ECONNRESET`…), no estilo de `detect-infra-failure.ts`. Não foi
  implementada aqui, para não contaminar a comparação.

## Recomendação

**Manter desligado e não ampliar.** Com o modelo que cabe no hardware disponível, a integração piora
a qualidade (6/15 contra 13/15) e acrescenta ~12 s por decisão; com o timeout padrão, é puro custo
(2 s de espera seguidos do fallback). O módulo pode ser **removido** sem impacto, já que nada o
referencia fora dos próprios testes. Se houver interesse em reavaliar, o próximo passo de menor custo
é rodar o mesmo benchmark com `nimble` em hardware com ≥ 16 GB de RAM ou GPU. Só valeria integrar às
skills se o modelo superar a baseline nos cenários `text-only-*` sem regredir os demais, e com
latência p95 abaixo de ~2 s.

## Spikes futuros

- [#556](https://github.com/Tavaressan/Vetor/issues/556) — avaliar `nimble`/`clef` em hardware
  adequado contra a baseline.
- [#557](https://github.com/Tavaressan/Vetor/issues/557) — dataset de falhas reais rotulado pelo
  desfecho.
- [#558](https://github.com/Tavaressan/Vetor/issues/558) — heurística determinística de falha
  transitória a partir do texto do erro.
