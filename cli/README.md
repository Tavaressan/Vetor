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

**Pré-requisitos:** [Deno](https://deno.com) e `gh` CLI autenticado no PATH, Git com suporte a `git worktree`.

## Uso

```
vetor install     # instala o Vetor no projeto atual
vetor update       # sincroniza a instalação existente com a fonte
vetor status       # mostra o status da instalação por engine
vetor uninstall    # remove os arquivos instalados pelo Vetor (pede confirmação)
vetor --help       # lista os comandos disponíveis
```

## Documentação

Skills, arquitetura, configuração e compatibilidade multi-engine: [wiki do repositório principal](https://github.com/Tavaressan/Vetor/tree/master/wiki).

## Licença

[MIT](https://github.com/Tavaressan/Vetor/blob/master/LICENSE) © 2026 Vitor Tavares Chaves.
