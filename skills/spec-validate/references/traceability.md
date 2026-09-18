# Rastreabilidade Spec → Task → Code → Test (#223, preparação)

Este documento descreve o formato e os pontos de extensão preparados por #223 (Handoff #203
§13-§18). **Nenhuma integração real está implementada aqui** — nem transformação de requirement em
task pelo Coordinator, nem detecção de Spec Drift pelo Guardian. O que existe é o formato de dados
e as garantias que essas integrações futuras vão poder assumir, implementadas em
`scripts/lib/spec-traceability.ts`.

```text
Spec
 │
 ├── RF-01
 ├── RF-02
 └── RF-03
       │
       ▼
     Task            (Coordinator — §2, não implementado)
       │
       ▼
      Code
       │
       ▼
      Test
       │
       ▼
   Guardian           (§3, não implementado)
```

---

## 1. Metadados por requisito

Cada requisito (`RF-NN`/`RNF-NN`, ver `templates/spec.md` e `skills/spec/SKILL.md` §5.2) pode
carregar metadados de rastreabilidade:

```yaml
id: RF-01
priority: must
status: planned
```

- `id`: o mesmo identificador estável já usado pelo motor de geração de `/vetor:spec` — nunca é
  renumerado (ver `skills/spec/SKILL.md` §5.2).
- `priority`: `must | should | could` (MoSCoW), mesma semântica de `**Priority:**` no template.
- `status`: um de `planned | confirmed | implemented | verified` (`RequirementStatus` em
  `scripts/lib/spec-traceability.ts`).

**Garantia central:** o `id` nunca muda através de nenhuma transição de `status`. `RF-01` continua
`RF-01` depois de implementado e verificado — só o campo `status` evolui.
`transitionRequirementStatus(metadata, novoStatus)` (spec-traceability.ts) formaliza essa garantia:
devolve um novo objeto com `status` atualizado e `id`/`priority` preservados, sem mutar o original.

A ordem sugerida de estados (`REQUIREMENT_STATUSES`) é um fluxo recomendado, não uma máquina de
estados imposta — `transitionRequirementStatus` não valida que a transição segue essa ordem (ex.:
pular de `planned` direto para `verified`). Impor ou não essa ordem é decisão de quem consumir este
módulo no futuro (Coordinator, Guardian), não deste módulo em si.

Onde esses metadados vivem fisicamente (frontmatter YAML por requisito, um arquivo `.json` paralelo
à Spec, ou embutido no Quality Report — ver `skills/shared/references/knowledge-provider-contract.md`
para o precedente de persistência do Vetor) é uma decisão de implementação para quando a integração
real (item 2 ou 3) for construída — esta issue não fixa esse formato de armazenamento, só a forma
(`RequirementMetadata`) e a garantia de estabilidade do `id`.

---

## 2. Ponto de extensão: Coordinator (RF → Task)

Fluxo futuro:

```text
RF-01
  ↓
Task: Implement user registration

RF-02
  ↓
Task: Implement email verification
```

O `issue-coordinator` (`skills/issue-coordinator/SKILL.md`) já despacha issues do GitHub para
workers isolados; a extensão futura é a **origem** dessas issues poder ser um requisito de Spec
(`RF-NN`) em vez de uma issue criada manualmente. Para isso, cada task despachada precisaria
referenciar o `id` do requisito que a originou — por exemplo, um campo `sourceRequirement: RF-01`
na issue do GitHub ou no corpo da task.

**Não implementado nesta issue** — geraria uma mudança grande no `issue-coordinator` (que hoje só
conhece issues do GitHub, não requisitos de Spec) fora do escopo de #223. O que fica pronto é a
garantia de que `RF-01` é um identificador estável o bastante para ser citado por uma task futura
sem risco de a referência quebrar quando a Spec evoluir (ver item 1).

---

## 3. Ponto de extensão: Guardian (Spec Drift)

Fluxo futuro:

```text
Spec
 │
 ▼
Implementation
 │
 ▼
Guardian
 │
 ├── RF-01 ✅
 ├── RF-02 ✅
 ├── RF-03 ⚠️
 └── RF-04 ❌
```

O `guardian` (`skills/guardian/SKILL.md`) hoje audita gaps que o pre-commit não cobre (JSON
inválido, migrations, worktrees órfãos, etc.). A extensão futura é ele também poder avaliar, por
requisito:

- **requirement sem implementação aparente** (`status: planned`/`confirmed` há muito tempo sem
  commit relacionado);
- **código sem requirement correspondente** (mudança de comportamento sem `RF-`/`RNF-` que a
  explique);
- **teste ausente** (`status: implemented` sem cobertura de teste correspondente);
- **Spec Drift**: divergência relevante entre o comportamento especificado e o
  implementado/documentado. Exemplo:

  ```text
  Spec:
  RF-03 → mensagens devem utilizar processamento assíncrono.

  Code:
  implementação utiliza chamada síncrona.

  Guardian:
  ⚠️ POSSIBLE SPEC DRIFT
  ```

**Não implementado nesta issue** — exigiria análise semântica de código (comparar comportamento
declarado vs. implementado), explicitamente fora do escopo de #223 (Handoff #203 §16-§17: "não
implementar ainda análise semântica completa do código"). O que fica pronto é o formato de
metadados (`status`) sobre o qual essa análise futura poderia se apoiar.

---

## 4. Decision Log

Alterações importantes na Spec (decisões arquiteturais, mudanças de escopo) podem ser registradas
num log minimalista, formato `DEC-NN` (mesma disciplina de IDs estáveis do item 1):

```markdown
### DEC-01

Date: 2026-09-16

Decision:
...

Reason:
...

Impact:
...
```

`renderDecisionLogEntry`/`applyDecisionLogEntry` (`scripts/lib/spec-traceability.ts`) formalizam a
renderização e a regra de que uma nova decisão sempre vai para o **final** do log, nunca substitui
ou reordena entradas anteriores — mesmo espírito de nunca renumerar `RF-`/`RNF-` existentes.

Quando uma decisão registrada aqui for arquitetural, o fluxo poderá **futuramente** gerar um ADR
(`skills/architecture-review/`, se existir no projeto) — esta issue não implementa essa
transformação automática (Handoff #203 §18: "não transformar esta issue em implementação completa
de ADR").
