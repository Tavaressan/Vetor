# Investigação: hook `WorktreeCreate` contra o worktree nativo do Claude Code

**Issue:** #577 — spike(worktree): hook WorktreeCreate versus worktree nativo no Claude Code
**Data:** 2026-11-09
**Base:** `master` em `f6ab98f`
**Versão observada:** Claude Code 2.1.319 (`claude --version`)
**Contexto:** depende da #568 (contrato de capacidades), já fechada. Relaciona-se com a #586 (D1:
três criadores de worktree).

**Rótulos:** **[Fato]** reproduzido aqui ou citado da documentação com o texto literal · **[Doc,
resumo]** trecho da documentação que só foi obtido por resumo, sem o texto literal verificado ·
**[Inferência]** · **[Opinião]** · **[Não verificado]**.

**Fontes (lidas em 2026-11-09; as páginas não mostram data):**
`https://code.claude.com/docs/en/worktrees.md`, `…/hooks.md`, `…/sub-agents.md`,
`…/common-workflows.md`, `…/settings-reference.md`.

---

## 1. Pergunta

O Vetor registra o hook `WorktreeCreate` (`hooks/hooks.json`, `scripts/prepare-worktree.ts`). Segundo a
documentação, esse hook substitui a criação padrão do git e desliga o `.worktreeinclude`.

1. Quais recursos nativos se perdem hoje por causa do hook?
2. O caminho nativo atende à instalação de dependências que o `prepare-worktree.ts` faz?
3. Como o nome nativo de branch, `worktree-<nome>`, afeta a convenção do Vetor e o `safety-check`?

## 2. Resumo

- **[Fato]** O hook troca o caminho inteiro de criação do Claude Code. Isso vale para os subagentes
  com `isolation: "worktree"`, para o `--worktree` interativo do usuário e para as sessões em
  background, não só para o coordinator.
- **[Fato]** Com o hook, o Vetor perde: `.worktreeinclude`, base no default **remoto** com fetch,
  `git worktree lock` durante a execução, o marcador de varredura e a **remoção automática** do
  worktree e da branch. Para worktrees criados por hook, a doc diz: "Remove those worktrees yourself"
  e "Claude Code never deletes a branch belonging to a hook-created worktree" **[Doc, resumo]**.
- **[Fato]** O único ganho do hook é instalar dependências na criação. O Claude Code não instala
  dependências: a doc manda "ask Claude to install dependencies, or run your project's setup yourself".
  Só que o próprio Vetor já tem o caminho portátil para isso, `prepare-worktree.ts --path`, que é o
  fallback documentado para os outros harnesses.
- **[Fato]** O nome `worktree-<nome>` não afeta o `safety-check` nem o status file: os dois usam a
  branch **atual**, e o worker troca para `<type>/<issue#>-<slug>` no primeiro passo. O efeito real é
  uma branch inicial sobrando, que precisa entrar na limpeza.
- **[Opinião]** Recomendação: **remover o hook `WorktreeCreate` no Claude Code** e mover a preparação
  de dependências para o primeiro passo do worker, que é o mesmo caminho dos outros harnesses. As
  condições estão no §6.

## 3. Evidências

### 3.1 O que o hook faz hoje (reproduzido)

Repositório descartável com `origin`, `.gitignore` com `.env` e `node_modules/`, `.worktreeinclude`
com `.env`, um `.env` local e um commit local que não foi enviado ao `origin`. O hook rodou com o
mesmo payload do Claude Code:

```sh
echo '{"cwd":"<repo>","name":"bold-oak-a3f2","hook_event_name":"WorktreeCreate","session_id":"x"}' \
  | deno run -A scripts/prepare-worktree.ts
```

```text
local HEAD=49188d4 origin=3423ca0
exit=0 364ms
branch=bold-oak-a3f2 base=49188d4 .env=ausente node_modules=nao
branch refs/heads/bold-oak-a3f2          (git worktree list --porcelain: sem "locked")
```

**[Fato]**

- A branch é o próprio `name`, sem tipo (`prepare-worktree.ts:158-159`).
- A base é a branch default **local**, que tinha um commit não enviado (`prepare-worktree.ts:160-165`).
- O `.env` listado no `.worktreeinclude` não foi copiado.
- O worktree não ficou travado (`locked`).
- A instalação rodou (`npm ci`) e falhou por falta de lockfile. O hook seguiu, como projetado
  (`prepare-worktree.ts:11`), e saiu com 0.

### 3.2 Comportamento nativo (documentação)

| Recurso nativo | Texto da documentação | Com o hook do Vetor |
| --- | --- | --- |
| Substituição total | "Configure a `WorktreeCreate` hook to replace the default `git worktree` logic entirely" (worktrees.md). Gatilho: "When a worktree is being created via `--worktree`, `isolation: "worktree"`, or for a background session. Replaces default git behavior" (hooks.md) | vale para todos os worktrees do Claude Code no projeto onde o plugin está ativo |
| `.worktreeinclude` | "Because the hook replaces the default git behavior, [`.worktreeinclude`] is not processed when you use `--worktree`. Copy any local configuration files inside your hook script instead." (worktrees.md) | **perdido**: o `prepare-worktree.ts` não copia nada (§3.1) |
| Base | "New worktrees branch from the repository's default branch"; o padrão `"fresh"` usa o default do remoto e "When the repository hasn't been fetched in the last 24 hours, it fetches the default branch, capped at five seconds" (worktrees.md) | **diferente**: base local, sem fetch |
| Base configurável | `worktree.baseRef`: `"fresh"` (padrão) ou `"head"`; "Subagent worktrees use the same base branch as `--worktree`" (worktrees.md) | ignorada pelo hook **[Não verificado]**: a doc não diz se a chave vale com hook |
| Caminho e branch | "under `.claude/worktrees/<name>/` at your repository root, on a new branch named `worktree-<name>`" (worktrees.md) | mesmo caminho; branch `<name>` |
| Trava | "While an agent is running, Claude Code holds a `git worktree lock` on its worktree" (worktrees.md) | **perdida**: sem `locked` (§3.1) |
| Remoção do subagente | "Each subagent gets a temporary worktree that Claude Code removes automatically when the subagent finishes without changes" (worktrees.md) | **perdida**: "When a subagent or a workflow agent finishes, Claude Code keeps the worktree your WorktreeCreate hook made for it and doesn't run your WorktreeRemove hook. Remove those worktrees yourself" **[Doc, resumo]** |
| Varredura periódica | a varredura "removes worktrees that Claude created for subagents and background sessions once they are older than your `cleanupPeriodDays`"; ela "keeps any worktree without [the marker], including a worktree a WorktreeCreate hook created" (worktrees.md) | **perdida** |
| Branch na limpeza | "Claude Code never deletes a branch belonging to a hook-created worktree" **[Doc, resumo]** | o Vetor apaga pelo próprio fluxo (`vetor-checks.sh delete-merged-branch`) |
| Segurança na criação | pula filter drivers do repositório, `GIT_NO_REPLACE_OBJECTS=1`, recusa `.claude/worktrees` com symlink (worktrees.md) | não replicado no `prepare-worktree.ts` |
| Diretórios grandes | `worktree.symlinkDirectories`: "Symlink large directories into each worktree instead of duplicating them" **[Doc, resumo]** | o `prepare-worktree.ts:79` já reconhece um `node_modules` preparado assim |
| Dependências | "A worktree is a fresh checkout, so initialize your development environment there: ask Claude to install dependencies, or run your project's setup yourself" (worktrees.md) | **ganho do hook**: instala na criação |

**[Fato]** O Vetor não registra `WorktreeRemove` (`grep -rn WorktreeRemove hooks scripts skills wiki`
sem resultado). A limpeza dos worktrees de worker depende só do coordinator (Fase 7,
`vetor-checks.sh safe-remove-worktree`).

### 3.3 Onde o Vetor supõe o comportamento do hook

| Suposição | Onde | Com o nativo |
| --- | --- | --- |
| Worktree nasce do **HEAD local do root** | `issue-coordinator-dispatch.md:49,54,148`; `worktree-prewarm.md:31` | Muda com o `"fresh"` padrão (default remoto). Fica igual com `worktree.baseRef: "head"` |
| Dependências prontas antes do primeiro turno | `prepare-worktree.ts` (modo hook) e o marcador `prepare-failed` lido por `prewarm-worktrees.ts:226` | O worker precisaria preparar no primeiro passo |
| Branch inicial descartável | o worker roda `git checkout -b <type>/<issue#>-<slug>` (`issue-coordinator-dispatch.md:14`) | igual; sobra `worktree-<nome>` em vez de `<nome>` |
| Status e guardas pela branch atual | `lib/status.ts:43,52-53`; `lib/safety-policy.ts:493-508` | sem efeito: a branch atual já é a do worker |

### 3.4 Pergunta 3: `worktree-<nome>` e o `safety-check`

**[Fato]**

- O status file é `<root>/.claude/vetor/status/<branch>.md`, com a branch **atual**
  (`lib/status.ts:1,43,52-53`).
- A guarda de push só bloqueia `main`, `master` e `production`, e a de worker não-GREEN só age quando
  há status file para a branch atual. Sem status file, "a branch não pertence ao fluxo do coordinator:
  não interfere" (`lib/safety-policy.ts:471-508`).
- Antes do `git checkout -b`, a branch é `worktree-<nome>` (nativo) ou `<nome>` (hook). Nenhuma das
  duas tem status file, então as guardas tratam as duas igual.
- O `guardian-audit.ts` só confere o local (`.claude/worktrees/`, `:186`), que é o mesmo nos dois
  caminhos.

**[Inferência]** O único efeito é a branch inicial que sobra depois do `checkout -b`. No caminho
nativo, ela aponta para a base sem commits próprios, então `git branch -d` a apaga sem `-D` (que o
`safety-check` bloqueia). Ela precisa entrar na limpeza da Fase 7. Hoje a branch `<nome>` criada
pelo hook também sobra; este repositório não tem nenhuma porque a limpeza atual já as apaga
(`git branch --list` em 2026-11-09: só `master`, `docs/*` e uma branch de usuário).

## 4. Respostas

1. **O que se perde:** `.worktreeinclude`; a base no default remoto com fetch; a trava
   `git worktree lock`; a remoção automática do worktree sem mudanças e a varredura periódica; as
   proteções de criação (filter drivers, replace objects, recusa de symlink). Isso vale também para o
   `claude --worktree` do próprio usuário, fora do fluxo do Vetor.
2. **Dependências:** o nativo não instala. Mas o Vetor já tem o comando portátil
   (`deno run -A scripts/prepare-worktree.ts --path "$PWD"`), que é o fallback documentado em
   `harness-capabilities.md` §2.2 para os harnesses sem `WorktreeCreate`. Mover a preparação para o
   primeiro passo do worker cobre o caso sem o hook. `worktree.symlinkDirectories` pode evitar a
   instalação por worktree em projetos Node, e o `prepare-worktree.ts:79` já detecta isso.
3. **Nome da branch:** sem efeito no `safety-check` nem no status file. Exige só incluir
   `worktree-<nome>` na limpeza da Fase 7.

## 5. Opções avaliadas

### Opção A: manter o hook

- A favor: dependências prontas no primeiro turno; zero mudança.
- Contra: perde tudo do §4.1, inclusive para worktrees que o usuário cria fora do Vetor. Os worktrees
  de subagente que terminam sem mudanças nunca são removidos pelo Claude Code.

### Opção B: reduzir o hook

O hook continua, mas replica o nativo: base remota com fetch, cópia do `.worktreeinclude`, `lock`.

- Contra: reimplementa o Claude Code dentro do plugin, e cada mudança de versão do harness vira
  divergência. A remoção automática e a varredura continuam perdidas, porque dependem do marcador
  interno, que um hook não escreve.

### Opção C: remover o hook no Claude Code (recomendada)

- O worker roda `prepare-worktree.ts --path "$PWD"` como primeiro passo, logo depois do `cd` e do
  `vetor-checks.sh in-worktree`, o mesmo comando dos outros harnesses.
- O `install` do Vetor grava `worktree.baseRef: "head"` em `.claude/settings.json` do projeto, para
  manter a base no HEAD local do root que o coordinator supõe.
- A Fase 7 apaga a branch inicial `worktree-<nome>` com `vetor-checks.sh delete-merged-branch`.
- A favor: recupera todos os recursos nativos; um único caminho de preparação para todos os harnesses
  (ajuda a D1 da #586); o `--worktree` do usuário volta ao normal.
- Contra: o primeiro turno do worker gasta o tempo da instalação (em Deno puro, zero:
  `[vetor] runtime=deno: nenhuma preparação necessária`, #586 §3.2); a preparação passa a depender
  de instrução, não de mecanismo.

## 6. Recomendação

**[Opinião]** **Opção C, remover o hook `WorktreeCreate` do `hooks/hooks.json`**, com três condições
na mesma mudança:

1. O prompt do worker (`scripts/lib/orchestrator/dispatch-prompt.ts`) ganha o passo
   `deno run -A <plugin>/scripts/prepare-worktree.ts --path "$PWD"` antes de qualquer teste, e o
   marcador `prepare-failed` continua valendo.
2. `worktree.baseRef: "head"` passa a ser recomendado pelo `install` no projeto, ou o texto de
   `issue-coordinator-dispatch.md:49,148` muda para "default remoto". O mantenedor escolhe.
3. A Fase 7 inclui a branch `worktree-<nome>` na limpeza.

Antes de remover, falta medir uma coisa: se `worktree.baseRef` e `worktree.symlinkDirectories` se
comportam como a doc resume, numa rodada real de subagente com `isolation: "worktree"` e sem o hook.
A doc lida aqui não cobre isso literalmente (§3.2).

**`worktree-create` continua como caminho portátil** nos demais harnesses em qualquer cenário: a skill
não depende do hook, e o `prepare-worktree.ts --path` não muda.

A decisão continua humana: este spike não altera o hook nem cria issues de follow-up.
