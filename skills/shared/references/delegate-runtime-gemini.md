# Delegação — Gemini (Antigravity, `agy`)

> Lida só quando `agy` é o runtime selecionado em `delegate-to-runtime.md` §2.

- **Invocação:** `agy -p "<prompt>"` (`-p`/`--print` roda um prompt único e imprime a resposta).
- **Stdin: não funciona no modo padrão.** A flag `--input-format` padrão é `text`, que ignora o
  stdin (regressão de #111). Por isso o `agy` não serve às tarefas via pipe de `delegate-tasks.md`.
  Alternativa verificada: embutir o conteúdo no argumento do prompt (`agy -p "... $conteudo"`),
  válida só para conteúdo que cabe no limite da linha de comando; para conteúdo grande, prefira um
  runtime com stdin confirmado (`opencode` ou `codex`).
- **Falha conhecida:** já se observou erro genérico de encoding (`proto: field ... contains invalid
  UTF-8`) ao processar texto em português com acentuação. Trate como qualquer falha:
  `delegate-to-runtime.md` §3, sem retry.
- **Cache fora do projeto:** o `agy` pode persistir uma cópia do rascunho em
  `~/.gemini/antigravity-cli/brain/<uuid>/...`, fora do repositório. É comportamento do CLI; o Vetor
  só consome o stdout e não gerencia esse cache.
