# Investigação: Integração do MCP Lenz (Fact-Checking) ao Plugin Vetor

**Issue:** #295 — chore(mcp): investigar valor de integrar o MCP Lenz (fact-checking) ao plugin
**Data:** 2026-09-29
**Status:** Concluída — fatos de plano, preço e autenticação corrigidos em 2026-09-29 após a revisão
do PR #331 (ver §7)

**Rótulos:** **[Fato]** verificável na fonte citada · **[Inferência]** conclusão derivada de fatos ·
**[Opinião]** juízo ou decisão do autor · **[Não verificado]** nem confirmado em fonte, nem testado.

MCP (*Model Context Protocol*) é o protocolo pelo qual o Claude Code conecta ferramentas externas.
O Lenz é uma API (*Application Programming Interface*) de fact-checking hospedada, exposta como
servidor MCP em `https://lenz.io/mcp`.

---

## 1. Mapeamento de Saídas Geradas por IA no Vetor

O Vetor possui vários pontos onde conteúdo gerado por IA é produzido e poderia se beneficiar de
fact-checking. A coluna de criticidade é **[Opinião]** do autor.

| Skill/Comando | Tipo de Saída | Criticidade |
|--------------|---------------|-------------|
| `/vetor:spec` | Specs estruturadas (RF/RNF, Acceptance Criteria, Edge Cases) | **Alta** — specs viram contrato de implementação |
| `/vetor:backlog-ideator` | Issues GitHub geradas por ideação | Média — passam por aprovação humana antes de criar |
| `/vetor:architecture-review` | Relatório de dívida arquitetural, achados, recomendações | **Alta** — base para decisões técnicas |
| agente `code-review` (despachado pelo `worktree-ship`) | Achados consultivos sobre o diff da PR (bugs, arquitetura, segurança) | **Alta** — feedback direto em PRs |
| `/vetor:issue-coordinator` | Planos de dispatch, relatórios de status | Baixa — operacional, não decisório |

**Gates humanos existentes** (fonte: arquivos do próprio repositório):

- **[Fato]** Specs: o rascunho é mostrado ao usuário, que decide se o salva
  (`skills/spec/SKILL.md` §6).
- **[Fato]** Issues do `backlog-ideator`: nunca são criadas sem aprovação explícita do usuário
  (`skills/backlog-ideator/SKILL.md`, "Restrições"). O `issue-coordinator --headless` não pede
  aprovação do plano (`skills/issue-coordinator/SKILL.md`, seção "Modo headless").
- **[Fato]** O agente `code-review` é **consultivo**: publica comentário na PR e nunca bloqueia o
  merge (`agents/code-review.md`; `skills/worktree-ship/SKILL.md` §8.5). Não é gate de aprovação
  humana.
- **[Fato]** O fluxo de entrega para em review humano só quando o GitHub reporta `reviewDecision`
  igual a `REVIEW_REQUIRED` ou `CHANGES_REQUESTED` (`skills/worktree-ship/SKILL.md` §9).
  **[Não verificado]** se um dado repositório de destino exige review (configuração do GitHub) —
  não foi consultado.

---

## 2. Modelo de Custo do Lenz

**Fontes, todas consultadas em 2026-09-29:**

- https://lenz.io/plans — texto da página lido diretamente.
- https://github.com/lenzhq/lenz-mcp — README do servidor MCP oficial (`lenzhq`, Apache-2.0), lido
  via `raw.githubusercontent.com`.
- https://lenz.io/privacy — política de privacidade ("Last updated: September 2026").
- https://code.claude.com/docs/en/mcp — documentação do Claude Code sobre MCP.

### 2.1 Planos e créditos — [Fato] (lenz.io/plans)

| Plano | Preço | Créditos por mês |
|-------|-------|------------------|
| Free | US$ 0 | 100 |
| Plus | US$ 7,99 | 500 |
| Pro | US$ 99 | 5.000 |
| Scale | US$ 399 | 20.000 |
| Enterprise | sob contato ("Talk to us") — volume acima do Scale, SLAs, white-label, integração sob medida | — |

- Toda conta nova recebe **200 créditos de bônus** (não expiram; gastos depois da franquia mensal).
- Os créditos mensais **não acumulam** para o mês seguinte. Recarga avulsa: 400 créditos por US$ 10
  (não expiram).
- Não há cobrança automática de excedente: a requisição é recusada quando o saldo não cobre o custo.

### 2.2 Custo por chamada — [Fato] (lenz.io/plans; README do lenz-mcp)

| Endpoint | Custo |
|----------|-------|
| `/assess` (checagem rápida) | 1 crédito |
| `/verify` (verificação com fontes) | 10 créditos por afirmação (5 com `depth: "low"`) |
| `/ask` (pergunta de acompanhamento) | 1 crédito |
| `/extract` (lista as afirmações de um texto) | grátis, até 1.000 por dia por conta |
| `/review` (revisão de rascunho) | soma das checagens que executa (1 por checagem rápida, 10 por verificação) |

- **[Fato]** O plano Free lista como alternativas, dentro dos mesmos 100 créditos: 100 checagens
  rápidas, ou 10 verificações, ou 100 acompanhamentos.
- **[Fato]** O `assess_claim` do MCP devolve "one row per claim" (até 20 por texto), e o README
  precifica o `verify_claim` como "ten times an `assess_claim` row".
  **[Inferência]** o crédito de `/assess` é por afirmação, não por texto.
  **[Não verificado]** se a cobrança é por afirmação ou por chamada; a tool `check_usage` do MCP
  devolve a tabela de preços vigente.
- **[Inferência]** Verificar em profundidade uma spec com 10 afirmações custa 100 créditos, ou seja,
  toda a franquia mensal do plano Free.

### 2.3 Autenticação — [Fato] (README do lenz-mcp; docs do Claude Code)

- O README declara: **OAuth** (*Open Authorization*, protocolo de login delegado; "no key — for
  clients that support it") **ou** uma chave de API gratuita (`Authorization: Bearer lenz_…`), que
  "works with any MCP client".
- Configuração por OAuth: só a URL, sem `headers` e sem chave no arquivo:
  `{"type": "http", "url": "https://lenz.io/mcp"}`.
- A seção "Claude Code" do README documenta **apenas** a instalação com chave
  (`--header "Authorization: Bearer ${LENZ_API_KEY}"`), a mesma da issue #295. Portanto
  `LENZ_API_KEY` é um dos dois caminhos, não o único.
- O Claude Code suporta OAuth 2.0 em servidores MCP HTTP remotos (`/mcp`, `claude mcp login <nome>`)
  e mostra um aviso na inicialização quando um servidor configurado precisa de login. Em modo
  não interativo (`claude -p`, Agent SDK) ele não consegue rodar o fluxo OAuth. Se o servidor
  rejeitar um `Authorization` configurado em `headers`, o Claude Code reporta falha de conexão e
  não recorre ao OAuth.
- **[Inferência]** O OAuth funcionaria no Claude Code com o Lenz, pelo trecho do README "any other
  client that supports OAuth for MCP". **[Não verificado]** — não foi testado de ponta a ponta.

### 2.4 Privacidade e retenção — [Fato] (lenz.io/privacy)

- Claims enviadas pela API são privadas por padrão.
- Por padrão o Lenz guarda as claims enviadas, a análise e os logs de requisição "for as long as
  your account exists". Só contas **Pro e Scale** configuram o período de retenção (a menor opção é
  a retenção zero). Os planos Free e Plus não configuram.
- "The claim text you submit is sent to third-party AI models for analysis" (por exemplo, Google
  Gemini), e esses provedores "may have their own data retention policies".
- A retenção configurada cobre todos os canais da conta, incluindo "connected AI assistants".
- **[Não verificado]** Termos de Serviço ("Data We Process") não foram lidos. A política de
  privacidade não menciona treinamento de modelos com o texto enviado (busca textual sem
  ocorrência), mas isso não substitui os Termos.

### 2.5 Conclusão do custo

**[Fato]** O Lenz é um serviço hospedado de terceiros, com plano gratuito (100 créditos por mês
mais 200 de bônus no cadastro), planos pagos com preço público e custo por chamada publicado. Só o
Enterprise é sob contato. **[Inferência]** O custo em dinheiro não é um obstáculo; o custo é em
créditos, conta e privacidade.

---

## 3. Precedente de Dependência Externa

| MCP Atual | Tipo | Dependência |
|-----------|------|-------------|
| Context7 | Documentação de libs | Serviço HTTP remoto de terceiros (`.mcp.json`); funciona sem conta; a API key é opcional (`wiki/MCPs.md`) |
| Chrome DevTools | Browser automation | Binário local (Chrome) |
| Docker | Container inspection | Binário local (Docker) |
| **Lenz (proposto)** | **Fact-checking** | **Serviço HTTP remoto de terceiros; exige conta Lenz (gratuita no plano Free) via OAuth ou chave de API; consome créditos** |

**O que NÃO diferencia o Lenz dos MCPs embarcados:** ser serviço de terceiros e exigir rede. O
`context7`, já embarcado, é igualmente um serviço HTTP remoto (`.mcp.json`).

**O que diferencia (todos [Fato], pelas fontes de §2 e `wiki/MCPs.md`):**

1. Exige conta, mesmo gratuita; o `context7` não exige nada.
2. O que é enviado é o texto a verificar, ou seja, conteúdo gerado pelo Vetor a partir do projeto do
   usuário (§2.4).
3. Consome créditos de um saldo por conta (§2.1 e §2.2).

**[Inferência]** Com uma entrada embarcada no `.mcp.json` que use OAuth (só a URL), todo usuário do
plugin que não tenha feito login no Lenz veria o aviso de "precisa de autenticação" na inicialização
do Claude Code (§2.3). **[Não verificado]** na prática, pois não foi testado.

---

## 4. Comparação com Gates Existentes

| Gate Atual | Natureza | Cobertura | Limitação |
|------------|----------|-----------|-----------|
| Aprovação humana de Specs | Gate humano | Todo rascunho é mostrado ao usuário antes de ser salvo | Depende da atenção do revisor **[Opinião]** |
| Aprovação humana de Issues | Gate humano | `backlog-ideator` nunca cria sem aprovação; o `issue-coordinator --headless` não pede aprovação do plano | Idem |
| Agente `code-review` em PRs | **Consultivo, não é gate** | Só roda com mudança de código-fonte (PRs só de docs, lockfile ou config são puladas); publica comentário; nunca bloqueia merge | Não impede nada por si só; quem age é o humano |
| Review humano no PR (`reviewDecision`) | Gate humano, condicional | O `worktree-ship` para quando o GitHub exige review | **[Não verificado]** se o repositório de destino exige |
| Lenz (adicional) | Automatizado | Fact-checking multi-modelo contra a web aberta | Ver §5 |

**Valor incremental:**

- **[Fato]** O README do Lenz diz que ele verifica claims "against the open web, independent of
  whatever context your model was given", e que por isso "complements retrieval/groundedness
  checkers rather than replacing them".
- **[Inferência]** As saídas do Vetor (specs de um projeto, achados de code review, dívida
  arquitetural) afirmam, na maior parte, fatos sobre o repositório e decisões locais. A web aberta
  não confirma nem refuta isso. Uma minoria das saídas cita fatos externos (versão de biblioteca,
  norma, limite de API), e para documentação de bibliotecas o Vetor já tem o `context7`.
- **[Não verificado]** O ganho real do Lenz sobre os gates humanos. Não foi medido: a issue exclui
  testar a acurácia do produto. Também não há dado sobre quantos erros factuais externos esses
  gates deixam passar hoje.

---

## 5. Recomendação

### **NÃO INTEGRAR POR PADRÃO** — nada é embarcado em `.mcp.json` e nenhum skill passa a chamar o Lenz

**Ramo do critério de aceite da issue:** "não". Não há escopo de integração nem pontos de uso nos
skills a definir.

**A recomendação se manteve, mas por outros motivos.** As justificativas de custo e de dependência
de chave ou conta paga foram **removidas**: os fatos de §2 as refutam (há plano gratuito, preço
público e OAuth sem chave). Também foi removida a justificativa "gate existente suficiente": o
`code-review` é consultivo (§1) e não há evidência sobre a taxa de acerto dos gates humanos com
fatos externos (§4). Também não vale "rede obrigatória / serviço de terceiros", porque o `context7`
embarcado é igual (§3).

**Justificativas atuais:**

| # | Justificativa | Natureza | Base |
|---|---------------|----------|------|
| 1 | O Lenz verifica contra a web aberta. As saídas do Vetor falam do repositório do usuário; para a maior parte delas o Lenz não tem o que confirmar. | **[Fato]** + **[Inferência]** | README do lenz-mcp (§4) |
| 2 | Um skill que chamasse o Lenz automaticamente enviaria conteúdo do projeto a modelos de terceiros; nos planos Free e Plus a retenção não pode ser limitada (padrão: enquanto a conta existir). | **[Fato]** + **[Inferência]** | lenz.io/privacy (§2.4) |
| 3 | Exige conta Lenz (gratuita), e o `context7` embarcado não exige nada. Com OAuth, o aviso de "precisa de autenticação" apareceria para todo usuário que não usa o Lenz. Em modo não interativo o Claude Code não roda o login OAuth (§2.3) e os workers do Vetor são headless (`agents/issue-worker.md`), então dependeriam de um login prévio numa sessão interativa. | **[Fato]** + **[Inferência]** | §2.3 e §3 |
| 4 | O valor incremental sobre os gates humanos não foi demonstrado. | **[Não verificado]** | §4 |

**Custo × benefício:**

- **Custo** — **[Fato]** o Free custa US$ 0 e cobre 100 checagens rápidas ou 10 verificações por
  mês; o Plus custa US$ 7,99 e dá 500 créditos. **[Fato]** exige conta, e a retenção padrão é
  indefinida. **[Inferência]** uma verificação profunda de 10 afirmações usa a franquia mensal
  inteira do Free. **[Opinião]** o custo em dinheiro é baixo.
- **Benefício** — **[Não verificado]**. O encaixe é incerto (justificativa 1) e não foi medido.
- **[Opinião]** Com custo em dinheiro baixo e benefício não demonstrado, não vale embarcar por padrão. A decisão
  é barata de reverter: nada é embarcado, então não há nada a desfazer. Confiança moderada; ela cai
  se aparecer evidência de encaixe (critério C abaixo).

### Critério de reavaliação

Abre uma nova avaliação quando **qualquer um** destes ocorrer. Nenhum está cumprido hoje (estado
verificado em 2026-09-29):

- **A — Contexto próprio:** o Lenz passar a verificar afirmações contra contexto fornecido pelo
  chamador (por exemplo, arquivos do repositório ou documentos privados), documentado em fonte
  oficial. Hoje o README diz que a verificação é contra a web aberta, independente do contexto.
- **B — Retenção no Free:** o plano Free passar a permitir retenção configurável ou zero. Hoje só
  Pro e Scale permitem (lenz.io/privacy).
- **C — Evidência de encaixe:** existir um piloto registrado (nova issue de spike) com pelo menos 10
  saídas reais do Vetor (specs ou relatórios) em que o `assess_claim` tenha marcado pelo menos 3
  afirmações factuais externas como `False` ou `Mostly False`, aprovadas antes pela revisão humana e
  depois confirmadas como erradas por um humano. Hoje não existe piloto. Os limites 10 e 3 são
  escolha **[Opinião]** do autor e podem ser ajustados.

Cada gatilho apenas **reabre a decisão**; nenhum implica integrar.

### Se a reavaliação resultar em "sim"

- O escopo e os pontos de uso nos skills serão definidos naquela avaliação.
- Ponto de partida **[Opinião]**: opcional, documentado em `wiki/MCPs.md`, sem entrada embarcada em
  `.mcp.json`.
- Ausência de conta ou de saldo não pode falhar o fluxo em silêncio. **[Fato]** O README do Lenz
  orienta o agente a informar `status: "quota_exhausted"` "plainly rather than retrying or quietly
  skipping the check".

---

## 6. Próximos Passos (Fora de Escopo Desta Issue)

- [ ] Opcional, a critério do mantenedor: registrar em `wiki/MCPs.md` que o Lenz não é embarcado, e
  como um usuário o adiciona por conta própria (OAuth: só a URL `https://lenz.io/mcp`; ou chave de
  API gratuita).
- [ ] Reavaliar apenas quando um dos gatilhos A, B ou C da §5 ocorrer.

---

## 7. Registro de Correções (revisão do PR #331, 2026-09-29)

| Item | Versão anterior do documento | Verificado na fonte oficial |
|------|------------------------------|-----------------------------|
| Tier gratuito | "Não encontrado evidência de tier gratuito" | Plano Free: US$ 0/mês, 100 créditos/mês, mais 200 de bônus no cadastro (lenz.io/plans) |
| Custo por chamada | "Não publicado — requer contato comercial" | Publicado: `/assess` 1, `/verify` 10 por afirmação, `/ask` 1, `/extract` grátis. Só o Enterprise é sob contato (lenz.io/plans) |
| Planos | "Pagos" | Plus US$ 7,99, Pro US$ 99, Scale US$ 399 (lenz.io/plans) |
| Autenticação | "`LENZ_API_KEY`" | OAuth (sem chave) ou chave de API gratuita; `LENZ_API_KEY` é o segundo caminho (README do lenz-mcp) |
| Gate "Code review em PRs" | Tratado como aprovação humana | Consultivo, nunca bloqueia merge (`agents/code-review.md`) |
| Gate de Specs | "`ExitPlanMode`" | Rascunho mostrado ao usuário, que decide salvar (`skills/spec/SKILL.md` §6); `ExitPlanMode` é do plano do `issue-coordinator` |
| Critério de reavaliação | "Tier gratuito ou preço público" (já cumprido em 2026-09-29) | Substituído pelos gatilhos A, B e C (§5) |

---

**Conclusão da Investigação:** A recomendação de **não integrar por padrão** se mantém, mas os
motivos mudaram: custo e conta paga deixaram de valer, e ficam o descasamento entre a web aberta e o
conteúdo do Vetor, o envio de conteúdo do projeto a terceiros com retenção padrão indefinida no
plano Free, e a ausência de evidência de valor incremental. Nada é conectado aos skills. A
reavaliação depende dos gatilhos A, B ou C (§5), que não estão cumpridos hoje.
