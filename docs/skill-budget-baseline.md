# Baseline do orçamento de contexto das skills

Registrado em 2026-11-09, no commit seguinte a `24c5fd5`, antes das refatorações de enxugamento
(#571 a #581). Gerado com `deno run --allow-read scripts/skill-budget.ts` (issue #570).

Tokens estimados por caracteres / 4. **Obrigatória** é o `SKILL.md` mais as referências citadas
sem gatilho condicional, em fecho transitivo; **sob demanda** são as referências citadas só com
gatilho ("quando", "se", "ao"...). A medição é estática e não depende de harness.

| Skill | SKILL.md | Obrigatória | Sob demanda |
| --- | ---: | ---: | ---: |
| architecture-review | 2531 | 14880 | 6023 |
| backlog | 3035 | 14459 | 6023 |
| backlog-ideator | 109 | 109 | 0 |
| coordinator | 20038 | 45061 | 10195 |
| design | 6261 | 26697 | 3198 |
| fix | 4291 | 19210 | 5489 |
| fix-loop-agent | 105 | 105 | 0 |
| guardian | 4450 | 16812 | 6023 |
| install | 3616 | 6814 | 16073 |
| issue-coordinator | 113 | 113 | 0 |
| now | 1994 | 15480 | 3198 |
| retro | 2066 | 2066 | 16684 |
| ship | 7623 | 20035 | 6023 |
| spec | 7881 | 21129 | 6023 |
| spec-validate | 2325 | 3742 | 0 |
| stack-practices | 2899 | 16385 | 3198 |
| vetor | 106 | 106 | 0 |
| worktree-create | 2232 | 12441 | 16684 |
| worktree-ship | 105 | 105 | 0 |

| Agent | Corpo | Preloads | Obrigatória |
| --- | ---: | --- | ---: |
| code-review | 1754 | — | 1754 |
| issue-worker | 3209 | fix | 22419 |
| ship-worker | 1622 | ship | 21657 |

Os limites em `scripts/skill-budget.json` partem destes valores com 5% de folga, arredondados para cima ao
múltiplo de 500, e o teste `scripts/tests/skill-budget_test.ts` falha quando uma skill passa do seu limite. Ao
reduzir uma skill, baixe o limite dela no mesmo PR.

Referência externa: o Antigravity carrega só os primeiros 24 000 bytes do corpo de um `SKILL.md`
(aviso do `agy plugin validate` em 2026-11-09); `coordinator`, `design`, `ship` e `spec` passam disso.
