# Delegação — Codex (`codex`)

> Lida só quando `codex` é o runtime selecionado em `delegate-to-runtime.md` §2.

- **Invocação:** `codex exec -s read-only "<prompt>"`, com o prompt como argumento posicional
  (documentado por `codex exec --help` do codex-cli 0.163.0, que também documenta
  `-s, --sandbox <read-only|workspace-write|danger-full-access>`).
- **Stdin: confirmado empiricamente** (codex-cli 0.163.0, 2026-10-21). O help diz: "If stdin is
  piped and a prompt is also provided, stdin is appended as a `<stdin>` block". `echo
  "MARCADOR-VETOR-434-XQ7" | codex exec -s read-only "Repita exatamente o marcador que você recebeu
  via stdin, sem mais nada"` devolveu o marcador no stdout, sem alterar a working tree.
- **Diagnóstico de entrega vazia do Alethe:** quando um worker Codex do Alethe devolve `text`
  vazio, rode o `codex exec` no host para ver se o limite de uso foi atingido
  (`delegate-alethe.md` §6.3, regra 9).
