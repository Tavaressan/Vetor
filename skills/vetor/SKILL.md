---
name: vetor
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
/vetor [--force]
```

- `--force`: opcional — força a sobrescrita do mapeamento de testes (`module-test-map.md`) e do arquivo de configuração (`config.json`) mesmo que já existam.

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
`$CLAUDE_PLUGIN_ROOT/skills/shared/references/agent-status.template.md`) nunca sejam commitados:

```bash
mkdir -p .claude/vetor/status
grep -qxF '.claude/vetor/status/' .gitignore 2>/dev/null || echo '.claude/vetor/status/' >> .gitignore
```

A entrada no `.gitignore` é idempotente — este passo substitui qualquer ajuste de gitignore por
worker.

### 2 — Detectar o projeto (`module-test-map.md` + `config.json`)

Um único script detecta o runtime, gera o mapeamento de testes e persiste a configuração:

```bash
deno run -A "$CLAUDE_PLUGIN_ROOT/scripts/detect-project.ts" [--force]
```

Repasse o `--force` recebido nos args. Sem ele, o script preserva um `module-test-map.md`
existente e responde `{"status":"skipped"}`.

O script grava:
- `.claude/vetor/module-test-map.md` — comandos de teste por módulo;
- `.claude/vetor/config.json` — `runtime`, `packageManager` e `testCommand` detectados, preservando
  o `maxConcurrentWorkers` (default 5). O `prepare-worktree.ts` lê isso para saber como preparar
  cada worktree.

Se o runtime sair como `unknown`, avise o usuário de que o `module-test-map.md` precisa de ajuste
manual — as skills de teste dependem dele.

### 3 — Exibir Sumário de Configuração e Próximos Passos

Após a criação/validação dos arquivos, exiba uma mensagem informativa clara e amigável para o desenvolvedor:

```
🚀 Vetor inicializado com sucesso em .claude/vetor/!

Runtime detectado: <runtime> (<testCommand>)

Arquivos configurados:
- [x] .claude/vetor/module-test-map.md (Mapeamento de testes por módulo)
- [x] .claude/vetor/config.json (runtime detectado + maxConcurrentWorkers: 5)
- [x] .claude/vetor/status/ (status files dos workers — gitignorado)

Próximos passos recomendados:
1. Abra e revise o arquivo `.claude/vetor/module-test-map.md` para garantir que os comandos de teste headless e os mapeamentos de pasta de seu projeto estejam 100% corretos.
2. (Opcional) Crie a pasta `.claude/vetor/docs/` e adicione guias de arquitetura, padrões do projeto e gaps em markdown. O comando `/vetor:backlog` lerá automaticamente estes arquivos para propor issues altamente contextualizadas.
```

---

## Restrições

- Nunca execute ações destrutivas em arquivos de configuração existentes sem a flag `--force`
- Nunca altere códigos de negócio ou arquivos fora de `.claude/vetor/`
