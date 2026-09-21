# Convenções de Planejamento e Economia de Tokens (Vetor)

Este documento estabelece o padrão de design para o ciclo de vida de planejamento das skills do Vetor, visando a **experiência do usuário (Human-in-the-Loop)** e a **redução drástica do consumo de tokens**.

---

## 1. Princípios de Economia de Tokens e Contexto

Para evitar sessões com mais de 150k de contexto e o spawn excessivo de subagentes caros:

### 1.1 Limites de Contexto e Leitura Bruta
* **Regra de 100 linhas**: Nunca despeje mais de 100 linhas de logs, documentações ou dumps brutos de arquivos no contexto do agente primário se houver um runtime de delegação disponível (Gemini/OpenCode/Codex — ver `delegate-to-runtime.md`).
* **Delegação Obrigatória** (sintaxe de invocação e algoritmo de seleção de runtime em `delegate-to-runtime.md` §1-2; `$DELEGATE` = comando do runtime selecionado):
  - **Logs de Erro/CI**: Utilize `gh run view <run-id> --log-failed | $DELEGATE "..."` para obter resumos de até 15 linhas antes do diagnóstico.
  - **Documentações longas**: Use `cat <docs> | $DELEGATE "..."` para gerar sumários arquiteturais compactos de alta densidade antes de analisar o backlog.
  - **Dumps de Migrations/Estruturas**: Use `ls -R | $DELEGATE "..."` para pré-auditar antes de o agente ler os arquivos.
* **Finalização Restrita**: Oriente os subagentes a finalizarem a execução assim que atingirem seu objetivo restrito, em vez de manter contexto acumulando além do necessário.

### 1.2 Regras de Orquestração de Subagentes
* **Haicuzation por Padrão**: Todo subagente worker deve ser configurado por padrão com `haiku` para tarefas classificadas como `fix`, `chore` ou `test` menores.
* **Sonnet sob Demanda**: Limite o uso de `sonnet` apenas para features complexas (`feat`), refatorações estruturais (`refactor`) ou quando um subagente `haiku` esgotar suas iterações e o coordenador optar pelo redespacho seletivo.

---

## 2. Aprovação do plano antes de despachar subagentes

Todas as skills que realizam mutações estruturais (criar issues, rodar auto-fixes no repo, despachar
subagentes) devem apresentar o plano de ações e obter aprovação explícita do usuário antes de agir.
O mecanismo de aprovação depende do ecossistema — ver §2.2.

### 2.1 Conteúdo mínimo do plano

Independente do mecanismo de aprovação, o plano apresentado deve conter:

```markdown
# Plano de Execução Vetor — [Nome da Skill]

[Breve sumário executivo da operação]

## Ações Propostas

[Lista detalhada de mutações a serem feitas, ex.: issues a criar, commits a aplicar, subagentes a iniciar]

### Tabela de Configuração e Recursos
Exemplo para Coordinator:
| Subagente/Grupo | Módulo/Issue | Modelo Sugerido | Ação |
|-----------------|--------------|-----------------|------|
| worker-slug-a   | #42          | haiku           | Criar|

*Você pode pedir para forçar o uso de um modelo diferente antes de aprovar.*
```

### 2.2 Mecanismo de aprovação por ecossistema

#### Para skills de implementação de código (`fix-loop-agent`, `issue-worker`, e similares)

* **No Claude Code**: use o plan mode nativo — apresente o plano acima e conclua com `ExitPlanMode`
  para pedir aprovação do usuário. Este é o caminho de primeira classe no Claude Code para código,
  não um fallback.
* **No Antigravity/Gemini**: salve o plano no artefato `implementation_plan.md` definindo
  `request_feedback: true` nos metadados. O agente interromperá a chamada até o clique em "Proceed".

#### Para skills de orquestração/ideação (`backlog-ideator`, `issue-coordinator`, `guardian`)

Estas skills realizam mutações estruturais (criar issues, orquestrar subagentes) mas **não implementam
código de produto**. Para elas:

* **No Claude Code**: exiba o plano no chat e aguarde uma resposta textual afirmativa do usuário
  (ex.: "sim", "prosseguir"). **Não use `ExitPlanMode`** — a ferramenta a desaconselha explicitamente
  para tarefas fora do escopo de escrita de código.
* **No Antigravity/Gemini**: salve o plano no artefato `implementation_plan.md` definindo
  `request_feedback: true` nos metadados. O agente interromperá a chamada até o clique em "Proceed".

#### Fallback para ecossistemas sem mecanismo nativo

Em ecossistemas sem nenhum dos dois mecanismos acima, exiba o plano no chat e aguarde uma resposta
textual afirmativa do usuário (ex.: "sim", "prosseguir") antes de prosseguir com a execução.

---

## 3. Equilíbrio de Princípios: YAGNI, KISS e DRY

Regras não-óbvias de escrita de código, consumidas por referência pelos prompts do `issue-worker`
e do `fix-loop-agent` (não replique estes parágrafos nas skills):

* **Regra das 3 perguntas**: só pergunte quando houver ambiguidade crítica de arquitetura/escopo,
  e nunca mais de 3 perguntas objetivas num único turno. Se o prompt/requisitos já bastam,
  prossiga sem perguntar (YAGNI — não pergunte sobre cenários futuros).
* **TDD antes do fix**: red antes de green — escreva primeiro um teste de reprodução que falhe,
  cobrindo só o bug em questão, antes de tocar no código de produto. Disciplina completa (bom teste,
  seams, anti-padrões, mocking) em `tdd-conventions.md` — não replique o texto aqui.
* **KISS/YAGNI no código**: a menor alteração que faz o teste passar; sem refatoração oportunista
  em arquivos adjacentes nem abstrações "para o futuro".
* **Reuso antes de reinventar**: rotinas complexas (detecção de testes, checagens de git) já podem
  estar em `scripts/` (ex.: `detect-project.ts`, `vetor-checks.sh`) ou nas referências — verifique
  antes de escrever lógica inline.

