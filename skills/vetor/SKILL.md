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

- `--force`: opcional — força a sobrescrita do mapeamento de testes (`module-test-map.md`), do arquivo de
  configuração (`config.json`) e das rules geradas (`.claude/rules/vetor/`) mesmo que já existam.

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

### 2 — Detectar o projeto (`module-test-map.md` + `config.json` + rules)

Um único script detecta o runtime, gera o mapeamento de testes, persiste a configuração e escreve as
rules de convenção do projeto:

```bash
deno run -A "$CLAUDE_PLUGIN_ROOT/scripts/detect-project.ts" [--force]
```

Repasse o `--force` recebido nos args. A guarda é **por arquivo**: sem `--force`, cada arquivo que já
existe é preservado (o JSON de saída informa o que foi criado e o que foi pulado).

O script grava:
- `.claude/vetor/module-test-map.md` — comandos de teste por módulo;
- `.claude/vetor/config.json` — `runtime`, `packageManager` e `testCommand` detectados, preservando
  o `maxConcurrentWorkers` (default 5). O `prepare-worktree.ts` lê isso para saber como preparar
  cada worktree;
- `.claude/rules/vetor/<runtime>.md` — convenções do projeto (comando de teste, formatador, lint,
  estilo de import), com frontmatter `paths` para entrarem em contexto **apenas** quando o agente lê
  um arquivo daquele tipo. Só há rules para projetos Deno e Node; nos demais runtimes o script não
  gera nenhuma.

Cada linha de uma rule corresponde a um fato lido do repositório (`deno.json`, `package.json`,
arquivos de config). O que não foi detectado não vira regra.

Se o runtime sair como `unknown`, avise o usuário de que o `module-test-map.md` precisa de ajuste
manual — as skills de teste dependem dele.

### 3 — Exibir Sumário de Configuração e Próximos Passos

Após a criação/validação dos arquivos, exiba uma mensagem informativa clara e amigável para o desenvolvedor:

```
🚀 Vetor inicializado com sucesso!

Runtime detectado: <runtime> (<testCommand>)

Arquivos configurados:
- [x] .claude/vetor/module-test-map.md (Mapeamento de testes por módulo)
- [x] .claude/vetor/config.json (runtime detectado + maxConcurrentWorkers: 5)
- [x] .claude/vetor/status/ (status files dos workers — gitignorado)
- [x] .claude/rules/vetor/<runtime>.md (convenções do projeto, carregadas sob demanda)

Próximos passos recomendados:
1. Abra e revise o arquivo `.claude/vetor/module-test-map.md` para garantir que os comandos de teste headless e os mapeamentos de pasta de seu projeto estejam 100% corretos.
2. Revise e **commite** `.claude/rules/vetor/`. Os issue-workers rodam em worktrees, que só contêm arquivos rastreados pelo git — uma rule não commitada não chega até eles.
3. (Opcional) Crie a pasta `.claude/vetor/docs/` e adicione guias de arquitetura, padrões do projeto e gaps em markdown. O comando `/vetor:backlog` lerá automaticamente estes arquivos para propor issues altamente contextualizadas.
```

Se o script pulou algum arquivo por já existir, diga qual — e que só `--force` o sobrescreve.

---

## Restrições

- Nunca execute ações destrutivas em arquivos de configuração existentes sem a flag `--force`
- Nunca altere códigos de negócio ou arquivos fora de `.claude/vetor/` e `.claude/rules/vetor/`
- Nunca escreva em `.claude/rules/` fora do subdiretório `vetor/` — esse espaço é do usuário
