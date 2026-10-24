# Vetor

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Tavaressan/Vetor/master/assets/logo-dark.png">
    <img src="https://raw.githubusercontent.com/Tavaressan/Vetor/master/assets/logo.png" alt="Vetor Logo" width="320" />
  </picture>
</div>

[![npm version](https://img.shields.io/npm/v/@tavaressan/vetor.svg)](https://www.npmjs.com/package/@tavaressan/vetor)
[![license](https://img.shields.io/npm/l/@tavaressan/vetor.svg)](https://github.com/Tavaressan/Vetor/blob/master/LICENSE)

Instalador do **Vetor**: plugin de skills para automação de workflow de desenvolvimento no Claude Code, Codex e outras engines de agente.

Este pacote é o instalador de linha de comando. As skills em si (ideação, coordenação de issues, fix loop, ship, guardian) vivem no [repositório principal](https://github.com/Tavaressan/Vetor) — leia o README de lá para o que o Vetor faz.

## Instalação

```
npm install -g @tavaressan/vetor
vetor install
```

Ou via Deno, sem instalação ou com instalação global:

```sh
deno run -A npm:@tavaressan/vetor install
deno install --global --compile -A npm:@tavaressan/vetor
```

`-A` concede todas as permissões: o CLI lê e escreve no projeto, acessa variáveis de ambiente e, no `doctor`, executa `git`, `gh` e `deno`. O modo interativo sob Deno ainda requer validação manual em um terminal real.

**Pré-requisitos:** [Deno](https://deno.com) e `gh` CLI autenticado no PATH, Git com suporte a `git worktree`.

## Uso

```
vetor install     # instala o Vetor no projeto atual
vetor update       # sincroniza a instalação existente com a fonte
vetor status       # mostra o status da instalação por engine
vetor doctor       # verifica Deno, gh autenticado, Git worktree, engines e cópias globais do OpenCode
vetor uninstall    # remove os arquivos instalados pelo Vetor (pede confirmação)
vetor uninstall --engines cursor   # remove só as engines informadas (IDs separados por vírgula)
vetor --help       # lista os comandos disponíveis
```

`vetor status` mostra a versão instalada e a versão do CLI, além de classificar cada arquivo como íntegro, modificado ou ausente. Sai com código 1 se houver arquivo ausente.

`vetor doctor` verifica Deno, autenticação do `gh` e suporte a `git worktree`; falhas nesses itens fazem o comando sair com código 1. A detecção de engines e a busca por cópias globais do Vetor no OpenCode são informativas.

## Documentação

Skills Codex são instaladas em `.agents/skills/`, que o Codex varre em cada diretório do cwd até a raiz do repositório ([documentação oficial](https://learn.chatgpt.com/docs/build-skills), consultada em 2026-10-21). Agentes e hooks Codex continuam em `.codex/`.

O Cursor também lê `.agents/skills/`, `.claude/skills/` e `.cursor/skills/` ([documentação oficial](https://cursor.com/docs/skills), consultada em 2026-10-23), então as skills dele não ganham uma cópia própria quando outra engine já as grava num desses diretórios: com Codex ou Antigravity o Cursor usa `.agents/skills/`; com Claude Code (sem Codex nem Antigravity), `.claude/skills/`; sozinho (ou só com OpenCode), `.cursor/skills/`. `.claude/skills/` continua sendo do Claude Code, e agentes e hooks do Cursor seguem em `.cursor/`. O `vetor update` migra para o diretório compartilhado as skills antigas de `.cursor/skills/` que não foram editadas; as editadas ficam onde estão, com aviso. `vetor uninstall --engines <ids>` retira só as engines informadas e mantém no disco o arquivo compartilhado que outra engine ainda usa.

Skills, arquitetura, configuração e compatibilidade multi-engine: [wiki do repositório principal](https://github.com/Tavaressan/Vetor/tree/master/wiki).

## Licença

[MIT](https://github.com/Tavaressan/Vetor/blob/master/LICENSE) © 2026 Vitor Tavares Chaves.
