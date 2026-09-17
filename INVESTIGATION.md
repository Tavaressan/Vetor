# Investigação: Aplicação de deno.com/agents.md aos Hooks/Scripts do Vetor

## 1. Análise de Permissões Atuais vs. Propostas

### Scripts Deno Invocados no hooks.json

| Script | Invocação Atual | Permissões Usadas | Permissões Propostas | Análise |
|--------|-----------------|-------------------|----------------------|---------|
| `safety-check.ts` | `deno run -A` | `-A` (todas) | `--allow-stdin --allow-read --allow-run=git --allow-write=.claude/vetor/status` | Lê stdin (JSON), executa `git`, lê/escreve arquivos de status |
| `check-edit.ts` | `deno run -A` | `-A` (todas) | `--allow-stdin --allow-read --allow-run=deno` | Lê stdin, executa `deno check` ou `tsc`, lê arquivos do projeto |
| `check-status.ts` | `deno run -A` | `-A` (todas) | `--allow-stdin --allow-read --allow-write=.claude/vetor/status` | Lê stdin, lê/escreve/remove status files |
| `prepare-worktree.ts` | `deno run -A` | `-A` (todas) | `--allow-stdin --allow-read --allow-write --allow-run=git,deno,npm,pnpm,yarn,poetry,python,pip` | Lê stdin, cria/gerencia worktree, executa instaladores |
| `session-check.ts` | via `deno run -A` em `session-check.sh` | `-A` (todas) | `--allow-stdin --allow-read` | Lê stdin, lê config.json |

### Session-Check Wrapper

O script `scripts/session-check.sh` é um wrapper bash que:
1. Verifica se `deno` está no PATH com `command -v deno`
2. Se não encontrar, emite mensagem de erro amigável
3. Se encontrar, executa `session-check.ts` com `deno run -A`

**Status**: Já implementa detecção de ambiente parcial (POSIX shells apenas).

---

## 2. Matriz de Permissões Necessárias

### Análise Detalhada por Script

#### A. `prepare-worktree.ts`
**Operações detectadas:**
- `Deno.stdin` - lê JSON do WorktreeCreate event
- `run("git", [...])` - detecta default branch, cria worktree
- `detectProject(sourceDir)` - lê arquivos de projeto (deno.json, package.json, Cargo.toml, etc.)
- `run("deno|npm|pnpm|yarn|poetry", ["install"], worktreePath)` - instala dependências
- `Deno.mkdirSync()` - cria `.claude/vetor/` no worktree
- `Deno.writeTextFileSync()` - escreve marcador de falha
- `Deno.lstat()`, `Deno.stat()` - testa existência de arquivos
- `Deno.symlink()` - cria symlinks (Windows junction)

**Permissões propostas:**
```
--allow-stdin
--allow-read      # todo o worktree + projeto raiz (para detectar runtime)
--allow-write     # novo worktree + .claude/ directory
--allow-run=git,deno,npm,pnpm,yarn,poetry,python,pip  # instaladores
--allow-env       # (opcional) se precisar de env vars para instaladores
```

**Impacto de Segurança**: Moderado — cria worktree novo, instala deps. Restrições bem-definidas.

---

#### B. `safety-check.ts`
**Operações detectadas:**
- `Deno.stdin` - lê JSON do evento PreToolUse
- `Deno.readTextFileSync()` - lê status file, agent bindings
- `Deno.cwd()` - resolve contexto
- `run("git", ["worktree", "list", ...])` - valida estado de worktree
- `Deno.mkdirSync()` - cria `.claude/vetor/status/.agent-cwd`
- `Deno.writeTextFileSync()` - escreve agent binding cache

**Permissões propostas:**
```
--allow-stdin
--allow-read      # para .claude/vetor/status/*, projeto root
--allow-run=git   # apenas git (não precisa outros comandos)
--allow-write=.claude/vetor/status  # agent bindings
```

**Impacto de Segurança**: Baixo — read-heavy, write restrito a status files.

---

#### C. `check-edit.ts`
**Operações detectadas:**
- `Deno.stdin` - lê JSON do evento PostToolUse
- `Deno.statSync()` - verifica arquivo/diretório
- `Deno.build.os` - detecta sistema operacional (sem permissão necessária)
- `Deno.Command` com `deno check` ou `tsc` - typecheck inline
- Reads project config (tsconfig.json, deno.json)

**Permissões propostas:**
```
--allow-stdin
--allow-read      # para projeto (typescript files, config)
--allow-run=deno  # apenas deno check (tsc pode estar no node_modules)
```

**Impacto de Segurança**: Baixo — apenas diagnóstico, sem estado mutável.

---

#### D. `check-status.ts`
**Operações detectadas:**
- `Deno.stdin` - lê JSON do evento SubagentStop
- `Deno.readTextFileSync()` - lê status file, prepare-failed marker
- `Deno.mkdirSync()` - cria `.claude/vetor/status/`
- `Deno.writeTextFileSync()` - escreve stopguard sentinel
- `Deno.removeSync()` - remove sentinel após terminal

**Permissões propostas:**
```
--allow-stdin
--allow-read      # para .claude/vetor/status/*
--allow-write=.claude/vetor/status  # stopguard, status files
```

**Impacto de Segurança**: Muito baixo — manipula apenas status metadata.

---

#### E. `session-check.ts`
**Operações detectadas:**
- `Deno.stdin` - lê JSON do evento SessionStart
- `readJson()` → `Deno.readTextFileSync()` - lê .claude/vetor/config.json

**Permissões propostas:**
```
--allow-stdin
--allow-read      # apenas config.json (não todo projeto)
```

**Impacto de Segurança**: Mínimo — apenas diagnóstico.

---

## 3. Detecção de Ambiente: Estado Atual e Recomendações

### Problema Relatado

Durante uma sessão de `/vetor:issue-coordinator`, o `SessionStart` hook avisa que Deno não está no PATH, mas o dispatch de um worker falha depois com `deno: command not found` quando o hook tenta executar `prepare-worktree.ts`. Isso ocorre porque:

1. O hook `session-check.sh` (bash) consegue emitir aviso
2. Mas os demais hooks (`prepare-worktree.ts`, `safety-check.ts`, etc.) rodam com `deno run -A` **direto** em hooks.json
3. Se o PATH não estiver atualizado no shell do harness (snapshot anterior à instalação do Deno), o fallback de PATH não funciona
4. Não há retry, apenas falha silenciosa

### Estado Atual

1. **SessionStart**: `session-check.sh` (bash wrapper) checa se Deno está no PATH com `command -v deno`
   - ✓ Funciona em shells POSIX
   - ✗ Não funciona em PowerShell (Windows nativo)
   - ✗ Não fornece troubleshooting específico para Windows

2. **Demais hooks**: Invocam `deno run -A <script.ts>` **direto** sem pré-check
   - ✗ Falham com `deno: command not found` se Deno não estiver no PATH
   - ✗ Mensagem de erro genérica do shell, sem indicar que Deno é dependência do plugin

### Raiz do Problema

O `session-check.sh` avisa que Deno não está no PATH, mas não **bloqueia** a sessão. O harness continua
adiante e tenta executar os demais hooks. Como o PATH é um snapshot no momento da execução do hook,
se Deno foi instalado *nesta sessão* (ex.: via `curl -fsSL https://deno.land/install.sh | sh`),
o shell do hook pode não ter o PATH atualizado.

---

## 4. Recomendação Final

### Permissões (Impacto: Moderado-Alto)

**Vale a pena restringir?** ✅ **SIM**

**Justificativa**:
- Cada script hoje roda com `-A` (todas as permissões), inclusive escrita irrestrita
- Restrições propostas são bem-definidas e documentadas (tabela acima)
- Reduz blast radius em caso de bug ou injeção maliciosa num script
- Compatível com policy de least privilege do Deno e recomendações de deno.com/agents.md
- Segue tendência industry-wide de sandboxing e explicit permissions

**Custo**:
- Ajustes em 5 scripts + 1 wrapper bash (10-15 min cada)
- Testes de CI já cobrem esses scripts → regressão será detectada
- Não afeta usuários (transparente em uso)
- Investimento inicial, manutenção futura mínima

**Implementação Sugerida**:
- Criar issue(s) separada(s) por script para restrição de permissões
- Prioridade: `safety-check.ts` > `prepare-worktree.ts` > demais (safety-critical primeiro)
- Padrão de commit: `fix: restrict permissions on <script-name>.ts with --allow-* granular flags`
- Validar com testes de CI existentes

### Detecção de Ambiente (Impacto: Baixo)

**Vale a pena melhorar?** ✅ **SIM, com escopo limitado**

**Justificativa**:
- `session-check.sh` já cobre POSIX shells (bash, sh)
- PowerShell (Windows nativo) não tem `command -v`, alternativa é `Test-Command` ou `Get-Command` (ambos PowerShell built-in)
- Mas o plugin **já avisa** na SessionStart quando Deno não está no PATH
- O problema real é que o harness continua e tenta executar hooks subsequentes apesar do aviso
- **Limitação**: Melhorar a detecção não resolve o loop; o harness precisaria de lógica de retry

**Escopo Viável**:
1. Fortalecer `session-check.sh` com check PowerShell (1-2 linhas)
2. Melhorar mensagem de erro em `session-check.sh` com instruções específicas para Windows
3. Documentar em README/troubleshooting que SessionStart é um aviso, não um bloqueio
4. Sugerir que usuários validem `deno --version` **antes** de usar skills do Vetor

**Custo**:
- 1-2 horas para bash enhancements + docs
- Não requer coordenação com harness (fora de escopo do plugin)

**Implementação Sugerida**:
- Criar issue separada: `fix: improve deno detection in session-check.sh for PowerShell`
- Adicionar PowerShell check com `Get-Command`
- Melhora mensagem de erro com troubleshooting Windows-específico
- Commit: `fix: enhance deno detection for Windows/PowerShell in session-check.sh`

---

## 5. Issues de Implementação Recomendadas

Se aprovadas:

1. **Restringir permissões de `safety-check.ts`** (priority: HIGH)
   - Mais crítico por ser pre-tool gate que passa stdin/cwd
   - Testes de CI cobrem casos reais; regressão será detectada

2. **Restringir permissões de `prepare-worktree.ts`** (priority: HIGH)
   - Cria worktree e executa instaladores; blast radius alto
   - Bem testado em CI

3. **Restringir permissões de `check-edit.ts`, `check-status.ts`, `session-check.ts`** (priority: MEDIUM)
   - Menor impacto de segurança individualmente
   - Alinha com policy de least privilege

4. **Melhorar detecção de Deno em `session-check.sh`** (priority: LOW)
   - Adicionar PowerShell check
   - Melhora UX no Windows
   - 1-2 horas de trabalho

5. **Documentação de troubleshooting** (priority: LOW)
   - Adicionar FAQ em README sobre PATH, instalação de Deno
   - Cobrir Windows + shells POSIX
   - Link direto para deno.land/install.sh + instruções de `DENO_INSTALL`

---

## 6. Conformidade com deno.com/agents.md

### Recomendações do Guia Aplicáveis

1. **Permissões Explícitas (§ Sandbox Model)**
   - Guia: "Deno is sandboxed by default; filesystem/network/env require explicit --allow-* flags"
   - Vetor hoje: Usa `-A` (todas as permissões) em todos os hooks
   - **Gap**: Não segue recomendação de least privilege
   - **Fix**: Restringir permissões conforme tabela acima

2. **Detecção de Ambiente (§ Environment Detection)**
   - Guia: "Agents should verify runtime is available before using it"
   - Vetor hoje: SessionStart avisa, mas não bloqueia; demais hooks falham silenciosamente
   - **Gap**: Aviso sem ação; falhas sem contexto
   - **Fix**: Fortalecer `session-check.sh`, melhorar mensagens de erro

3. **Node/npm Compatibilidade (§ Node.js Compatibility)**
   - Guia: "If using Node libraries, declare them explicitly and read package.json"
   - Vetor hoje: Scripts Deno-nativo, sem dependências npm
   - **Status**: Irrelevante (não aplicável)

### Conclusão

O Vetor já segue parcialmente as recomendações de deno.com/agents.md. Os ajustes propostos
completam a conformidade com foco em:
- **Segurança**: Permissões granulares em vez de `-A`
- **Robustez**: Detecção e tratamento de erro melhores para ambientes sem Deno no PATH
- **Transparência**: Mensagens amigáveis e troubleshooting em vez de falhas silenciosas

---

## Anexo: Checklist de Implementação

- [ ] Restringir permissões em `safety-check.ts` (HIGH priority)
- [ ] Restringir permissões em `prepare-worktree.ts` (HIGH priority)
- [ ] Restringir permissões em `check-edit.ts` (MEDIUM priority)
- [ ] Restringir permissões em `check-status.ts` (MEDIUM priority)
- [ ] Restringir permissões em `session-check.ts` via wrapper (MEDIUM priority)
- [ ] Adicionar PowerShell check em `session-check.sh` (LOW priority)
- [ ] Melhorar mensagens de erro para Windows/PowerShell (LOW priority)
- [ ] Documentar troubleshooting de Deno em README (LOW priority)
- [ ] Validar testes de CI com permissões restritas
- [ ] Atualizar references/deno.md com novas convenções
