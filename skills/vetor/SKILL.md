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

### 1 — Garantir estrutura de diretórios

Crie o diretório de configurações do Vetor no projeto-alvo:

```bash
mkdir -p .claude/vetor
```

### 2 — Configurar Mapeamento de Testes (`module-test-map.md`)

O mapeamento de testes é essencial para que skills como `worktree-ship` e `fix-loop-agent` saibam como rodar testes de forma automatizada.

1. Verifique se o arquivo `.claude/vetor/module-test-map.md` já existe.
2. **Se o arquivo já existir** e a flag `--force` **não** foi fornecida:
   - Reporte que o arquivo já existe e mantenha o conteúdo atual intacto.
3. **Se o arquivo não existir** ou a flag `--force` **oi** fornecida:
   - Execute o script de auto-detecção padrão:
     ```bash
     $CLAUDE_PLUGIN_ROOT/scripts/auto-detect.sh
     ```
   - Se o script de auto-detecção reportar sucesso, informe a criação do arquivo.
   - Se o script falhar ou não encontrar comandos, use o template padrão como fallback:
     ```bash
     cp "$CLAUDE_PLUGIN_ROOT/skills/shared/references/module-test-map.template.md" \
        .claude/vetor/module-test-map.md
     ```

### 3 — Configurar Parâmetros globais (`config.json`)

O arquivo `.claude/vetor/config.json` define variáveis comportamentais do plugin, como o limite de concorrência de subagentes.

1. Verifique se o arquivo `.claude/vetor/config.json` já existe.
2. **Se o arquivo não existir** ou a flag `--force` **foi** fornecida:
   - Crie o arquivo `.claude/vetor/config.json` com a configuração padrão de concorrência inicializada para 5 workers:
     ```json
     {
       "maxConcurrentWorkers": 5
     }
     ```
     (Caso `--force` seja passado e o arquivo já exista, sobrescreva-o para garantir o valor padrão de 5, ou relate se foi mantido).
3. **Se o arquivo já existir** e a flag `--force` **não** foi fornecida, preserve o conteúdo atual.

### 4 — Exibir Sumário de Configuração e Próximos Passos

Após a criação/validação dos arquivos, exiba uma mensagem informativa clara e amigável para o desenvolvedor:

```
🚀 Vetor inicializado com sucesso em .claude/vetor/!

Arquivos configurados:
- [x] .claude/vetor/module-test-map.md (Mapeamento de testes por módulo)
- [x] .claude/vetor/config.json (Configurações do plugin. maxConcurrentWorkers: 5)

Próximos passos recomendados:
1. Abra e revise o arquivo `.claude/vetor/module-test-map.md` para garantir que os comandos de teste headless e os mapeamentos de pasta de seu projeto estejam 100% corretos.
2. (Opcional) Crie a pasta `.claude/vetor/docs/` e adicione guias de arquitetura, padrões do projeto e gaps em markdown. O comando `/vetor:backlog` lerá automaticamente estes arquivos para propor issues altamente contextualizadas.
```

---

## Restrições

- Nunca execute ações destrutivas em arquivos de configuração existentes sem a flag `--force`
- Nunca altere códigos de negócio ou arquivos fora de `.claude/vetor/`
