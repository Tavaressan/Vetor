---
name: worktree-session
description: "[LEGADO — não use] Skill monolítica de sessão de desenvolvimento, mantida apenas como referência histórica. Substituída por worktree-create + worktree-ship + issue-coordinator. Não é carregada pelo plugin."
license: Proprietary
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "2.0.0"
  status: deprecated
---

> ⚠️ **DEPRECATED / LEGADO — não use.** Esta skill monolítica é grande demais e
> perde contexto facilmente. Foi substituída pela composição `worktree-create` +
> `worktree-ship` (e `issue-coordinator` para orquestração). É mantida aqui apenas
> como referência histórica e **não é carregada pelo plugin** (vive fora de `skills/`).

Você é o coordenador de sessão do repositório Alfabra Vector. Sua missão é conduzir o desenvolvedor por um fluxo de trabalho Git seguro e rastreável, do início ao merge, garantindo que o root nunca fique sujo com trabalho inacabado.

---

## FASE 0 — Entrada por issue GitHub (opcional)

Execute esta fase **antes** da Fase 1 sempre que o usuário:
- Passar um número de issue como argumento (ex.: `/worktree-session 42`)
- Mencionar "quero desenvolver a issue #N", "trabalhar na issue N" ou similar na mensagem de ativação

Se nenhuma issue foi mencionada, pule esta fase e vá direto para a Fase 1.

### 0.1 — Buscar a issue no GitHub

```bash
gh issue view <N> --json number,title,body,labels,assignees,state
```

Se a issue não existir ou o comando falhar, informe e avance para a Fase 1 normalmente.

Se a issue estiver fechada (`state: CLOSED`), avise:
> A issue #N já está fechada. Quer continuar mesmo assim? (s/n)

Apresente um resumo da issue:
> **Issue #N — `<título>`**
> Labels: `<labels>`
> `<primeiras 3–5 linhas do body, se houver>`

### 0.2 — Procurar feature Reversa Forward correspondente

Tente localizar a feature pelo número da issue. Busque por diretórios em `_reversa_forward/` cujo prefixo numérico (com ou sem zeros à esquerda) corresponda a `<N>`:

```bash
ls _reversa_forward/ 2>/dev/null | grep -E "^0*<N>-"
```

**Caso A — Feature encontrada:**

Leia os artefatos físicos da feature para determinar o estágio (mesma lógica da Fase 2.2.A):

| Artefatos presentes                                      | Estágio               | Pronto para código? |
|----------------------------------------------------------|-----------------------|---------------------|
| Nenhum / só pasta                                        | vazio                 | ❌                  |
| `requirements.md` apenas                                 | requirements          | ❌                  |
| `roadmap.md` mas sem `actions.md`                        | plan                  | ❌                  |
| `actions.md` com pelo menos uma linha `\| ... \| [ ] \|` | coding-em-progresso   | ✅                  |
| `actions.md` com todas as linhas `[X]`                   | done                  | ⚠️ já concluído    |

**Se pronto (✅):** apresente:

> Feature Reversa Forward encontrada para a issue #N:
> - `<NNN>-<short-name>` | Estágio: codificação em andamento
> - `<concluídas>` de `<total>` ações concluídas em `actions.md`
>
> Vou configurar o worktree vinculado a esta feature e à issue #N.
> Confirma? (s/n)

Se confirmado:
- Registre internamente: `feature-dir`, `feature-id` como inteiro, `issue-number = N`, `short-name`
- Derive branch: `feat/<N>-<short-name>` (sem zeros à esquerda)
- Derive worktree-path: `.claude/worktrees/<short-name>`
- Pule a Fase 1 e vá direto para a Fase 2, seção 2.3 (confirmação de nomes)

**Se não pronto (❌):**

> Feature Reversa Forward encontrada (`<NNN>-<short-name>`), mas ainda no estágio `<estágio>` — sem ações de código definidas.
>
> Para manter a documentação alinhada, complete o pipeline antes de codificar:
> - Execute `/reversa-forward` para ver o próximo passo
>
> O quê prefere fazer?
> 1. Pausar e completar o pipeline Reversa Forward primeiro (recomendado)
> 2. Criar worktree avulso vinculado apenas à issue #N (sem feature docs)

Se escolher 2: registre apenas `issue-number = N` e vá para a Fase 1 (modo normal, mas com issue pré-preenchida).

**Se done (⚠️):**

> Feature `<NNN>-<short-name>` já está concluída no Reversa Forward. A issue #N tem ajustes ou é uma continuação?
> 1. Vincular mesmo assim (ex.: correção pós-merge)
> 2. Não vincular — criar worktree avulso
> 3. Iniciar nova feature com `/reversa-forward` baseada na issue

**Caso B — Feature não encontrada no Reversa Forward:**

> Issue #N encontrada: "**`<título>`**"
> Não há feature Reversa Forward correspondente a esta issue.
>
> Para manter documentação e rastreabilidade, é recomendado criar a feature no pipeline antes de codificar:
> - `/reversa-forward <título da issue>` — inicia requirements com o título da issue como ponto de partida
>
> Como quer prosseguir?
> 1. Pausar e iniciar pipeline com `/reversa-forward` (recomendado)
> 2. Criar worktree avulso vinculado apenas à issue #N (sem feature docs)

Se escolher 2: registre `issue-number = N`, derive `slug` do título da issue (kebab-case, max 5 palavras), e vá para a Fase 1 com issue e slug pré-preenchidos (pule as perguntas manuais correspondentes na Fase 2.2.B).

---

## FASE 1 — Escolha do modo de trabalho

Ao ser ativado, pergunte:

> **Como você quer trabalhar nesta sessão?**
>
> 1. **Root** — trabalhar diretamente no repositório principal (adequado para mudanças rápidas, documentação, configuração)
> 2. **Worktree isolado** — criar um ambiente separado para desenvolver uma feature ou fix sem impactar o root (recomendado para qualquer mudança de código)

Se o usuário escolher **Root**, encerre o skill. O agente segue normalmente no repositório principal.

Se o usuário escolher **Worktree isolado**, avance para a Fase 2.

---

## FASE 2 — Seleção ou criação do worktree

### 2.1 — Listar worktrees existentes

Execute:
```bash
git worktree list
```

Apresente a lista de forma legível. Se existirem worktrees além do principal, pergunte:

> **Deseja retomar um worktree existente ou criar um novo?**
>
> Liste os worktrees com seus paths e branches.
> Opção extra: "Criar novo worktree"

Se o usuário escolher retomar um existente:
- Informe o path do worktree selecionado
- Use `EnterWorktree` com o path correspondente para mudar o contexto de trabalho
- Avance para a Fase 3 com a branch já existente

Se o usuário escolher criar novo, avance para 2.2.

---

### 2.2 — Tipo de mudança

Pergunte:

> Qual é o tipo da mudança?
> 1. `feat` — nova funcionalidade
> 2. `fix` — correção de bug
> 3. `chore` — manutenção, deps, configuração
> 4. `refactor` — refatoração sem mudança de comportamento

**Após a escolha:**

- Se `feat`: execute a seção **2.2.A — Verificação de Framework de Feature** antes de prosseguir.
- Se `fix`, `chore` ou `refactor`: avance diretamente para **2.2.B — Perguntas manuais**.

---

### 2.2.A — Verificação de Framework de Feature (apenas `feat`)

Esta verificação garante que novas funcionalidades passem pelo ciclo de documentação e planejamento antes de entrar em código. Execute-a lendo os artefatos físicos — nunca assuma estado por campos auto-declarados.

#### Reversa Forward

Tente ler `.reversa/active-requirements.json`.

**Caso A — Feature ativa encontrada:**

Extraia do JSON:
- `feature-id` (ex.: `"017"`)
- `short-name` (ex.: `"crewai-parametrizado-agent-id"`)
- `feature-dir` (ex.: `"_reversa_forward/017-crewai-parametrizado-agent-id"`)

Verifique o estágio físico checando os arquivos presentes em `feature-dir`:

| Artefatos presentes em `feature-dir`                         | Estágio               | Pronto para código? |
|--------------------------------------------------------------|-----------------------|---------------------|
| Nenhum                                                       | vazio                 | ❌                  |
| `requirements.md` apenas                                     | requirements          | ❌                  |
| `roadmap.md` mas sem `actions.md`                            | plan                  | ❌                  |
| `actions.md` com pelo menos uma linha `\| ... \| [ ] \|`     | coding-em-progresso   | ✅                  |
| `actions.md` presente, todas as linhas de ação com `[X]`    | done                  | ⚠️ já concluído    |

**Se pronto (✅):**

Conte as ações em `actions.md`: linhas com `[ ]` = abertas, linhas com `[X]` = concluídas. Apresente:

> Feature ativa no Reversa Forward detectada:
> - ID: `<NNN>` | Nome: `<short-name>`
> - Estágio: codificação em andamento (`<concluídas>` de `<total>` ações concluídas)
>
> Vincular este worktree a esta feature? (s/n)

Se o usuário confirmar:
- Derive `branch = feat/<N>-<short-name>` onde `<N>` é o `feature-id` sem zeros à esquerda (ex.: `017` → `17`)
- Derive `worktree-path = .claude/worktrees/<short-name>`
- Registre internamente: `feature-dir`, `feature-id` como inteiro, `issue-number = int(feature-id)`
- Pule as seções 2.2.B e avance para 2.3

Se o usuário recusar:
- Avance para 2.2.B normalmente (sem vinculação)

**Se não pronto (❌):**

> Feature ativa no Reversa Forward (`<NNN>-<short-name>`) está no estágio `<estágio>` — ainda sem ações de código definidas.
>
> Para implementar seguindo o fluxo documentado, complete o pipeline primeiro:
> - Execute `/reversa-forward` para ver o próximo passo sugerido
>
> Como quer prosseguir?
> 1. Pausar e completar o pipeline Reversa Forward primeiro (recomendado)
> 2. Criar worktree avulso sem vinculação ao Reversa (avança para perguntas manuais)

**Se done (⚠️):**

> Feature `<NNN>-<short-name>` já consta como concluída no Reversa Forward. Vincular mesmo assim?
> 1. Sim, vincular (para ajustes ou correções pós-coding)
> 2. Não, criar worktree avulso sem vinculação
> 3. Iniciar nova feature com `/reversa-forward <descrição>` antes de continuar

**Caso B — Sem feature ativa (`.reversa/active-requirements.json` ausente, inválido ou `feature-dir` inexistente):**

> Nenhuma feature ativa encontrada no Reversa Forward.
>
> Features novas devem passar pelo pipeline Reversa antes de entrar em código — isso garante requisitos, plano e ações atômicas documentadas e rastreáveis à issue correspondente.
>
> Como quer prosseguir?
> 1. Pausar e iniciar o pipeline com `/reversa-forward <descrição da feature>` (recomendado)
> 2. Criar worktree avulso sem vinculação (avança para perguntas manuais)

**Caso C — Sem Reversa neste projeto (`.reversa/` ausente):**

Pule esta verificação silenciosamente e avance para 2.2.B.

#### Hook para outros frameworks

Se outro framework de feature estiver em uso neste projeto (ex.: Linear CLI, Jira, custom), adicione aqui uma subseção equivalente seguindo o mesmo padrão:
1. Ler o estado do framework (arquivo de estado ou saída de CLI)
2. Detectar se há feature pronta para código
3. Derivar `branch` e `issue-number` a partir dos metadados da feature
4. Confirmar vinculação com o usuário antes de prosseguir

---

### 2.2.B — Perguntas manuais

Executadas quando: tipo é `fix`/`chore`/`refactor`, OU o usuário recusou vinculação ao framework, OU não há framework ativo (Caso C).

**Pergunta 2 — Descrição curta:**
> Descreva a mudança em 3–5 palavras (será usada no nome da branch):
> Ex.: "autenticação oauth google", "timeout embedding service"

**Pergunta 3 — Issue GitHub (opcional):**
> Há um número de issue GitHub relacionado? (Enter para pular)

---

### 2.3 — Derivar nomes

**Se vinculado ao Reversa Forward** (ou outro framework):
- Branch e worktree-path já foram derivados em 2.2.A — apenas confirme

**Se sem vinculação** (perguntas manuais):
- Branch: `<tipo>/<NNN>-<slug>` se issue informada; `<tipo>/<slug>` sem issue
- Worktree: `.claude/worktrees/<slug>`

Confirme com o usuário:
> Vou criar:
> - Branch: `<branch>`
> - Worktree: `<path>`
> [Se vinculado ao framework: `- Feature: <feature-dir>/actions.md`]
>
> Confirma? (s/n)

---

### 2.4 — Criar o worktree

Execute em sequência:

```bash
# 1. Garantir que o master está atualizado
git pull origin master

# 2. Criar worktree com nova branch a partir do master
git worktree add -b <branch> <path-worktree> master
```

Em caso de erro (ex.: branch já existe), informe e peça nova descrição.

Após criação bem-sucedida, use `EnterWorktree` para mudar o contexto de trabalho para o novo worktree.

Informe:
> Worktree criado e ativado. Você está agora em `<path>` na branch `<branch>`.
> Pode começar a trabalhar. Quando terminar, diga "concluir feature" ou "/worktree-session concluir".

Se vinculado ao Reversa Forward, acrescente:
> As ações a implementar estão em `<feature-dir>/actions.md`. Marque cada ação concluída com `[X]` após cada commit correspondente.

---

## FASE 3 — Trabalho no worktree

O agente trabalha normalmente no contexto do worktree. Regras durante esta fase:

- **Commits incrementais:** fazer commits a cada unidade lógica concluída, nunca acumular tudo no final
- **Mensagens de commit:** seguir o padrão conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`)
- **Nunca fazer push** até o usuário sinalizar que a feature está pronta para revisão
- **Nunca tocar no root** — qualquer arquivo fora do worktree está fora do escopo

**Se vinculado ao Reversa Forward:**
- As ações a implementar estão em `<feature-dir>/actions.md` — use-as como checklist de trabalho
- Após cada ação concluída, atualize o checkbox no `actions.md`: `[ ]` → `[X]`
- Mensagens de commit devem referenciar o ID da ação quando possível: `feat(T003): <descrição>`
- Não modifique outros artefatos do Reversa (`requirements.md`, `roadmap.md`, etc.) — eles pertencem ao framework

---

## FASE 4 — Conclusão e abertura do PR

Ativada quando o usuário disser "concluir feature", "abrir PR", "feature pronta" ou similar.

### 4.1 — Revisão antes do push

Execute:
```bash
git status
git log origin/master..HEAD --oneline
```

Apresente o resumo dos commits que serão enviados. Confirme com o usuário antes de prosseguir.

### 4.2 — Push da branch

```bash
git push -u origin <branch>
```

### 4.3 — Abertura do PR como Draft

**Se vinculado ao Reversa Forward**, construa o corpo do PR incluindo a seção de feature docs. Antes de abrir o PR, conte as ações concluídas e abertas em `<feature-dir>/actions.md`:

```bash
gh pr create \
  --title "<tipo>(<short-name>): <descrição>" \
  --body "$(cat <<'EOF'
## Resumo
- <bullet points das mudanças principais>

## Feature Reversa Forward
- Artefatos: `_reversa_forward/<NNN-short-name>/`
- Progresso: `<concluídas>` de `<total>` ações concluídas em `actions.md`

## Como testar
- <checklist de validação>

## Issue relacionada
Closes #<issue-number>

🤖 Desenvolvido com [Claude Code](https://claude.ai/code)
EOF
)" \
  --draft \
  --base master
```

**Sem vinculação a framework**, use o template original:

```bash
gh pr create \
  --title "<tipo>: <descrição>" \
  --body "$(cat <<'EOF'
## Resumo
- <bullet points das mudanças principais>

## Como testar
- <checklist de validação>

## Issue relacionada
Closes #<NNN>

🤖 Desenvolvido com [Claude Code](https://claude.ai/code)
EOF
)" \
  --draft \
  --base master
```

Informe a URL do PR criado.

---

## FASE 5 — Monitoramento do CI

Após criar o PR, monitore o status dos checks automaticamente.

### 5.1 — Verificar status dos checks

Execute a cada ciclo de monitoramento:
```bash
gh pr checks <PR-number> --watch
```

Apresente o resultado de forma resumida.

### 5.2 — Se todos os checks passarem

Marque o PR como pronto e faça o merge imediatamente:
```bash
gh pr ready <PR-number>
gh pr merge <PR-number> --squash --delete-branch --yes
```

Se o merge falhar por conflito com master, informe o usuário, resolva os conflitos no worktree (`git merge master`, corrija, commit, push) e volte ao início da Fase 5 para remonitorar.

Se o merge for bem-sucedido, avance direto para a Fase 6 (sincronizar root).

### 5.3 — Se algum check falhar

Identifique o check com falha:
```bash
gh pr checks <PR-number>
```

Para cada falha:
1. Leia os logs do check falho via `gh run view <run-id> --log-failed`
2. Identifique a causa raiz
3. Aplique a correção no worktree
4. Faça commit com mensagem `fix: corrige <problema> no CI`
5. Execute push: `git push origin <branch>`
6. Volte ao início da Fase 5 para novo monitoramento

Repita até todos os checks passarem.

---

## FASE 6 — Sincronizar root após merge

### 6.1 — Sincronizar o root com master

Saia do contexto do worktree (use `ExitWorktree`) e execute no root:

```bash
git checkout master
git pull origin master
```

Confirme:
> Root sincronizado com master. Branch `<branch>` mergeada e deletada remotamente.

### 6.2 — Limpeza do worktree (opcional)

Pergunte:
> Deseja remover o worktree local `<path>`? A branch remota já foi mergeada.
>
> 1. Sim, remover worktree e branch local
> 2. Não, manter por ora

Se o usuário confirmar:
```bash
git worktree remove <path>
git branch -d <branch>   # branch remota já foi deletada pelo --delete-branch no merge
```

---

## Resumo do fluxo

```
Ativação
  └─ Issue #N mencionada? (Fase 0)
  │    └─ gh issue view N → resumo da issue
  │         └─ Feature Reversa Forward para #N existe?
  │              └─ Pronta (actions.md com [ ]) → vincular → pular para Fase 2.3
  │              └─ Não pronta → sugerir pipeline → ou avulso com issue pré-preenchida
  │              └─ Não encontrada → sugerir /reversa-forward → ou avulso com issue pré-preenchida
  └─ Sem issue (Fase 1)
       └─ Root? → trabalho direto
       └─ Worktree? → listar existentes ou criar novo
            └─ Retomar existente → EnterWorktree → Fase 3
            └─ Criar novo:
                 └─ tipo = feat?
                 │    └─ Verificar framework (Reversa Forward / outros)
                 │         └─ Feature pronta? → vincular → derivar branch do framework
                 │         └─ Feature não pronta? → sugerir pipeline → ou avulso
                 │         └─ Sem framework? → perguntas manuais
                 └─ tipo = fix/chore/refactor → perguntas manuais
                      └─ branch + worktree derivados → confirmar (Fase 2.3)
                           └─ git pull master → git worktree add → EnterWorktree
                                └─ [trabalho com commits incrementais]
                                └─ [se reversa: marcar ações [X] em actions.md]
                                     └─ "concluir" → git push → gh pr create --draft
                                          └─ [se reversa: PR inclui progresso actions.md + Closes #N]
                                               └─ gh pr checks --watch
                                                    └─ falha? → corrigir → push → remonitorar
                                                    └─ passou? → gh pr ready
                                                         └─ aguardar merge
                                                              └─ ExitWorktree → git pull master
                                                                   └─ git worktree remove (opcional)
```
