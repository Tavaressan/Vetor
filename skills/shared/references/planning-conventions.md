# Convenções de Planejamento e Economia de Tokens (Vetor)

Este documento estabelece o padrão de design para o ciclo de vida de planejamento das skills do Vetor, visando a **experiência do usuário (Human-in-the-Loop)** e a **redução drástica do consumo de tokens**.

---

## 1. Princípios de Economia de Tokens e Contexto

Para evitar sessões com mais de 150k de contexto e o spawn excessivo de subagentes caros:

### 1.1 Limites de Contexto e Leitura Bruta
* **Regra de 100 linhas**: Nunca despeje mais de 100 linhas de logs, documentações ou dumps brutos de arquivos no contexto do agente primário se o CLI `agy` (Gemini) estiver disponível.
* **Delegação Obrigatória**:
  - **Logs de Erro/CI**: Utilize `gh run view <run-id> --log-failed | agy -p "..."` para obter resumos de até 15 linhas antes do diagnóstico.
  - **Documentações longas**: Use `cat <docs> | agy -p "..."` para gerar sumários arquiteturais compactos de alta densidade antes de analisar o backlog.
  - **Dumps de Migrations/Estruturas**: Use `ls -R | agy -p "..."` para pré-auditar antes de o agente ler os arquivos.
* **Compactação Periódica**: Oriente os subagentes a executarem rotinas equivalentes a `/compact` se o histórico de chat local crescer excessivamente, ou a finalizarem a execução assim que atingirem seu objetivo restrito, limpando o cache local.

### 1.2 Regras de Orquestração de Subagentes
* **Haicuzation por Padrão**: Todo subagente worker deve ser configurado por padrão com `haiku` para tarefas classificadas como `fix`, `chore` ou `test` menores.
* **Sonnet sob Demanda**: Limite o uso de `sonnet` apenas para features complexas (`feat`), refatorações estruturais (`refactor`) ou quando um subagente `haiku` esgotar suas iterações e o coordenador optar pelo redespacho seletivo.
* **Transparência Orçamentária**: Todo plano que envolve subagentes deve exibir uma estimativa do custo acumulado da execução em dólares e do limite máximo permitido (budget cap).

---

## 2. Padrão de Artefato: `implementation_plan.md`

Todas as skills que realizam mutações estruturais (criar issues, rodar auto-fixes no repo, despachar subagentes) devem utilizar o arquivo de plano nativo da plataforma.

### 2.1 Estrutura do Arquivo

O arquivo deve seguir este template markdown estrito:

```markdown
# Plano de Execução Vetor — [Nome da Skill]

[Breve sumário executivo da operação]

## Ações Propostas

[Lista detalhada de mutações a serem feitas, ex.: issues a criar, commits a aplicar, subagentes a iniciar]

### Tabela de Configuração e Recursos
[Uma tabela ou bloco de dados estruturado que permite ao usuário revisar o custo/configurações]
Exemplo para Coordinator:
| Subagente/Grupo | Módulo/Issue | Modelo Sugerido | Custo Estimado | Ação |
|-----------------|--------------|-----------------|----------------|------|
| worker-slug-a   | #42          | haiku           | $0.15          | Criar|

*Você pode editar a coluna 'Modelo Sugerido' diretamente neste arquivo para forçar o uso de um modelo diferente antes de aprovar.*

## Estimativa de Consumo e Orçamento

* **Custo Total Estimado**: $X.XX USD
* **Token Budget Limit**: $Y.YY USD (definido em `.claude/settings.json` ou padrão de $2.00)

## Instruções de Aprovação

Clique no botão **Proceed** no seu editor ou confirme para executar o plano acima. O agente só realizará as ações listadas após esta aprovação.
```

### 2.2 Tratamento agnóstico da aprovação do usuário
* Em ecossistemas como **Antigravity / Gemini**, salve o plano definindo `request_feedback: true` nos metadados do artefato. O agente interromperá a chamada até o clique em "Proceed".
* Em ecossistemas que não suportam bloqueio interativo em artefatos, o agente deve exibir o plano no chat e aguardar uma resposta textual afirmativa do usuário (ex.: "sim", "prosseguir") antes de prosseguir com a execução.

---

## 3. Equilíbrio de Princípios: YAGNI, KISS e DRY

Para garantir a eficiência técnica e financeira sem comprometer a precisão do desenvolvimento:

### 3.1 Questionamento Direcionado vs. Suposições (KISS & YAGNI)
Supor o que o usuário deseja sem validação pode levar a implementações incorretas e retrabalho caro (desperdício massivo de tokens). No entanto, conversas longas e abertas esgotam a janela de contexto.
* **A Regra das 3 Perguntas (KISS)**: Se houver ambiguidade crítica sobre a arquitetura, escopo ou comportamento desejado, o agente **deve perguntar**, mas limitando-se a **um único turno com no máximo 3 perguntas diretas e objetivas** (ex.: múltipla escolha ou respostas de sim/não).
* **Foco no Escopo (YAGNI)**: Não pergunte sobre decisões futuras ou cenários hipotéticos que não fazem parte da issue atual. Se o documento de requisitos do repositório ou o prompt inicial fornecerem informações suficientes, prossiga sem questionamentos.

### 3.2 Desenvolvimento e Testes (TDD com KISS e YAGNI)
* **TDD Minimalista**: Antes de alterar o código do sistema, escreva um teste de reprodução simples que falhe (vermelho). O teste deve testar *apenas* o caso de uso ou o bug específico.
* **KISS no Código**: Implemente a solução mais simples e direta possível para fazer o teste passar. Evite refatorações "oportunistas" em arquivos adjacentes ou otimizações prematuras que não foram solicitadas.
* **YAGNI na Arquitetura**: Não crie interfaces, abstrações ou parâmetros extras "para o caso de precisarmos no futuro". Escreva apenas o código estritamente necessário para fechar a issue.

### 3.3 Centralização e Reuso (DRY)
* **Sem Duplicação de Instruções**: As regras de comportamento de escrita de código (TDD, KISS e YAGNI) descritas aqui devem ser consumidas via referência pelos prompts do `issue-worker` e do `fix-loop-agent`, sem a necessidade de replicar longos parágrafos de regras em múltiplos arquivos `.md`.
* **Aproveitamento de Recursos Locais**: Sempre verifique se rotinas complexas (como detecção de testes ou comandos de CI) já não estão resolvidas em scripts compartilhados (`scripts/auto-detect.sh`) ou referências (`project-conventions.md`) antes de tentar reinventar a lógica inline.

