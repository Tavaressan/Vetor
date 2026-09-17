---
name: spec-validate
description: Valida a qualidade de uma Spec (RF/RNF, Acceptance Criteria, Non-Goals, Edge Cases) contra o Quality Model do Vetor — score 0-100 ponderado por dimensão e Quality Gate (READY/NEEDS_REFINEMENT/INCOMPLETE) — e reporta Strengths/Gaps/Suggestions.
license: MIT
compatibility: Claude Code, OpenCode, Codex, Antigravity
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é a skill de validação de qualidade de Specs do Vetor (Handoff #203). Sua missão é ler uma
Spec já persistida em disco, computar seu score contra o Quality Model (5 dimensões ponderadas),
classificá-la no Quality Gate e reportar o resultado em Strengths/Gaps/Suggestions — nunca decidir
sozinho se a Spec "está boa o bastante": o Quality Gate é um mecanismo de decisão, quem age sobre o
resultado (refinar, seguir para implementação) é sempre o usuário ou a skill chamadora.

O Quality Model, o Quality Gate, a estrutura de saída (Score/Status/Strengths/Gaps/Suggestions —
#220) e os dimension checkers heurísticos (#221: Must sem Acceptance Criteria, termos vagos sem
métrica mensurável, `⚠️ ABERTO` explícito vs. omissão silenciosa, Non-Goals ausente, Edge Cases
contextuais) já estão completos e operacionais. Feedback estruturado por gap (`location`/`problem`/
`impact`/`suggested_action`), o Quality Report em Markdown persistido separado da Spec e o
refinamento iterativo com limite de 3 ciclos são escopo de #222. Metadados de rastreabilidade por
requisito e Decision Log são escopo de #223.

---

## Sintaxe

```
/vetor:spec-validate <path>
```

- `<path>`: caminho (relativo ao repositório) de uma Spec em markdown já persistida em disco (ex.:
  `docs/specs/authentication.md`).

Também invocável como etapa interna de `/vetor:spec` (uso futuro, quando #216-#219 estiverem
mergeados e a skill `spec` passar a chamar esta validação antes de apresentar o rascunho final ao
usuário) — nesse caso, a mesma CLI abaixo é chamada, só que a partir do fluxo de `/vetor:spec` em
vez de invocação direta pelo usuário.

---

## Referências

- `$CLAUDE_PLUGIN_ROOT/scripts/spec-validate.ts` — CLI que expõe o Quality Model e os dimension
  checkers (`scripts/lib/spec-quality.ts`, `scripts/lib/spec-quality-checkers.ts`,
  `scripts/lib/spec-parser.ts`). Uma `SKILL.md` é prosa interpretada por um agente — não pode
  importar módulos TypeScript diretamente (mesmo padrão de `scripts/knowledge-doc.ts` para
  `skills/spec/SKILL.md`).
- `templates/spec.md` — esqueleto que os dimension checkers assumem ao fazer o parsing heurístico
  (headings `## Nome da Seção`, requisitos `### RF-NN - <nome>` / `### RNF-NN - <nome>`).

---

## Comportamento

### 1 — Rodar o Quality Model

```bash
deno run -A "$CLAUDE_PLUGIN_ROOT/scripts/spec-validate.ts" <path> [--config <path-do-config>]
```

- `<path>`: obrigatório — path para a Spec em markdown.
- `--config`: opcional — path para `.claude/vetor/config.json` (default), de onde os thresholds do
  Quality Gate são lidos (ver passo 3). Path inexistente/config sem a chave usam os thresholds
  default.

O CLI lê a Spec, faz o parsing heurístico (`spec-parser.ts`), roda os 5 dimension checkers
(`spec-quality-checkers.ts`) e agrega o resultado no Quality Model (`spec-quality.ts`), imprimindo
o Quality Report em Markdown na saída padrão. Se o path não existir ou não puder ser lido, o CLI
termina com exit code 1 e uma mensagem de erro — repasse-a ao usuário sem tentar adivinhar o path
correto por conta própria.

### 2 — Quality Model

Score final é `0-100`, soma ponderada de 5 dimensões (`DIMENSION_WEIGHTS` em `spec-quality.ts`,
#203 §2):

| Dimensão     | Peso |
| ------------ | ---: |
| Completeness |   30 |
| Testability  |   25 |
| Clarity      |   20 |
| Scope        |   15 |
| Edge Cases   |   10 |

Cada dimensão é avaliada por um checker independente que devolve uma fração `0-1` de quanto foi
satisfeita; o score da dimensão é `fraction × peso`, arredondado. A soma das 5 dimensões nunca
ultrapassa 100.

### 3 — Quality Gate

Classificação operacional a partir do score (`gateFor` em `spec-quality.ts`, #203 §3):

```text
80-100 → READY
60-79  → NEEDS_REFINEMENT
0-59   → INCOMPLETE
```

Os thresholds são configuráveis via `.claude/vetor/config.json`:

```json
{
  "specValidate": {
    "thresholds": { "ready": 80, "needsRefinement": 60 }
  }
}
```

Um override parcial (ex.: só `ready`) preserva o default para o campo omitido — nunca assuma que a
ausência de `specValidate` no config é um erro, é o caso comum (default aplicado silenciosamente).

### 4 — Apresentar o resultado

Reproduza o Quality Report emitido pelo CLI ao usuário — não resuma nem edite os números. O relato
sempre inclui, no mínimo:

```
Score: <N>/100
Status: <READY|NEEDS_REFINEMENT|INCOMPLETE>

## Strengths
...

## Gaps
...

## Suggestions
...
```

Se `Status` for `NEEDS_REFINEMENT` ou `INCOMPLETE`, informe ao usuário que a Spec pode ser refinada
a partir dos `Gaps`/`Suggestions` listados — mas não refine a Spec por conta própria nesta versão da
skill (refinamento iterativo com limite de ciclos é escopo de #222); apenas relate.

---

## Restrições

- Nunca decida sozinho que uma Spec `NEEDS_REFINEMENT`/`INCOMPLETE` pode seguir para implementação
  mesmo assim — o Quality Gate é informativo para quem decide (usuário ou skill chamadora), não uma
  trava automática nesta versão.
- Nunca edite a Spec original a partir desta skill — validação é somente leitura; qualquer edição é
  responsabilidade de quem chamou (`/vetor:spec` ou o usuário diretamente).
- Nunca invente um score ou gate fora do que o CLI (`scripts/spec-validate.ts`) reportou.
- Nunca trate a ausência de `specValidate.thresholds` no config como erro — é o caso default,
  silenciosamente resolvido para `{ ready: 80, needsRefinement: 60 }`.
