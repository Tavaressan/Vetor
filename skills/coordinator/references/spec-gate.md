# Coordinator — gate de Spec: pergunta e opções

> Lida sob demanda pelo `SKILL.md` do `coordinator` (quando alguma issue for sinalizada pelo gate). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

**Fora de `--headless`:** não pergunte nada neste ponto. As issues sinalizadas viram o
**item 2 da entrevista consolidada** (abaixo): uma única pergunta para todas elas, e não uma por
issue (`planning-conventions.md` §3 "Regra das 3 perguntas"). O gate classifica e o plano reflete a
opção `(Recommended)`; a resposta do usuário, no turno único da largada, ajusta o que for preciso.
Texto-base da pergunta do item 2:

```
Issue(s) #<N>[, #<M>...] parece(m) não-trivial(is) (<razão: múltiplos módulos | sem
descrição/Critério de Aceite em checklist>) e não tem(têm) Spec
associada. Como prosseguir?

1. Despachar com micro-spec JIT — um modelo leve escreve o escopo de 1 página no dispatch (Recommended)
2. Despachar mesmo assim — escopo confirmado nesta conversa
3. Gerar Spec antes (/vetor:spec) — a(s) issue(s) sai(em) desta leva de dispatch
```

- **Opção 1 (micro-spec JIT)**: a issue segue no plano normalmente; marque na coluna
  "Ação" da tabela (abaixo) `Despachar (⚠️ sem Spec — micro-spec JIT)`. A micro-spec é sintetizada no
  dispatch da Fase 4, sem interromper o dispatch nem atrasar a aprovação do plano e sem perguntar ao
  usuário se quer tirar a issue da leva para escrever uma Spec completa: contrato, formato e
  fallback em `../shared/references/issue-coordinator-dispatch.md` ("Micro-spec JIT"). Se o modelo
  falhar, a issue é despachada sem micro-spec e continua marcada `⚠️ sem Spec`.
- **Opção 2**: a issue segue no plano normalmente, sem micro-spec; marque na coluna "Ação"
  `Despachar (⚠️ sem Spec — confirmado pelo usuário)`. Se o usuário informou pontos de escopo
  (problema, resultado esperado, não-escopo) no campo livre da mesma resposta, inclua-os no prompt
  do worker da Fase 4, como contexto adicional (não substitui uma Spec — é só o mínimo de escopo
  confirmado para o worker não inventar critério de aceite sozinho).
- **Opção 3**: remova a issue desta leva de dispatch — ela não aparece como `Despachar`, e sim com
  Ação `SKIPPED (aguardando Spec)` e coluna "Onda" `—` (nunca foi despachada, não pertence a onda
  nenhuma). Se a issue sinalizada é a **Lead** do grupo, o grupo inteiro sai da leva (as Sequential
  Issues do grupo ficam sem Lead para dar nome ao worktree/branch — voltam junto na próxima sessão);
  se é uma **Sequential Issue**, apenas ela sai e o restante do grupo (Lead + demais Sequential) segue
  normalmente. A issue (ou grupo) volta a ser candidata em uma sessão futura do coordinator, quando a
  Spec existir (`/vetor:spec` roda fora deste fluxo, tipicamente numa sessão manual). Aplique a label
  de triagem existente no repositório conforme a tabela de mapeamento da Fase 1 (`needs-spec` ->
  `spec-needed` -> `triage/needs-information`; se nenhuma existir, não aplique e nunca use
  `gh label create`). **Um grupo `SKIPPED` nunca é pendência para a transição de onda da Fase 4** —
  como não foi despachado, não há branch skew a prevenir (as ondas ordenam merges de trabalho já
  despachado, não issues que nunca saíram do plano); a transição de `O_i` para `O_{i+1}` ignora grupos
  `SKIPPED` de `O_i`.

**Em `--headless`: nunca pergunte, nunca bloqueie.** Um gate síncrono aqui recriaria o mesmo deadlock
por falta de interlocutor do worker preso em plan mode (ver `wiki/Decisoes-de-Design.md`).
Marque a issue na coluna "Ação" como
`Despachar (⚠️ sem Spec associada — sinalização não-bloqueante; micro-spec JIT)` e prossiga o dispatch
normalmente: a micro-spec JIT (opção 1 acima) é gerada no dispatch, sem perguntar; a ausência de Spec
fica registrada no relatório final (Fase 7), nunca impede o dispatch.
