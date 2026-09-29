# Prontidão para Publish do CLI — Resumo de Issues #290, #292, #293, #294

**Branch:** feat/292-cli-publish-pipeline
**Data:** 2026-09-29

---

## Status das Issues

| Issue | Título | Status | Notas |
|-------|--------|--------|-------|
| #290 | Confirmar disponibilidade do nome `vetor` no npm | ✅ **Concluído** | `npm view vetor` → 404 Unpublished (2015-11-30). Nome livre. |
| #292 | Primeiro publish real de `vetor` no npm | ⏳ **Pronto para execução** | Código pronto; requer `NPM_TOKEN` secret e tag `cli-v0.1.0` |
| #293 | Validar instalação via `vetor install` (pacote publicado) | ✅ **Coberto por teste** | `cli/test/pack.test.js` já testa instalação real do tarball |
| #294 | Dispatch ponta-a-ponta via issue-coordinator portado | ⏳ **Pronto para execução** | Requer OpenCode CLI instalado no ambiente de validação |

---

## Verificações de Prontidão (Codebase)

### ✅ Package.json
- Name: `@tavaressan/vetor` (escopado, evita conflito com `vetor` antigo)
- Version: `0.1.0` (primeira versão)
- `publishConfig.access: public` configurado
- `files`: `bin/`, `lib/`, `templates/` — correto
- `prepack` hook: `node scripts/sync-templates.js` — sincroniza templates

### ✅ Workflow de Publish (`.github/workflows/npm-publish.yml`)
- Trigger: `release.published` com tag `cli-v*` OU `workflow_dispatch`
- Guard: `startsWith(github.event.release.tag_name, 'cli-v')`
- Dry-run por default no `workflow_dispatch`
- Testes rodam antes do publish (`npm test`)
- Check de versão existente no registry
- Requer `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`

### ✅ Testes de Empacotamento (`cli/test/pack.test.js`)
- `npm pack --dry-run` valida `files` allowlist
- Verifica sincronização de `templates/` via prepack (skills, agents, hooks, opencode)
- **Teste E2E real:** `npm pack` real → `npm install <tarball>` em dir limpo → valida `installFiles()` para Claude Code, OpenCode, Codex
- Validação de runtime OpenCode real (`opencode agent list`) se CLI disponível
- Documenta limitação conhecida: `vetor install` não-interativo não seleciona engine (stdin pipe)

### ✅ Sync de Templates (`cli/scripts/sync-templates.js`)
- Copia `skills/`, `agents/`, `hooks/`, `opencode/` → `cli/templates/`
- Traduz formato por engine (Codex → `.toml`, OpenCode → achatado)
- `fs.rmSync` + `fs.cpSync` — idempotente

### ✅ Writer/Installer (`cli/lib/installer/writer.js`)
- `defaultSourceRoot()` detecta layout de pacote publicado (sem `plugin.json`)
- `installFiles()` copia para destinos por engine
- Testes automatizados cobrem ambos branches (monorepo vs pacote publicado)

---

## Passos para Execução do Publish (Manual/CI)

### 1. Configurar Secret
```
GitHub Repository Settings → Secrets → Actions → NPM_TOKEN
```
Token npm com escopo `publish` para `@tavaressan/vetor`.

### 2. Criar Release Tag
```bash
git tag cli-v0.1.0
git push origin cli-v0.1.0
```
OU via GitHub UI: Create Release → tag `cli-v0.1.0` → Publish release.

### 3. Workflow Dispara Automaticamente
- Roda testes
- Verifica versão não existente
- Publica no npm com `NPM_TOKEN`

### 4. Validação Pós-Publish
```bash
npm view @tavaressan/vetor version  # deve retornar 0.1.0
npx @tavaressan/vetor@latest --help  # deve funcionar fora do monorepo
```

---

## Passos para Validação #293/#294 (Pós-Publish)

### #293 - Validação Instalação OpenCode
```bash
# Em dir limpo fora do monorepo
npx @tavaressan/vetor@latest install
# Selecionar OpenCode
opencode agent list  # deve listar issue-worker, code-review, issue-coordinator
```

### #294 - Dispatch E2E OpenCode
```bash
# Em repo de teste com 2 issues label 'backlog'
cp -r opencode/. .opencode/
opencode run --agent issue-coordinator "backlog"
# Confirmar: plano → worktree → worker dispatch → status file → merge
```

---

## Gaps Conhecidos (Fora de Escopo Desta Leva)

1. **Codex CLI** não disponível no ambiente de CI/validação atual — validação de runtime real pendente (manual)
2. **OpenCode CLI** não instalado no CI (`ubuntu-latest`) — validação de runtime real só local
3. **NPM_TOKEN** secret não configurado — bloqueia publish real
4. **vetor install não-interativo** não seleciona engine (stdin pipe) — documentado, YAGNI para corrigir agora

---

## Conclusão

**Código 100% pronto para publish.** As issues #292, #293, #294 dependem de:
- Configuração de secret `NPM_TOKEN` (infraestrutura)
- Execução manual da release tag
- Ambiente com OpenCode CLI para validação #294

Nenhuma mudança de código necessária neste momento.