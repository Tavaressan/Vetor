# Desenvolvimento e Dogfooding

Instruções e boas práticas para desenvolver, testar e contribuir com o Vetor utilizando o próprio Vetor (dogfooding).

## O Problema do Cache no Dogfooding

O Claude Code instala plugins a partir de marketplaces (por exemplo, `/plugin install vetor@vetor`) e armazena os artefatos em um diretório de cache local do usuário:
`~/.claude/plugins/cache/<marketplace>/<plugin>/<versão>/` (por exemplo, `~/.claude/plugins/cache/vetor/vetor/1.1.0/`).

Quando você inicia o Claude Code diretamente no repositório do Vetor sem parâmetros adicionais (`claude`), **o harness não carrega as skills do working tree automaticamente**. Em vez disso, ele consome a versão em cache já instalada globalmente.

### Consequências observadas (Issue #450)
- **Defasagem silenciosa:** Instruções de skills recém-alteradas ou PRs recém-mergeados (como regras de `ship` ou adições no `coordinator`) não têm efeito na sessão ativa.
- **Divergência de documentação e referências:** O agente ou desenvolvedor continua operando com instruções congeladas da versão em cache, precisando consultar branches ou arquivos manualmente para ler referências atualizadas.
- **Falsa validação:** Testes de skills executados via slash commands (`/vetor:...`) validam a release anterior em cache, e não as modificações do working tree.

---

## Carregando o Plugin do Working Tree (`--plugin-dir`)

Para que o Claude Code utilize os arquivos do seu repositório local durante o desenvolvimento, passe o sinalizador `--plugin-dir` apontando para a raiz do working tree (conforme documentado na [referência oficial de plugins do Claude Code](https://code.claude.com/docs/en/plugins-reference)):

```bash
# Na raiz do repositório Vetor:
claude --plugin-dir .

# Ou passando o caminho absoluto/relativo explícito:
claude --plugin-dir /caminho/para/Vetor
```

### Validação do Manifesto

O Claude Code identifica o plugin pelo manifesto `.claude-plugin/plugin.json` na raiz informada. Para validar se o manifesto e a estrutura local estão íntegros antes de iniciar:

```bash
claude plugin validate .
```

---

## Interação com o Plugin Instalado: Precedência e Resolução de Conflitos

Ao utilizar `--plugin-dir .` em um ambiente que já possui o Vetor instalado via marketplace:

1. **Precedência em nível de sessão:** O Claude Code trata opções de linha de comando (`--plugin-dir` e `--plugin-url`) com precedência sobre instalações persistentes nos escopos `user`, `project` ou `local`. Os componentes locais (skills, subagentes nativos, hooks e configurações de MCP) sobrepõem os componentes homônimos da versão em cache para aquela sessão, salvo quando o plugin está em `enabledPlugins` de managed settings. Nesse caso, a cópia de `--plugin-dir` é ignorada com a mensagem `--plugin-dir copy of "<name>" ignored: plugin is locked by managed settings`.
2. **Resolução de nomes e namespaces:** Não há colisão de nomes. Os slash commands `/vetor:<skill>` invocam as definições do diretório local apontado por `--plugin-dir`.
3. **Isolamento e diagnóstico:** `claude plugin list` não mostra a substituição: a linha do marketplace continua aparecendo como habilitada porque reflete as settings. Para confirmar a substituição, inicie `claude --plugin-dir . --debug` e consulte o log em `~/.claude/debug/`, que registra `Plugin "vetor" from --plugin-dir overrides installed version`. Se desejar isolamento absoluto, você pode desinstalar temporariamente a versão do marketplace (`/plugin uninstall vetor`).

---

## Ciclo de Vida e Recarga em Sessão Ativa

O Claude Code carrega as definições de skills, agentes e hooks na inicialização da sessão ou na primeira invocação de cada componente.

- **Alterações durante a sessão:** Modificações feitas em arquivos de instrução (`skills/*/SKILL.md`, `agents/*.md`) ou em scripts durante uma sessão ativa **não** são refletidas a cada prompt automaticamente se já estiverem em memória.
- **Recarga manual:** Para aplicar as alterações do working tree sem reiniciar a sessão do terminal, utilize o comando:
  ```text
  /reload-plugins
  ```
- **Recarga dos plugins:** `/reload-plugins` recarrega do disco o conjunto de plugins (skills, agentes, hooks, servidores MCP e LSP). Só alterações em monitors exigem reiniciar a sessão.

---

## Dogfooding com Subagentes e Worktrees

O Vetor utiliza worktrees isolados para execução paralela de tarefas (`coordinator`, `worktree-create`). Ao desenvolver funcionalidades que envolvam worktrees:

- Os subagentes despachados nativamente pelo Claude Code herdam o contexto do harness principal da sessão (portanto, utilizam as skills resolvidas via `--plugin-dir`).
- Ao abrir uma nova janela ou sessão de terminal diretamente dentro de um worktree isolado (ex.: `.claude/worktrees/...`), lembre-se de inicializar com `claude --plugin-dir <raiz-do-repositorio>` para garantir o carregamento das skills locais.

---

## Desenvolvimento em Outros Runtimes

- **Google Antigravity:** Para testar alterações locais no harness global, execute `agy plugin install .` na raiz do clone ou instale via npx no workspace de teste (`npx @tavaressan/vetor install --engines antigravity --yes`).
- **OpenCode:** O OpenCode consome o diretório `.opencode/` do projeto. Testes de desenvolvimento utilizam scripts locais em `opencode/` sincronizados no projeto.
- **OpenAI Codex e Cursor:** Consomem respectivamente `.codex/` e `.cursor/` locais no projeto-alvo.
