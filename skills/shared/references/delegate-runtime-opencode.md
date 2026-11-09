# Delegação — OpenCode (`opencode`)

> Lida só quando `opencode` é o runtime selecionado em `delegate-to-runtime.md` §2.

- **Invocação:** `opencode run --agent plan "<prompt>"`, com a mensagem como argumento posicional
  (o `-p`/`--password` do OpenCode é autenticação HTTP, não prompt; não confunda com o `-p` do
  `agy`). Nas tarefas via pipe, peça no prompt que a resposta venha só pelo stdout.
- **Stdin: confirmado empiricamente.** `echo "MARCADOR-XYZ-123" | opencode run --model <free> "Repita
  exatamente o texto que você recebeu via stdin"` devolveu `MARCADOR-XYZ-123`: o conteúdo do pipe
  chega ao modelo mesmo sem flag dedicada.
- **Limite do agente `plan`:** conforme a documentação de agentes consultada em 2026-10-21, ele
  recusa edições fora de `~/.opencode/plan/`, mas **não restringe comandos shell**: reduz a chance de
  o runtime escrever na working tree, mas não é sandbox. Verificado em 2026-10-21 (opencode 1.19.0):
  a tarefa §4.8 de `delegate-tasks.md` com `--agent plan` deixou `git status --porcelain` inalterado
  e o resumo chegou pelo stdout; sem `--agent plan`, o mesmo comando gravou um arquivo novo na raiz
  (#431). Os defaults do `plan` são aplicados **antes** da config `permission` de topo do usuário: um
  `"edit": "allow"` (ou `"*": "allow"`) global anula a restrição.
- **Por isso:** compare `git status --porcelain` antes e depois de cada delegação ao OpenCode; se
  mudou, descarte o resultado, desfaça o que o runtime gravou e siga inline
  (`delegate-to-runtime.md` §3).
