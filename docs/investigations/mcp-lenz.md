# Investigação: Integração do MCP Lenz (Fact-Checking) ao Plugin Vetor

**Issue:** #295 — chore(mcp): investigar valor de integrar o MCP Lenz (fact-checking) ao plugin
**Data:** 2026-09-29
**Status:** Concluída

---

## 1. Mapeamento de Saídas Geradas por IA no Vetor

O Vetor possui vários pontos onde conteúdo gerado por IA é produzido e poderia se beneficiar de fact-checking:

| Skill/Comando | Tipo de Saída | Criticidade |
|--------------|---------------|-------------|
| `/vetor:spec` | Specs estruturadas (RF/RNF, Acceptance Criteria, Edge Cases) | **Alta** — specs viram contrato de implementação |
| `/vetor:backlog-ideator` | Issues GitHub geradas por ideação | Média — passam por aprovação humana antes de criar |
| `/vetor:architecture-review` | Relatório de dívida arquitetural, achados, recomendações | **Alta** — base para decisões técnicas |
| `/vetor:code-review` | Code reviews (bugs, arquitetura, segurança) | **Alta** — feedback direto em PRs |
| `/vetor:issue-coordinator` | Planos de dispatch, relatórios de status | Baixa — operacional, não decisório |

**Gate de aprovação humana existente:** Todas as specs e issues do Vetor **já passam por aprovação humana** antes de criar/commitar (Spec: `ExitPlanMode`; Issues: aprovação do plano do coordinator; PRs: review required). Isso é um gate forte já existente.

---

## 2. Modelo de Custo do Lenz

**Fonte:** lenz.io (consultado em 2026-09-29)

- **Tier gratuito:** Não encontrado evidência de tier gratuito sustentável
- **Planos:** Pagos, baseados em volume de chamadas
- **Custo por chamada:** Não publicado publicamente — requer contato comercial
- **Autenticação:** `LENZ_API_KEY` (Bearer token via HTTP transport)

**Conclusão:** É um serviço **pago de terceiros**, não um binário local como `docker` ou `chrome-devtools`.

---

## 3. Precedente de Dependência Externa

| MCP Atual | Tipo | Dependência |
|-----------|------|-------------|
| Context7 | Documentação de libs | Serviço gratuito (Context7) |
| Chrome DevTools | Browser automation | Binário local (Chrome) |
| Docker | Container inspection | Binário local (Docker) |
| **Lenz (proposto)** | **Fact-checking** | **API paga de terceiros** |

**Avaliação:** Diferente dos MCPs atuais, o Lenz exige:
1. Conta paga em serviço de terceiros
2. API key de usuário
3. Conectividade de rede obrigatória
4. Custo variável por uso

Isso **quebra o modelo** de "embarcado por padrão" — todo usuário precisaria de conta Lenz.

---

## 4. Comparação com Gates Existentes

| Gate Atual | Cobertura | Limitação |
|------------|-----------|-----------|
| Aprovação humana de Specs | 100% das specs | Subjetivo, depende de atenção do revisor |
| Aprovação humana de Issues | 100% das issues | Mesmo |
| Code review em PRs | 100% dos PRs | Mesmo |
| Lenz (adicional) | Fact-checking automatizado | **Custo + dependência externa** |

**Valor incremental real:** O Lenz agregaria fact-checking **automatizado e multi-modelo** sobre afirmações verificáveis. Mas:
- As specs/issues já têm critérios de aceite concretos (checklists)
- A revisão humana já valida correção técnica
- O Lenz não substitui a revisão humana — seria **camada adicional**

---

## 5. Recomendação

### **NÃO INTEGRAR POR PADRÃO** — Documentar como integração opcional externa

**Justificativa:**
1. **Custo:** Serviço pago de terceiros — não aceitável como dependência padrão do plugin
2. **Gate existente suficiente:** Aprovação humana + code review já cobrem validação de conteúdo
3. **Dependência externa:** Quebra autonomia do plugin (rede obrigatória, conta terceiros)
4. **ROI incerto:** Fact-checking de specs técnicas (não claims factuais públicos) tem utilidade limitada

### **Se a recomendação for reavaliada no futuro:**
- Critério objetivo: Lenz oferecer tier gratuito sustentável OU demonstração clara de ROI em specs técnicas
- Escopo: Opcional, documentado em `wiki/MCPs.md`, não em `.mcp.json` embarcado
- Degradação graciosa: Igual ao Context7 — sem API key, segue sem o MCP

---

## 6. Próximos Passos (Fora de Escopo Desta Issue)

- [ ] Registrar recomendação "não integrar" em `wiki/MCPs.md` com justificativa
- [ ] Documentar como usuário avançado pode adicionar manualmente se quiser
- [ ] Reavaliar quando Lenz anunciar tier gratuito ou preço público

---

**Conclusão da Investigação:** O Lenz não se encaixa no modelo de MCPs embarcados do Vetor (binários locais ou serviços gratuitos). O gate de aprovação humana existente já cumpre o papel de validação de conteúdo gerado por IA. Recomenda-se **não integrar** e documentar como opção avançada externa.