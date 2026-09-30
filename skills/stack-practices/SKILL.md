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
/vetor:stack-practices [--refresh]
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
> prefixe o path absoluto desse diretório ao caminho relativo antes de executar — defina uma vez:
> ```bash
> SKILL_DIR="<path absoluto informado como 'Base directory for this skill' no carregamento>"
> ```
> e use `"$SKILL_DIR/../../scripts/..."` em todo comando abaixo, nunca o path relativo isolado.

- `../shared/references/mcp-availability.md` — mecanismo de checagem de
  disponibilidade do Context7 ("Documentação de ferramentas/libs (Context7)"). Esta skill é uma das
  que tornam o Context7 **obrigatório quando disponível** — nunca usa conhecimento pré-treinado do
  agente como fonte de melhor prática, com ou sem o MCP.

---

## Comportamento

### 1 — Detectar libs/frameworks estruturais

```bash
deno run -A "$SKILL_DIR/../../scripts/lib/deps.ts" .
```

(ou, dentro de outra skill/script Deno, importe `detectStructuralDeps` de
`scripts/lib/deps.ts`). O detector cruza `package.json`, `deno.json`/`deno.jsonc`,
`pyproject.toml` e `Cargo.toml` e devolve só o punhado de dependências diretas *estruturais* —
frameworks web, ORMs, a lib de UI principal — nunca toda dependência declarada nem dependências
transitivas. Uma rule por utilitário/dependência transitiva infla o contexto sem ganho; o escopo
é deliberadamente restrito ao mesmo allowlist do detector.

**Pacotes irmãos (regra única, vale para todos os passos).** Pacotes que compartilham a mesma
documentação formam um **grupo** e, daqui em diante, contam como **uma** lib: uma resolução e uma
query (feitas com o nome do líder), um único arquivo `<líder>.md`. Grupos reconhecidos — lista
fechada, no formato `membro → líder`; qualquer outro pacote é independente: `react-dom → react`.

- O grupo entra na lista se qualquer membro foi detectado. O arquivo é sempre `<líder>.md`, mesmo
  que só um membro esteja no projeto. A versão instalada do grupo é a do líder; se o líder não foi
  detectado, a do primeiro membro detectado.
- No cabeçalho e no título do passo 4, `<lib>@<versão-instalada>` vira a lista dos membros
  detectados, cada um com a sua versão instalada (ex.: `react@19.2.8, react-dom@19.2.8`).
- Falha ou "sem fonte oficial" no passo 3 pula o grupo inteiro — nunca só um membro.

Sem `--refresh`, filtre a lista às libs que ainda **não** têm arquivo em
`.claude/rules/vetor/best-practices/<lib>.md` (`<lib>` = o líder, no caso de um grupo — assim um
irmão já coberto não reaparece como candidato). Com `--refresh`, mantenha a lista inteira.

Se a lista resultante estiver vazia (nenhuma lib estrutural detectada, ou todas já têm regra e não
foi passado `--refresh`), reporte e pare — nada a fazer.

### 2 — Checar disponibilidade do Context7

Siga o mecanismo de `mcp-availability.md`: procure as ferramentas `resolve-library-id` e
`query-docs` cujo **segmento de servidor** case com `context7` — `mcp__context7__…` (standalone) ou
`mcp__plugin_<plugin>_context7__…` (empacotado), nunca por substring solta. Com mais de um segmento
correspondente, escolha pela ordem de preferência do item 4 daquele documento.

Guarde o prefixo completo escolhido (ex.: `mcp__context7__` ou `mcp__plugin_vetor_context7__`) como
`<ctx7>`. O passo 3 usa **somente** `<ctx7>resolve-library-id` e `<ctx7>query-docs` — nunca um
prefixo fixo. Se as ferramentas estiverem diferidas, carregue-as antes com `ToolSearch`
(`select:<ctx7>resolve-library-id,<ctx7>query-docs`).

**Se não disponível:** não gere nenhuma regra para as libs afetadas. Reporte a limitação no
resultado final ("Context7 indisponível — nenhuma regra de melhores práticas gerada para: <libs>")
e pare. **Nunca** escreva melhor prática com base no conhecimento pré-treinado do agente como
fallback — o risco de estar desatualizado para a versão exata em uso é exatamente o que esta skill
existe para evitar.

### 3 — Consultar o Context7 por lib

Para cada lib da lista do passo 1:

1. **Resolver o library ID versionado.** Chame `<ctx7>resolve-library-id` com o nome da lib.
   Percorra os resultados na ordem devolvida e fique com o primeiro que (a) não seja `/websites/*`
   (site indexado — nunca produz `Source` em tag, ver item 3) e (b) liste em `Versions` ao menos uma
   *versão de release*. Não são release: entradas `__branch__*` e pré-releases (`-canary`, `-rc`,
   `-beta`, `-alpha`, `-next`). Escolha a versão nesta ordem: a igual à instalada (`v<V>` ou
   `<V>`); senão a maior versão de release menor que a instalada e da mesma major (ex.: instalada
   16.3.6, indexada até `v16.2.9` → `v16.2.9`); se a instalada for `unknown`, a maior de release
   listada. O ID consultado é `/<org>/<projeto>/<versão-docs>` e `<versão-docs>` é esse sufixo.
   Sem resultado que atenda (a) e (b), ou sem versão escolhível: pule a lib e registre "sem fonte
   oficial na versão <V-instalada>" no passo 6 — não consulte o ID sem versão.
2. **Consultar.** `<ctx7>query-docs` com o ID versionado e uma pergunta específica e escopada, no
   estilo "práticas atuais recomendadas e APIs deprecated para `<lib>` versão `<versão-docs>`" —
   nunca uma pergunta genérica que force o Context7 a devolver um resumo raso.
3. **Filtro de Source.** Cada snippet devolvido traz uma linha `Source: <URL>`. Aceite o snippet só
   se a URL for `https://github.com/<org>/<projeto>/blob/<versão-docs>/<caminho>` (ou
   `/tree/<versão-docs>/…`), com `<org>/<projeto>` e `<versão-docs>` idênticos aos do ID consultado.
   Isso define os dois critérios:
   - **Oficial** = arquivo do repositório do mantenedor (o `<org>/<projeto>` do library ID — a
     skill confia na atribuição do Context7, não verifica a origem do repositório por conta
     própria). Não contam: agregadores (`/websites/*`, deepwiki), blogs, gists, fóruns, repositórios de outra org
     nem snippet sem `Source`. Um site de documentação do mantenedor (ex.: `nextjs.org/docs/…`)
     também não passa, ainda que seja do mantenedor: a URL não fixa versão.
   - **Na tag da versão consultada** = o ref após `blob/`/`tree/` é exatamente `<versão-docs>`. Não
     contam `blob/main/`, `blob/canary/`, qualquer outro branch, outra versão nem SHA.

   Descarte os demais snippets por inteiro, incluindo texto editorial anexado a eles. Se nenhum
   snippet sobrar: **não grave regra** para a lib e registre "sem fonte oficial na versão
   <versão-docs>" no passo 6. Nunca preencha com snippets descartados nem com conhecimento
   pré-treinado. Sem arquivo gravado, a lib volta como candidata na próxima execução (filtro do
   passo 1) — comportamento esperado, igual ao de uma falha de resolução.

Se a resolução ou a query falharem por outro motivo (lib não indexada, erro transiente),
**pule só aquela lib** — reporte a falha no resultado e continue com as demais. Uma lib com erro
nunca bloqueia a geração das regras das outras.

### 4 — Gravar a regra

Para cada lib com ao menos um snippet aceito pelo filtro de Source (passo 3, item 3), escreva `.claude/rules/vetor/best-practices/<lib>.md`:

```markdown
---
paths:
  - "<globs relevantes à lib, ex. '**/*.tsx' para uma lib de UI React>"
---

> Gerado por `/vetor:stack-practices` a partir da documentação de <lib>@<versão-instalada> (docs consultadas: <versão-docs>) via Context7 em <data ISO>.
> Conhecimento externo, não um fato observado neste repositório — pode ficar desatualizado.
> Rode `/vetor:stack-practices --refresh` periodicamente. Editável — não sobrescrito sem `--refresh`.

# Melhores práticas — <lib>@<versão-instalada> (docs: <versão-docs>)

- <bullet curto e citável, só o que o Context7 retornou como prática atual documentada>
- <...>
```

Regras:
- Cabeçalho de proveniência (as 3 linhas `>`) é obrigatório e distinto do `ORIGIN` usado pelas
  rules factuais de `scripts/lib/rules.ts` — nunca escreva regra de melhor prática no mesmo arquivo
  `.claude/rules/vetor/<runtime>.md` gerado pelo `/vetor`, cuja regra de ouro é "só fato observado
  localmente". `.claude/rules/vetor/best-practices/` é um diretório à parte.
- **O cabeçalho registra a versão instalada e a versão de docs consultada**; se divergirem, o
  passo 6 reporta a divergência.
- `<data ISO>` é a data da consulta, não uma data fixa — usada depois pelo guardian para medir
  staleness (passo 5).
- Bullets refletem só o que a fonte (Context7) disse — nunca elaboração ou inferência do agente
  além do que a resposta retornou.
- **Source oficial na tag da versão consultada** (regra adicional — não substitui a anterior): só
  entram bullets de snippets aceitos pelo filtro de Source do passo 3 (item 3).
- Sem `--refresh`, nunca sobrescreva um arquivo já existente para a mesma lib.

### 5 — Sinalizar staleness no guardian (referência cruzada)

Esta skill não roda o guardian. A auditoria de staleness (regra de melhor prática com mais de 90
dias desde a última consulta) já está documentada em `skills/guardian/SKILL.md` — nenhuma ação
extra aqui, além de manter a data no cabeçalho (passo 4) precisa e atualizada a cada
`--refresh`, já que é o dado que o guardian lê.

### 6 — Reportar

Ao final, resuma:
- Libs detectadas no passo 1 e quais já tinham regra (puladas, sem `--refresh`).
- Libs com regra gerada/atualizada nesta execução, com a versão instalada e a versão de docs consultada.
- **Divergências de versão** (versão instalada ≠ versão de docs indexada) — sinalize explicitamente.
- Libs puladas por falha de resolução/query no Context7 (passo 3).
- Libs sem regra por "sem fonte oficial na versão X" (passo 3: sem ID versionado utilizável ou
  nenhum snippet aceito pelo filtro de Source), com a versão X.
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
