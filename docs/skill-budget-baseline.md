# Baseline do orçamento de contexto das skills

Registrado em 2026-11-09 sobre o commit `ad1ad95`, antes das refatorações de enxugamento (#571 a
#581). Gerado com `deno run --allow-read scripts/skill-budget.ts` (issue #570) e regenerado na #571
com a regra de classificação refinada abaixo, sobre o mesmo commit, para a comparação continuar justa.

Tokens estimados por caracteres / 4. **Obrigatória** é o `SKILL.md` mais as referências listadas
na seção `## Referências` sem gatilho condicional, em fecho transitivo; **sob demanda** são as
referências listadas com gatilho ("quando", "se", "ao"...) e as citadas só no corpo (num passo, numa
tabela ou numa restrição), que o modelo lê quando o fluxo chega lá. A medição é estática e não
depende de harness.

| Skill | SKILL.md | Obrigatória | Sob demanda |
| --- | ---: | ---: | ---: |
| architecture-review | 2531 | 11086 | 9817 |
| backlog | 3035 | 12112 | 8370 |
| backlog-ideator | 109 | 109 | 0 |
| coordinator | 20038 | 20038 | 36193 |
| design | 6261 | 13790 | 16105 |
| fix | 4291 | 9784 | 14915 |
| fix-loop-agent | 105 | 105 | 0 |
| guardian | 4450 | 13018 | 9817 |
| install | 3616 | 5134 | 17753 |
| issue-coordinator | 113 | 113 | 0 |
| now | 1994 | 11686 | 6992 |
| retro | 2066 | 2066 | 16684 |
| ship | 7623 | 9374 | 16684 |
| spec | 7881 | 17335 | 9817 |
| spec-validate | 2325 | 3742 | 0 |
| stack-practices | 2899 | 2899 | 16684 |
| vetor | 106 | 106 | 0 |
| worktree-create | 2232 | 2232 | 27678 |
| worktree-ship | 105 | 105 | 0 |

| Agent | Corpo | Preloads | Obrigatória |
| --- | ---: | --- | ---: |
| code-review | 1754 | — | 1754 |
| issue-worker | 3209 | fix | 12993 |
| ship-worker | 1622 | ship | 10996 |

Os limites em `scripts/skill-budget.json` partem destes valores com 5% de folga, arredondados para cima ao
múltiplo de 500, e o teste `scripts/tests/skill-budget_test.ts` falha quando uma skill passa do seu limite. Ao
reduzir uma skill, baixe o limite dela no mesmo PR.

Referência externa: o Antigravity carrega só os primeiros 24 000 bytes do corpo de um `SKILL.md`
(aviso do `agy plugin validate` em 2026-11-09); `coordinator`, `design`, `ship` e `spec` passam disso.
