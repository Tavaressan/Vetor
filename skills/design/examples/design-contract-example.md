# Design Contract — Exemplo (Painel de Worktrees)

Fixture de referência para a integração do Design Contract com o Evidence State
(`skills/shared/references/evidence-state.md`, #214 — ver `design-vocabulary.md` §4.4). Cobre os
campos mínimos necessários para demonstrar as Decisões e a Questão aberta; não é um Design Contract
completo (campos como Tokens, Responsividade e Acessibilidade foram omitidos por não serem
necessários para este exemplo).

## Objetivo da experiência

Permitir ao usuário visualizar os worktrees ativos do projeto e criar um novo sem sair da
aplicação.

## Telas

Painel de Worktrees (lista) → Modal de criação de worktree.

## Decisões

```text
CONFIRMED
Ação primária da tela é "Criar worktree".
Source: Prototype

INFERRED
A sidebar representa navegação persistente entre projetos.
Source: Prototype + Specification

ASSUMED
Navegação desktop permanece expandida acima de 1024px.
Reason: Nenhuma tela do protótipo cobre breakpoints intermediários; premissa necessária para
avançar a especificação.
```

## Questões abertas

```text
OPEN_QUESTION
Os filtros da lista de worktrees devem persistir entre sessões?
Impact: Afeta se o estado do filtro precisa ser persistido em storage do cliente ou servidor.
```

## Referências

- Prototype: (link do protótipo)
- Specification: (link da spec)
