---
id: spec:instalacao-multi-harness-guiada-por-agente
type: spec
project: Vetor
status: ready
created: 2026-10-20
updated: 2026-10-22
---
# Instalação Multi-Harness Guiada por Agente a partir da Documentação

## Summary
Padronizar e documentar os fluxos de instalação e atualização do Vetor para todos os harnesses suportados (Claude Code, Antigravity, OpenCode, Codex e Cursor) diretamente no `README.md`, incluindo uma seção determinística sem TTY voltada para agentes de IA ("For AI Agents") e corrigindo o bloqueio do hook de segurança no Antigravity em ambientes Windows.

## Context
Atualmente, o `README.md` documenta apenas a instalação interativa no Claude Code (`/plugin marketplace ...`) e via npm global (`npm install -g @tavaressan/vetor && vetor install`). Quando um usuário instrui um agente em outro harness (ex.: *"Instale este plugin para uso no Antigravity/OpenCode: https://github.com/Tavaressan/Vetor"*), o agente não encontra instruções para o seu ambiente e falha ao tentar executar comandos interativos sem TTY. Além disso, a instalação do plugin no Antigravity sob Windows quebrava as execuções subsequentes de comandos do agente porque o hook em `hooks.json` apontava para um script Bash (`./scripts/safety-check.sh`) não suportado pelo `cmd /c` e que não emitia o contrato JSON esperado pelo Antigravity (`{"decision": "allow"|"deny"}`).

## Goals
1. Permitir que qualquer agente ou desenvolvedor descubra comandos determinísticos de instalação e atualização para qualquer harness suportado lendo apenas o `README.md`.
2. Fornecer comandos ponta a ponta sem TTY (headless) na seção "For AI Agents" para instalação automatizada.
3. Garantir que a instalação do plugin no Antigravity não cause bloqueios em chamadas de `run_command`, operando de forma compatível com Windows e aderente ao contrato JSON do Antigravity.
4. Assegurar paridade no CLI `vetor install` para a engine `antigravity` via `.agents` em modo não-interativo (`--engines antigravity --yes`).

## Non-Goals
1. Deduplicação estrutural de árvores de arquivos no repositório (`opencode/scripts/` vs `scripts/`), que é objeto específico do spike arquitetural #404.
2. Suporte ou documentação para plataformas de IA não mapeadas (ex.: Roo Code, Windsurf).
3. Criação de registros ou marketplaces de pacotes adicionais além de npm, GitHub e Claude Plugin Marketplace.

## Users / Personas
- **Agentes de IA (Headless / TTY-less):** Instâncias de Antigravity, OpenCode, Codex ou Cursor que recebem ordens para instalar o Vetor a partir do repositório Git ou npm e precisam de comandos diretos e sem prompts interativos.
- **Desenvolvedores Humanos:** Usuários de diferentes harnesses que buscam no `README.md` a forma oficial de instalar o Vetor no seu editor preferido.

## Functional Requirements

### Guia Multi-Harness & Instruções para Agentes (Documentação)

#### RF-01 - Documentação de Instalação e Atualização por Harness no README
**Priority:** Must  
**Description:** O `README.md` deve conter instruções explícitas de instalação e atualização para cada um dos 5 harnesses suportados: Claude Code, Antigravity, OpenCode, Codex e Cursor.  
**Acceptance Criteria:**
- [ ] O `README.md` lista comandos específicos de instalação inicial para cada harness.
- [ ] O `README.md` lista comandos de atualização para versões subsequentes para cada harness.
- [ ] O escopo de instalação (workspace local vs. global do usuário) é explicitado para cada harness.

#### RF-02 - Seção Determinística para Agentes de IA ("For AI Agents / Instalação por Agente")
**Priority:** Must  
**Description:** O `README.md` deve conter uma subseção clara ("For AI Agents") contendo blocos de comando determinísticos, não-interativos e prontos para execução em ambientes sem TTY.  
**Acceptance Criteria:**
- [ ] Todos os comandos na seção "For AI Agents" usam flags que suprimem prompts interativos (ex.: `--yes`, `--engines <nome>`).
- [ ] Um agente instruído apenas com *"Instale o Vetor para Antigravity"* consegue executar o fluxo completo sem solicitar entrada no terminal.
- [ ] A seção documenta a dependência mínima de runtime (Deno e gh CLI).

#### RF-03 - Sincronização da Wiki de Compatibilidade
**Priority:** Should  
**Description:** As páginas da wiki (`wiki/Compatibilidade-Antigravity.md`, `wiki/Compatibilidade-OpenCode.md` e `wiki/Home.md`) devem refletir com precisão os comandos canônicos documentados no `README.md`.  
**Acceptance Criteria:**
- [ ] Os comandos de instalação citados na wiki coincidem com os comandos do `README.md`.

### Estabilidade e Não-Bloqueio no Antigravity (Hooks/Windows)

#### RF-04 - Hook de Segurança Compatível com Multiplataforma e Contrato do Antigravity
**Priority:** Must  
**Description:** O hook acionado por `run_command` no Antigravity através do `hooks.json` da raiz deve executar de forma transparente em Windows, macOS e Linux, retornando a estrutura JSON requerida (`{"decision": "allow"}` ou `{"decision": "deny", "reason": "..."}`).  
**Acceptance Criteria:**
- [ ] A execução de `run_command` no Antigravity em Windows não falha com erro de comando não reconhecido (`'.' não é reconhecido...`).
- [ ] O hook retorna JSON válido no stdout em conformidade com a especificação do Antigravity.
- [ ] A regra de proteção contra push direto para branches protegidas (`main`, `master`, `production`) continua sendo aplicada.

#### RF-05 - Resiliência a Falhas do Interpretador de Hook
**Priority:** Should  
**Description:** Se o interpretador do hook de segurança encontrar um erro inesperado de ambiente ou sintaxe, ele não deve derrubar o harness em loop de falha bloqueante.  
**Acceptance Criteria:**
- [ ] Erros internos do runner de hook são logados em stderr sem travar o processo principal com saída malformada.

### Paridade e Modos Não-Interativos no CLI (vetor install)

#### RF-06 - Suporte Completo à Engine Antigravity via Flags Não-Interativas do CLI
**Priority:** Must  
**Description:** O comando `vetor install --engines antigravity --yes` deve materializar as skills e agentes no diretório de projeto `.agents/` sem solicitar intervenção no terminal.  
**Acceptance Criteria:**
- [ ] O comando `vetor install --engines antigravity --yes` conclui com código de saída 0 em ambiente sem TTY.
- [ ] As skills são copiadas para `.agents/skills/<skill>/SKILL.md` e os subagentes com `model: inherit` para `.agents/agents/<nome>.md`.
- [ ] A suíte de testes do CLI (`cli/test/`) valida a execução não-interativa para a engine `antigravity`.

## Non-Functional Requirements

### RNF-01 - Compatibilidade com Execuções sem TTY (Headless)
**Priority:** Must  
**Description:** Nenhum comando sugerido na seção de agentes pode travar aguardando confirmação `stdin` (TTY).  
**Acceptance Criteria:**
- [ ] Todos os comandos rodam com sucesso sob pipes ou buffers não-interativos.

### RNF-02 - Suporte Multiplataforma a Ambientes Windows
**Priority:** Must  
**Description:** O hook de segurança do Antigravity deve funcionar independentemente da presença de Git Bash ou WSL no PATH do Windows.  
**Acceptance Criteria:**
- [ ] O hook executa com sucesso sob `cmd.exe` e `powershell.exe`.

### RNF-03 - Latência Reduzida na Verificação Pré-Comando
**Priority:** Should  
**Description:** O hook invocado antes de comandos deve ter latência imperceptível para o fluxo do agente.  
**Acceptance Criteria:**
- [ ] O tempo de execução da checagem de segurança é inferior a 150 ms na mediana.

## Behavior / States
- **Fluxo do Agente:** Leitura do `README.md` → Identificação do bloco correspondente ao seu harness → Execução do comando headless → Configuração de workspace concluída.
- **Fluxo do Hook Antigravity:** Disparo do evento `PreToolUse` para `run_command` → Runner multiplataforma inspeciona o comando → Emite `{"decision": "allow"}` ou `{"decision": "deny"}`.

## Data
A documentação atualiza o arquivo `README.md` e as páginas na pasta `wiki/`. O hook de segurança atualiza a configuração `hooks.json` e eventuais scripts de apoio em `scripts/`.

## Integrations / Dependencies
- **Antigravity CLI (`agy`):** Invocado para `agy plugin install` no fluxo global.
- **npm / npx:** Invocado para `vetor install --engines <harness> --yes` nos fluxos de projeto.
- **Git & Deno:** Runtimes base do Vetor.

## Edge Cases
- **Windows sem Git Bash / WSL:** O hook não pode assumir interpretador Bash disponível.
- **Diretório temporário já existente em `git clone`:** O comando sugerido deve usar diretórios limpos ou instruir remoção prévia.
- **Atualização sobre versão já instalada:** O fluxo deve substituir versões antigas sem colisão de escrita (`agy plugin install` sobrepondo ou substituindo).

## Error Handling
- Se o comando `agy` ou `npm` não estiver disponível, o `README.md` deve apontar o link direto para o pré-requisito antes de rodar a instalação.

## Security / Privacy
- Preservação da regra de bloqueio de push acidental para branches principais (`main`/`master`).
- Não expor credenciais ou chaves durante a instalação via CLI.

## Rollout
- Aplicado diretamente no repositório Vetor e publicado na próxima versão do pacote npm `@tavaressan/vetor`.

## Open Questions
Nenhuma questão aberta remanescente.

## Decisions
- **Decisão 1:** A documentação de instalação multi-harness residirá diretamente no `README.md`, com bloco em destaque "For AI Agents", dispensando arquivo `INSTALL.md` isolado para manter ponto único de entrada.
- **Decisão 2:** O hook do Antigravity em `hooks.json` deve ser mantido habilitado por padrão e refatorado para um runner multiplataforma compatível com Windows e com a saída JSON do Antigravity, em vez de ser desabilitado.

## References
- Issue #403: `feat(compat,cli): instalação multi-harness guiada por agente a partir da documentação`
- `wiki/Compatibilidade-Antigravity.md`
- `cli/lib/installer/writer.js`

## Revision History
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-19 | Antigravity / Vetor | Rascunho inicial gerado via `/vetor:spec` para Issue #403 |
| 2026-10-22 | Antigravity / Vetor | Implementação da Issue #403 (README multi-harness, runner antigravity, testes) |
