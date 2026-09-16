# Disciplina de TDD (Vetor)

Fonte única da disciplina de TDD do Vetor — consumida por referência (sem replicar texto) por
`planning-conventions.md` §3, `fix-loop-agent/SKILL.md` §3.b e `agents/issue-worker.md`. Adapta o
conjunto `engineering/tdd/SKILL.md` + `tests.md` + `mocking.md` de Matt Pocock
(github.com/mattpocock/skills) ao modo **headless** do Vetor — sem sessão síncrona de confirmação
com o usuário.

---

## 1. O que é um bom teste

Um bom teste verifica **comportamento observável através da interface pública** do módulo — nunca
detalhe de implementação. Se o teste quebra quando você refatora o interior de uma função sem mudar
seu comportamento externo, o teste está acoplado à implementação, não ao comportamento.

- Teste a partir do que o módulo expõe (função pública, endpoint, CLI, contrato) — não a partir de
  variáveis internas, métodos privados ou estrutura de dados intermediária.
- Um bom teste sobrevive a uma refatoração interna legítima; só falha quando o comportamento
  observável realmente muda.

## 2. Seams (adaptado ao modo headless)

O mattpocock exige confirmar o *seam* (ponto de encaixe do teste, i.e. qual interface pública
testar) com o usuário antes de escrever o teste. `issue-worker` e `fix-loop-agent` rodam headless,
sem interlocutor disponível para essa confirmação síncrona.

**Adaptação**: o seam é inferido automaticamente a partir da interface pública já mapeada no módulo
(`module-test-map.md` — comando headless e módulo associado ao path alterado). Se o seam correto for
ambíguo (ex.: módulo sem interface pública clara, ou o path alterado não mapeia para nenhum módulo
conhecido), o worker registra `Status: BLOCKED_WAITING` (mecanismo já existente em
`agent-status.template.md`) em vez de inventar uma interação síncrona nova — reaproveita a escalação
que o `issue-coordinator` já sabe tratar.

## 3. Três anti-padrões nomeados

Evite estes três padrões ao escrever o teste de reprodução:

1. **Implementation-coupled** — o teste mocka um colaborador interno, chama um método privado, ou
   verifica o resultado por um canal lateral (ex.: consulta direta ao banco em vez de usar a
   interface pública do módulo). Sintoma: o teste quebra ao refatorar sem mudar comportamento.
2. **Tautológico** — o valor esperado é recalculado da mesma forma que o código sob teste calcula
   (ex.: `expect(soma(a, b)).toBe(a + b)`). O teste sempre passa, mesmo com bug — não prova nada. O
   valor esperado deve vir de um literal conhecido ou de um exemplo trabalhado manualmente
   (ex.: `expect(soma(2, 3)).toBe(5)`).
3. **Horizontal slicing** — escrever todos os testes de todos os cenários antes de implementar
   qualquer um deles. Regra oposta obrigatória: **vertical slice** (também chamado *tracer bullet*)
   — um teste, uma implementação mínima que o faz passar, repete. Isso já é, na prática, o que o
   loop do `fix-loop-agent` §3.b faz iteração a iteração; esta seção só nomeia a regra
   explicitamente.

## 4. Regras do loop vermelho-verde

- **Red antes de green**: escreva o teste de reprodução — cobrindo só o bug/comportamento em
  questão — antes de tocar no código de produto. Confirme que ele falha pelo motivo esperado antes
  de aplicar o fix.
- **Uma fatia por vez**: um teste por iteração (vertical slice, ver §3.3). Não acumule múltiplos
  cenários não relacionados num único teste nem escreva testes para comportamento ainda não
  implementado.
- **Refactor não é parte deste ciclo**: o ciclo vermelho-verde do `fix-loop-agent`/`issue-worker` não
  deve tentar refatorar código adjacente ou melhorar arquitetura durante o fix. Achados de
  refatoração/arquitetura ficam para o `code-review`, agente separado despachado depois pelo
  `worktree-ship` (ver issue #178) — é o estágio dedicado a esse tipo de achado.

## 5. Mocking

Mocke **apenas na fronteira do sistema**: API externa, tempo/aleatoriedade (clock, `Math.random`),
e — quando estritamente necessário para isolar o teste do ambiente — banco de dados ou filesystem.

**Nunca mocke um módulo ou classe do próprio projeto.** Se testar um módulo exige mockar outro
módulo interno para funcionar, isso é sinal de acoplamento excessivo entre eles — reavalie o design
em vez de mascarar o problema com mock (mas não trate essa reavaliação como parte do ciclo
vermelho-verde — ver §4, "refactor não é parte deste ciclo"; registre como achado para o
`code-review` posterior).
