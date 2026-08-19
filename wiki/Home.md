# Wiki do Vetor

Documentação de detalhe do plugin. O [README](../README.md) cobre instalação e uso; aqui fica o que
não precisa estar no caminho de quem só quer começar.

## Uso

- **[Configuração](Configuracao.md)** — mapeamento de testes por projeto, permissões do
  `.claude/settings.json` (Modo Seguro vs. Alta Eficiência) e delegação opcional ao Gemini.
- **[MCPs](MCPs.md)** — os três servidores MCP embarcados (`context7`, `chrome-devtools`, `docker`)
  e a superfície de risco de cada um.
- **[Referência](Referencia.md)** — hard caps, alavancas de custo de tokens e estrutura do
  repositório.

## Internals

- **[Arquitetura](Arquitetura.md)** — composição das skills, subagentes nativos, convenções geradas
  em `.claude/rules/vetor/` e observabilidade.
- **[Hooks](Hooks.md)** — o que é aplicado por hook (e não por prompt), e como reutilizar
  `vetor-checks.sh in-worktree` em hooks do seu próprio projeto.
- **[Decisões de design](Decisoes-de-Design.md)** — por que orquestração própria, o papel de Agent
  Teams e as limitações conhecidas de plataforma.

## Compatibilidade com outros runtimes

- **[Antigravity](Compatibilidade-Antigravity.md)** — proteção reduzida; não usar `coordinator`.
- **[OpenAI Codex](Compatibilidade-Codex.md)** — paridade estrutural de hooks, skills bloqueadas.
- **[OpenCode](Compatibilidade-OpenCode.md)** — isolamento de worktree resolvido, `coordinator` portado.
