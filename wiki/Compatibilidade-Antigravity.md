# Compatibilidade — Antigravity

**Claude Code** (`hooks/hooks.json`):
- ✅ `PreToolUse`, `PostToolUse`, `SubagentStop`, `SessionStart`, `WorktreeCreate`
- **Proteção**: completa. Bloqueia escrita fora do worktree, obriga status file em estado terminal, injeta diagnostics de edição

**Antigravity** (`hooks.json` na raiz):
- ✅ `PreToolUse` (suportado e configurado)
- ⚠️ `PostToolUse` (evento existe no Antigravity, mas **não está configurado** no `hooks.json`)
- ❌ `SubagentStop` (não existe. Antigravity tem um evento `Stop` genérico, mas não específico a subagentes; não é equivalente)
- ❌ `SessionStart` (não suportado)
- ❌ `WorktreeCreate` (não suportado)
- **Proteção**: reduzida. Apenas prévia de push/escrita via `PreToolUse`; **sem** diagnostics de edição ou garantia de status file

Para usar o Vetor com Antigravity, a restrição crítica é que workers podem escrever fora do worktree (além do `status file`), encerrar sem preenchê-lo, e não recebem feedback de tipo. Recomenda-se manter a invocação manual (`/vetor:fix-loop`, `/vetor:worktree-ship`) e **não usar `/vetor:coordinator`** com dispatch em background até que Antigravity suporte os eventos faltantes.

## `vetor install` não instala arquivos para Antigravity (issue #283)

Investigação com o CLI `agy` real instalado (`agy plugin validate .`, `agy plugin list`) confirma
que a distribuição de plugin do Antigravity não segue o modelo "copiar `skills/`/`agents/`/`hooks/`
para um diretório de projeto-alvo" que Claude Code, Codex e Cursor usam:

- `agy plugin validate .`, rodado na raiz deste repositório, lê o `plugin.json` **na raiz** (mesmo
  schema `antigravity.google/schemas/v1/plugin.json` já usado aqui) e as pastas `skills/`/`agents/`/
  `hooks/` **também na raiz** — não num diretório-âncora escondido tipo `.antigravity/`.
- `agy plugin list` mostra que um plugin importado (`agy plugin import`) fica registrado num
  manifesto **global do usuário** (`~/.gemini/antigravity-cli/settings.json` e
  `~/.gemini/antigravity-cli/plugin_data/<nome>/`), não em um diretório dentro do projeto-alvo.

Ou seja: `.antigravity` (usado antes desta issue como destino em `ENGINE_DEST_DIR` de
`cli/lib/installer/writer.js`, "convenção assumida por consistência") não é um diretório que o
Antigravity lê — copiar arquivos para lá produziria uma pasta inerte. `detector.js` já não usava
`.antigravity` como âncora de detecção (só o comando `agy` no PATH), então essa parte não regride.

**Decisão implementada:** `ENGINE_DEST_DIR` não tem mais entrada para `antigravity`. Selecionar
Antigravity em `vetor install` não copia nenhum arquivo (comportamento seguro — nunca escreve numa
pasta que a engine não lê) e aparece explicitamente em `enginesSkipped` no retorno de
`installFiles()`, reportado ao usuário como "nenhum arquivo instalado (sem convenção de projeto
confirmada para esta engine ainda)" em vez de falhar silenciosamente. Cobertura automatizada em
`cli/test/installer-writer.test.js`. Não descoberto nesta investigação: um segundo mecanismo de
"instalação project-local" equivalente a `.claude/` que não seja a rota de plugin (`agy plugin
install/import`) — se existir, é trabalho futuro mapeá-lo e implementar a tradução real.

---

[← Wiki do Vetor](Home.md)
