# Investigação estruturada em rodadas (grilling) — Vetor

Fonte única do mecanismo de entrevista em rodadas ("grilling") extraído de `backlog-ideator` (#177,
PR #193) — consumida por referência (sem replicar texto) por `backlog-ideator/SKILL.md` §2.b e
`architecture-review/SKILL.md`. Adapta os skills públicos `productivity/grilling` e
`engineering/domain-modeling` de Matt Pocock (github.com/mattpocock/skills) ao modo **síncrono, com
humano no loop** do Vetor — diferente do dispatch headless de `fix-loop-agent`/`issue-worker`, que
nunca pergunta ao usuário.

Substitui o padrão antigo de "bloco fixo com até 3 perguntas" (`planning-conventions.md` §3.1, ainda
válido como default geral para skills que não adotam grilling) por rodadas sem teto, cada pergunta
acompanhada da recomendação do próprio agente.

---

## 1. Fato vs. decisão

Antes de transformar qualquer ambiguidade em pergunta ao usuário, tente apurá-la sozinho: comandos
de leitura (`gh issue list`, grep no código-alvo, releitura de documentação já carregada). Qualquer
ambiguidade resolvível dessa forma **nunca** vira pergunta — apure e prossiga. Só entra em rodada o
que exige julgamento do usuário (prioridade, escopo, trade-off, decisão irreversível).

## 2. Frontier

Mantenha internamente (não precisa expor a árvore ao usuário) a lista de ambiguidades ainda não
resolvidas. Cada rodada contém apenas as perguntas cuja resposta **não** depende de outra pergunta
ainda em aberto na mesma rodada — uma pergunta que depende da resposta de outra vai para a rodada
seguinte, nunca entra junto. **Não há teto fixo de perguntas por rodada**: a rodada contém toda a
frontier atual (pode ser 1 pergunta, pode ser 6).

## 3. Formato de rodada

```
❓ **Q1** - **<título da decisão>**: <pergunta, com opções se aplicável>
➡️ <resposta recomendada pelo agente>
---
❓ **Q2** - **<título da decisão>**: <pergunta, com opções se aplicável>
➡️ <resposta recomendada pelo agente>
```

## 4. Critério de parada

Repita rodadas até a frontier esvaziar — isto é, nenhuma ambiguidade nova surge das respostas da
última rodada. Não pare por contagem de perguntas respondidas. Se a análise prévia não levantar
nenhuma ambiguidade crítica, pule direto para a fase seguinte sem gerar uma rodada vazia.

## 5. `CONTEXT.md` — glossário de domínio (lazy e opcional)

Extensão opcional do carregamento de contexto: se `.claude/vetor/docs/CONTEXT.md` existir, ele
normalmente já é lido junto com a documentação do projeto (qualquer `.md` em
`.claude/vetor/docs/`). É um glossário **puro**: nunca contém spec ou decisão de implementação,
apenas terminologia de domínio.

Durante a sessão, se um termo do domínio for usado de forma ambígua ou entrar em conflito com o que
já está registrado em `CONTEXT.md`, resolva a definição (apurando fato antes de perguntar — regra do
§1 acima) e escreva/atualize o arquivo com o formato:

```
**<Termo>**: <definição de 1-2 frases>
_Avoid_: <sinônimos banidos, se houver>
```

**Nunca crie o arquivo preventivamente** — só na primeira vez em que um termo é de fato resolvido
durante a sessão.
