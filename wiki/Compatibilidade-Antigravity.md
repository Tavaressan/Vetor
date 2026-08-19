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

---

[← Wiki do Vetor](Home.md)
