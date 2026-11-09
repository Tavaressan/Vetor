# Spec — modo `--validate`

> Lido pelo `SKILL.md` do `spec` só no modo `--validate <path>` ou quando o passo 6 valida o rascunho
> persistido. Substitui a antiga skill `/vetor:spec-validate`.

```
/vetor:spec --validate <path>
```

- `<path>`: caminho (relativo ao repositório) de uma Spec em markdown já persistida em disco (ex.:
  `docs/specs/authentication.md`).


No modo `--validate`, a skill `spec` valida a qualidade de uma Spec (Handoff de Spec): lê uma
Spec já persistida em disco, computa seu score contra o Quality Model (5 dimensões ponderadas),
classifica-a no Quality Gate e reporta o resultado em Strengths/Gaps/Suggestions — nunca decide
sozinha se a Spec "está boa o bastante": o Quality Gate é um mecanismo de decisão, quem age sobre o
resultado (refinar, seguir para implementação) é sempre o usuário ou a skill chamadora.

O Quality Model, o Quality Gate, a estrutura de saída (Score/Status/Strengths/Gaps/Suggestions), os dimension checkers heurísticos (Must sem Acceptance Criteria, termos vagos sem
métrica mensurável, `⚠️ ABERTO` explícito vs. omissão silenciosa, Non-Goals ausente, Edge Cases
contextuais), o feedback estruturado por gap (`location`/`problem`/`impact`/`suggestedAction`), o
Quality Report em Markdown persistido separado da Spec e o refinamento iterativo com limite de 3
ciclos já estão completos e operacionais. O formato de metadados de rastreabilidade por
requisito (`id`/`priority`/`status`) e o Decision Log também estão preparados — ver
`references/traceability.md` —, mas **sem** integração real com Coordinator/Guardian: essa
integração é infraestrutura futura, não código funcional deste modo.

---

## Referências

> Paths relativos e `$SKILL_DIR` aqui resolvem a partir do diretório da skill `spec`, não deste
> arquivo (mesma convenção do `SKILL.md`).

- `../../scripts/spec-validate.ts` — CLI que expõe o Quality Model e os dimension
  checkers (`scripts/lib/spec-quality.ts`, `scripts/lib/spec-quality-checkers.ts`,
  `scripts/lib/spec-parser.ts`). Uma `SKILL.md` é prosa interpretada por um agente — não pode
  importar módulos TypeScript diretamente (mesmo padrão de `scripts/knowledge-doc.ts` para
  `skills/spec/SKILL.md`).
- `templates/spec.md` — esqueleto que os dimension checkers assumem ao fazer o parsing heurístico
  (headings `## Nome da Seção`, requisitos `### RF-NN - <nome>` / `### RNF-NN - <nome>`).
- `references/traceability.md` — formato de metadados de
  requisito (`id`/`priority`/`status`), Decision Log (`DEC-NN`) e os pontos de extensão futuros
  para Coordinator (RF→Task) e Guardian (Spec Drift) — preparação sem integração real.

---

## Comportamento

### 1 — Rodar o Quality Model

```bash
deno run -A "$SKILL_DIR/../../scripts/spec-validate.ts" <path> [--config <path-do-config>] [--history <path>]
```

- `<path>`: obrigatório — path para a Spec em markdown.
- `--config`: opcional — path para `.claude/vetor/config.json` (default), de onde os thresholds do
  Quality Gate são lidos (ver passo 3). Path inexistente/config sem a chave usam os thresholds
  default.
- `--history`: opcional — sobrescreve onde o histórico de validação é persistido (default:
  derivado da raiz do repositório git + path da Spec, `<git-toplevel>/.claude/vetor/specs/
  <slug>.validation.json` — não do cwd do processo, para que duas invocações a partir de
  subdiretórios diferentes do mesmo checkout encontrem o mesmo histórico). `<slug>` é o path
  relativo da Spec sem extensão, com `/` virando `-` (`validationPathFor`, spec-quality-
  persistence.ts) — não só o basename, para que duas Specs de mesmo nome em pastas diferentes não
  colidam no mesmo histórico. Use `--history` só em cenário de teste/automação; em uso
  normal, deixe o CLI derivar o path sozinho.

O CLI lê a Spec, faz o parsing heurístico (`spec-parser.ts`), roda os 5 dimension checkers
(`spec-quality-checkers.ts`) e agrega o resultado no Quality Model (`spec-quality.ts`), imprimindo
o Quality Report em Markdown na saída padrão (`spec-quality-report.ts`). Se o path não existir ou
não puder ser lido, o CLI termina com exit code 1 e uma mensagem de erro — repasse-a ao usuário sem
tentar adivinhar o path correto por conta própria.

### 2 — Quality Model

Score final é `0-100`, soma ponderada de 5 dimensões (`DIMENSION_WEIGHTS` em `spec-quality.ts`):

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

Classificação operacional a partir do score (`gateFor` em `spec-quality.ts`):

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

Reproduza o Quality Report emitido pelo CLI ao usuário — não resuma nem edite os números nem os
gaps. Cada gap listado já vem estruturado (`location`/`problem`/`impact`/`suggestedAction`) — nunca substitua esse detalhe por uma frase genérica tipo "a Spec precisa melhorar". O relato
sempre inclui, no mínimo:

```
Score: <N>/100
Status: <READY|NEEDS_REFINEMENT|INCOMPLETE>

## Strengths
...

## Gaps
- **<location>**: <problem>
  - Impact: <impact>
  - Suggested action: <suggestedAction>

## Suggestions
...
```

### 5 — Refinamento iterativo (limite de 3 ciclos)

Quando `Status` for `NEEDS_REFINEMENT` ou `INCOMPLETE`, o ciclo `validate → gaps → refine →
validate` pode se repetir **no máximo 3 vezes** (`MAX_REFINEMENT_CYCLES` em
`spec-quality-report.ts`) além da validação inicial:

1. Rode o passo 1. Se `Status` for `READY`, pare — não há necessidade de refinar.
2. Caso contrário, aplique **uma** correção objetiva a partir de um `Gap` do relatório (edite a
   Spec você mesmo ou peça ao usuário, conforme o contexto de quem chamou).
3. Rode o passo 1 de novo, **sempre com o mesmo `<path>`** (o CLI deriva o mesmo arquivo de
   histórico automaticamente a partir do path da Spec — não passe `--history` em uso normal).
4. O Quality Report da segunda chamada em diante inclui `## Refinement History` com a evolução do
   score (ex.: `54 → 71 → 84`). Repita os passos 2-3 até `READY` ou até o CLI imprimir a mensagem de
   limite de ciclos atingido.
5. Se o CLI sinalizar que o limite foi atingido, **pare** — não invente uma 5ª validação. Informe ao
   usuário que a Spec precisa de revisão manual; este modo nunca decide sozinho refinar além do
   limite.

---

## Restrições

- Nunca decida sozinho que uma Spec `NEEDS_REFINEMENT`/`INCOMPLETE` pode seguir para implementação
  mesmo assim — o Quality Gate é informativo para quem decide (usuário ou skill chamadora), não uma
  trava automática nesta versão.
- Nunca edite a Spec original neste modo fora do ciclo de refinamento explícito do passo
  5 — validação é somente leitura por padrão; qualquer edição fora desse ciclo é responsabilidade
  de quem chamou (o fluxo de geração do `/vetor:spec` ou o usuário diretamente).
- Nunca invente um score, gate ou gap fora do que o CLI (`scripts/spec-validate.ts`) reportou.
- Nunca substitua o `problem`/`impact`/`suggestedAction` de um gap por uma frase genérica — o
  Handoff #203 §9 proíbe explicitamente saída tipo "Spec precisa ser melhorada" sem especificar
  location/problem/impact/ação.
- Nunca trate a ausência de `specValidate.thresholds` no config como erro — é o caso default,
  silenciosamente resolvido para `{ ready: 80, needsRefinement: 60 }`.
- Nunca ultrapasse `MAX_REFINEMENT_CYCLES` (3) ciclos de refinamento automático — ao atingir o
  limite, pare e escale para revisão manual em vez de insistir em mais uma tentativa.
- Nunca escreva o Quality Report dentro do arquivo da Spec — ele é sempre persistido separado
  (`scripts/lib/spec-quality-persistence.ts`), nunca misturado ao conteúdo da Spec.
