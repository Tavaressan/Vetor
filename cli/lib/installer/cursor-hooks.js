'use strict';

// Tradução de hooks/hooks.json (formato Claude Code, fonte agnóstica deste repositório) para
// o schema nativo do Cursor (`.cursor/hooks.json`), confirmado contra a documentação oficial:
// - cursor.com/docs/hooks (schema, `version`, `hooks.<evento>[]` com `command`/`matcher`/
//   `timeout`, lista de eventos suportados)
// - cursor.com/docs/reference/third-party-hooks (mapeamento de nomes de evento e de tool entre
//   Claude Code e Cursor)
// Ver wiki/Compatibilidade-Cursor.md, seção Hooks, para o achado completo (issue #284).
//
// Cobre só os eventos usados por hooks/hooks.json deste repositório hoje (YAGNI) — não é um
// tradutor genérico para qualquer hooks.json arbitrário de terceiros.

// cursor.com/docs/reference/third-party-hooks#hook-step-mapping — só os eventos que essa
// tabela documenta como suportados; eventos sem linha na tabela (ex.: WorktreeCreate, que nem
// existe no Claude Code como conceito de hook nativo do produto, só neste plugin) não têm
// equivalente e são reportados em `dropped`.
const EVENT_NAME_MAP = {
  PreToolUse: 'preToolUse',
  PostToolUse: 'postToolUse',
  UserPromptSubmit: 'beforeSubmitPrompt',
  Stop: 'stop',
  SubagentStop: 'subagentStop',
  SessionStart: 'sessionStart',
  SessionEnd: 'sessionEnd',
  PreCompact: 'preCompact',
};

// cursor.com/docs/reference/third-party-hooks#tool-name-mapping. Edit e Write mapeiam para o
// mesmo tool Cursor ("Write") — o Cursor não distingui edição em lugar de escrita nova.
const TOOL_NAME_MAP = {
  Bash: 'Shell',
  Read: 'Read',
  Write: 'Write',
  Edit: 'Write',
  Grep: 'Grep',
  Task: 'Task',
};

// Eventos cujo `matcher` do Claude Code filtra por NOME de tool — únicos onde o vocabulário de
// TOOL_NAME_MAP se aplica. Outros eventos com matcher (ex.: SubagentStop, que no Claude Code
// filtra por nome customizado de subagente) têm semântica diferente da do Cursor (que filtra
// por `subagent_type` fixo: generalPurpose/explore/shell) e não são traduzíveis — ver
// `translateHooksForCursor`.
const TOOL_MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

// Lista completa de eventos documentados em cursor.com/docs/hooks (Agent hooks + Tab hooks +
// App lifecycle hook) — usada por `validateCursorHooksSchema` para rejeitar nomes de evento
// inventados/não suportados, não só os que este tradutor emite.
const CURSOR_EVENT_NAMES = new Set([
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'subagentStart',
  'subagentStop',
  'beforeShellExecution',
  'afterShellExecution',
  'beforeMCPExecution',
  'afterMCPExecution',
  'beforeReadFile',
  'afterFileEdit',
  'beforeSubmitPrompt',
  'preCompact',
  'stop',
  'afterAgentResponse',
  'afterAgentThought',
  'beforeTabFileRead',
  'afterTabFileEdit',
  'workspaceOpen',
]);

/**
 * Traduz o `matcher` de PreToolUse/PostToolUse (nomes de tool do Claude Code, string "|"-
 * separated) para o vocabulário de tool do Cursor, removendo duplicatas geradas por tools que
 * colapsam no mesmo tool Cursor (Edit/Write -> Write). Tokens fora de TOOL_NAME_MAP passam
 * inalterados (ex.: um nome de tool MCP customizado).
 */
function translateToolMatcher(matcher) {
  const tokens = matcher.split('|').map((token) => TOOL_NAME_MAP[token] ?? token);
  return [...new Set(tokens)].join('|');
}

/** Achata uma entrada `{matcher?, hooks:[{type,command,timeout}]}` do Claude Code em uma ou mais entradas planas `{command,timeout?,matcher?}` do Cursor. */
function translateHookEntry(event, entry, canTranslateMatcher) {
  const matcher = entry.matcher;
  return (entry.hooks ?? []).map((inner) => {
    const translated = { command: inner.command };
    if (typeof inner.timeout === 'number') translated.timeout = inner.timeout;
    if (matcher && canTranslateMatcher) {
      translated.matcher = translateToolMatcher(matcher);
    }
    return translated;
  });
}

/**
 * Traduz `hooks/hooks.json` (formato Claude Code) para o schema nativo do Cursor
 * (`.cursor/hooks.json`). Retorna `{ hooks, dropped }`:
 * - `hooks`: objeto pronto para `JSON.stringify` em `.cursor/hooks.json` (com `version: 1`).
 * - `dropped`: eventos/matchers da fonte sem equivalente fiel no Cursor — nunca lançado como
 *   erro (perda de cobertura parcial não deve travar a instalação), mas sempre reportado para
 *   quem for decidir o que fazer com o gap (ver wiki/Compatibilidade-Cursor.md).
 */
function translateHooksForCursor(sourceHooksJson) {
  const sourceEvents = sourceHooksJson?.hooks ?? {};
  const translatedHooks = {};
  const dropped = [];

  for (const [event, entries] of Object.entries(sourceEvents)) {
    const cursorEvent = EVENT_NAME_MAP[event];
    if (!cursorEvent) {
      dropped.push({ event, reason: 'no-cursor-equivalent' });
      continue;
    }

    const canTranslateMatcher = TOOL_MATCHER_EVENTS.has(event);
    const hasUntranslatableMatcher = entries.some(
      (entry) => entry.matcher && !canTranslateMatcher,
    );
    if (hasUntranslatableMatcher) {
      dropped.push({ event, reason: 'matcher-not-translatable' });
    }

    translatedHooks[cursorEvent] = entries.flatMap((entry) =>
      translateHookEntry(event, entry, canTranslateMatcher),
    );
  }

  return { hooks: { version: 1, hooks: translatedHooks }, dropped };
}

/**
 * Validação mínima do `.cursor/hooks.json` gerado contra o schema documentado em
 * cursor.com/docs/hooks (nomes de evento válidos, `version` numérica, `command` obrigatório
 * por entrada). Não é um validador de JSON Schema genérico — cobre só os campos que este
 * tradutor emite e os erros mais prováveis de regressão (evento inventado, entrada sem
 * `command`), suficiente para o critério de aceite da issue #284 sem depender de uma lib
 * externa (este pacote não tem dependências — ver cli/package.json).
 */
function validateCursorHooksSchema(hooksJson) {
  const errors = [];

  if (typeof hooksJson?.version !== 'number') {
    errors.push('"version" ausente ou não-numérico — cursor.com/docs/hooks exige um inteiro positivo (ex.: 1)');
  }

  const hooks = hooksJson?.hooks;
  if (hooks && typeof hooks === 'object') {
    for (const [event, entries] of Object.entries(hooks)) {
      if (!CURSOR_EVENT_NAMES.has(event)) {
        errors.push(`evento "${event}" não está na lista documentada em cursor.com/docs/hooks`);
        continue;
      }
      for (const [index, entry] of (entries ?? []).entries()) {
        if (typeof entry?.command !== 'string' || entry.command.length === 0) {
          errors.push(`hooks.${event}[${index}] sem "command" (campo obrigatório)`);
        }
        if ('timeout' in entry && typeof entry.timeout !== 'number') {
          errors.push(`hooks.${event}[${index}].timeout precisa ser numérico`);
        }
        if ('matcher' in entry && typeof entry.matcher !== 'string') {
          errors.push(`hooks.${event}[${index}].matcher precisa ser string`);
        }
      }
    }
  } else {
    errors.push('"hooks" ausente ou não é um objeto');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  translateHooksForCursor,
  validateCursorHooksSchema,
  EVENT_NAME_MAP,
  TOOL_NAME_MAP,
  CURSOR_EVENT_NAMES,
};
