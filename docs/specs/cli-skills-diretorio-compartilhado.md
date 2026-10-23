---
id: spec:cli-skills-diretorio-compartilhado
type: spec
project: Vetor
status: draft
created: 2026-10-23
updated: 2026-10-23
---
# CLI: Skills em Diretório Compartilhado

## Summary

Reduzir cópias redundantes de skills em instalações multi-engine do CLI usando diretórios de projeto que várias engines reconhecem. Cursor deve aproveitar `.agents/skills/` quando Antigravity ou Codex já fazem o Vetor gravar skills ali, ou `.claude/skills/` quando Claude Code estiver selecionado. Cursor instalado sozinho continua usando `.cursor/skills/`. O manifesto, `update` e `uninstall` devem refletir propriedade compartilhada sem deixar arquivos gerenciados órfãos nem apagar skills ainda usadas por outra engine.

## Context

- O destino por engine está centralizado em `ENGINE_DEST_DIR` em `cli/lib/installer/writer.js:39-45`; Codex já direciona skills para `.agents/skills/` via `ENGINE_SOURCE_DIR_DEST` (`cli/lib/installer/writer.js:73-77`), e Antigravity usa `.agents` como raiz (`cli/lib/installer/writer.js:39-45`).
- A lista `ENGINE_EXCLUDED_SOURCE_DIRS` atualmente exclui diretórios inteiros para OpenCode e hooks de Antigravity, mas não define compartilhamento de skills com Cursor (`cli/lib/installer/writer.js:68-72`).
- A cópia gerenciada registra hash e engines associadas por arquivo, e evita sobrescrever arquivo não gerenciado ou modificado pelo usuário (`cli/lib/installer/writer.js:151-188`). O manifesto do projeto fica em `.vetor/install-manifest.json` (`cli/lib/installer/manifest.js:28-32`) e suas entradas comportam múltiplas engines.
- `update` deriva engines do manifesto e reporta arquivos da fonte que não foram atualizados como órfãos sem apagá-los (`cli/lib/commands/update.js:11-23`, `cli/lib/commands/update.js:39-63`).
- `uninstall` remove arquivos íntegros registrados no manifesto, preserva os modificados e mantém entradas preservadas no manifesto (`cli/lib/commands/uninstall.js:37-49`, `cli/lib/commands/uninstall.js:79-118`). O comportamento atual não descreve retenção por dono quando um arquivo tem várias engines.
- Há testes para destino `.agents/skills/` compartilhado por Codex e Antigravity no update (`cli/test/update.test.js:98-121`) e para remoção de skill Codex desse destino no uninstall (`cli/test/uninstall.test.js:140-151`). O writer ainda testa instalação Cursor em `.cursor/` (`cli/test/installer-writer.test.js:362-388`).
- A documentação oficial do Cursor lista `.agents/skills/`, `.cursor/skills/` e, por compatibilidade, `.claude/skills/` e `.codex/skills/`. Ela não declara precedência entre essas raízes; descreve que skills são descobertas de diretórios múltiplos. Consulta em 2026-10-23: [Agent Skills — Cursor Docs](https://cursor.com/docs/skills).
- A issue #479 informa medição de 2026-10-22 de cerca de 1,7 MB gravados com cinco engines, com cópias em `.claude/skills`, `.agents/skills` e `.cursor/skills`. A soma local atual dos arquivos sob `skills/` neste worktree é 381.255 bytes; não substitui a medição de uma instalação multi-engine.
- A proposta do spike #404 recomenda `.agents/skills/` como destino canônico compartilhado (`docs/proposals/multi-harness-deduplication.md:16-19`), mas a issue #479 delimita a mudança para reaproveitar destinos reconhecidos pelo Cursor sem obrigar Cursor sozinho a usar `.agents/`.

## Goals

- Evitar que a instalação multi-engine grave uma cópia adicional das skills em `.cursor/skills/` quando outra engine selecionada já fornecer ao Cursor um diretório compatível.
- Manter o destino atual `.cursor/skills/` quando Cursor é a única engine selecionada.
- Manter manifesto, atualização e desinstalação coerentes com o compartilhamento e com arquivos modificados pelo usuário.
- Validar o comportamento com testes do CLI para instalação combinada, update e uninstall.

## Non-Goals

- Compartilhar ou redirecionar agentes, hooks ou outros arquivos; o escopo é somente skills.
- Alterar o conteúdo ou formato das skills.
- Remover cópias que não sejam gerenciadas pelo manifesto do Vetor.
- Definir precedência interna do Cursor entre raízes de skills; a documentação oficial consultada não estabelece uma.
- Reduzir o tamanho do pacote npm ou reorganizar as fontes no repositório.

## Users / Personas

- Desenvolvedor que instala Vetor em mais de um harness no mesmo projeto e deseja reduzir arquivos duplicados.
- Mantenedor do Vetor que precisa atualizar e remover instalações multi-engine sem perder arquivos pertencentes a engines ainda selecionadas.
- Usuário de Cursor que instala apenas Cursor e espera continuar recebendo skills no diretório nativo `.cursor/skills/`.

## Functional Requirements

### RF-01 - Reutilizar destino de skills reconhecido pelo Cursor

**Priority:** Must

**Description:** Quando Cursor for selecionado junto com Codex ou Antigravity, as skills do Cursor devem ser fornecidas pelo destino `.agents/skills/`, sem gravar duplicatas em `.cursor/skills/`. Quando Cursor for selecionado junto com Claude Code, deve reutilizar `.claude/skills/`, sem gravar duplicatas em `.cursor/skills/`. Se mais de um desses destinos estiver disponível, aplica-se a decisão registrada em Decisions; a incerteza sobre prioridade permanece em Open Questions.

**Acceptance Criteria:**

- [ ] Em instalação com Claude Code, Antigravity, Cursor, Codex e OpenCode, as skills gerenciadas pelo Vetor aparecem em no máximo dois destinos entre `.claude/skills/` e `.agents/skills/`, e nenhuma skill do Vetor é gravada em `.cursor/skills/`.
- [ ] Em instalação apenas com Cursor, ao menos uma skill de origem é gravada em `.cursor/skills/` e nenhuma é gravada em `.agents/skills/` por causa do Cursor.
- [ ] Em instalação Cursor + Antigravity, as skills do Cursor são atendidas por `.agents/skills/`, sem cópia em `.cursor/skills/`.
- [ ] Em instalação Cursor + Claude Code sem Codex ou Antigravity, as skills do Cursor são atendidas por `.claude/skills/`, sem cópia em `.cursor/skills/`.

**Happy Path:**

1. O usuário seleciona uma ou mais engines para instalar.
2. O instalador identifica se uma engine selecionada já grava skills em raiz reconhecida pelo Cursor.
3. O instalador grava cada skill apenas nos destinos necessários e registra os proprietários no manifesto.

**Alternative Flows:**

- Cursor é a única engine que oferece destino: as skills são gravadas em `.cursor/skills/`.
- Nenhum destino de compartilhamento compatível está presente: cada engine mantém seu destino vigente.

### RF-02 - Atualizar manifesto compartilhado

**Priority:** Must

**Description:** Cada arquivo de skill gravado em um destino compartilhado deve manter no manifesto todas as engines que dependem daquele arquivo. `update` deve reconstruir o conjunto de engines a atualizar sem reintroduzir uma cópia redundante em `.cursor/skills/`.

**Acceptance Criteria:**

- [ ] Após instalação combinada que compartilhe skills, cada entrada compartilhada no `.vetor/install-manifest.json` lista todas as engines que dependem dela.
- [ ] Após alterar o conteúdo da fonte e executar `vetor update`, o destino compartilhado é atualizado quando não foi editado pelo usuário e continua sem cópia redundante em `.cursor/skills/`.
- [ ] Um teste do CLI cobre update com Cursor e pelo menos uma engine que compartilhe o destino.

**Happy Path:**

1. O manifesto existente enumera as engines proprietárias dos arquivos compartilhados.
2. O usuário executa `vetor update`.
3. O destino compartilhado recebe a versão atual da fonte quando permanece íntegro.

**Alternative Flows:**

- Se o arquivo foi editado pelo usuário, update preserva o conteúdo e comunica que não o sobrescreveu, conforme a política de atualização segura existente.

### RF-03 - Remover somente quando não houver outro proprietário

**Priority:** Must

**Description:** Ao desinstalar ou deixar de atualizar uma engine, arquivos de skills compartilhados devem permanecer disponíveis enquanto outra engine registrada ainda depender deles. Quando não restar proprietário, o uninstall pode remover o arquivo se ele continuar íntegro segundo o manifesto.

**Acceptance Criteria:**

- [ ] Um teste de uninstall comprova que remover uma das engines proprietárias preserva os arquivos compartilhados e atualiza o manifesto para manter a engine remanescente.
- [ ] Um teste comprova que remover a última engine proprietária remove arquivo íntegro e entrada correspondente do manifesto.
- [ ] Arquivo compartilhado modificado pelo usuário é preservado durante uninstall, e continua registrado para tratamento explícito posterior.
- [ ] O uninstall do cenário compartilhado não remove skills ainda usadas por engine que permaneça instalada.

**Happy Path:**

1. O usuário desinstala a configuração ou engine que deixará de usar uma skill compartilhada.
2. O sistema verifica os proprietários registrados para cada arquivo.
3. O sistema remove apenas a propriedade que saiu; apaga o arquivo íntegro somente quando não resta proprietário.

**Alternative Flows:**

- Se o arquivo está modificado pelo usuário, ele permanece no disco e no manifesto, seguindo a proteção existente.

## Non-Functional Requirements

### RNF-01 - Limitar duplicação em instalação multi-engine

**Priority:** Must

**Description:** A instalação de cinco engines citada no issue deve materializar as skills do Vetor em no máximo dois diretórios compatíveis, evitando a terceira cópia em `.cursor/skills/`.

**Acceptance Criteria:**

- [ ] Em uma instalação com Claude Code, Antigravity, Cursor, Codex e OpenCode, o número de raízes de skills gerenciadas pelo Vetor entre `.claude/skills/`, `.agents/skills/` e `.cursor/skills/` é no máximo dois.
- [ ] A validação da PR informa o tamanho total medido dos arquivos de skills gravados no projeto e os destinos contabilizados.
- [ ] ⚠️ ABERTO: definir um limite absoluto de bytes para a instalação multi-engine; o critério do issue fixa número de diretórios, mas não um teto de tamanho atualizado.

## Behavior / States

- **Cursor isolado:** skill em `.cursor/skills/`, com propriedade Cursor no manifesto.
- **Cursor compartilhado:** skill provida pela raiz compatível escolhida entre `.agents/skills/` e `.claude/skills/`; entrada do manifesto com as engines dependentes.
- **Atualização:** arquivos íntegros sincronizados no destino compartilhado; arquivos editados permanecem preservados e sinalizados.
- **Desinstalação parcial:** remove somente a propriedade da engine removida e mantém arquivos requeridos por outro proprietário.
- **Desinstalação final:** remove arquivo íntegro quando não há proprietários restantes; arquivo modificado é preservado.

## Data

O manifesto `.vetor/install-manifest.json` registra cada caminho de arquivo, hash e engine(s) proprietária(s). A mudança afeta entradas de skills e a relação de engines; o formato e a estratégia exatos de migração permanecem em aberto.

## Integrations / Dependencies

- CLI npm `vetor install`, `vetor update` e `vetor uninstall`.
- Diretórios de skills reconhecidos pelas engines selecionadas.
- Documentação oficial do Cursor, que confirma `.agents/skills/`, `.cursor/skills/` e `.claude/skills/` como raízes reconhecidas, sem publicar precedência entre elas.

## Edge Cases

- **Cursor + Codex + Antigravity:** ambas as engines usam `.agents/skills/`; Cursor deve aproveitar essa raiz sem gravar em `.cursor/skills/`.
- **Cursor + Claude Code + Codex/Antigravity:** há mais de uma raiz compartilhável; o diretório escolhido e a preservação dos demais destinos existentes devem seguir a decisão final do mantenedor.
- **Mesma skill em duas raízes lidas pelo Cursor:** o Cursor carrega todas as raízes que reconhece, então com `.claude/skills/` e `.agents/skills/` presentes ele encontra duas cópias de cada skill do Vetor; a documentação consultada em 2026-10-23 não diz o que acontece com nomes repetidos. Hoje, com as cinco engines, já são três cópias (incluindo `.cursor/skills/`). ⚠️ ABERTO: verificar no Cursor real se nomes repetidos aparecem duplicados ou são unificados.
- **Instalação anterior com `.cursor/skills/`:** o update pode encontrar arquivos gerenciados no destino antigo; política de migração e tratamento de arquivos modificados carecem de decisão.
- **Skill removida da fonte:** update não deve apagar silenciosamente arquivo remanescente; definir coerência da entrada compartilhada e dos donos segue a semântica segura de órfãos existente.
- **Skill preexistente, fora do manifesto:** não deve ser sobrescrita nem removida pelo Vetor.
- **Skill editada pelo usuário:** update e uninstall devem preservá-la e informar que a operação foi retida.

## Error Handling

Arquivos não gerenciados ou alterados pelo usuário devem ser preservados e reportados conforme a política existente. ⚠️ ABERTO: definir a mensagem e o resultado quando dois destinos candidatos têm conteúdos divergentes ou proprietários incompatíveis.

## Security / Privacy

O compartilhamento não reduz as proteções existentes contra sobrescrita de arquivo não gerenciado ou modificado. O uninstall continua limitado a caminhos dentro do projeto e a arquivos cujo hash confere com o manifesto. ⚠️ ABERTO: definir tratamento de manifesto legado inconsistente que liste proprietários divergentes para o mesmo destino.

## Rollout

⚠️ ABERTO: definir versão de publicação e política de compatibilidade/migração para projetos com instalação existente em `.cursor/skills/`.

## Open Questions

> Todas as perguntas abaixo foram decididas pelo mantenedor em 2026-10-23, seguindo a recomendação de cada uma; ver `## Decisions`.

- **Qual raiz compartilhada deve prevalecer quando Cursor é instalado junto com engines que já usam `.agents/skills/` e Claude Code, que usa `.claude/skills/`?** Recomendação: priorizar `.agents/skills/`, que já é compartilhada por Codex e Antigravity; manter `.claude/skills/` para os arquivos próprios de Claude Code, resultando em no máximo duas raízes no caso das cinco engines.
- **Como o update deve tratar uma instalação anterior que possui `.cursor/skills/` no manifesto?** Recomendação: migrar para a raiz compartilhada somente arquivos íntegros cujo hash confere com o manifesto, registrar os proprietários e retirar as entradas antigas; preservar e reportar arquivos alterados, sem apagar cópias editadas.
- **Se `.cursor/skills/` já existe, mas não está no manifesto, deve ser mantido após ativar o compartilhamento?** Recomendação: preservar por ser conteúdo não gerenciado, sem sobrescrever ou apagar; evitar adicionar novas skills gerenciadas ali.
- **Qual teto absoluto de tamanho deve substituir ou complementar a meta histórica de `<400 KB` que não foi medida?** Recomendação: primeiro coletar tamanho reproducível na PR e fixar limite somente após revisão dessa medição.
- **Qual comportamento é esperado se dois destinos candidatos contêm versões diferentes da mesma skill?** Recomendação: nunca sobrescrever conteúdo divergente; preservar ambos, emitir aviso e registrar no manifesto apenas propriedades verificadas.

## Decisions

- Cursor sozinho mantém `.cursor/skills/` para preservar seu destino nativo atual.
- Para colaboração com Codex e Antigravity, `.agents/skills/` é candidato preferencial porque essas engines já compartilham esse destino no instalador.
- Para colaboração com Claude Code, `.claude/skills/` é reconhecido pelo Cursor segundo documentação oficial consultada em 2026-10-23.
- O manifesto existente já permite múltiplas engines por arquivo (`cli/lib/installer/writer.js:173-187`); sua coerência é requisito comportamental, sem definir aqui um novo formato de armazenamento.
- A precedência de descoberta do Cursor entre diretórios é desconhecida na documentação consultada; a spec não assume uma ordem.

Decididas pelo mantenedor em 2026-10-23 (Open Questions):

- Quando houver Codex ou Antigravity, o Cursor usa `.agents/skills/`; `.claude/skills/` continua só para o Claude Code. No caso das cinco engines, as skills ficam em no máximo duas raízes.
- O `update` migra de `.cursor/skills/` para a raiz compartilhada só arquivos íntegros (hash igual ao do manifesto), registra os proprietários e retira as entradas antigas; arquivos alterados são preservados e reportados.
- `.cursor/skills/` fora do manifesto é preservado; o Vetor não grava novas skills ali quando há raiz compartilhada.
- O teto em bytes só é fixado depois da medição reproduzível na PR.
- Conteúdo divergente da mesma skill em dois destinos nunca é sobrescrito: os dois são preservados, com aviso, e o manifesto registra só proprietários verificados.

## References

- Issue #479: `feat(cli): gravar as skills uma vez só quando várias engines leem o mesmo diretório`.
- `cli/lib/installer/writer.js`.
- `cli/lib/installer/manifest.js`.
- `cli/lib/commands/update.js`.
- `cli/lib/commands/uninstall.js`.
- `cli/test/installer-writer.test.js`, `cli/test/update.test.js`, `cli/test/uninstall.test.js`.
- `docs/proposals/multi-harness-deduplication.md`.
- [Agent Skills — Cursor Docs](https://cursor.com/docs/skills) (consulta em 2026-10-23).

## Revision History

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-23 | Codex (via Alethe) | rascunho inicial gerado por /vetor:spec |
| 2026-10-23 | Claude Code (coordinator) | revisão: correções factuais e decisões do mantenedor nas Open Questions |

- Relacionado: proposals/multi-harness-deduplication.md
