# Investigação: descoberta de capacidades dos harnesses

**Issue:** #618 — spike(capabilities): mecanismos de descoberta e capacidades detectáveis por
harness **Data:** 2026-11-10 **Base:** `master` em `f6ab98f` **Contexto:** ADR-002, Fase 0,
objetivos 1 e 2, questões abertas 1, 2 e 3
(`/home/tavaressan/Projects/orca/workspaces/Vetor/brittlestar/docs/adr/ADR-002-capability-based-execution-routing.md`,
lido para referência; arquivo externo, não copiado nem commitado). Parte da matriz da #568
(`skills/shared/references/harness-capabilities.md`, `wiki/Contrato-de-Capacidades.md`) sem
redefini-la.

**Rótulos:** **[Fato]** verificado na fonte citada ou em comando registrado · **[Inferência]**
conclusão derivada dos fatos · **[Opinião]** juízo técnico.

---

## 1. Pergunta

1. Para Claude Code, Antigravity, OpenCode, Kilo e Codex, que mecanismos de descoberta existem
   (inspeção do CLI, `--version`/`--help`, arquivos de configuração, variáveis de ambiente, adapters
   de integração)?
2. Quais capacidades (terminal, filesystem, browser, git, MCP, paralelismo, background, retomada,
   worktree isolado) podem ser detectadas com confiança, e quais só podem ser declaradas?
3. Como separar capacidade declarada, verificada e operacional na prática, e qual o custo de
   verificar cada uma (tempo, efeitos colaterais, credenciais)?
4. A descoberta deve usar inspeção nativa do CLI, adapters de integração ou ambos? Os perfis ficam
   embutidos no Vetor, vêm das integrações ou os dois?
5. Como a descoberta se comporta quando o harness não está instalado ou a versão é desconhecida?

## 2. Resumo

- **[Fato]** `--version` e `--help` (comandos de leitura) funcionaram para `claude` (2.1.322), `agy`
  (1.5.4), `opencode` (v2.2.7) e `codex` (0.167.0) neste host; o `kilo` está presente como shim do
  `mise`, mas invocar `--version`/`--help` disparou tentativa de instalação/fetch do pacote
  `npm:@kilocode/cli@7.8.27`, com efeito colateral de rede/instalação não concluído nesta
  verificação (§3.2).
- **[Fato]** A matriz da #568 (`wiki/Contrato-de-Capacidades.md:24-30`,
  `skills/shared/references/harness-capabilities.md:22-84`) já cobre subagentes, hooks, isolamento
  de worktree, perguntas, background e agendamento por harness; esta investigação a reutiliza e a
  estende para as capacidades pedidas pela #618 (terminal, filesystem, browser, git, MCP,
  paralelismo, background, retomada, worktree isolado), marcando detectável / só declarável /
  desconhecida por célula (§4).
- **[Fato]** No repositório, a descoberta programática existente é por sinais parciais e
  heterogêneos: presença de namespaces de ferramenta MCP
  (`skills/shared/references/delegate-alethe.md:24-34`, `mcp-availability.md:130-140`), ordem de
  resolução de executável do Orca (`docs/investigations/orca-adapter.md:289-304`), e contrato de
  disponibilidade por probe de ferramentas em `scripts/lib/orchestrator/types.ts:89-97` — não há um
  mecanismo único de descoberta de capacidades de harness.
- **[Inferência]** Capacidades fundamentais do núcleo (ler/editar/rodar shell, logo
  filesystem/terminal/git quando presentes no ambiente) são verificáveis por sonda barata e local;
  capacidades dependentes de sessão, UI, provedores, credenciais ou estado remoto (browser, retomada
  real, background confiável, MCP operacional em todos os contextos) tendem a ser só declaradas ou
  verificáveis apenas em contexto específico.
- **[Opinião]** A descoberta deve combinar inspeção nativa barata do CLI/ambiente (quando instalado)
  com perfis declarativos versionados embutidos no Vetor e, quando existirem, adapters de integração
  que exponham verificações operacionais; sem isso, a ausência de instalação ou versão desconhecida
  não pode ser tratada como ausência de capacidade.

## 3. Evidências

### 3.1 Fontes de base (sem redefinir a #568)

- **[Fato]** `skills/shared/references/harness-capabilities.md:7-20` define o núcleo obrigatório
  (ler arquivos, editar arquivos, rodar shell com `git`, `gh`, `deno`) e a regra de detecção: usar
  capacidade quando a ferramenta correspondente estiver na lista da sessão, sem sondagem ativa por
  chamada de ferramenta.
- **[Fato]** `wiki/Contrato-de-Capacidades.md:9-17` reafirma que todo fluxo suportado funciona só
  com o núcleo e que recurso exclusivo de harness é otimização aditiva com fallback portátil.
- **[Fato]** `wiki/Contrato-de-Capacidades.md:24-30` traz a matriz por harness para subagentes,
  hooks, isolamento de worktree, perguntas, background e agendamento (Claude Code, OpenCode,
  Antigravity, Codex, Cursor), com legendas ✅/⚠️/❌/❓.
- **[Fato]** `docs/investigations/orca-adapter.md:64-77,289-315` mostra descoberta por
  `agent-context --json`/`status --json` de um CLI externo (Orca), com resolução segura de
  executável e verificação de capacidades/contrato sem precisar de efeitos colaterais além da
  execução do binário resolvido por caminho.
- **[Fato]** `docs/investigations/orchestrator-adapter-contract.md:170-188,288-323` evidencia que
  disponibilidade (`isAvailable`) hoje é probe sem I/O baseado em contexto (ex.: ferramentas
  presentes) e propõe ampliar para executáveis resolvidos, distinguindo detecção de disponibilidade
  de verificação operacional.
- **[Fato]** ADR-002
  (`/home/tavaressan/.../ADR-002-capability-based-execution-routing.md:99-117,152-158`) distingue
  capacidades declaradas, verificadas e operacionais no descritor/registry e exige que anúncio não
  seja tratado como prova operacional.

### 3.2 Sondagens de CLI executadas neste host

Comandos de leitura executados em 2026-11-10 (shell, sem login, sem escrita de configuração, sem
processos remanescentes conhecidos):

| Harness/CLI            | Resolução                                                                                | `--version`               | `--help` (amostra)                                                                                                                                                               | Custo observado                                       | Efeitos colaterais                                                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (`claude`) | `/home/tavaressan/.local/share/mise/command-wrappers/bin/claude`                         | `2.1.322 (Claude Code)`   | uso interativo/`-p`, flags como `--agent`, `--mcp` não visível no recorte, `--session`/`--continue`/`--resume` em opções de sessão/background no help completo parcial capturado | ~imediato (execução local)                            | nenhum observado                                                                                                                                                                                                                                                                                  |
| Antigravity (`agy`)    | `/home/tavaressan/.local/share/mise/installs/antigravity-cli/latest/agy`                 | `1.5.4`                   | flags `--agent`, `--mode`, `--model`, `--remote-agent`, `--sandbox`; subcomandos `acp`, `mcp`, `plugin`, `models` etc.                                                           | ~imediato                                             | nenhum observado                                                                                                                                                                                                                                                                                  |
| OpenCode (`opencode`)  | `/home/tavaressan/.local/share/mise/installs/opencode/latest/node_modules/.bin/opencode` | `opencode v2.2.7`         | subcomandos `run`, `session`, `mcp`, `models`, `serve`, flags `--continue/-c`, `--session/-s`, `--agent`                                                                         | ~imediato                                             | nenhum observado                                                                                                                                                                                                                                                                                  |
| Codex (`codex`)        | `/home/tavaressan/.local/share/mise/command-wrappers/bin/codex`                          | `codex-cli 0.167.0`       | subcomandos `exec`, `resume`, `fork`, `mcp`, `app-server`, `sandbox`, `features`; modos interativo e não interativo                                                              | ~imediato                                             | nenhum observado                                                                                                                                                                                                                                                                                  |
| Kilo (`kilo`)          | `/home/tavaressan/.local/share/mise/shims/kilo` (shim)                                   | não obtida de forma limpa | help parcial exibido após logs de bootstrap (`kilo run`, `attach`, `serve`, `session`, `mcp`, `models`, `worktree` visíveis no recorte)                                          | alto para leitura: >30s observados durante tentativas | **[Fato]** invocar `--version`/`--help` acionou `mise` para instalar/fetch `npm:@kilocode/cli@7.8.27` (rede/download tentado, sem confirmação de instalação final neste relatório); isso é efeito colateral relevante para descoberta automática, embora os comandos solicitados sejam de leitura |

**[Inferência]** Para Kilo, a presença de um shim não equivale a CLI pronta para inspeção barata; a
resolução via gerenciador pode introduzir custo e efeitos colaterais inesperados.

### 3.3 Inspeção de configuração/ambiente (sem leitura de segredos)

- **[Fato]** Este ambiente expõe sinais de harness em variáveis/processo: `ORCA_*` em contexto Orca
  foi documentado em `docs/investigations/orca-adapter.md:244-248` (não reexecutado aqui), e a skill
  do ambiente atual indica ferramentas de execução/sessão próprias do OpenCode.
- **[Fato]** O repositório contém perfis de compatibilidade documentais por harness:
  `wiki/Compatibilidade-Antigravity.md`, `wiki/Compatibilidade-Codex.md`,
  `wiki/Compatibilidade-OpenCode.md`, `wiki/Compatibilidade-Cursor.md`, referenciados por
  `wiki/Contrato-de-Capacidades.md:32-37`.
- **[Inferência]** Arquivos de configuração locais e variáveis de ambiente podem ser sinais de
  instalação/integração, mas sua leitura deve ser limitada a presença/formato/versão declarada e
  nunca a credenciais; na prática, isso costuma viabilizar detecção de "instalado/configurado", não
  de capacidade operacional.

## 4. Matriz harness × capacidade (pergunta 2)

A matriz abaixo parte da #568 e a estende para as capacidades pedidas. Cada célula indica
**Detectável** (por sonda/inspeção objetiva, com custo aceitável), **Só declarável** (depende de
documentação/configuração/versão ou de prova contextual não generalizável), ou **Desconhecida** (sem
evidência suficiente neste contexto). "Fonte" aponta para a evidência usada.

### 4.1 Claude Code (`claude` 2.1.322)

| Capacidade       | Classificação                                    | Fonte                                                                                                                                                                     | Observação                                                                                                                |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Terminal         | **Detectável**                                   | Núcleo `skills/shared/references/harness-capabilities.md:10-16`; CLI presente (`--version`/`--help`, §3.2)                                                                | **[Fato]** capacidade de rodar shell é premissa do núcleo e observável no ambiente.                                       |
| Filesystem       | **Detectável**                                   | Núcleo `harness-capabilities.md:10-13`; ferramentas de leitura/edição disponíveis na sessão                                                                               | **[Fato]** leitura/edição de arquivos operacional nesta sessão.                                                           |
| Browser          | **Só declarável**                                | `built-in-browser` e `chrome-browser` skills listadas no ambiente; sem sonda direta executada                                                                             | **[Inferência]** depende de ferramentas/conectores habilitados por sessão, não do binário `claude` isoladamente.          |
| Git              | **Detectável**                                   | Núcleo exige `git` no `PATH` (`harness-capabilities.md:13`); repo git presente                                                                                            | **[Fato]** verificável por `git` local e contexto do repositório.                                                         |
| MCP              | **Só declarável**                                | help/flags não expõem inventário de servidores nesta sonda; matriz #568 não lista MCP; detecção por namespace de ferramentas é contextual (`mcp-availability.md:130-140`) | **[Inferência]** detectável apenas na sessão que enxerga os servidores/ferramentas MCP.                                   |
| Paralelismo      | **Detectável** (condicional) / **Só declarável** | #568: subagentes/background ✅ (`Contrato-de-Capacidades.md:26-29`, `harness-capabilities.md:24-33,70-77`)                                                                | **[Fato]** suporte declarado; operacionalidade real depende de ferramentas de subagente/background disponíveis na sessão. |
| Background       | **Detectável** (condicional) / **Só declarável** | #568 `Contrato-de-Capacidades.md:29`; `harness-capabilities.md:70-77`                                                                                                     | **[Inferência]** verificável se a ferramenta de background existir na sessão; caso contrário só perfil declarado.         |
| Retomada         | **Só declarável**                                | CLI indica continuidade de sessão (`--continue`, `--resume`/background no help capturado, §3.2)                                                                           | **[Inferência]** existência de flags sugere suporte, mas retomada operacional depende de estado/sessão válida.            |
| Worktree isolado | **Detectável** (condicional) / **Só declarável** | #568 isolamento ✅ (`Contrato-de-Capacidades.md:27`, `harness-capabilities.md:52-57`); `claude --help` mostra opções de sessão/diretório                                  | **[Fato]** capacidade documentada; **[Inferência]** verificação operacional exige criar/usar worktree no fluxo suportado. |

### 4.2 Antigravity (`agy` 1.5.4)

| Capacidade       | Classificação                                | Fonte                                                                                                                        | Observação                                                                                                                                             |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terminal         | **Detectável**                               | Núcleo do Vetor; `agy` instalado (`§3.2`); `wiki/Compatibilidade-Antigravity.md` descreve hooks sobre `run_command`          | **[Inferência]** execução shell mediada pelo agente/harness; detectável no ambiente se o comando/hook estiver disponível.                              |
| Filesystem       | **Detectável**                               | Núcleo `harness-capabilities.md:10-13`                                                                                       | **[Fato]** leitura/edição é requisito do núcleo.                                                                                                       |
| Browser          | **Só declarável**                            | Sem evidência no CLI/help de controle de browser                                                                             | **[Inferência]** pode existir por integrações específicas, não verificadas aqui.                                                                       |
| Git              | **Detectável**                               | Núcleo exige `git` (`harness-capabilities.md:13`); hooks checam git (`Compatibilidade-Antigravity.md`)                       | **[Fato]** verificável localmente por `git` e políticas de comando.                                                                                    |
| MCP              | **Detectável** (parcial) / **Só declarável** | `agy mcp` existe no help (§3.2); `--remote-agent`/subcomandos sugerem integrações                                            | **[Inferência]** presença de comando `mcp` indica suporte/configuração possível, mas conectividade operacional é contextual.                           |
| Paralelismo      | **Só declarável**                            | #568: subagentes ✅ (`Contrato-de-Capacidades.md:25`)                                                                        | **[Fato]** declarado/documentado; **[Inferência]** sem sessão ativa do Antigravity para prova operacional aqui.                                        |
| Background       | **Desconhecida**                             | #568 marca ❓ (`Contrato-de-Capacidades.md:29`)                                                                              | **[Fato]** não verificado em fonte confirmada na matriz.                                                                                               |
| Retomada         | **Só declarável**                            | `agy --help` mostra `--conversation`, `--continue` (§3.2)                                                                    | **[Inferência]** flags sugerem retomada, mas dependem de armazenamento de conversa e contexto.                                                         |
| Worktree isolado | **Só declarável**                            | #568 isolamento ❌ (`Contrato-de-Capacidades.md:27`); fallback por skill `worktree-create` (`harness-capabilities.md:52-57`) | **[Fato]** isolamento nativo não documentado como disponível; worktree pode ser criado pelo núcleo, mas isolamento automático do agente é outro nível. |

### 4.3 OpenCode (`opencode` v2.2.7)

| Capacidade       | Classificação                                | Fonte                                                                                                                                        | Observação                                                                                                                                |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal         | **Detectável**                               | Núcleo; `opencode run`/CLI presente (§3.2); fallback por processo citado em `harness-capabilities.md:29-33`                                  | **[Fato]** execução shell é parte do uso do Vetor/OpenCode.                                                                               |
| Filesystem       | **Detectável**                               | Núcleo `harness-capabilities.md:10-13`                                                                                                       | **[Fato]** requisito operacional.                                                                                                         |
| Browser          | **Só declarável**                            | Sem evidência direta no help/versão                                                                                                          | **[Inferência]** depende de ferramentas/MCP ou integrações de sessão.                                                                     |
| Git              | **Detectável**                               | Núcleo exige `git`; `opencode` opera em diretórios de projeto (`[project]`)                                                                  | **[Fato]** verificável no ambiente.                                                                                                       |
| MCP              | **Detectável** (parcial) / **Só declarável** | subcomando `mcp` no help (§3.2); plugin/tooling variável por instalação                                                                      | **[Inferência]** gestão/listagem pode ser detectável via CLI, mas capacidade MCP útil é operacional e depende de servidores configurados. |
| Paralelismo      | **Só declarável**                            | #568 subagentes ⚠️ por `task`/processo `opencode run --dir` (`Contrato-de-Capacidades.md:25`, `harness-capabilities.md:29-33`)               | **[Fato]** modelo de paralelismo documentado como parcial/adaptado; **[Inferência]** prova operacional depende de cenário e agente.       |
| Background       | **Só declarável**                            | #568 background ⚠️ por processos do SO (`Contrato-de-Capacidades.md:29`, `harness-capabilities.md:70-77`)                                    | **[Inferência]** viável via shell, não como primitiva uniforme garantida do harness.                                                      |
| Retomada         | **Detectável** (parcial) / **Só declarável** | `--continue/-c`, `--session/-s`, subcomando `session` (§3.2)                                                                                 | **[Fato]** CLI expõe mecanismos de sessão; **[Inferência]** retomada efetiva depende de sessão existente e estado íntegro.                |
| Worktree isolado | **Só declarável**                            | #568 isolamento ⚠️ por processo com `--dir` (`Contrato-de-Capacidades.md:27`); subcomando `worktree` no help (§3.2) sugere suporte de gestão | **[Inferência]** criação/uso de worktree é detectável como comando, mas isolamento automático do agente continua dependente do fluxo.     |

### 4.4 Kilo (`kilo`, shim `mise`; CLI alvo `@kilocode/cli@7.8.27` observado no bootstrap)

| Capacidade       | Classificação                                                                | Fonte                                                         | Observação                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal         | **Só declarável**                                                            | shim presente; help parcial sugere `run/serve/attach` (§3.2)  | **[Fato]** execução de leitura disparou bootstrap do mise; sem binário confirmado pronto.                                                      |
| Filesystem       | **Só declarável**                                                            | mesmo acima; pressuposto de agentes de código                 | **[Inferência]** provável, mas não verificado operacionalmente aqui sem instalação estável.                                                    |
| Browser          | **Desconhecida**                                                             | sem evidência coletada                                        | **[Fato]** não verificado.                                                                                                                     |
| Git              | **Só declarável**                                                            | help parcial mostrou `worktree`; contexto comum de coding CLI | **[Inferência]** provável integração com repositórios, não comprovada por sonda limpa.                                                         |
| MCP              | **Detectável** (parcial, após instalação) / **Desconhecida** no estado atual | help parcial mostrou `mcp` (§3.2)                             | **[Fato]** comando anunciado no help capturado, mas captura ocorreu durante bootstrap com efeito colateral; estado operacional não confirmado. |
| Paralelismo      | **Desconhecida**                                                             | sem fonte na matriz #568 para Kilo                            | **[Fato]** Kilo não consta em `Contrato-de-Capacidades.md:24-30`.                                                                              |
| Background       | **Desconhecida**                                                             | sem evidência                                                 | **[Fato]** não verificado.                                                                                                                     |
| Retomada         | **Só declarável**                                                            | help parcial mostrou `session` (§3.2)                         | **[Inferência]** sugestão de sessões, sem prova operacional.                                                                                   |
| Worktree isolado | **Só declarável**                                                            | help parcial mostrou `worktree` (§3.2)                        | **[Inferência]** gestão de worktree parece existir, isolamento por agente não verificado.                                                      |

### 4.5 Codex (`codex` 0.167.0)

| Capacidade       | Classificação                                | Fonte                                                                                                            | Observação                                                                                               |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Terminal         | **Detectável**                               | Núcleo; `codex exec`, `sandbox` no help (§3.2)                                                                   | **[Fato]** CLI expõe execução não interativa e sandbox/comandos.                                         |
| Filesystem       | **Detectável**                               | Núcleo; uso típico de agente de código                                                                           | **[Fato]** requisito operacional do ambiente.                                                            |
| Browser          | **Desconhecida**                             | sem evidência no help/versão coletado                                                                            | **[Fato]** não verificado.                                                                               |
| Git              | **Detectável**                               | Núcleo; Codex opera em repositórios e comandos de sessão/review/exec                                             | **[Fato]** verificável localmente por `git`.                                                             |
| MCP              | **Detectável** (parcial) / **Só declarável** | subcomando `mcp` no help (§3.2); #568 não traz coluna de MCP                                                     | **[Inferência]** configuração/gestão MCP detectável via CLI, operação depende de servidores/credenciais. |
| Paralelismo      | **Só declarável**                            | #568 subagentes ✅ em TOML (`Contrato-de-Capacidades.md:25`)                                                     | **[Fato]** suporte declarado; **[Inferência]** sem prova operacional nesta sessão.                       |
| Background       | **Desconhecida**                             | #568 marca ❓ (`Contrato-de-Capacidades.md:29`)                                                                  | **[Fato]** não confirmado na matriz.                                                                     |
| Retomada         | **Detectável** (parcial) / **Só declarável** | `resume`, `fork`, `archive/unarchive`, `session`-like flows implícitos no help (`resume`, `fork` visíveis, §3.2) | **[Fato]** CLI expõe retomada/fork; **[Inferência]** sucesso depende de sessão persistida.               |
| Worktree isolado | **Só declarável**                            | #568 isolamento ❌ só por instrução (`Contrato-de-Capacidades.md:27`)                                            | **[Fato]** sem isolamento nativo declarado na matriz; worktree pode ser gerido pelo núcleo.              |

## 5. Separação declarada, verificada e operacional (pergunta 3)

| Nível           | Definição prática                                                                                               | Como obter                                                                                                                                                                        | Custo típico                                                                | Efeitos colaterais / credenciais                                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Declarada**   | Capacidade anunciada por perfil, documentação, schema, `--help` ou matriz versionada                            | Ler `wiki/Compatibilidade-*`, `Contrato-de-Capacidades.md`, `harness-capabilities.md`, `agent-context/help` estático, manifestos                                                  | Baixo (leitura local/remota de docs)                                        | Nenhum se offline/local; remoto pode depender de rede. Sem credenciais. **[Fato]** alinhado à distinção da ADR-002 (lida).                                                                                                                                                                |
| **Verificada**  | Evidência objetiva de que o mecanismo existe no ambiente alvo (binário, comando, flag, arquivo, namespace/tool) | `command -v`/resolução segura de executável, `--version`, `--help`, `models/mcp/session/worktree` listagens, presença de ferramenta na sessão, `agent-context/status` sem mutação | Baixo a médio (ms a segundos; Kilo mostrou custo maior por bootstrap, §3.2) | Pode ter efeitos colaterais se o resolvedor instala pacotes (caso `mise`/`kilo`) ou se o binário errado for executado (`orca` no Linux, `docs/investigations/orca-adapter.md:289-295`). Deve evitar credenciais.                                                                          |
| **Operacional** | A capacidade funciona de fato no contexto atual, com permissões e dependências                                  | Prova mínima contextual: criar/usar worktree, listar sessões reais, enviar/ler job, acionar MCP configurado, rodar tarefa em background/subagente                                 | Médio a alto (segundos a minutos)                                           | Pode exigir credenciais, rede, provedores, arquivos de sessão, criação de processos/artefatos temporários. Deve ser opt-in e controlado; sondas destrutivas ou persistentes são inadequadas para descoberta automática. **[Opinião]** só deve rodar quando o fluxo precisa da capacidade. |

**[Fato]** A distinção "declarada/verificada/operacional" já aparece na proposta da ADR-002 (seções
de Capability Registry/descritor, lidas) e é compatível com o tratamento de disponibilidade por
probe em `scripts/lib/orchestrator/types.ts:89-97` e com a verificação em duas etapas do Orca
(`orca-adapter.md:289-304`).

## 6. Parecer de viabilidade por mecanismo (perguntas 1 e 3)

| Mecanismo                                                      | Viabilidade                                                            | Custo/efeitos                                                                                                            | O que detecta bem                                                                                            | Limites                                                                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inspeção de CLI (`command -v`, caminho resolvido, `--version`) | **Alta**                                                               | Baixo; sem rede/credenciais se binário local. **[Fato]** validado para claude/agy/opencode/codex.                        | Instalado, versão, identidade do executável.                                                                 | Falso positivo com shims gerenciados (kilo/mise, §3.2); risco de executar binário homônimo errado se não houver resolução segura (`orca-adapter.md:289-295`).                              |
| `--help` / `agent-context` / subcomandos de introspecção       | **Alta** para superfície de comandos, **média** para capacidades reais | Baixo a médio. `agent-context --json` do Orca foi barato e sem app (`orca-adapter.md:64-77`); `--help` pode ser extenso. | Comandos disponíveis (`mcp`, `session`, `resume`, `worktree`, `exec`, `serve`).                              | Anúncio de comando não prova operação (MCP sem servidor, sessão sem estado).                                                                                                               |
| Arquivos de configuração (projeto/usuário)                     | **Média**                                                              | Baixo, mas sensível                                                                                                      | Instalação/configuração declarada, endpoints locais, agentes/plugins habilitados.                            | Pode conter segredos; formato varia por versão; presença não implica validade operacional.                                                                                                 |
| Variáveis de ambiente                                          | **Média**                                                              | Baixo                                                                                                                    | Contexto de execução (ex.: handles/IDs quando dentro do harness), seleção de executável (`ORCA_CLI_COMMAND`) | Não confiável fora da sessão; ausência não prova falta de suporte. **[Fato]** `ORCA_CLI_COMMAND` pode estar definido e quebrado (`orca-adapter.md:244-259`).                               |
| Adapters de integração / probes de sessão                      | **Alta** para operacional, **média** para portabilidade                | Médio a alto; depende de contexto                                                                                        | Capacidades realmente acessíveis (ferramentas MCP presentes, wake/check de orquestrador, worktree efetivo)   | Nem todo harness tem adapter/probe padronizado; acoplado à sessão ou ao transporte. **[Fato]** `isAvailable` atual usa contexto de ferramentas (`orchestrator-adapter-contract.md:59-66`). |
| Perfis embutidos (matriz versionada)                           | **Alta** como baseline                                                 | Baixo                                                                                                                    | Fallback seguro, classificação declarada, diferenças conhecidas                                              | Pode ficar desatualizado; não reflete instalação/versão local. Deve ser tratado como declarada até verificação.                                                                            |

## 7. Recomendações (perguntas 4 e 5)

### 7.1 Pergunta 4 — inspeção nativa do CLI, adapters de integração ou ambos? perfis embutidos, das integrações ou ambos?

- **[Opinião]** Usar **ambos**: inspeção nativa do CLI/ambiente para verificar presença e versão
  quando instalado, e adapters de integração/probes para capacidades que só fazem sentido em sessão
  ou via contrato externo (MCP operacional, orquestrador, wake, worktree do orquestrador).
- **[Opinião]** Manter perfis **embutidos no Vetor** como baseline declarada versionada (derivada da
  #568 e docs de compatibilidade), permitindo enriquecimento por **integrações/adapters** quando
  estes puderem provar capacidades verificadas/operacionais. Isso atende à extensibilidade sem
  exigir presença de um harness específico.
- **[Fato]** Há precedente das duas abordagens no repositório: matriz/perfis documentais
  (`Contrato-de-Capacidades.md`, `Compatibilidade-*`) e descoberta operacional por contrato/CLI em
  integrações específicas (`orca-adapter.md` §4.1, §5.3).

### 7.2 Pergunta 5 — harness não instalado ou versão desconhecida

- **[Fato]** Quando o executável não é encontrado por resolução segura, a capacidade de inspeção
  nativa não existe; para o núcleo do Vetor, isso não impede fluxos que dependem só de
  ler/editar/shell (`harness-capabilities.md:7-16`).
- **[Opinião]** Comportamento recomendado:
  1. **Não instalado:** não executar binários homônimos genéricos para "testar" (ex.: `orca`);
     marcar capacidades dependentes do harness como **desconhecidas/só declaradas pelo perfil
     embutido** e oferecer fallback portátil.
  2. **Versão desconhecida ou ilegível:** tratar como **declarada com baixa confiança**; usar apenas
     o subconjunto de capacidades estáveis do perfil embutido e exigir verificação contextual antes
     de rotear para capacidades sensíveis (MCP, retomada, worktree isolado nativo, background).
  3. **Shim/gerenciador com bootstrap:** classificar a verificação como cara/possivelmente com
     efeito colateral (como no `kilo`/`mise`, §3.2) e não rodá-la automaticamente em descoberta
     passiva.
  4. **Falha de introspecção:** registrar erro como sinal de indisponibilidade do probe, não como
     prova negativa de capacidade.

## 8. Lacunas e itens não verificados

- **[Fato]** Não houve verificação operacional em sessões reais de Antigravity, Codex GUI/agent,
  Kilo instalado ou Claude Code fora desta sessão; as classificações "condicional" refletem isso.
- **[Fato]** A capacidade **browser** não foi testada por sonda ativa em nenhum harness, para evitar
  efeitos colaterais e porque depende de ferramentas de sessão/conectores.
- **[Fato]** Para **MCP**, não foi feita conexão a servidores; apenas presença de
  comandos/namespaces foi considerada quando aplicável.
- **[Inferência]** A capacidade **terminal** foi tratada no sentido de execução de comandos/shell
  disponível ao agente; terminais interativos/PTY com UX específica variam por harness e não foram
  medidos.

## 9. Recomendações finais

- **[Opinião]** Priorizar um descritor mínimo que carregue: `id`, `version?`, fonte da evidência
  (`declared|verified|operational`), capacidades pedidas pela #618 e custo/efeito da última
  verificação. Isso viabiliza o Capability Registry da ADR-002 sem acoplamento a fornecedor.
- **[Opinião]** Tratar `filesystem`, `terminal` e `git` como candidatos naturais a verificação local
  barata (núcleo), e `browser`, `MCP`, `paralelismo`, `background`, `retomada`, `worktree isolado`
  como capacidades cuja classe sobe para verificada/operacional só com prova contextual.
- **[Opinião]** Não exigir `claude`, `agy`, `opencode`, `kilo` ou `codex` instalados: o fluxo deve
  degradar para perfil embutido + núcleo obrigatório.

## 10. Critério de aceite

- [x] **Relatório em `docs/investigations/` com a matriz harness × capacidade, marcando para cada
      célula se é detectável, só declarável ou desconhecida, com a fonte.** — Atendido em
      `docs/investigations/descoberta-de-capacidades.md`, seção 4 (tabelas 4.1 a 4.5), com coluna
      "Fonte" por célula e classificação explícita.
- [x] **Parecer de viabilidade para cada mecanismo de descoberta, com recomendação para as perguntas
      4 e 5.** — Atendido nas seções 6 (viabilidade por mecanismo, custo/efeitos/limites) e 7
      (respostas e recomendações explícitas para perguntas 4 e 5).
- [x] **A matriz parte da #568 em vez de redefini-la.** — Atendido nas seções 2, 3.1 e 4: cita
      `skills/shared/references/harness-capabilities.md` e `wiki/Contrato-de-Capacidades.md` como
      base e estende para as capacidades da issue.
- [x] **Nenhuma recomendação exige que um harness específico esteja presente.** — Atendido nas
      seções 7.2 e 9: ausência/versão desconhecida degradam para perfil embutido e núcleo
      obrigatório; recomendações são condicionais e portáveis.
