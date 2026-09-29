# Investigação: Valor de Traduzir Documentação do Vetor para Inglês

**Issue:** #260 — docs: investigar se há valor em traduzir a documentação do Vetor para o inglês
**Data:** 2026-09-29
**Status:** Concluída

---

## 1. Sinais Concretos de Demanda por Documentação em Inglês

**Projetos similares de skills/plugins para agent harnesses:**

| Projeto | Documentação | Adoção não-lusófona |
|---------|--------------|---------------------|
| [Reversa](https://github.com/sandeco/reversa) | PT/EN | Média (README EN, issues EN) |
| [Skills do Matt Pocock](https://github.com/mattpocock/skills) | EN apenas | Alta (comunidade global) |
| [Superpowers](https://github.com/obra/superpowers) | EN apenas | Alta |
| [Claude Code Skills (oficial)](https://github.com/anthropics/claude-code-skills) | EN apenas | Nativa global |

**Evidência disponível:** Não há dados públicos de métricas de adoção por idioma para projetos de skills do Claude Code. A maioria dos projetos bem-sucedidos usa **inglês como padrão** ou **bilíngue (PT/EN)**.

**Sinais indiretos:**
- O instalador npm (`@tavaressan/vetor`) expõe o projeto a audiência global
- Issues/PRs em inglês já aparecem espontaneamente em repositórios brasileiros populares
- A comunidade Claude Code é majoritariamente anglófona

---

## 2. Volume Real por Documento

| Documento | Linhas (aprox) | Status |
|-----------|----------------|--------|
| `README.md` | 101 | Bilíngue parcial (já tem alguns termos EN) |
| `wiki/Home.md` | 29 | Hub de navegação |
| `wiki/Configuracao.md` | ~150 | Técnico |
| `wiki/MCPs.md` | ~80 | Técnico |
| `wiki/Arquitetura.md` | ~200 | Técnico |
| `wiki/Hooks.md` | ~120 | Técnico |
| `wiki/Decisoes-de-Design.md` | ~300 | Técnico |
| `wiki/Referencia.md` | ~180 | Técnico |
| `wiki/Compatibilidade-Antigravity.md` | ~100 | Técnico |
| `wiki/Compatibilidade-Codex.md` | ~107 | Técnico |
| `wiki/Compatibilidade-OpenCode.md` | ~482 | Técnico |
| `wiki/Compatibilidade-Cursor.md` | ~80 | Técnico |
| **Total Wiki** | **~1.800** | |
| **SKILL.md (13 skills)** | ~2.500 | Instruções operacionais (consumidas por agente) |

---

## 3. SKILL.md: Entram no Escopo?

**Não recomendado.** Os `SKILL.md` são:
- Instruções operacionais consumidas pelo **próprio agente** (não humanos primariamente)
- Executadas pelo agente no contexto da sessão
- Tradução não agrega valor para o agente (ele processa PT nativamente)
- Custo de manutenção alto: toda mudança no SKILL.md exigiria sync manual das duas versões

**Escopo recomendado:** Apenas **README.md + Wiki** (documentação para humanos)

---

## 4. Estratégias de Tradução

| Estratégia | Prós | Contras |
|------------|------|---------|
| **Completa manual (README + Wiki PT/EN)** | Qualidade máxima, controle total | **Custo altíssimo** de manutenção (sync manual), risco de deriva |
| **README-EN.md apenas + Wiki em PT** | Baixo custo, porta de entrada | Wiki fica inacessível a não-lusófonos |
| **Tradução automatizada em CI** | Sync automático, sempre atualizado | Qualidade variável, termos técnicos podem quebrar |
| **Não traduzir (status quo)** | Zero custo | Barreira de entrada para não-lusófonos |

---

## 5. Custo de Manutenção

**Risco real de deriva:** Já documentado no projeto — `wiki/Compatibilidade-OpenCode.md` descreve `opencode/scripts/` que pode divergir de `scripts/` (sem sync automático). Adicionar idioma duplica esse risco.

**Estimativa de esforço contínuo:**
- Tradução inicial: ~4.000 linhas × ~2 min/linha = ~130h
- Manutenção: ~20% do tempo de mudanças de doc = overhead permanente

---

## 6. Recomendação

### **NÃO TRADUZIR AGORA** — Reavaliar após sinais de adoção não-lusófona

**Justificativa:**
1. **Sem evidência de demanda concreta** — apenas especulação baseada no publish npm
2. **Custo/benefício desfavorável** — ~130h inicial + overhead permanente vs. benefício incerto
3. **Risco de deriva** — mesmo problema já existente no projeto (docs desatualizadas vs código)
4. **Público-alvo atual:** Principalmente usuários de Claude Code lusófonos (comunidade brasileira ativa)
5. **Agentes processam PT nativamente** — SKILL.md não precisam de tradução

### **Critério Objetivo de Reavaliação Futura**

Reavaliar tradução quando **UM** dos seguintes sinais ocorrer:
- [ ] ≥ 3 issues/PRs em inglês abertos por contribuidores externos no repositório Vetor
- [ ] ≥ 10 estrelas de usuários com perfil não-lusófono no GitHub
- [ ] Feedback direto de usuário não-lusófono pedindo docs em inglês (via issue/discussion)
- [ ] Publicação no npm (`@tavaressan/vetor`) gerar ≥ 50 downloads/semana sustentados por 4 semanas

### **Se Reavaliar e Decidir Traduzir:**
- **Escopo:** README-EN.md + Wiki (não SKILL.md)
- **Estratégia:** Tradução automatizada em CI (ex.: GitHub Actions + DeepL/LibreTranslate) com revisão humana pontual
- **Manutenção:** CI falha se docs PT mudarem sem sync — força atualização

---

## 7. Conclusão

A documentação em português atende bem o público atual. O custo de tradução e manutenção bilíngue não se justifica sem sinais concretos de demanda. **Recomenda-se não traduzir agora** e reavaliar apenas quando houver evidência objetiva de adoção não-lusófona (critérios acima).