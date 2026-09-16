# Vocabulário de design de código (Vetor)

Fonte única do vocabulário de arquitetura consumido por referência (sem replicar texto) por
`architecture-review/SKILL.md` e pelo Check 9 do `guardian/SKILL.md` (que hoje usa "deletion test"/
"fan-in" de forma solta, sem definição centralizada). Adapta o skill público
`engineering/codebase-design` de Matt Pocock (github.com/mattpocock/skills) ao vocabulário do Vetor.

Use estes termos consistentemente — nunca "componente"/"service"/"boundary" como sinônimo frouxo de
`module`/`seam`.

---

## Termos

- **Module (módulo)** — unidade de código com uma responsabilidade coesa e um limite identificável
  (arquivo, diretório, package). A pergunta relevante nunca é "esse arquivo é grande?", mas "esse
  módulo tem uma única razão coerente para mudar?".
- **Interface** — a superfície pública através da qual outros módulos interagem com um módulo
  (função exportada, endpoint, CLI, contrato de tipo). Tudo que não é interface é **implementação**
  — livre para mudar sem quebrar quem depende do módulo.
- **Depth (profundidade)** — relação entre o tamanho da interface e o poder da funcionalidade que ela
  esconde. Um módulo **profundo** expõe pouco e faz muito (alta profundidade); um módulo **raso**
  (shallow) expõe quase tanto quanto implementa — a interface já é praticamente a implementação, e
  não economiza nada de quem a usa entender o módulo.
- **Seam** — o ponto de encaixe entre dois módulos, onde um comportamento pode ser trocado/isolado
  sem tocar o outro lado. É também, por definição, a superfície de teste de um módulo (ver
  Princípio 2).
- **Adapter** — implementação concreta que plugga em um seam (ex.: driver de banco específico atrás
  de uma interface de repositório). Um único adapter existente não prova que o seam é real — pode
  ser especulação prematura (ver Princípio 3).
- **Leverage (alavancagem)** — o ganho que uma mudança de design compra: quanto código a mais se
  torna simples, testável ou substituível por causa dela. Alavancagem baixa é sinal de que a
  reestruturação proposta não paga o custo de fazê-la.
- **Locality (localidade)** — o quanto o código relevante para entender ou corrigir um comportamento
  está fisicamente próximo (mesmo módulo/arquivo) de onde o comportamento é observado. Baixa
  localidade é o sintoma clássico de uma função pura extraída só para testabilidade, enquanto o bug
  real mora em como ela é chamada.

## Princípios

1. **Deletion test.** Para avaliar se um módulo/abstração paga o custo de existir: imagine deletá-lo
   e inlinar seu conteúdo no(s) chamador(es). Se o resultado fica mais simples de entender (menos
   indireção, sem perda de teste relevante), a abstração provavelmente não deveria existir como está.
   Se o resultado fica mais confuso ou duplica lógica não trivial, a abstração se justifica. É
   julgamento qualitativo sobre legibilidade e coesão — não uma métrica textual (ex.: contagem de
   linhas ou de referências) que a substitua sozinha.
2. **A interface é a superfície de teste.** Um bom teste exercita o módulo pela sua interface pública
   — nunca por um detalhe de implementação exposto lateralmente. Se testar um módulo exige alcançar
   além da sua interface, o seam está no lugar errado (mesma disciplina de `tdd-conventions.md` §1-2,
   aplicada aqui à avaliação arquitetural, não ao ciclo vermelho-verde).
3. **Um adapter é seam hipotético; dois é seam real.** Uma interface desenhada para "permitir trocar
   a implementação no futuro" com um único adapter implementado é especulação (YAGNI) até que um
   segundo adapter concreto exista. Dois adapters reais confirmam que o seam paga o custo de existir;
   um só ainda não prova nada.
