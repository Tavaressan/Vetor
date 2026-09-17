---
name: stack-practices
description: Detecta as libs/frameworks estruturais do projeto e grava regras de melhores práticas via Context7 (conhecimento externo, path-scoped, separado das rules factuais do /vetor).
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é a skill de melhores práticas de stack do Vetor. Sua missão é detectar as libs/frameworks
estruturais do projeto-alvo, consultar o Context7 para cada uma e gravar regras de melhores
práticas — rotuladas explicitamente como conhecimento externo, nunca misturadas às rules factuais
que o `/vetor` já gera.

---

## Sintaxe

```
/stack-practices [--refresh]
```

- sem flag: só gera regras para libs que ainda não têm arquivo em
  `.claude/rules/vetor/best-practices/`.
- `--refresh`: força reconsulta ao Context7 e sobrescreve as regras já existentes — melhores
  práticas envelhecem com o tempo, diferente das rules factuais de `/vetor` (que só mudam quando o
  repo muda).

---

## Referências

> Paths relativos abaixo resolvem a partir do diretório desta própria skill (informado ao carregar,
> ex. "Base directory for this skill: ..."), não do `cwd` de execução. Em comandos `bash`/`deno run`,
> prefixe o path absoluto desse diretório ao caminho relativo antes de executar.

- `../shared/references/mcp-availability.md` — mecanismo de checagem de
  disponibilidade do Context7 ("Documentação de ferramentas/libs (Context7)"). Esta skill é uma das
  que tornam o Context7 **obrigatório quando disponível** — nunca usa conhecimento pré-treinado do
  agente como fonte de melhor prática, com ou sem o MCP.

---

## Comportamento

### 1 — Detectar libs/frameworks estruturais

```bash
deno run -A "../../scripts/lib/deps.ts" .
```

(ou, dentro de outra skill/script Deno, importe `detectStructuralDeps` de
`scripts/lib/deps.ts`). O detector cruza `package.json`, `deno.json`/`deno.jsonc`,
`pyproject.toml` e `Cargo.toml` e devolve só o punhado de dependências diretas *estruturais* —
frameworks web, ORMs, a lib de UI principal — nunca toda dependência declarada nem dependências
transitivas. Uma rule por utilitário/dependência transitiva infla o contexto sem ganho; o escopo
é deliberadamente restrito ao mesmo allowlist do detector.

Sem `--refresh`, filtre a lista às libs que ainda **não** têm arquivo em
`.claude/rules/vetor/best-practices/<lib>.md`. Com `--refresh`, mantenha a lista inteira.

Se a lista resultante estiver vazia (nenhuma lib estrutural detectada, ou todas já têm regra e não
foi passado `--refresh`), reporte e pare — nada a fazer.

### 2 — Checar disponibilidade do Context7

Siga o mecanismo de `mcp-availability.md`: procure por qualquer ferramenta com prefixo
`mcp__context7__` (direta ou diferida via `ToolSearch`).

**Se não disponível:** não gere nenhuma regra para as libs afetadas. Reporte a limitação no
resultado final ("Context7 indisponível — nenhuma regra de melhores práticas gerada para: <libs>")
e pare. **Nunca** escreva melhor prática com base no conhecimento pré-treinado do agente como
fallback — o risco de estar desatualizado para a versão exata em uso é exatamente o que esta skill
existe para evitar.

### 3 — Consultar o Context7 por lib

Para cada lib da lista do passo 1:

1. `mcp__context7__resolve-library-id` para achar o library ID a partir do nome (e, se disponível
   na resposta, restrinja pela versão detectada no passo 1).
2. `mcp__context7__query-docs` com uma pergunta específica e escopada, no estilo "práticas atuais
   recomendadas e APIs deprecated para `<lib>` versão `<versão>`" — nunca uma pergunta genérica que
   force o Context7 a devolver um resumo raso.

Se a resolução ou a query falharem para uma lib específica (lib não indexada, erro transiente),
**pule só aquela lib** — reporte a falha no resultado e continue com as demais. Uma lib com erro
nunca bloqueia a geração das regras das outras.

### 4 — Gravar a regra

Para cada lib com resposta do Context7, escreva `.claude/rules/vetor/best-practices/<lib>.md`:

```markdown
---
paths:
  - "<globs relevantes à lib, ex. '**/*.tsx' para uma lib de UI React>"
---

> Gerado por `/stack-practices` a partir da documentação de <lib>@<versão> via Context7 em <data ISO>.
> Conhecimento externo, não um fato observado neste repositório — pode ficar desatualizado.
> Rode `/stack-practices --refresh` periodicamente. Editável — não sobrescrito sem `--refresh`.

# Melhores práticas — <lib>@<versão>

- <bullet curto e citável, só o que o Context7 retornou como prática atual documentada>
- <...>
```

Regras:
- Cabeçalho de proveniência (as 3 linhas `>`) é obrigatório e distinto do `ORIGIN` usado pelas
  rules factuais de `scripts/lib/rules.ts` — nunca escreva regra de melhor prática no mesmo arquivo
  `.claude/rules/vetor/<runtime>.md` gerado pelo `/vetor`, cuja regra de ouro é "só fato observado
  localmente". `.claude/rules/vetor/best-practices/` é um diretório à parte.
- `<data ISO>` é a data da consulta, não uma data fixa — usada depois pelo guardian para medir
  staleness (passo 5).
- Bullets refletem só o que a fonte (Context7) disse — nunca elaboração ou inferência do agente
  além do que a resposta retornou.
- Sem `--refresh`, nunca sobrescreva um arquivo já existente para a mesma lib.

### 5 — Sinalizar staleness no guardian (referência cruzada)

Esta skill não roda o guardian. A auditoria de staleness (regra de melhor prática com mais de 90
dias desde a última consulta) já está documentada em `skills/guardian/SKILL.md` — nenhuma ação
extra aqui, além de manter a data no cabeçalho (passo 4) precisa e atualizada a cada
`--refresh`, já que é o dado que o guardian lê.

### 6 — Reportar

Ao final, resuma:
- Libs detectadas no passo 1 e quais já tinham regra (puladas, sem `--refresh`).
- Libs com regra gerada/atualizada nesta execução, com a versão consultada.
- Libs puladas por falha de resolução/query no Context7 (passo 3).
- Se o Context7 não estava disponível: a lista completa de libs sem regra por esse motivo (passo 2).

---

## Restrições

- Nunca gera regra de melhor prática sem o Context7 disponível — sem exceção, sem fallback de
  conhecimento pré-treinado.
- Nunca escreve em `.claude/rules/vetor/<runtime>.md` (rules factuais do `/vetor`) — só em
  `.claude/rules/vetor/best-practices/`.
- Nunca gera regra para dependência transitiva ou utilitária fora do allowlist estrutural do
  detector (`scripts/lib/deps.ts`).
- Sem `--refresh`, nunca sobrescreve uma regra já existente.
