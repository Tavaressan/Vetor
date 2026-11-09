# Coordinator — labels de triagem no GitHub

> Lida sob demanda pelo `SKILL.md` do `coordinator` (ao pular ou manter bloqueada uma issue). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

#### Labels de triagem no GitHub (visibilidade de issues puladas/bloqueadas)

Quando o coordinator tira uma issue da leva (`SKIPPED (aguardando Spec)` do gate de Spec/design na Fase 2, `SKIPPED (aguardando insumo do usuário)` da triagem, ou issue bloqueada em `BLOCKED_WAITING` na Fase 5.b), o motivo só aparece no Coordinator Report da sessão. Para deixar o estado de triagem visível no GitHub, o coordinator aplica a label equivalente que o repositório **já possuir** — **sem nunca criar labels**.

Consulte os labels existentes no repositório:
```bash
gh label list --limit 100 --json name
```

Mapeie o motivo aos labels existentes no repo alvo, usando o **primeiro da linha que existir** (no estilo do mapeamento de tipo do `/vetor:backlog` §6.a):

| Motivo | Label Preferido | Fallback 1 | Fallback 2 | Se nenhum existir |
| ------ | --------------- | ---------- | ---------- | ----------------- |
| `SKIPPED (aguardando Spec)` | `needs-spec` | `spec-needed` | `triage/needs-information` | Não aplica |
| `SKIPPED (aguardando insumo do usuário)` / bloqueada | `blocked` | `status/blocked` | — | Não aplica |
| `EJECTED` (esgotou as tentativas ou bloqueio sem resposta, Fase 5.f) | `needs-human` | — | — | Não aplica |

**Regras e convenções:**
1. **Regra de ouro — nunca crie labels:** o coordinator **nunca** executa `gh label create`. Se nenhuma das labels candidatas da linha existir no repositório-alvo, não aplica label alguma no GitHub — o motivo fica registrado exclusivamente no plano e no Coordinator Report da sessão.
2. **Aplicação da label:** quando a issue for pulada ou bloqueada e houver label correspondente no repositório:
   ```bash
   gh issue edit <N> --add-label "<label-encontrada>"
   ```
3. **Remoção da label de triagem ao despachar:** ao despachar posteriormente uma issue (Fase 4) que possua qualquer uma das labels de triagem mapeadas (`needs-spec`, `spec-needed`, `triage/needs-information`, `blocked`, `status/blocked`, `needs-human`), o coordinator obrigatoriamente a remove antes ou no momento do dispatch:
   ```bash
   gh issue edit <N> --remove-label "<label-de-triagem>"
   ```
4. **Comportamento em `--headless`:** aplica igualmente a label de triagem se ela existir no repositório; nunca cria labels (`gh label create`). Sem equivalente no repo, não aplica e documenta a omissão no relatório final.
5. **Não-escopo:** nunca aplique labels indicando execução em andamento (ex.: `in-progress` ou qualquer estado de execução). O estado de execução vive exclusivamente no worktree e no status file (`.claude/vetor/status/`), e o padrão do GitHub para status de fluxo é o campo Status do Projects.
6. **Ejeção (`needs-human`):** vale a mesma regra de ouro. A label só é aplicada se já
   existir (`gh label list`); sem ela, o motivo fica no comentário diagnóstico da issue e no relatório,
   e a ejeção segue normalmente. Falha ao aplicá-la (ex.: token sem permissão) também não interrompe a
   ejeção: o motivo vai ao relatório.
