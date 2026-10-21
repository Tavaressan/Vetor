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
vetor --help       # lista os comandos disponíveis
```

`vetor status` mostra a versão instalada e a versão do CLI, além de classificar cada arquivo como íntegro, modificado ou ausente. Sai com código 1 se houver arquivo ausente.

`vetor doctor` verifica Deno, autenticação do `gh` e suporte a `git worktree`; falhas nesses itens fazem o comando sair com código 1. A detecção de engines e a busca por cópias globais do Vetor no OpenCode são informativas.

## Documentação

Skills Codex são instaladas em `.agents/skills/`, que o Codex varre em cada diretório do cwd até a raiz do repositório ([documentação oficial](https://learn.chatgpt.com/docs/build-skills), consultada em 2026-10-21). Agentes e hooks Codex continuam em `.codex/`. Skills, arquitetura, configuração e compatibilidade multi-engine: [wiki do repositório principal](https://github.com/Tavaressan/Vetor/tree/master/wiki).

## Licença

[MIT](https://github.com/Tavaressan/Vetor/blob/master/LICENSE) © 2026 Vitor Tavares Chaves.
