# Classificação dos testes de contrato (issue #569)

Os testes de contrato conferiam trechos do texto das skills, o que congelava a redação dos prompts.
Cada bloco foi classificado em uma de três categorias:

- **comportamento**: o que o texto descreve é feito por um script; o teste do script cobre.
- **invariante**: regra de segurança ou ligação entre arquivos que precisa valer em qualquer
  redação; fica num teste estrutural, que busca no pacote da skill (`SKILL.md` e as referências
  alcançáveis), e não numa frase.
- **redação**: confere a frase escolhida; sai.

Totais (asserções, contando todos os `assert*`): comportamento 134, invariante 92, redação 576, num total de 802.

Achado da migração: o `ship` §11 mandava rodar um `git reset --hard` que o próprio hook bloqueia;
o bloco foi trocado por backup em branch e `git reset --keep`, e a invariante "nenhum bloco de shell
é bloqueado pelo hook" passou a cobrir todos os prompts.

Verificação do critério "reescrever uma skill sem mudar o comportamento não quebra a suíte": numa
cópia do repositório, toda a prosa de `skills/`, `agents/` e `opencode/agent/` foi re-quebrada em
72 colunas e as Fases 5 a 7 do `coordinator` foram movidas para uma referência nova, citada sob
demanda. A suíte passou, exceto por dois artefatos do experimento: o exemplo de
`skills/design/examples/` (dado de teste de um parser, não prompt) e o `opencode-install_test.ts`,
que precisa de `cli/`, deixado fora da cópia. O experimento achou e corrigiu duas fragilidades no
teste do agent do OpenCode: os cabeçalhos de fase passaram a ser procurados no pacote da skill, e o
limite de tamanho passou de linhas para caracteres.

Decisão registrada: a tabela de classificação do gate de Spec (#561) e a autorização de merge (#560)
eram testes de redação recém-criados; saem pela mesma regra, porque nenhum script implementa essas
regras e o teste quebraria ao mover o texto para uma referência (#573).


## `scripts/tests/auto-ship-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #497: --auto-ship e autoShipHeadless habilitam a Fase 6 em --headless | 6 | redação | removido |
| issue #497: Fase 6.d exige os quatro gates e o script que os avalia | 7 | comportamento | `auto-ship-gates_test.ts` |
| issue #497: gate reprovado deixa o PR aberto e é registrado, sem abortar nem perguntar | 6 | redação | removido |
| issue #497: restrições do headless foram atualizadas junto (skill, wiki e espelho OpenCode) | 3 | redação | removido |
| issue #497: os cabeçalhos que os gates procuram são os que os produtores publicam | 4 | invariante | `skill-invariants_test.ts` (fiação dos cabeçalhos) |
| issue #497: a referência documenta o gate estrito, o anti-forja e a heurística de severidade | 5 | redação | removido |

## `scripts/tests/backlog-labels-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #452: skills/backlog/SKILL.md não cria labels nem exige backlog/ai-generated | 7 | invariante | `skill-invariants_test.ts` (nunca criar labels) |
| issue #452: skills/backlog/SKILL.md mapeia apenas labels existentes e documenta omissão | 5 | redação | removido |
| issue #452: README.md deixa de citar ai-generated | 3 | redação | removido |

## `scripts/tests/concurrent-preship-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #494: Fase 6 despacha /vetor:ship --prepare em paralelo, um Agent por worktree verde | 8 | redação | removido |
| issue #494: Fase 5 manda acionar o Pre-Ship dos verdes sem esperar os demais workers | 2 | redação | removido |
| issue #494: CI monitorado por consulta agregada, sem gh pr checks --watch por PR | 4 | redação | removido |
| issue #494: espera total converge para max(T_ci) + 60 s, com polling dentro do teto de 50 s | 4 | redação | removido |
| issue #494: falha de pre-ship entra no vocabulário do Coordinator Report | 2 | redação | removido |

## `scripts/tests/coordinator-consolidated-interview-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #499: a Fase 2 tem a seção da entrevista consolidada, em turno único | 3 | redação | removido |
| issue #499: a entrevista consolida teto, Specs, entrega e aprovação, todos com (Recommended) | 3 | redação | removido |
| issue #499: a pergunta por issue e a pergunta solta do teto deixaram de existir | 4 | redação | removido |
| issue #499: no plan mode e nos outros ecossistemas o pacote cabe em uma única aprovação | 3 | redação | removido |
| issue #499: o runtime de delegação do agrupamento não gera pergunta própria | 2 | redação | removido |
| issue #499: --headless adota o (Recommended) de cada item da entrevista | 2 | redação | removido |
| issue #499: a retomada (--resume) também pergunta tudo em uma chamada | 1 | redação | removido |
| issue #499: o espelho OpenCode registra a entrevista como uma mensagem de texto | 2 | redação | removido |
| issue #560: o item 3 pede a autorização de merge com as três opções de entrega | 5 | redação | removido |
| issue #560: a Fase 6 trata a negação do merge com uma única pergunta | 3 | redação | removido |

## `scripts/tests/coordinator-decision-inbox-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #500: BLOCKED_WAITING vira SUSPENDED na inbox e libera a vaga no teto N | 6 | comportamento | `decision-inbox_test.ts` |
| issue #500: liberar a vaga não mata o worker (regra antiga reescrita) | 3 | redação | removido |
| issue #500: a notificação é texto não bloqueante; AskUserQuestion só sem nada a monitorar | 3 | redação | removido |
| issue #500: avanço otimista é opt-in, com a frase da Spec, tag de checkpoint e marcador | 6 | comportamento | `decision-inbox_test.ts` |
| issue #500: texto do usuário nunca vai na linha de comando | 3 | redação | removido |
| issue #500: a retomada usa o worktree existente, sem vetor:issue-worker, com prioridade sobre QUEUED | 4 | redação | removido |
| issue #500: o headless suspende, libera a vaga e reporta, sem escalar | 2 | redação | removido |
| issue #500: SUSPENDED entra nas regras de onda, duplicidade e dispatch | 3 | redação | removido |
| issue #500: o template do status file documenta SUSPENDED como estado só do coordinator | 3 | comportamento | `decision-inbox_test.ts`, `status_test.ts` |
| issue #500: o relatório tem SUSPENDED entre os resultados válidos dos dois modos | 1 | redação | removido |
| issue #500: o JSON da inbox não é versionado (repo e passo de instalação) | 2 | invariante | `skill-invariants_test.ts` (estado de runtime fora do git) |
| issue #500: o espelho OpenCode avisa que a Decision Inbox não se aplica lá | 2 | redação | removido |

## `scripts/tests/coordinator-footer-origin-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #453: linhas de rodapé geradas começam com o prefixo rastreável | 3 | invariante | `skill-invariants_test.ts` (rodapé de origem) |
| issue #453: skills/coordinator/SKILL.md §1 particiona por rodapé 🤖 Gerado por /vetor: no body com transição de ai-generated | 6 | invariante | `skill-invariants_test.ts` (prefixo do rodapé no coordinator) |
| issue #453: opencode/agent/issue-coordinator.md herda a partição por rodapé da skill, sem duplicar o texto | 2 | redação | removido |
| issue #453: o coordinator deixa de ter backlog como label default (skill e agent do OpenCode) | 6 | redação | removido |

## `scripts/tests/coordinator-goal-mode-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #498: a sintaxe aceita --goal com a meta entre aspas, junto de label, lista e retomada | 4 | redação | removido |
| issue #498: a relação com --headless e --auto-ship é explícita, numa tabela | 4 | redação | removido |
| issue #498: --goal sozinho nunca entrega nem faz merge; a entrega exige opt-in e os 4 gates | 5 | redação | removido |
| issue #498: nenhuma AskUserQuestion e decisões determinísticas pelo (Recommended) | 5 | redação | removido |
| issue #498: a execução converge até resolver ou ejetar tudo, com teto de sessão de 120 minutos | 5 | redação | removido |
| issue #498: a meta é texto literal, nunca interpolada em shell | 5 | redação | removido |
| issue #498: o Goal Convergence Report consolida sucessos, PRs preparados e ejetadas | 7 | redação | removido |
| issue #498: o modo goal não relaxa a restrição de nenhum hook nem a de labels | 2 | redação | removido |
| issue #498: as restrições da skill cobrem --goal junto de --headless | 1 | redação | removido |
| issue #498: o registro de decisões não é versionado (repo e passo de instalação) | 2 | invariante | `skill-invariants_test.ts` (estado de runtime fora do git) |
| issue #498: a decisão de design está registrada e o espelho OpenCode diz que --goal não se aplica | 3 | redação | removido |

## `scripts/tests/coordinator-graceful-ejection-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #501: a Fase 5.f define os gatilhos da ejeção graciosa | 5 | redação | removido |
| issue #501: o comentário diagnóstico sai por arquivo/stdin, sem escapes de shell | 3 | invariante | `gh-body-file-contract_test.ts` |
| issue #501: a label needs-human só é aplicada se já existir, e nunca é criada | 5 | invariante | `skill-invariants_test.ts` (nunca criar labels) |
| issue #501: a label de ejeção também é removida ao despachar a issue de novo | 2 | redação | removido |
| issue #501: o worktree é limpo com segurança e a branch nunca é apagada | 7 | comportamento | `ejection_test.ts` |
| issue #501: ejetar libera a onda e pula só os dependentes diretos | 3 | redação | removido |
| issue #501: o gate de Spec oferece a micro-spec JIT como padrão, sem pergunta de remoção | 3 | redação | removido |
| issue #501: a micro-spec JIT vive no dispatch, com path, prazo, validação e fallback | 10 | comportamento | `micro-spec_test.ts` |
| issue #501: o formato da micro-spec pede 1 objetivo, 3 critérios e 2 non-goals | 5 | comportamento | `micro-spec_test.ts` |
| issue #501: EJECTED consta no template, no vetor-status.sh e no relatório dos dois modos | 4 | comportamento | `vetor-status_test.ts`, `ejection_test.ts` |
| issue #501: o espelho OpenCode registra que a ejeção graciosa não se aplica lá | 3 | redação | removido |

## `scripts/tests/coordinator-native-dependencies-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #456: afirmativa defasada de ausência de grafo formal é removida e corrigida | 4 | redação | removido |
| issue #456: documenta leitura do endpoint REST e resumo de dependências bloqueadoras | 3 | redação | removido |
| issue #456: tratamentos documentados para bloqueadora fora da leva vs dentro da leva | 5 | redação | removido |
| issue #456: fallback para heurística textual em caso de falha ou indisponibilidade da API | 4 | redação | removido |
| issue #456: SKIPPED (bloqueada por #N) entra na triagem de despachabilidade e no plano da Fase 2 | 2 | redação | removido |
| issue #456: SKIPPED (bloqueada por #N) entra no vocabulário do Coordinator Report e fechamento de onda | 2 | redação | removido |
| issue #456: modelo de resolução de dependências cobre nativo, fora da leva, dentro da leva e fallback | 7 | redação | removido |

## `scripts/tests/coordinator-orphan-pr-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #527: coordinator lista PRs abertos sem worktree local com CI, mergeable e draft | 4 | redação | removido |
| issue #527: em --headless a entrega de PR órfão exige auto-ship e os gates da 6.d | 1 | redação | removido |
| issue #527: --finalize recria o worktree a partir da branch remota em vez de abortar | 4 | comportamento | `ship-prepare-finalize_test.ts` |
| issue #527: Fast Merge Gate inclui PRs órfãos no mapa e re-sincroniza o segundo sobreposto | 3 | redação | removido |
| issue #527: sem opt-in o headless apenas lista os PRs órfãos | 1 | redação | removido |
| issue #527: validação de headRefName e recusa de fork ficam em worktree-create 4.a | 7 | redação | removido |
| issue #527: ship resolve o cd do worktree recriado e delega os gates da 6.d ao chamador | 2 | redação | removido |
| issue #527: coordinator dá o comando concreto de detecção de PR órfão | 2 | redação | removido |
| issue #527: trechos novos não usam comandos destrutivos | 1 | invariante | `skill-invariants_test.ts` (blocos de shell passam no hook) |

## `scripts/tests/coordinator-spec-gate-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #561: a tabela de decisão cobre os 4 casos de label × critério de aceite | 1 | redação | removido |
| issue #561: enhancement com critério de aceite em checklist é trivial | 2 | redação | removido |
| issue #561: sem critério de aceite a issue é não-trivial, qualquer que seja a label | 2 | redação | removido |
| issue #561: múltiplos módulos continuam tornando a issue não-trivial | 1 | redação | removido |

## `scripts/tests/coordinator-triage-labels-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #457: skills/coordinator/SKILL.md documenta tabela de mapeamento de labels de triagem | 5 | redação | removido |
| issue #457: skills/coordinator/SKILL.md proíbe criação de labels (nunca gh label create) | 3 | invariante | `skill-invariants_test.ts` (nunca criar labels) |
| issue #457: skills/coordinator/SKILL.md exige remoção da label de triagem ao despachar issue | 5 | redação | removido |
| issue #457: skills/coordinator/SKILL.md documenta comportamento em modo --headless | 2 | redação | removido |
| issue #457: skills/coordinator/SKILL.md define não-escopo de status de execução (in-progress) | 2 | redação | removido |

## `scripts/tests/coordinator-watchdog-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #562: a Fase 5 arma o watchdog e o trata como bloqueio da 5.b | 2 | comportamento | `stalled-workers_test.ts` |
| issue #562: o watchdog tem caminho portátil e orienta checar permissões | 3 | comportamento | `stalled-workers_test.ts` |
| issue #562: o orçamento diz se a espera por workers conta no maxSessionMinutes | 2 | redação | removido |

## `scripts/tests/delegate-to-runtime-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issues #431 e #434: invocações isolam OpenCode e documentam Codex | 13 | redação | removido |
| issue #480: mcp-availability documenta o sinal mcp__alethe__* e a ausência de sinal fora do harness | 8 | redação | removido |
| issue #480: §6 trata o Alethe como runtime MCP com schema observado | 7 | redação | removido |
| issue #480: §2 inclui o runtime MCP no algoritmo de seleção sem escolhê-lo em silêncio | 3 | redação | removido |
| issue #481: o algoritmo documenta mcpAvailable e a escolha só por preferência | 4 | comportamento | `delegation-runtime_test.ts` |
| issue #481: /vetor:now cita o Alethe quando mcp__alethe__* está ativo e registra o probe como não implementado | 6 | redação | removido |
| issue #483: o contrato exige a varredura draft-scan.ts e a CLI existe | 9 | comportamento | `draft-scan_test.ts` |
| issue #480: cada regra do contrato prático traz fonte e data | 3 | redação | removido |
| issue #480: o contrato prático documenta os limites do Alethe | 1 | redação | removido |
| issue #504: a regra 1 diz qual isolate usar e cita os fatos observados com a data | 2 | redação | removido |
| issue #504: as limitações da varredura de JSDoc ficam registradas no fluxo | 5 | redação | removido |
| issue #486: o Alethe é o único orquestrador com adaptador e menção nas skills | 2 | comportamento | `orchestrator-registry_test.ts` |

## `scripts/tests/fast-merge-gate-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #495: Fase 6 do coordinator aponta para o Fast Merge Gate e para o --finalize | 3 | redação | removido |
| issue #495: fast-merge-gate.md lê o cache de arquivos tocados e usa check-disjoint antes do primeiro merge | 9 | comportamento | `disjoint-merge_test.ts` |
| issue #495: merge queue detectada pela API do GitHub, com a limitação documentada | 3 | comportamento | `vetor-merge_test.ts` |
| issue #495: enfileirado (exit 4) é distinto de mergeado (exit 0) em script, ship, gate e relatório | 8 | comportamento | `vetor-merge_test.ts` |
| issue #495: nenhum consumidor documenta exit 0 do vetor-merge.sh como 'enfileirado' | 1 | redação | removido |

## `scripts/tests/fix-latency-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #514: fix roda o typecheck de Node/TS antes dos testes | 4 | redação | removido |
| issue #515: test scoping nas iterações 1 a 4 e suíte completa antes do GREEN | 6 | redação | removido |

## `scripts/tests/gh-body-file-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issues #525/#532: skills e agents não usam --body inline em gh issue\|pr create\|comment | 1 | invariante | mantido em `gh-body-file-contract_test.ts` (detector em código) |
| detector pega --body inline e aceita --body-file | 6 | invariante | mantido em `gh-body-file-contract_test.ts` (detector em código) |
| detector pega heredoc, $(cat <<'EOF') e comando após && | 4 | invariante | mantido em `gh-body-file-contract_test.ts` (detector em código) |
| detector pega code span inline com --body | 2 | invariante | mantido em `gh-body-file-contract_test.ts` (detector em código) |
| detector avalia por comando: --body-file + heredoc de status file não acusa | 2 | invariante | mantido em `gh-body-file-contract_test.ts` (detector em código) |

## `scripts/tests/guardian-labels-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #455: guardian não cita nem aplica a label ai-generated no SKILL.md | 1 | redação | removido |
| issue #455: corpo das issues criadas pelo guardian termina com rodapé de origem | 3 | invariante | `skill-invariants_test.ts` (rodapé de origem) |
| issue #455: labels de tipo/módulo só são aplicadas se já existirem no repositório | 1 | redação | removido |
| issue #455: plano de auto-fix recomenda criação de issue sem menção a ai-generated | 1 | redação | removido |

## `scripts/tests/harness-capabilities-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #568: cada capacidade opcional tem uma seção de fallback na referência | 1 | invariante | mantido em `harness-capabilities-contract_test.ts` (estrutura do frontmatter e das seções) |
| issue #568: o compatibility de toda skill declara só o núcleo como obrigatório | 1 | invariante | mantido em `harness-capabilities-contract_test.ts` (estrutura do frontmatter e das seções) |

## `scripts/tests/install-ai-memory-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #503: a skill install não grava caminho pessoal do usuário | 2 | invariante | `skill-invariants_test.ts` (sem caminho pessoal) |
| issue #503: o install oferece o .ai-memory.toml com consentimento e sem sobrescrever | 6 | redação | removido |
| issue #503: o install aponta para a receita docker-compose e para a wiki de MCPs | 2 | redação | removido |

## `scripts/tests/memory-gotchas-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #370: consulta e registro de gotchas são opcionais e não bloqueiam o fluxo | 8 | redação | removido |

## `scripts/tests/memory-handoffs-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #371: handoff é complemento opcional do status file | 11 | redação | removido |

## `scripts/tests/prewarm-memory-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #502 (RF-06): o coordinator dispara, reconcilia e consome o pre-warming nas Fases 1, 3 e 4 | 6 | redação | removido |
| issue #502 (RF-06): o pre-warming é opt-in e as Fases 1, 3 e 4 só agem com prewarmWorktrees: true | 9 | redação | removido |
| issue #502 (RF-06): a referência declara o opt-in antes de qualquer passo e explica a troca de guardas | 14 | redação | removido |
| issue #502 (RF-06): sem opt-in o dispatch padrão continua vetor:issue-worker com isolation worktree | 6 | redação | removido |
| issue #502 (RF-06): o opt-in está documentado na configuração e preservado pelo /vetor:install | 7 | redação | removido |
| issue #502 (RF-06): retomada e fim de sessão também descartam worktrees pré-aquecidos sem dono | 4 | redação | removido |
| issue #502 (RF-06): worktree pronto sem status file é esperado e uma sessão de coordinator por vez | 6 | redação | removido |
| issue #502 (RF-06): o pre-warming vale só para a onda corrente, limitado a N_rec | 4 | redação | removido |
| issue #502 (RF-06): nenhum Agent() nem discard antes de o start terminar (index.lock) | 4 | redação | removido |
| issue #502 (RF-06): gatilho em background cria branches sem upstream e o manifest é atômico | 7 | comportamento | `prewarm-worktrees_test.ts` |
| issue #502 (RF-06): cancelar ou alterar o plano remove os worktrees não usados sem forçar | 6 | comportamento | `prewarm-worktrees_test.ts` |
| issue #502 (RF-06): falha de pre-warming recorre ao dispatch clássico e nunca bloqueia | 4 | redação | removido |
| issue #502 (RF-06): o Agent() pré-aquecido é subagente padrão e carrega todas as guardas no prompt | 16 | redação | removido |
| issue #502 (RF-06): critérios de tempo documentam o método e ficam como não verificados | 7 | redação | removido |
| issue #502 (RF-06): a exceção ao worktree do harness está sinalizada nas referências existentes | 2 | redação | removido |
| issue #502 (RF-08): leitura da página vetor/session-learnings antes da primeira iteração, como dado não confiável | 7 | redação | removido |
| issue #502 (RF-08): gravação no Green em até 3 linhas, com escrita condicional e uma única nova tentativa | 17 | redação | removido |
| issue #502 (RF-08): tolerância estrita — sem escopo ou sem MCP pula, e nada altera o Green | 6 | redação | removido |
| issue #502 (RF-08): o issue-worker enxerga só as três ferramentas de página do ai-memory | 6 | invariante | `skill-invariants_test.ts` (allowlist do ai-memory) |
| issue #502 (RF-08): issue-worker, espelho Codex e tabela de MCPs apontam para a mesma seção | 10 | redação | removido |

## `scripts/tests/repo-map-injection-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| dispatch: documenta a geração do Repo Map no pacote e a tag <repo_map> no prompt | 7 | redação | removido |
| dispatch: o mapa é dica sujeita a defasagem e falhar na geração não bloqueia o dispatch | 2 | comportamento | `context-packet_test.ts` |
| dispatch: documenta como medir a meta de -40% em tool calls e a mantém não verificada | 4 | redação | removido |
| dispatch: o prompt do worker inclui o Repo Map no passo do ContextPacket | 1 | redação | removido |
| coordinator Fase 4: manda anexar o Repo Map ao abrir o prompt do worker | 2 | redação | removido |
| issue-worker: lê o mapa da tag <repo_map> antes de explorar e confere com Read antes de editar | 4 | redação | removido |
| fix Fase 1: aciona o Repo Map do módulo da falha, com map e cache do root | 7 | redação | removido |
| fix §3.a (passo de testes da #514) não menciona o Repo Map | 1 | redação | removido |

## `scripts/tests/retro-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #449: template da retro inclui checklist de critério de aceite | 4 | redação | removido |
| issue #449: §5 aplica só label de tipo existente, nunca cria labels e não aplica ai-generated | 7 | redação | removido |
| issue #449: rodapé 🤖 Gerado por /vetor:retro permanece obrigatório | 3 | redação | removido |

## `scripts/tests/ship-deterministic-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| #543: ship e coordinator chamam prepare/finalize do vetor-checks.sh e só escalam em falha | 6 | comportamento | `ship-prepare-finalize_test.ts`; citação dos subcomandos em `skill-invariants_test.ts` |
| #542: template define Tested:, o worker o grava no GREEN e o ship documenta o pulo | 5 | comportamento | `ship-prepare-finalize_test.ts` |
| #541: coordinator revisa o diff local antes do prepare e registra a revisão no PR | 11 | redação | removido |

## `scripts/tests/ship-worker-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| ship-worker: frontmatter com tools restritas, sem isolation e compatível com agy plugin validate | 6 | invariante | `skill-invariants_test.ts` (frontmatter do ship-worker) |
| ship-worker: prompt conduz /vetor:ship --prepare, grava PR_STAGED e não bloqueia no CI | 6 | redação | removido |
| ship-worker: manda prefixar todo Bash com cd no worktree (cwd não persiste e não há isolation) | 2 | redação | removido |
| ship-worker: proíbe merge e push para a branch default | 6 | invariante | `skill-invariants_test.ts` (worker sem push/merge) |
| dispatch: documenta o ContextPacket com os campos obrigatórios da RF-07 | 8 | comportamento | `context-packet_test.ts` |
| dispatch: worktree.path é opcional no primeiro dispatch (o harness cria o worktree) | 1 | comportamento | `context-packet_test.ts` |
| dispatch: ship-worker é despachado no worktree existente, com modelo barato explícito | 3 | redação | removido |
| dispatch: documenta como medir a redução de tool calls de exploração (RF-07) | 2 | redação | removido |
| issue-worker: usa o ContextPacket antes de qualquer busca global | 4 | redação | removido |
| coordinator Fase 4: manda montar o ContextPacket no dispatch do worker | 2 | redação | removido |

## `scripts/tests/spike-investigation-dispatch-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #458: skills/coordinator/SKILL.md documenta detecção de issues spike e dispensa do gate de Spec | 5 | redação | removido |
| issue #458: skills/coordinator/SKILL.md documenta despacho em modo investigação com worktree docs e prompt específico | 8 | redação | removido |
| issue #458: agents/issue-worker.md documenta modo investigação com dispensa de TDD | 3 | redação | removido |
| issue #458: agents/issue-worker.md documenta formato do relatório, critério de GREEN e não-escopo | 5 | redação | removido |
| issue #458: skills/shared/references/issue-coordinator-dispatch.md alinhado com modo investigação | 2 | redação | removido |

## `scripts/tests/worker-terminal-status-contract_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #559: os dois workers rodam verify-status como último passo | 2 | comportamento | `check-status_test.ts`; citação do subcomando em `skill-invariants_test.ts` |
| issue #559: a Fase 5 manda reconciliar antes do Pre-Ship | 1 | redação | removido |
| issue #559: a reconciliação verifica commits e árvore, roda a suíte e registra | 5 | comportamento | `check-status_test.ts` |

## `opencode/scripts/issue-coordinator_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue-coordinator carrega a skill coordinator pela ferramenta skill, com permissão explícita — issue #478 | 5 | invariante | mantido (só o frontmatter de permissão) |
| issue-coordinator para e reporta a lacuna quando a skill não está disponível — issue #478 | 2 | redação | removido |
| issue-coordinator não repete as fases nem as regras da skill — issue #478 | 4 | invariante | mantido (agent fino, sem duplicar a skill) |
| issue-coordinator mantém as diferenças de execução do OpenCode — issue #478 | 10 | redação | removido |
| issue-coordinator documenta escalação simple -> complex após FAILED_MAX_ITERATIONS e sem default embutido — issue #395 | 8 | redação | removido |
| issue-coordinator só cita referências e scripts que o instalador entrega — issue #478 | 3 | invariante | mantido (links que o instalador entrega) |
| o checkpoint de fechamento de onda vive na referência compartilhada — issues #335 e #478 | 10 | redação | removido |
| nenhum agente em opencode/agent/ fixa model: no frontmatter — issue #395 | 1 | invariante | mantido (sem `model:` no frontmatter) |

## `scripts/tests/ship-worker-allowlist_test.ts`

| Teste | Asserções | Categoria | Destino |
| --- | ---: | --- | --- |
| issue #533: ship exige Write e ship-worker inclui Write na allowlist | 2 | invariante | `skill-invariants_test.ts` (Write no ship-worker) |
| issue #533: allowlist do ship-worker não inclui Agent nem plan mode | 1 | invariante | `skill-invariants_test.ts` (allowlist do ship-worker) |

## Fora dos arquivos `*contract*`

| Arquivo | Teste | Categoria | Destino |
| --- | --- | --- | --- |
| `code-review-smells_test.ts` | nomes de code smells de Fowler no `code-review` | redação | removido |
| `evidence-blocked-waiting_test.ts` | vocabulário do Evidence State no template e no `fix` | redação | removido; a referência cruzada continua coberta pelos links de `skill-portability_test.ts` |
| `dispatch-prompt_test.ts` | a skill do coordinator manda usar `dispatch-prompt.ts` | invariante | `skill-invariants_test.ts` (scripts do dispatch no pacote do coordinator) |

