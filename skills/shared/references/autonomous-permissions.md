# Permissões para fluxos autônomos (Claude Code)

> Lida pelo `install` (passo 2.d) e citada pelo `now`. Vale só no Claude Code: nos demais harnesses
> as permissões são do próprio harness, e o Vetor não as configura. Fatos consultados em 2026-11-09
> na documentação oficial; cada um traz a página.

## Por que

Workers em background, Pre-Ship e rotinas `--headless` param em prompts de permissão que ninguém vê
(uma onda de 5 workers ficou 8h30 parada, #562). Regras `allow` para o que o Vetor faz sempre evitam
esses prompts; merge, push para a default e comandos destrutivos continuam exigindo autorização
explícita (#560) e o hook de segurança.

## O que o Vetor oferece

`deno run -A "$SKILL_DIR/../../scripts/permissions-setup.ts" --check` lista as regras mínimas
presentes e ausentes (nos três arquivos de settings) e o estado do auto mode. Com anuência,
`--apply` acrescenta as ausentes a `.claude/settings.json` (ou `--local`, para
`.claude/settings.local.json`) sem remover nem alterar nada do que existe. As regras: `Edit` nos
status files (`/.claude/vetor/status/**`), leituras do `gh` (`pr view`, `pr checks`, `pr list`,
`issue view`, `issue list`), os subcomandos de leitura do `vetor-checks.sh` e o `vetor-status.sh`, e
o `testCommand` do `config.json`. **Nunca entram:** `gh pr merge`, `git push`, `vetor-merge.sh`,
`prepare`/`finalize`, cleanup e git destrutivo (o script recusa a lista se alguma escapar).

## Procedimento do install (passo 2.d)

Rode:

```bash
deno run -A "$SKILL_DIR/../../scripts/permissions-setup.ts" --check
```

1. Se `minimalRules.missing` vier vazio, registre "já configuradas" e siga.
2. Caso contrário, mostre as regras ausentes e pergunte uma vez (com a ferramenta de perguntas ou no
   chat): acrescentar em `.claude/settings.json` (versionado, vale para o time) / em
   `.claude/settings.local.json` (só nesta máquina) / pular. Nunca aplique sem a resposta.
3. Com anuência, rode `permissions-setup.ts --apply` (com `--local` na segunda opção). O script só
   acrescenta: nada existente é removido ou alterado, e settings com JSON inválido não é gravado
   (exit 1; relate e siga).
4. Recomende, sem disparar: `/auto-mode-setup`, que grava `autoMode.environment` em
   `~/.claude/settings.json` para o classificador do auto mode conhecer o projeto (sugira quando
   `autoMode.environmentConfigured` for `false`), e `/fewer-permission-prompts`, que acrescenta ao
   `.claude/settings.json` uma allowlist de leituras recorrentes tirada dos transcripts. Merge, push
   para a default e comandos destrutivos nunca entram na allowlist: dependem de autorização explícita.

## Fatos da documentação

- **Sintaxe de regra** (https://code.claude.com/docs/en/permissions.md): `Tool(specifier)`; em Bash
  o `*` vale em qualquer posição (`Bash(gh pr view *)`) e cada subcomando de um composto (`&&`, `;`,
  `|`) precisa casar uma regra. `Write(...)` não casa: use `Edit(...)`. Em settings de projeto,
  `/path` é relativo à raiz do projeto.
- **Arquivos e precedência** (https://code.claude.com/docs/en/settings.md): as listas de
  `permissions.allow` de `~/.claude/settings.json`, `.claude/settings.json` e
  `.claude/settings.local.json` são somadas; `deny` vence `allow`. O `allow` de
  `.claude/settings.json` só vale depois de o usuário confiar na pasta; o `settings.local.json`
  (não versionado) vale sem esse passo.
- **Auto mode** (https://code.claude.com/docs/en/permission-modes.md e
  https://code.claude.com/docs/en/auto-mode-config.md): um classificador revisa cada ação antes de
  rodar. `permissions.defaultMode: "auto"` e o objeto `autoMode` (`environment`, `allow`,
  `soft_deny`, `hard_deny`) só são lidos de `~/.claude/settings.json`, de managed settings ou de
  `--settings`; em `.claude/settings*.json` do projeto não têm efeito.
- **`/auto-mode-setup`** (auto-mode-config.md): comando built-in. Rascunha `autoMode.environment` a
  partir de CLAUDE.md, README, configs, remotes e sessões recentes e, se o usuário aceitar, grava em
  `~/.claude/settings.json`. A documentação só descreve o usuário digitando o comando: **a skill
  recomenda, não dispara.**
- **`/fewer-permission-prompts`** (https://code.claude.com/docs/en/commands.md): skill que lê os
  transcripts, acha chamadas de leitura recorrentes de Bash e MCP e acrescenta uma allowlist ao
  `.claude/settings.json` do projeto. Não há documentação de invocação pelo modelo: **a skill
  recomenda, não dispara.**
