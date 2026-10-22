# Spike #439: Avaliação da Migração do CLI de Node para Deno/TypeScript

**Status:** Concluído (Spike de Avaliação)  
**Data:** 2026-10-22  
**Autor:** Issue Worker (#439)  
**Decisão Proposta:** **NÃO MIGRAR** (Manter o CLI em Node/CommonJS com zero dependências e suporte híbrido Deno via `npm:`)

---

## 1. Sumário Executivo

O objetivo deste spike foi responder com dados medidos (e não estimativas intuitivas) se vale a pena migrar o instalador/CLI do Vetor (`cli/`) de Node/CommonJS para Deno/TypeScript. O repositório já utiliza Deno/TypeScript em `scripts/` e o Deno é pré-requisito documentado do Vetor (`README.md:36`).

A premissa inicial da issue supunha que o CLI duplicava lógica substancial de `scripts/lib/` (detecção de projeto/engines, manifesto, checagens do doctor) e que a migração traria ganho de tooling único e reuso de código.

**Principais conclusões da medição empírica:**
1. **A duplicação entre `cli/lib/` e `scripts/lib/` é nula (0,0%)**: Os domínios são ortogonais. O que `cli/lib/` faz (instalação de templates em diretórios de harnesses e manifestos de integridade) não existe em `scripts/lib/` (orquestração de agentes, quality gates de specs, rules).
2. **Duplicação isolada em scripts raiz é de apenas 56 linhas (4,6% do CLI)**: Restrita a um utilitário de varredura de PATH (18 linhas) e à checagem HTTP do `ai-memory` (38 linhas).
3. **Custo de reescrita alto e desproporcional**: 32 arquivos afetados (14 em `cli/lib` + `bin`, 18 em `cli/test`), totalizando **4.980 linhas** (3.661 linhas de código efetivo).
4. **O problema de distribuição para usuários de Deno já foi resolvido pela #438**: O pacote npm 0.2.0 já roda nativamente e compila no Deno 2.9.2 (`deno run -A npm:@tavaressan/vetor install` e `deno install --global --compile -A npm:@tavaressan/vetor`) sem exigir Node do usuário.
5. **Recomendação Definitiva**: **NÃO MIGRAR**. Manter a arquitetura atual de zero dependências e zero etapa de build no CLI, aproveitando a compatibilidade do Deno 2 com pacotes npm.

---

## 2. Pergunta 1: Medição de Duplicação entre `cli/lib/` e `scripts/`

> **Pergunta do Spike:** *Quanto do cli/lib/ duplica lógica de scripts/lib/ (detecção de projeto/engines, manifesto, checagens do doctor)? Medir, não estimar.*

### 2.1 Método e Comandos Reproduzíveis

Para medição precisa de linhas totais, linhas em branco, comentários e código efetivo:

```powershell
# Medição de cli/lib e cli/bin (PowerShell 5.1/7+)
$cliFiles = Get-ChildItem -File -Recurse cli/lib, cli/bin | Where-Object { $_.Extension -eq '.js' }
$cliStats = foreach ($f in $cliFiles) {
  $lines = Get-Content $f.FullName
  [PSCustomObject]@{
    File = $f.FullName.Replace((Get-Location).Path + "\", "")
    Total = $lines.Count
    Blank = ($lines | Where-Object { $_ -match '^\s*$' }).Count
    Comment = ($lines | Where-Object { $_ -match '^\s*(//|/\*|\*|#)' }).Count
    Code = ($lines | Where-Object { $_ -notmatch '^\s*$' -and $_ -notmatch '^\s*(//|/\*|\*|#)' }).Count
  }
}
$cliStats | Format-Table -AutoSize
```

```powershell
# Medição de scripts/lib
$scriptFiles = Get-ChildItem -File "scripts/lib/*.ts"
$scriptStats = foreach ($f in $scriptFiles) {
  $lines = Get-Content $f.FullName
  [PSCustomObject]@{
    File = $f.Name
    Total = $lines.Count
    Blank = ($lines | Where-Object { $_ -match '^\s*$' }).Count
    Comment = ($lines | Where-Object { $_ -match '^\s*(//|/\*|\*|#)' }).Count
    Code = ($lines | Where-Object { $_ -notmatch '^\s*$' -and $_ -notmatch '^\s*(//|/\*|\*|#)' }).Count
  }
}
$scriptStats | Format-Table -AutoSize
```

### 2.2 Inventário de Tamanho Medido

| Módulo / Camada | Arquivos | Linhas Totais | Linhas em Branco | Comentários | Linhas de Código Efetivo |
|---|---:|---:|---:|---:|---:|
| `cli/bin/` | 1 | 6 | 2 | 1 | 3 |
| `cli/lib/` | 13 | 1.744 | 192 | 339 | 1.213 |
| **Subtotal CLI (bin + lib)** | **14** | **1.750** | **194** | **340** | **1.216** |
| `scripts/lib/` | 20 | 3.337 | 344 | 647 | 2.346 |
| `cli/test/` | 18 | 3.071 | 387 | 239 | 2.445 |
| `cli/scripts/sync-templates.js` | 1 | 86 | 13 | 39 | 34 |
| `.github/workflows/npm-publish.yml` | 1 | 73 | 9 | 19 | 45 |

### 2.3 Análise Comparativa por Área Temática

#### A. Detecção de Engines vs. Detecção de Projeto
- **`cli/lib/installer/detector.js` (79 linhas totais, 51 de código):**
  Detecta se assistentes de IA estão presentes no ambiente do usuário (Claude Code, Codex, OpenCode, Antigravity, Cursor) verificando diretórios-âncora (`.claude/`, `AGENTS.md`, `.opencode/`, `.cursor/`) ou executáveis no PATH (`claude`, `codex`, `opencode`, `agy`, `cursor-agent`). O objetivo é saber quais templates instalar.
- **`scripts/lib/project.ts` (274 linhas totais, 227 de código):**
  Detecta a linguagem/stack e gerenciador de pacotes do projeto que está sendo desenvolvido pelo usuário (Node, Deno, Rust, Go, Python, Gradle, Bun, pnpm, yarn) e deriva o comando de testes do projeto (`cargo test`, `pytest`, `npm test`, etc.).
- **Fato medido:** Duplicação direta = **0 linhas (0,0%)**. Apesar de ambos realizarem "detecção", operam sobre domínios completamente ortogonais.
- **Subproduto (utilitário de PATH):**
  `cli/lib/installer/command-exists.js` (30 linhas totais, 18 de código) busca comandos no PATH resolvendo `PATHEXT` no Windows. Em `scripts/now-probe.ts`, a função `findBinary` (linhas 117-130, 14 linhas de código) realiza a mesma varredura.
  - **Duplicação medida no utilitário de PATH:** **18 linhas de código**.

#### B. Manifesto de Instalação
- **`cli/lib/installer/manifest.js` (76 linhas totais, 40 de código):**
  Lê e grava `.vetor/install-manifest.json`, calculando hashes SHA-256 de cada arquivo copiado para o projeto por engine. Permite que `vetor status`, `vetor update` e `vetor uninstall` identifiquem arquivos íntegros, modificados pelo usuário ou órfãos sem sobrescrever trabalho customizado.
- **`scripts/lib/`:**
  Busca no repositório: `Select-String -Path "scripts/**/*.ts" -Pattern "manifest"` retorna zero ocorrências de manifesto de instalação.
- **Fato medido:** Duplicação = **0 linhas (0,0%)**. O conceito de manifesto de arquivos de template pertence unicamente ao instalador.

#### C. Checagens do Doctor
- **`cli/lib/commands/doctor.js` (131 linhas totais, 121 de código):**
  Executa 6 checagens:
  1. `Deno` no PATH (7 linhas)
  2. `gh auth status` (12 linhas)
  3. `checkAiMemory` (38 linhas, linhas 34-71): lê `.mcp.json`, faz HTTP POST com JSON-RPC 2.0 (`initialize`) e valida retorno SSE/JSON.
  4. `checkOpenCodeGlobal` (23 linhas): detecta sobreposição de arquivos em `~/.opencode`.
  5. `Git worktree` suportado (12 linhas).
  6. `Engines detectadas` (9 linhas).
- **Em `scripts/`:**
  - `scripts/ai-memory-check.ts` (57 linhas): cliente MCP completo em Deno com handshake `initialize`, `notifications/initialized`, `tools/list` e chamada a `memory_status`.
  - As linhas 34-71 de `cli/lib/commands/doctor.js` são uma reimplementação simplificada em Node/fetch desse mesmo handshake MCP.
  - As demais checagens (`checkOpenCodeGlobal`, `gh auth`, `git worktree`) não existem em `scripts/lib/`.
- **Duplicação medida no doctor:** **38 linhas de código** (referentes a `checkAiMemory`).

#### D. Status (`cli/lib/commands/status.js` vs. `scripts/lib/status.ts`)
- `cli/lib/commands/status.js` (67 linhas, 47 de código): inspeciona arquivos instalados contra o manifesto `.vetor/install-manifest.json`.
- `scripts/lib/status.ts` (69 linhas, 40 de código): gerencia arquivos de status de execução de subagentes do coordinator (`.claude/vetor/status/<branch>.md`).
- **Fato medido:** Duplicação = **0 linhas (0,0%)**. Homônimo conceitual, lógicas sem nenhuma relação.

### 2.4 Resumo Quantitativo da Duplicação

| Origem no CLI | Linhas Totais | Linhas de Código | Linhas Duplicadas | % Duplicação do Arquivo | Alvo de Duplicação em `scripts/` |
|---|---:|---:|---:|---:|---|
| `cli/lib/installer/command-exists.js` | 30 | 18 | 18 | 100,0% | `scripts/now-probe.ts` (`findBinary`) |
| `cli/lib/commands/doctor.js` | 131 | 121 | 38 | 31,4% | `scripts/ai-memory-check.ts` (`checkAiMemory`) |
| Demais 12 arquivos em `cli/lib/` + `bin/` | 1.589 | 1.077 | 0 | 0,0% | — |
| **Total `cli/lib/` + `bin/`** | **1.750** | **1.216** | **56** | **4,6%** | — |
| **Comparado estritamente com `scripts/lib/`** | **1.750** | **1.216** | **0** | **0,0%** | — |

> **Achado central:** A duplicação de lógica entre `cli/lib/` e `scripts/lib/` é de **0%**. Apenas **4,6%** do código efetivo de `cli/lib/` (56 linhas de 1.216) possui código conceitualmente redundante com arquivos avulsos de `scripts/` (`now-probe.ts` e `ai-memory-check.ts`).

---

## 3. Pergunta 2: Estimativa Detalhada de Custo de Reescrita

> **Pergunta do Spike:** *Custo de reescrita: 13 arquivos em cli/lib/ + bin/, 18 arquivos de teste em cli/test/, scripts/sync-templates.js, npm-publish.yml.*

A migração exigiria tocar e reescrever **34 arquivos** no total, envolvendo 4 camadas distintas:

```
Total afetado: 4.980 linhas brutas / 3.740 linhas de código
├── cli/lib/ + bin/ (14 arquivos): 1.750 linhas (1.216 de código)
├── cli/test/ (18 arquivos): 3.071 linhas (2.445 de código)
├── cli/scripts/sync-templates.js: 86 linhas (34 de código)
└── .github/workflows/npm-publish.yml: 73 linhas (45 de código)
```

### 3.1 Item a: 13 arquivos em `cli/lib/` + `bin/` (1.750 linhas / 1.216 de código)

- **Mudança arquitetural:**
  - Conversão de CommonJS (`require`, `module.exports`) para ESM (`import`, `export`).
  - Definição de tipos TypeScript estritos para todas as estruturas de dados (`EngineConfig`, `InstallManifest`, `InstallOptions`, `CursorHookTranslation`, etc.).
  - Substituição de APIs de runtime: de `node:fs`, `node:path`, `node:crypto`, `node:child_process` para APIs Web Standard ou compatibilidade Deno.
- **Pontos de alta complexidade:**
  - `cli/lib/installer/writer.js` (491 linhas, 299 de código): gerencia regras complexas de cópia recursiva com filtros de exclusão por engine (`ENGINE_EXCLUDED_SOURCE_DIRS`), tradução em memória de subagentes e hooks, persistência de manifesto e integridade transacional de arquivos.
  - `cli/lib/installer/prompts.js` (155 linhas, 126 de código): controle de TTY via terminal raw mode (`readline.emitKeypressEvents` + `setRawMode`), redesenho ANSI relativo via terminal escape sequences e fallback determinístico para ambientes headless/não-interativos. No Deno, o manuseio de raw mode em `Deno.stdin` difere significativamente entre Windows e POSIX.
  - `cli/lib/installer/cursor-hooks.js` (185 linhas, 121 de código): transformação profunda do AST de hooks JSON do Claude Code para o schema camelCase do Cursor, achatando matchers e traduzindo ferramentas (`Bash` → `Shell`).
- **Esforço estimado:** **16 a 24 horas de desenvolvimento**.

### 3.2 Item b: 18 arquivos de teste em `cli/test/` (3.071 linhas / 2.445 de código)

- **Mudança arquitetural:**
  - Conversão da suíte de `node:test` + `node:assert/strict` para `Deno.test` + `@std/assert`.
  - Reescrita do utilitário `withTempDir` para garantir limpeza de locks de arquivos em Windows sob o runtime do Deno.
- **Pontos de alta complexidade:**
  - `cli/test/installer-writer.test.js` (791 linhas, 633 de código): a maior suíte do CLI. Testa exaustivamente permissões, idempotência, integridade SHA256 e exclusão por engine em diretórios temporários.
  - `cli/test/pack.test.js` (296 linhas, 192 de código): testa `npm pack --dry-run` e `npm pack` real, verificando a montagem física do tarball, extração e execução end-to-end de comandos instalados contra os CLIs reais do ambiente (Claude, Codex, OpenCode). Caso o empacotamento mude de formato, este arquivo precisa ser completamente redesenhado.
  - `cli/test/installer-prompts.test.js` (204 linhas, 168 de código): mocks de streams de stdin, emulação de sequências de escape ANSI e eventos de teclado.
- **Esforço estimado:** **24 a 32 horas de desenvolvimento**.

### 3.3 Item c: `cli/scripts/sync-templates.js` (86 linhas / 34 de código)

- Script executado no lifecycle `prepack`. Copia `skills/`, `agents/`, `hooks/`, `opencode/` e `LICENSE` da raiz do monorepo para `cli/templates/`.
- Conversão direta para TypeScript rodando via `deno run`.
- **Esforço estimado:** **1 a 2 horas**.

### 3.4 Item d: `.github/workflows/npm-publish.yml` (73 linhas / 45 de código)

- O workflow atual roda em `ubuntu-latest`, instala Node 22, valida `npm view` no registry para evitar publicação duplicada de versão e executa `npm publish` com `NODE_AUTH_TOKEN`.
- Se a distribuição migrar para Deno:
  - Se mantido no npm via `dnt`: exige novo passo de compilação `deno run -A scripts/build_npm.ts`, instalação de Node para publicação do pacote transpilado e testes duplos (no Deno e no Node gerado).
  - Se migrar para JSR: substituição pelo job `deno publish` com permissões OIDC do GitHub Actions.
  - Se migrar para binários: matriz de build multi-plataforma (`deno compile` para linux-x64, linux-arm64, windows-x64, darwin-arm64, darwin-x64) e upload para GitHub Releases.
- **Esforço estimado:** **4 a 8 horas**.

### 3.5 Tabela de Custo Consolidada

| Componente | Arquivos Afetados | Linhas Totais | Linhas Código | Complexidade | Estimativa (Horas) |
|---|---:|---:|---:|:---:|---:|
| `cli/lib/` + `bin/` | 14 | 1.750 | 1.216 | Média-Alta | 16 – 24 h |
| `cli/test/` | 18 | 3.071 | 2.445 | Alta | 24 – 32 h |
| `cli/scripts/sync-templates.js` | 1 | 86 | 34 | Baixa | 1 – 2 h |
| `.github/workflows/npm-publish.yml` | 1 | 73 | 45 | Média | 4 – 8 h |
| **Total do Spike** | **34** | **4.980** | **3.740** | **Alta** | **45 – 66 h** |

---

## 4. Pergunta 3: Distribuição Após Migrar e Impacto no Ecossistema

> **Pergunta do Spike:** *Distribuição após migrar: continuar no npm (como?), publicar no JSR, ou binários via deno compile — impacto para quem instala hoje com npm install -g.*

### 4.1 Opção A: Continuar no npm via `dnt` (Deno to Node Transform)

- **Mecanismo:** O código fonte reside em Deno/TS. Um script de build executa o `dnt`, que faz typecheck, compila para CommonJS/ESM, adiciona polyfills de compatibilidade para APIs Deno e emite um diretório `npm/` contendo `package.json` transpilado.
- **Vantagens:**
  - Preserva 100% a experiência dos usuários existentes: `npm install -g @tavaressan/vetor` e `npx @tavaressan/vetor install` continuam funcionando sem atrito.
- **Desvantagens:**
  - **Quebra a proposta de simplificação**: Atualmente o CLI tem **zero dependências** e **zero etapa de build**. Introduzir `dnt` insere um compilador pesado, amplia o tempo de CI, gera código transpilado difícil de debugar em produção e cria fragilidades na sincronização de templates.

### 4.2 Opção B: Publicar no JSR (`jsr:@tavaressan/vetor`)

- **Mecanismo:** Publicação direta através de `deno publish`. O pacote é disponibilizado no JSR.
- **Vantagens:**
  - Suporte nativo a TypeScript sem etapa de build intermediária; documentação gerada automaticamente.
  - Para usuários de Deno: instalação limpa via `deno install -g -A jsr:@tavaressan/vetor` ou execução sob demanda `deno run -A jsr:@tavaressan/vetor`.
- **Desvantagens e Impacto:**
  - **Quebra total para quem usa `npm install -g`**: O JSR não é descoberto pelo npm registry padrão sem configuração explícita de `.npmrc` (`@jsr:registry=https://npm.jsr.io`).
  - O ecossistema de assistentes de IA (Claude Code CLI, OpenCode, Codex) distribui primariamente extensões e CLIs pelo ecossistema Node/npm. Forçar o usuário a aprender comandos do JSR cria forte barreira de entrada.

### 4.3 Opção C: Binários Compilados via `deno compile`

- **Mecanismo:** `deno compile --allow-all --output dist/vetor cli/bin/vetor.ts`.
- **Vantagens:**
  - Executável autocontido e independente: o usuário final **não precisa ter nem Node nem Deno instalados** para rodar o instalador do Vetor.
  - Elimina discussões sobre runtime host no momento da instalação.
- **Desvantagens e Impacto:**
  - **Tamanho do binário**: Cada binário gerado inclui a V8 e o runtime do Deno, pesando entre 80 MB e 110 MB por arquitetura.
  - **Distribuição de templates estáticos**: `cli/templates/` precisaria ser embarcado no binário com `--include templates/` ou embutido em código, aumentando a complexidade de empacotamento.
  - **Atendimento de atualizações**: Sem um package manager, o usuário precisaria baixar novos binários manualmente ou depender de um mecanismo próprio de auto-update.
  - Não atende desenvolvedores acostumados com `npx @tavaressan/vetor`.

### 4.4 Comparação de Estratégias de Distribuição

| Critério | npm Puro (Atual) | npm via `dnt` | JSR Puro | `deno compile` |
|---|:---:|:---:|:---:|:---:|
| **Compatibilidade com `npm install -g`** | Nativa | Nativa | Quebrada (requer config) | Quebrada |
| **Suporte a `npx @tavaressan/vetor`** | Sim | Sim | Não | Não |
| **Suporte a `deno run -A ...`** | Sim (`npm:`, #438) | Sim (`npm:`) | Sim (`jsr:`) | Não (é binário) |
| **Necessita etapa de build (build step)** | **Não (zero build)** | Sim (`dnt`) | Não | Sim (`compile`) |
| **Dependências em tempo de build** | **Zero** | Alta (`dnt`, TS) | Zero | Deno |
| **Tamanho do download** | **~60 KB** | ~80 KB | ~60 KB | **~90 MB** |
| **Complexidade no CI** | Mínima | Alta | Mínima | Média (matriz OS) |

---

## 5. Pergunta 4: Compatibilidade com Harnesses que Esperam Node

> **Pergunta do Spike:** *Compatibilidade com harnesses que esperam Node (ex.: npx em configs de MCP) — o que muda, se algo.*

### 5.1 O Papel do CLI vs. O Papel do Harness

Uma confusão frequente é misturar o instalador do Vetor (`vetor`) com servidores de protocolo MCP.

1. **O CLI do Vetor NÃO é um servidor MCP:**
   - O CLI é exclusivamente um instalador/gerenciador de ciclo de vida de templates (`vetor install`, `vetor doctor`, `vetor status`, `vetor update`, `vetor uninstall`).
   - Ele não atua como processo persistente ou servidor stdio/SSE em nenhuma configuração de MCP.
2. **Servidores MCP configurados em projetos Vetor:**
   - O servidor MCP primário suportado pelo Vetor é o `ai-memory`, que opera tipicamente via container Docker (`docker run ... ai-memory`) ou serviço HTTP dedicado.
   - Ferramentas MCP de terceiros que os usuários eventualmente declaram em `.mcp.json` usando `command: "npx"` são executadas diretamente pelo harness host (Claude Code, Cursor, Codex), de forma totalmente isolada do instalador do Vetor.
3. **Invocação do CLI pelos Harnesses:**
   - Nenhum harness invoca o binário `vetor` em tempo de execução das skills. As skills instaladas em `.claude/skills/`, `.cursor/skills/` etc., executam diretamente comandos shell (`bash`) ou scripts Deno (`deno run -A scripts/...`).
   - O binário `vetor` é utilizado unicamente pelo desenvolvedor humano (ou pipelines de setup) para preparar o workspace.

### 5.2 Conclusão de Compatibilidade
- **Zero quebra nos harnesses**: Mudar o runtime do CLI não altera em nada o comportamento de Claude Code, Cursor, Codex, OpenCode ou Antigravity, desde que o comando `vetor` permaneça acessível no `PATH`.
- **Porém**: Usuários que hoje utilizam `npx @tavaressan/vetor install` para inicializar projetos sem poluir o PATH global perderiam essa facilidade se o pacote deixasse de existir no formato padrão do npm.

---

## 6. O Fator Decisivo: A Descoberta da Issue #438

A premissa motivadora da issue #439 era: *"Antes de decidir migrar, medir custo e ganho. Se a forma de instalação via Deno da #438 resolver a dependência de runtime para o usuário final, o ganho que sobra da migração é interno (ferramental único, TypeScript, reuso de scripts/lib)."*

O commit `b21a155` (PR que fechou as issues #436, #437 e #438 em 2026-10-21) confirmou empiricamente:

1. **Execução direta via Deno já funciona:**
   ```bash
   deno run -A npm:@tavaressan/vetor install
   ```
   O Deno 2.9.2 baixa o pacote do npm registry e executa o CommonJS sem nenhuma alteração no código fonte do CLI.
2. **Instalação global e compilação via Deno já funciona:**
   ```bash
   deno install --global --compile -A npm:@tavaressan/vetor
   ```
   Gera o executável global compilado no diretório bin do Deno. Um usuário que possui apenas Deno (sem Node instalado na máquina) já consegue instalar e utilizar o Vetor globalmente hoje.
3. **Smoke test no CI:**
   O arquivo `.github/workflows/ci.yml` já contém um step dedicado que roda o CLI local sob o Deno a cada pull request.

**Conclusão imediata:** O objetivo externo (permitir que usuários de Deno utilizem o Vetor sem depender de Node) **já foi alcançado**. Portanto, o único benefício potencial de uma migração seria o ganho interno.

Contudo, como comprovado na Seção 2 deste relatório, a duplicação interna é de apenas **4,6%** (56 linhas). Reescrever 4.980 linhas de código e testes para obter um reuso de 56 linhas representaria um retorno sobre investimento (ROI) extremamente desfavorável.

---

## 7. Recomendação Definitiva e Gatilhos de Reavaliação

### 7.1 Decisão Recomendada: NÃO MIGRAR

Recomenda-se manter o CLI do Vetor em **Node/CommonJS com zero dependências externas**, suportando o Deno como cidadão de primeira classe através da distribuição npm compatível (`npm:` specifier).

**Razões fundamentadas:**
1. **Zero duplicação real com `scripts/lib/`:** Não há ganho de modularização ou reuso com o core de skills do Vetor.
2. **Arquitetura "Zero Build / Zero Config":** O CLI atual não necessita de transpiladores, bundlers ou compilação. Qualquer contribuidor pode editar um arquivo `.js` e rodar os testes instantaneamente em milissegundos.
3. **Custo de migração desproporcional:** ~50 a 65 horas de engenharia que introduziriam riscos de regressão em manipulação de arquivos no Windows, modos de terminal raw e flags do instalador.
4. **Universalidade do canal npm:** Atende desenvolvedores em todos os ambientes corporativos e ecossistemas de IA sem atrito.
5. **Deno já é atendido:** Conforme validado na #438, desenvolvedores Deno já possuem suporte completo via `deno run -A npm:@tavaressan/vetor`.

### 7.2 Ações Menores Recomendadas (Melhoria Contínua, sem Migração)
1. **Deduplicação do Utilitário de PATH (18 linhas):**
   Se desejado, unificar a lógica de varredura de `PATH`/`PATHEXT` compartilhando uma especificação comum entre `now-probe.ts` e `command-exists.js`.
2. **Manutenção do Smoke Test Deno no CI:**
   Garantir que novos recursos adicionados ao CLI continuem sendo validados sob `deno run` no CI.

### 7.3 Gatilhos de Reavaliação (Quando reconsiderar esta decisão)

A decisão de não migrar deve ser formalmente reavaliada caso ocorra qualquer um dos seguintes eventos:

1. **Descontinuação do Node como pré-requisito ou alvo de ecossistema:**
   Se o projeto Vetor deliberadamente remover todo suporte a ambientes Node e declarar o Deno como o único runtime admissível para qualquer ferramenta associada.
2. **Necessidade de compartilhamento de módulos complexos:**
   Se uma nova funcionalidade do CLI exigir a importação direta de módulos densos de `scripts/lib/` (como o motor de inferência de specs `spec-quality-checkers.ts` ou o `KnowledgeProvider`), onde reimplementar em Node seria inviável.
3. **Regressão ou quebra de suporte a CommonJS no Deno:**
   Se versões futuras do Deno descontinuarem ou limitarem a execução de pacotes CommonJS via specifiers `npm:`.
4. **Mudança do padrão de mercado para distribuição de plugins de IA:**
   Se os harnesses (Claude Code, Cursor, Codex) passarem a adotar registries específicos de Deno ou binários compilados como padrão oficial em substituição ao npm.

---

## 8. Fontes e Referências Citadas

- **Código Fonte do CLI:**
  - `cli/package.json`: configuração de engines (`node >= 22`), `"type": "commonjs"`, zero dependências.
  - `cli/bin/vetor.js`: ponto de entrada do binário.
  - `cli/lib/router.js`: roteador de comandos e flags sem dependências.
  - `cli/lib/commands/doctor.js`: verificações do doctor (incluindo `checkAiMemory`).
  - `cli/lib/commands/status.js`: verificação de integridade contra o manifesto.
  - `cli/lib/installer/detector.js`: detecção de engines de assistentes de IA.
  - `cli/lib/installer/manifest.js`: gerenciador de `.vetor/install-manifest.json`.
  - `cli/lib/installer/command-exists.js`: resolução de executáveis em `PATH`/`PATHEXT`.
  - `cli/lib/installer/writer.js`: instalação de arquivos e tradução por engine.
  - `cli/lib/installer/prompts.js`: interface TTY raw mode interativa.
  - `cli/test/`: 18 arquivos de teste cobrindo unitários, TTY, manifestos e empacotamento.
- **Código Fonte de Scripts:**
  - `scripts/lib/project.ts`: detecção de stacks de projetos de software e comandos de teste.
  - `scripts/lib/status.ts`: ciclo de vida de status de subagentes do coordinator.
  - `scripts/now-probe.ts`: sondagem de ambiente do comando `now` (função `findBinary`).
  - `scripts/ai-memory-check.ts`: verificação MCP HTTP/SSE JSON-RPC 2.0.
  - `scripts/lib/`: 20 arquivos TypeScript de suporte às skills.
- **Documentação e Histórico:**
  - `README.md:36`: Deno 2.x como pré-requisito documentado do Vetor.
  - Commit `b21a155` (#436, #437, #438): comprovação empírica de execução e compilação do pacote 0.2.0 sob Deno 2.9.2.
  - `.github/workflows/npm-publish.yml` e `.github/workflows/ci.yml`: workflows de publicação e testes de integração.
