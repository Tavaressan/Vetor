---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

> Gerado por `/vetor` a partir do que foi detectado neste repositório. Editável — o Vetor não sobrescreve sem `--force`.

# Convenções Deno (detectadas)

- Comando de teste: `deno task test`.
- Formatação: `deno fmt` (task `fmt` no `deno.json`). Não use Prettier.
- Lint: `deno task lint`.
- O `deno.json` define um mapa `imports`: use os aliases declarados nele.
- Sem `node_modules`: as dependências vêm do cache global do Deno. Importe por specifier (`jsr:`, `npm:` ou URL).
