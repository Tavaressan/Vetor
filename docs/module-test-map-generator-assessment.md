# Assessamento: Gerador Automático de Module Test Map

**Issue:** #75  
**Status:** Análise e Planejamento  
**Autor:** Vetor Worker Agent  
**Data:** 2026-07-21

---

## 1. Análise de Viabilidade Técnica

### 1.1 Estado Atual

O `scripts/detect-project.ts` já implementa auto-detecção funcional:

- `hasTestSuite(path)` — busca recursiva por arquivos de teste com regex `/(?:_test|\.(?:test|spec))\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.go$/` e diretórios `test/`, `tests/`, `__tests__/`
- `detectProject(dir)` — detecção de runtime (deno/node/rust/go/python/gradle) via archivos de configuração
- `detectModules(root)` — escaneamento de 1-2 níveis de profundidade
- `renderMap()` — geração do Markdown com tabela de comandos e mapping path→módulo
- `writeConfig()` — persistência de runtime/packageManager/testCommand em `config.json`

**Gap identificado:** A detecção atual é manual (roda com `--force`). Não há geração automática pós-criação de módulo.

### 1.2 Viabilidade: Alta

A infraestrutura já existe. O que falta é orquestração automática — um hook ou watcher que regenere o mapa quando a estrutura do monorepo mudar.

---

## 2. Arquitetura Proposta

### 2.1 Estratégia de Auto-Detecção

O `detectProject` atual já resolve a detecção de runtime. Para automação completa:

**Trigger points (onde regenerar):**
1. **Hook `post-checkout` / `post-merge`** — regenera após mudar de branch
2. **`/vetor` skill** — já chama `detect-project.ts --force`; pode-se adicionar chamada sem `--force`
3. **`worktree-create`** — regenera no worktree novo (já parcialmente faz via `prepare-worktree.ts`)
4. **Watcher em tempo real** — desnecessário; re-gravação em batch é suficiente

**Lógica de decisão de runtime (já implementada, documentar):**

```
deno.json/deno.jsonc → Deno (com test task check)
package.json → Node (com detecção de PM: bun/pnpm/yarn/npm)
Cargo.toml → Rust
go.mod → Go
pyproject.toml/requirements.txt/poetry.lock → Python
build.gradle* → Gradle
Nenhum → unknown (não gera módulo)
```

### 2.2 Preservação de Customizações Humanas

**Problema:** Engenheiros editam o Markdown manualmente para adicionar anotações, regras customizadas ou notas de contexto.

**Solução proposta: Arquivo auxiliar `vetor.modules.json`**

```jsonc
{
  "overrides": {
    "scripts": {
      "command": "cd scripts && deno test -A --filter=unit",
      "note": "Ignorar testes de integração neste módulo"
    }
  },
  "exclusions": ["_reversa_sdd/", "_reversa_forward/"],
  "skipNoTest": true
}
```

**Por que não delimitadores no Markdown?**
- Fragilidade: parsing de Markdown é propenso a quebra com formatação humana
- Dificulta merge: conflitos em blocos delimitados são mais difíceis de resolver
- Separação de responsabilidades: configuração estruturada em JSON, apresentação em MD

**Fluxo de atualização:**
1. `detect-project.ts` detecta módulos automaticamente
2. Lê `vetor.modules.json` (se existir) para overrides
3. Merge: auto-detecção + overrides humanos
4. Grava `module-test-map.md` (só a parte gerada; seções manuais preservadas via merge strategy)

**Estratégia de merge do Markdown:**
- Identificar seções por headings (`## Comandos por módulo`, `## Detecção de módulo`, `## Regras de execução`)
- Re-render só as seções auto-geradas
- Seções adicionais humanas (após `## Regras de execução` ou com prefixo `<!-- manual -->`) preservadas intactas

### 2.3 Casos de Borda

| Cenário | Tratamento |
|---------|-----------|
| Diretório documental novo (`_docs/`) | `detectProject` retorna `unknown` → não vira módulo. Se quiser excluir explicitamente, adicionar em `vetor.modules.json` |
| Módulo sem testes (cenário #74) | `hasTestSuite` retorna false → `command: null` → "sem suíte de testes" → skip |
| Módulo com testes em diretório aninhado | `hasTestSuite` busca recursiva, exceto dirs ignorados → detecta |
| Monorepo com 3+ níveis | `detectModules` atual faz 2 níveis. Expandir para N? **Recomendação:** manter 2 — monorepos rasos são maioria; excesso de profundidade aumenta custo |
| Módulo com múltiplos runtimes | Prioridade: deno > node > rust > go > python > gradle (já implementado) |
| `node_modules/` dentro de módulo | Já excluído por `IGNORED_DIRS` |
| Worktree parcial | `hasTestSuite` opera no worktree local — funciona corretamente |

### 2.4 Acoplamento com Agent Runtime

**Opções de exposição:**

| Método | Performático? | Complexidade | Recomendação |
|--------|--------------|-------------|-------------|
| Leitura de arquivo (`module-test-map.md`) | Sim | Baixa | **Implementar** — já é o método atual |
| Injeção de prompt via skill reference | Sim | Média | Já existe em `project-conventions.md` |
| Ferramenta MCP | Não | Alta | Evitar — overhead de latência por ciclo |
| `config.json` como cache binário | Sim | Média | **Complementar** — `prepare-worktree.ts` já lê |

**Arquitetura recomendada:**

```
detect-project.ts (gerador)
    ↓
module-test-map.md (presentation layer — consumido por skills)
    ↓
config.json (data layer — runtime, testCommand, modules)
    ↓
project-conventions.md (reference layer — instruções para agents)
```

O `fix-loop-agent` e `worktree-ship` já leem `project-conventions.md` que instrui a usar `module-test-map.md`. Não há acoplamento direto com o gerador — é desacoplamento correto.

---

## 3. Plano de Implementação (Milestones)

### Milestone 1: Documentar comportamento atual (1 dia)

- [ ] Documentar lógica de detecção de `detectProject` e `hasTestSuite` em `docs/detect-project.md`
- [ ] Adicionar exemplos de saída para cada runtime
- [ ] Fechar Issue #74 com evidência de que o código já resolve (tests passing, mapa gerado corretamente)

### Milestone 2: Criar `vetor.modules.json` schema (2 dias)

- [ ] Definir schema JSON para overrides e exclusões
- [ ] Implementar leitura de `vetor.modules.json` em `detect-project.ts`
- [ ] Merge strategy: auto-detecção + overrides
- [ ] Testes unitários para cenários de merge

### Milestone 3: Preservação de seções manuais no Markdown (2 dias)

- [ ] Implementar parser de seções do `module-test-map.md`
- [ ] Re-render só seções auto-geradas, preservando seções manuais
- [ ] Testes com Markdown misto (auto + manual)

### Milestone 4: Hook de regeneração (1 dia)

- [ ] Adicionar chamada a `detect-project.ts` no `worktree-create` (já parcial)
- [ ] Adicionar chamada no `/vetor` skill (já existe com `--force`)
- [ ] Documentar quando regenerar vs. quando pular

### Milestone 5: Integração e teste end-to-end (2 dias)

- [ ] Testar cenário: criar módulo novo → regenerar mapa → verificar comando correto
- [ ] Testar cenário: módulo sem testes → verificar skip no worktree-ship
- [ ] Testar cenário: override manual → verificar preservação
- [ ] Testar cenário: monorepo com 5+ módulos → verificar performance

### Milestone 6: Fechar Issue #75 (0.5 dia)

- [ ] Atualizar documentação final
- [ ] Fechar issue com link para文档
- [ ] Criar Issue #76 para implementação (se necessário separar)

---

## 4. Riscos e Dependências

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Regex de teste não cobre framework novo | Média | Alto | Manter regex extensível; testar com novos padrões |
| Merge de Markdown corrompe formatação | Baixa | Médio | Usar delimitadores de seção por heading, não regex |
| `hasTestSuite` lento em monorepo grande | Baixa | Baixo | Cache em `config.json`; busca limitada a 2 níveis |
| Override humano conflita com auto-detecção | Média | Baixo | `vetor.modules.json` tem precedência; documentar |

---

## 5. Conclusão

A auto-detecção já é funcional. O gap principal é a **preservação de customizações humanas** e a **regeneração automática**. O plano proposto é incremental — cada milestone é entregável独立ente e testável.

**Recomendação:** Começar pelo Milestone 1 (documentação) e Milestone 2 (overrides), que resolvem os casos de borda mais urgentes sem refatoração grande.
