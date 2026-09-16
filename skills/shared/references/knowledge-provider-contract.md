# Knowledge Provider — contrato

O Vetor acessa documentação de projeto (specs, ADRs, arquitetura, contexto) através de uma
abstração única, `KnowledgeProvider`, implementada em `scripts/lib/knowledge.ts`. As Skills nunca
falam diretamente com Obsidian, filesystem ou qualquer outro backend — sempre através dessa
interface. Isso mantém a semântica (quando/por que ler ou escrever conhecimento) nas Skills, e a
integração com uma ferramenta específica isolada em uma implementação de `KnowledgeProvider`.

Implementação padrão, sempre disponível sem nenhuma configuração: `FilesystemKnowledgeProvider`
(módulo `docs/` do projeto-alvo por default). Implementações futuras (ex.: `ObsidianKnowledgeProvider`
— issue #225) devem seguir o mesmo contrato semântico descrito abaixo, para que uma Skill funcione de
forma idêntica independentemente do provider configurado.

## Operações mínimas (obrigatórias)

| Operação | Assinatura | Contrato |
|----------|-----------|----------|
| `search` | `search(query: string): Promise<KnowledgeSearchResult[]>` | Combina por conteúdo **ou** path, case-insensitive. Sem resultados → array vazio, nunca erro. |
| `read` | `read(path: string): Promise<string>` | Lê o conteúdo bruto de uma entrada. **Lança** se o path não existir. |
| `create` | `create(path: string, content: string): Promise<void>` | Cria uma nova entrada. **Lança** se o path já existir — nunca sobrescreve silenciosamente. |
| `update` | `update(path: string, content: string): Promise<void>` | Sobrescreve o conteúdo de uma entrada existente. **Lança** se o path não existir. |
| `list` | `list(path?: string): Promise<string[]>` | Lista os paths das entradas sob `path` (raiz do provider quando omitido). Diretório inexistente ou vazio → array vazio. Path **inválido** (ver "Semântica de path") lança, exatamente como as demais operações. |
| `link` | `link(source: string, target: string): Promise<void>` | Cria uma referência semântica de `source` para `target`. **Idempotente**: aplicar duas vezes não duplica a referência. **Lança** se `source` ou `target` não existirem. |

## Operações opcionais

| Operação | Assinatura | Contrato |
|----------|-----------|----------|
| `delete` | `delete(path: string): Promise<void>` | Remove uma entrada. Lança se não existir. |
| `move` | `move(source: string, target: string): Promise<void>` | Move/renomeia uma entrada preservando o conteúdo. Lança se `source` não existir ou `target` já existir. |
| `exists` | `exists(path: string): Promise<boolean>` | Retorna `false` para um path **válido** e inexistente. **Lança** para um path inválido (ver "Semântica de path" abaixo) — inválido não é o mesmo que inexistente. |

Uma implementação pode omitir as operações opcionais; uma Skill que dependa de uma delas deve
verificar `typeof provider.delete === "function"` (etc.) antes de chamá-la, em vez de assumir que
todo provider as oferece.

## Semântica de path

- Sempre relativo à raiz do provider (nunca um path absoluto do sistema de arquivos).
- Separador `/`, mesmo em Windows.
- Segmentos `..` e paths absolutos (`/...`, `C:\...`) são rejeitados — nenhuma implementação deve
  permitir que uma operação escape da raiz configurada.

## Configuração (`.claude/vetor/config.json`)

```json
{
  "knowledge": {
    "enabled": true,
    "provider": "filesystem"
  }
}
```

- `knowledge` ausente, ou `config.json` inteiro ausente → default `filesystem`, **sempre
  funcional**, sem exigir nenhuma configuração adicional.
- `knowledge.enabled: false` → Knowledge Provider desabilitado; nenhum estado de erro, o restante
  do workflow do Vetor continua normalmente.
- `knowledge.provider: "obsidian"` → seleciona a implementação Obsidian (issue #225). Campos
  específicos de Vault/paths pertencem a essa issue seguinte, não a este contrato.

`FilesystemKnowledgeProvider` nunca lê este arquivo de configuração — ele funciona de forma idêntica
com `knowledge` ausente, desabilitado ou habilitado. A leitura de `config.json` fica isolada em
`detectKnowledgeState()`, usada apenas para reportar o estado na inicialização do `/vetor` (ver
`skills/vetor/SKILL.md` §2 e §3).

## Estado reportado na inicialização

`detectKnowledgeState()` (`scripts/lib/knowledge.ts`) deriva um dos três estados a partir do
`config.json`, incluído no JSON de saída de `detect-project.ts` (campo `knowledge`):

| Estado | Label | Quando |
|--------|-------|--------|
| `filesystem` | `✓ Filesystem` | Default — `knowledge` ausente, ou presente com `enabled` não-`false` e `provider` não `"obsidian"`. |
| `obsidian` | `✓ Obsidian` | `knowledge.provider === "obsidian"` e `enabled` não-`false`. |
| `disabled` | `○ Disabled` | `knowledge.enabled === false` (vence mesmo com `provider` setado). |

`detectKnowledgeState()` nunca lança — ausência ou config malformada nunca interrompem o workflow do
Vetor.
