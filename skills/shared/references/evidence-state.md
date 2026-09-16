# Evidence State — modelo core

Referência compartilhada de rastreabilidade epistemológica: o Vetor distingue explicitamente o que
foi confirmado, o que foi inferido, o que foi assumido e o que permanece sem resposta. Origem:
issue #205 (§1-6, §12-14, §17-18); §7-11 (Discovery, Specs, ADR, Knowledge Provider, Guardian) e
§15-16 (Interaction Policy, Headless Mode) ficam para issues futuras que integrem este modelo a
artefatos que ainda não existem no Vetor.

Princípio central: **o Vetor deve saber não apenas o que está escrito, mas qual é a base para
acreditar que aquilo é verdade.**

## 1 — Os 4 estados

```text
┌─────────────┐
│  CONFIRMED  │ ← código/documento/fonte verificável
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   INFERRED  │ ← conclusão derivada da evidência
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   ASSUMED   │ ← premissa necessária
└──────┬──────┘
       │
       ▼
┌───────────────┐
│ OPEN_QUESTION │ ← informação ainda não determinada
└───────────────┘
```

O diagrama representa o fluxo epistemológico comum, **não** uma máquina de estados rígida nem uma
sequência obrigatória. Uma informação pode nascer diretamente `CONFIRMED`, ou permanecer indefinidamente
`OPEN_QUESTION`. Uma inferência pode mais tarde ser confirmada ou invalidada.

### CONFIRMED

Informação sustentada diretamente por uma fonte verificável.

```text
CONFIRMED:
O serviço utiliza RabbitMQ.

Evidence:
src/messaging/rabbitmq.ts
```

### INFERRED

Conclusão derivada de uma ou mais evidências, mas não declarada explicitamente pela fonte. Uma
inferência não deve ser apresentada como fato confirmado.

```text
INFERRED:
RabbitMQ provavelmente é utilizado para processamento assíncrono.

Evidence:
- RabbitMQ client configurado
- consumers registrados
- retry queue existente
```

### ASSUMED

Premissa adotada para permitir o progresso quando a informação necessária não está disponível.
Assumptions relevantes devem aparecer no resultado final entregue ao usuário.

```text
ASSUMED:
A nova funcionalidade deve reutilizar o mecanismo atual de autenticação.

Reason:
Não existe indicação de que a feature deva introduzir um novo mecanismo.

Impact:
A decisão poderá precisar ser revisada caso o requisito seja diferente.
```

### OPEN_QUESTION

Informação necessária ou relevante que ainda não foi determinada. Uma Open Question não deve ser
silenciosamente convertida em assumption quando a decisão for crítica.

```text
OPEN_QUESTION:
Qual deve ser o timeout máximo da operação?

Impact:
Não é possível definir o RNF de performance sem essa informação.
```

## 2 — Evidence Record (formato yaml)

O conjunto de campos é **assimétrico por estado** — nem todo campo se aplica a todo estado.

**CONFIRMED** (`evidence` + `confidence`, sem `reason`/`impact`):

```yaml
state: confirmed
claim: "O sistema utiliza RabbitMQ para comunicação assíncrona."
evidence:
  - type: code
    source: "src/messaging/rabbitmq.ts"
confidence: high
```

**INFERRED** (mesma forma de `CONFIRMED`, tipicamente com múltiplas evidências combinadas):

```yaml
state: inferred
claim: "RabbitMQ é utilizado para processamento assíncrono."
evidence:
  - type: code
    source: "src/messaging/rabbitmq.ts"
  - type: configuration
    source: "config/messaging.yaml"
confidence: medium
```

**ASSUMED** (`reason` + `confidence`, **sem** `evidence` — não há fonte a apontar):

```yaml
state: assumed
claim: "A nova feature deve reutilizar o mecanismo de autenticação existente."
reason: "Nenhum requisito indica substituição do mecanismo atual."
confidence: low
```

**OPEN_QUESTION** (`impact` apenas — **sem** `evidence` e **sem** `confidence`, pois não há
evidência nem grau de confiança a atribuir a algo ainda não determinado):

```yaml
state: open_question
claim: "Qual é o timeout máximo aceitável?"
impact: "Afeta o requisito de performance."
```

O formato definitivo, quando persistido, deve seguir os padrões de configuração já existentes do
Vetor (ex.: convenções de `.claude/vetor/config.json`) — esta referência define a forma conceitual,
não um schema validado.

## 3 — Evidence Source

Sempre que possível, uma evidência deve possuir uma origem identificável (`type` + `source`). Tipos
possíveis:

```text
code
documentation
spec
adr
configuration
user
external
tool
test
```

```yaml
evidence:
  type: code
  source: "src/auth/session.ts"
```

```yaml
evidence:
  type: user
  source: "user instruction"
```

Não exigir `source` para informações explicitamente fornecidas pelo usuário quando não houver outro
artefato para apontar.

Os tipos `spec` e `adr` fazem parte deste vocabulário mesmo antes de existir integração formal do
Evidence State com Specs ou ADRs no Vetor (essa integração é trabalho futuro — ver cabeçalho desta
referência).

## 4 — Confidence é separado do estado

`confidence` não substitui o Evidence State — ele qualifica a força da evidência disponível **dentro**
de um estado:

```text
CONFIRMED + HIGH
INFERRED + MEDIUM
ASSUMED + LOW
```

`CONFIRMED` significa que existe evidência direta; `confidence` representa a força ou qualidade
dessa evidência.

Usar categorias, nunca percentual sem metodologia que o justifique:

```text
high
medium
low
```

Evitar:

```text
confidence: 87%
```

`OPEN_QUESTION` não carrega `confidence` — não há evidência disponível para qualificar.

## 5 — Regra fundamental: proibição de auto-promoção

O Vetor **nunca** deve elevar automaticamente:

```text
INFERRED → CONFIRMED
ASSUMED  → CONFIRMED
```

sem nova evidência.

Exemplo incorreto:

```text
Code appears to use RabbitMQ.

↓

RabbitMQ is the official messaging architecture.
```

A segunda afirmação exige evidência adicional de um tipo qualificado (§3) — ex.: ADR, documentação,
requisito ou decisão explícita do usuário — antes de poder virar `CONFIRMED`.

## 6 — Evidence Conflict

Conflito entre duas evidências `CONFIRMED` que se contradizem.

```text
CONFIRMED A:
docs/architecture.md → PostgreSQL

CONFIRMED B:
docker-compose.yml → MongoDB
```

Resultado:

```text
EVIDENCE CONFLICT
```

Diante de um conflito, o Vetor deve:

1. identificar o conflito;
2. apresentar as fontes de ambos os lados;
3. evitar escolher arbitrariamente uma delas;
4. solicitar resolução quando uma decisão for necessária.

## 7 — Staleness

Evidência potencialmente desatualizada: sinalizada, nunca invalidada automaticamente.

```text
CONFIRMED
Source:
docs/architecture.md

Last updated:
2025-03-10

Code changed:
2026-09-15
```

Resultado:

```text
POSSIBLY STALE EVIDENCE
```

A documentação não é descartada só por existir um código mais recente — apenas sinalizada para
revisão quando houver evidência de alteração posterior à fonte original.

## 8 — Sinalização proporcional (quando marcar o estado)

O Vetor não marca epistemicamente cada frase produzida. A sinalização deve ocorrer quando a
distinção puder afetar: implementação, arquitetura, segurança, dados, comportamento, requisitos,
decisões irreversíveis, custo de mudança, validação ou entendimento do projeto.

```text
A autenticação atual utiliza JWT. [CONFIRMED]

A sessão parece ser validada pelo gateway. [INFERRED]

Vou assumir que a nova API seguirá o mesmo mecanismo. [ASSUMED]
```

Não transformar a resposta inteira em um relatório epistemológico.

## 9 — Traceability (conceitual, sem implementação exigida)

O modelo deve permitir, no futuro, encadear evidência até código e teste:

```text
Evidence
   │
   ▼
Claim
   │
   ▼
Requirement
   │
   ▼
Decision
   │
   ▼
Task
   │
   ▼
Code
   │
   ▼
Test
```

Não é necessário implementar essa cadeia nesta referência — o modelo apenas não deve tomar decisões
que impeçam essa evolução (ex.: descartar a origem de uma evidência, ou não deixar `claim` e
`evidence` endereçáveis individualmente).

## 10 — Diretriz para agentes

```text
Evidence Discipline

Before making a consequential claim about a project, prefer
direct evidence from the repository, documentation, configuration,
tests or explicit user instructions.

Distinguish:
- CONFIRMED: directly supported by evidence;
- INFERRED: derived from evidence;
- ASSUMED: adopted as a premise;
- OPEN QUESTION: unresolved information.

Do not present inference or assumption as confirmed fact.

When uncertainty materially affects implementation or architecture,
make it explicit or ask the user.
```

## 11 — O que este modelo não faz (YAGNI explícito)

Fora do escopo desta referência e do que ela documenta:

* sistema probabilístico complexo;
* confidence numérica artificial (percentual sem metodologia);
* LLM como autoridade da verdade;
* classificação epistemológica de cada frase produzida;
* banco de dados separado apenas para Evidence State;
* workflow obrigatório de quatro estados (a sequência do §1 não é uma máquina de estados rígida);
* alteração automática de documentação baseada apenas em inferência;
* integração com Discovery, Specs, ADR, Knowledge Provider ou Guardian (deferida — ver cabeçalho).

O objetivo é rastreabilidade, não criar uma camada artificial de burocracia.
