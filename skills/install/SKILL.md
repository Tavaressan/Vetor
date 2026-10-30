---
name: install
description: Porta de entrada do plugin. Inicializa e configura o ambiente do Vetor no projeto-alvo (mapeamento de testes e arquivos de configuração).
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é a skill de inicialização e configuração do Vetor. Sua missão é preparar o repositório-alvo para o uso do plugin, criando os diretórios e arquivos de configuração necessários caso não existam.

---

## Sintaxe

```
/vetor:install [--force]
```

- `--force`: opcional — força a sobrescrita do mapeamento de testes (`module-test-map.md`), do arquivo de
  configuração (`config.json`) e das rules geradas (`.claude/rules/vetor/`) mesmo que já existam.

---

## Referências

> Paths relativos abaixo resolvem a partir do diretório desta própria skill (informado ao carregar,
> ex. "Base directory for this skill: ..."), não do `cwd` de execução. Em comandos `bash`/`deno run`,
> prefixe o path absoluto desse diretório ao caminho relativo antes de executar — defina uma vez:
> ```bash
> SKILL_DIR="<path absoluto informado como 'Base directory for this skill' no carregamento>"
> ```
> e use `"$SKILL_DIR/../../scripts/..."` em todo comando abaixo, nunca o path relativo isolado.

- `../shared/references/mcp-availability.md` — se, durante o setup, for
  preciso explicar ou depurar comportamento do próprio Claude Code (hooks, slash commands,
  configuração de MCP, permissões, SDK de agentes), o MCP `claude-code-docs` é **obrigatório quando
  disponível** (ver "Documentação do próprio Claude Code (`claude-code-docs`)").
- `../shared/references/memory-gotchas.md` — regra de escopo do ai-memory (`.ai-memory.toml` com
  `workspace` e `project`) que o passo 2.c oferece scaffoldar.

---

## Comportamento

### 0 — Verificar pré-requisitos

O Vetor executa seus scripts com Deno. Confirme que ele está disponível:

```bash
deno --version
```

Se o comando falhar, **pare** e instrua a instalação — sem Deno, o hook de segurança e a preparação
de dependências dos worktrees não funcionam:
- macOS/Linux: `curl -fsSL https://deno.land/install.sh | sh`
- Windows: `winget install DenoLand.Deno`

### 1 — Garantir estrutura de diretórios

Crie os diretórios do Vetor no projeto-alvo e garanta que os status files dos workers
(escritos em `.claude/vetor/status/` — ver
`../shared/references/agent-status.template.md`), a Decision Inbox do coordinator
(`.claude/vetor/decision-inbox.json`) e o registro de decisões do modo `--goal`
(`.claude/vetor/goal-audit.json`) nunca sejam commitados:

```bash
mkdir -p .claude/vetor/status
for entry in '.claude/vetor/status/' '.claude/vetor/decision-inbox.json' '.claude/vetor/goal-audit.json'; do
  grep -qxF "$entry" .gitignore 2>/dev/null || echo "$entry" >> .gitignore
done
```

A entrada no `.gitignore` é idempotente — este passo substitui qualquer ajuste de gitignore por
worker.

### 2 — Detectar o projeto (`module-test-map.md` + `config.json` + rules)

Um único script detecta o runtime, gera o mapeamento de testes, persiste a configuração e escreve as
rules de convenção do projeto:

```bash
deno run -A "$SKILL_DIR/../../scripts/detect-project.ts" [--force]
```

Repasse o `--force` recebido nos args. A guarda é **por arquivo**: sem `--force`, cada arquivo que já
existe é preservado (o JSON de saída informa o que foi criado e o que foi pulado).

O script grava:
- `.claude/vetor/module-test-map.md` — comandos de teste por módulo e mapeamento por prefixo de path. Quando a raiz possui runtime detectado, ela é sempre incluída como módulo (`./`). Subdiretórios ignorados pelo `.gitignore` (verificados via `git check-ignore`) nunca viram módulos falsos positivos. Em projetos Node sem script `test` no `package.json`, o comando é composto a partir dos scripts de validação presentes (ex.: `npm run lint && npm run build`) com anotação no mapa de ausência de suíte de testes dedicada; caso nenhum script sirva, grava `AJUSTE:` explícito em vez de um comando inválido;
- `.claude/vetor/config.json` — `runtime`, `packageManager` e `testCommand` detectados (incluindo o comando composto ou `AJUSTE:` em projetos Node sem script de teste), preservando
  o `maxConcurrentWorkers` (default 5), o bloco `knowledge` (`enabled`/`provider`) e o bloco opcional
  `delegation` (`preferredRuntime` — ver `delegate-to-runtime.md`) e o bloco opcional `hooks`
  (`typecheckOnEdit: true` liga o `tsc` a cada edição em projetos Node/TS — ver `wiki/Configuracao.md`)
  e a chave opcional `prewarmWorktrees` (`true` liga o pre-warming de worktrees do coordinator — ver
  `wiki/Configuracao.md`), se já existirem. O
  `prepare-worktree.ts` lê isso para saber como preparar cada worktree;
- `.claude/rules/vetor/<runtime>.md` — convenções do projeto (comando de teste, formatador, lint,
  estilo de import), com frontmatter `paths` para entrarem em contexto **apenas** quando o agente lê
  um arquivo daquele tipo. Só há rules para projetos Deno e Node; nos demais runtimes o script não
  gera nenhuma.

Cada linha de uma rule corresponde a um fato lido do repositório (`deno.json`, `package.json`,
arquivos de config). O que não foi detectado não vira regra.

Se o runtime sair como `unknown`, avise o usuário de que o `module-test-map.md` precisa de ajuste
manual — as skills de teste dependem dele.

O JSON de saída inclui um campo `knowledge` (`{"status": ..., "label": ...}`) com o estado do
**Knowledge Provider** — ver `../shared/references/knowledge-provider-contract.md`.
Ausência do bloco `knowledge` em `config.json` (ou de `config.json` inteiro) nunca é erro: o default é
`✓ Filesystem`, sempre funcional sem configuração adicional. Só vira `○ Disabled` com
`knowledge.enabled: false` explícito, e `✓ Obsidian` com `knowledge.provider: "obsidian"` explícito.

Ausência do bloco `delegation` também nunca é erro: sem `delegation.preferredRuntime` configurado,
a seleção do runtime de delegação (Gemini/OpenCode/Codex) segue puramente por disponibilidade no
PATH e, se ambígua (2+ candidatos), por anuência explícita — ver algoritmo completo em
`delegate-to-runtime.md` §2.

### 2.b — Inserir/atualizar resumo de capacidades em CLAUDE.md/AGENTS.md

`CLAUDE.md`/`AGENTS.md` são os arquivos que agentes de código carregam automaticamente no início de
uma sessão — diferente de `.claude/rules/vetor/`, que só entra em contexto sob demanda. Um
desenvolvedor (ou agente) que abre esses arquivos deve ficar sabendo, sem já conhecer o Vetor de
antemão, que o plugin está instalado e como invocar suas skills/agentes.

Para cada um de `CLAUDE.md` e `AGENTS.md` que já exista na raiz do projeto-alvo, rode:

```bash
deno run -A "$SKILL_DIR/../../scripts/inject-capabilities-doc.ts" <caminho-do-arquivo>
```

O script acha o bloco delimitado por `<!-- vetor:capabilities:start -->` / `<!-- vetor:capabilities:end -->`
e o substitui; se o bloco ainda não existir, insere no fim do arquivo; se o arquivo não existir, não
faz nada — **nunca crie `CLAUDE.md`/`AGENTS.md` do zero**, isso é convenção de onboarding do
projeto-alvo, não algo que o Vetor deva opinar. Rodar `/vetor:install` de novo é idempotente: o bloco é
atualizado no lugar, sem duplicar e sem exigir `--force`.

**Prevenção de duplicidade com `@AGENTS.md` (issue #408):** antes de injetar em `CLAUDE.md`, o script
verifica se o arquivo importa `AGENTS.md` (ex.: linha `@AGENTS.md` ou `@./AGENTS.md`, padrão em projetos
Next.js e create-next-app). Se importar, o script pula a injeção em `CLAUDE.md` (`skipped_imports_agents`) e
o bloco é injetado apenas no `AGENTS.md`, evitando que o Claude Code carregue as capacidades em duplicidade.

O conteúdo do bloco é fixo e definido em uma única fonte — a constante `CAPABILITIES_BODY` em
`scripts/inject-capabilities-doc.ts` — para não divergir entre execuções nem exigir que o agente
redija prosa a cada `/vetor:install`. É um resumo sucinto (não duplica o conteúdo completo dos `SKILL.md`):
título curto, lista das skills/agentes com o comando de invocação e, entre parênteses, o nome do
agente/skill correspondente. Se novas skills forem adicionadas ao plugin, atualize a constante — não
gere a lista ad hoc na hora de rodar `/vetor:install`.

### 2.c — Oferecer o escopo do ai-memory (`.ai-memory.toml`, opcional)

O ai-memory é opcional e não vem embarcado no plugin. Quando ele está ativo, as skills (`/vetor:now`,
`/vetor:fix`, workers) só consultam e registram memória se o `.ai-memory.toml` mais próximo declarar
**ambos** `workspace` e `project` — ver `../shared/references/memory-gotchas.md`. Este passo oferece
criar esse marcador na raiz do projeto-alvo; ele **não** cria nem inicia o container do servidor.

1. Se `.ai-memory.toml` já existir na raiz, não toque nele — nem com `--force`: o escopo declarado
   pertence ao usuário. Registre "já existia" e siga para o passo 3.
2. Caso contrário, faça uma única pergunta via `AskUserQuestion` (criar / pular). Pular é seguro: sem
   o marcador, as skills simplesmente não consultam o ai-memory. Registre "recusado" e siga.
3. Em "criar", peça ao usuário `workspace` e `project` — nunca os adivinhe. Como sugestão editável:
   `default` para o `workspace` e, para o `project`, o caminho do remote `origin` sem o host com `/`
   trocado por `-` (`github.com/acme/api` → `acme-api`) ou, sem remote, o nome da pasta raiz.
4. Valide os dois valores: não podem conter `/`, `\`, espaço em branco ou caracteres de controle
   (regra de `docs/marker-file.md` do ai-memory) nem ser vazios (regra do Vetor). Se algum for
   inválido, peça de novo.
5. Escreva `.ai-memory.toml` na raiz com Write, somente com as duas chaves, e registre "criado":

```toml
workspace = "<workspace>"
project = "<project>"
```

O ai-memory recomenda versionar o arquivo para que todo checkout e worktree resolva o mesmo escopo;
o passo 2 dos próximos passos (§3) já cobre o commit.

### 3 — Exibir Sumário de Configuração e Próximos Passos

Após a criação/validação dos arquivos, exiba uma mensagem informativa clara e amigável para o desenvolvedor:

```
🚀 Vetor inicializado com sucesso!

Runtime detectado: <runtime> (<testCommand>)

Knowledge: <label do campo `knowledge` no JSON de saída — ex.: "✓ Filesystem", "✓ Obsidian" ou "○ Disabled">

Arquivos configurados:
- [x] .claude/vetor/module-test-map.md (Mapeamento de testes por módulo)
- [x] .claude/vetor/config.json (runtime detectado + maxConcurrentWorkers: 5)
- [x] .claude/vetor/status/ (status files dos workers — gitignorado)
- [x] .claude/rules/vetor/<runtime>.md (convenções do projeto, carregadas sob demanda)
- [<x ou ->] CLAUDE.md — bloco de capacidades <inserido | atualizado | ignorado (importa @AGENTS.md) | não encontrado (arquivo ausente)>
- [<x ou ->] AGENTS.md — bloco de capacidades <inserido | atualizado | não encontrado (arquivo ausente)>
- [<x ou ->] .ai-memory.toml — escopo do ai-memory <criado | já existia | recusado>

Próximos passos recomendados:
1. Abra e revise o arquivo `.claude/vetor/module-test-map.md` para garantir que os comandos de teste headless e os mapeamentos de pasta de seu projeto estejam 100% corretos.
2. Revise e **commite** os arquivos de configuração e regras (`.claude/vetor/config.json`, `.claude/vetor/module-test-map.md`, `.claude/rules/vetor/` e, se criado no passo 2.c, `.ai-memory.toml`). Os issue-workers rodam em worktrees, que só contêm arquivos rastreados pelo git — arquivos untracked não chegam até eles e deixam os workers sem mapa de testes nem regras (issue #327).
   **Importante (evitar divergência no squash do ship — issue #409):** se os arquivos forem commitados na branch default local sem push, os worktrees do coordinator nascerão desse commit local. Quando o `ship` realizar squash merge no GitHub, a default remota avançará com um hash diferente e a default local deixará de ser ancestral de `origin/<default>`, falhando no `sync-root` (passo 11 do ship). Use uma das duas opções suportadas:
   - **(a) Commit + push direto na branch default:** comite os arquivos de config na default local e faça `git push origin <default>` antes de despachar o coordinator; ou
   - **(b) PR dedicada para a configuração:** crie uma branch/PR com a configuração do Vetor e faça merge na branch default antes do primeiro dispatch do coordinator.
3. (Opcional) Crie a pasta `.claude/vetor/docs/` e adicione guias de arquitetura, padrões do projeto e gaps em markdown. O comando `/vetor:backlog` lerá automaticamente estes arquivos para propor issues altamente contextualizadas.
4. (Opcional) Rode `/vetor:stack-practices` para gerar regras de melhores práticas da stack detectada (via Context7).
5. (Opcional) Configurar o `ai-memory` — memória local persistida para a consulta preventiva de gotchas/decisões em fixes (`/vetor:fix`) e o registro de aprendizados. Ele não vem embarcado no plugin e o `/vetor:install` não sobe o container:
   - Suba o servidor com a receita `templates/docker-compose.ai-memory.yml` (no diretório do plugin) seguindo `wiki/MCPs.md`: `.env` com o backend de LLM (opcional) e o `.mcp.json` apontando para `http://127.0.0.1:49374/mcp`. O `.env` e as chaves nunca são versionados.
   - Sem o `.ai-memory.toml` do passo 2.c (com `workspace` e `project`), as skills não consultam nem registram memória, mesmo com o servidor ativo.
```

Se o script pulou algum arquivo por já existir, diga qual — e que só `--force` o sobrescreve. Reporte
também o resultado do passo 2.b: se o bloco de capacidades foi inserido, atualizado, ignorado por importar `@AGENTS.md`, ou se nenhum
`CLAUDE.md`/`AGENTS.md` foi encontrado na raiz (nesse caso, nenhuma ação foi tomada).

---

## Restrições

- Nunca execute ações destrutivas em arquivos de configuração existentes sem a flag `--force`
- Nunca altere códigos de negócio ou arquivos fora de `.claude/vetor/` e `.claude/rules/vetor/` — as
  únicas exceções são o bloco de capacidades em `CLAUDE.md`/`AGENTS.md` (passo 2.b) e o
  `.ai-memory.toml` (passo 2.c), criado só com anuência do usuário e nunca sobrescrito
- Nunca escreva em `.claude/rules/` fora do subdiretório `vetor/` — esse espaço é do usuário
