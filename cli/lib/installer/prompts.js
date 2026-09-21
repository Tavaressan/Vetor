'use strict';

const readline = require('node:readline');

/**
 * Deriva o estado inicial do checkbox a partir da detecção: engine detectada nasce
 * pré-marcada, não detectada nasce desmarcada. Função pura — o usuário ainda pode alterar
 * cada item na interação; a detecção é só sugestão inicial, nunca decide a instalação sozinha.
 */
function buildEngineChoices(engines) {
  return engines.map((engine) => ({ ...engine, checked: engine.detected }));
}

function renderChoices(choices) {
  return choices
    .map((choice, index) => {
      const box = choice.checked ? '[x]' : '[ ]';
      const suffix = choice.detected ? ' (detectada)' : '';
      return `  ${index + 1}. ${box} ${choice.name}${suffix}`;
    })
    .join('\n');
}

/**
 * Prompt interativo de seleção de engines: checkbox por número (sem dependência externa),
 * engines detectadas pré-marcadas. Usuário digita números para alternar marcação e confirma
 * com Enter (linha vazia) — exige ao menos uma engine marcada para aceitar a confirmação.
 *
 * Em sessão não-interativa (sem TTY) não há como obter confirmação explícita do usuário:
 * imprime a detecção e resolve com seleção vazia, sem marcar nenhuma engine por padrão.
 */
function runInstallPrompts(
  engines,
  { input = process.stdin, output = process.stdout, isTTY } = {},
) {
  const choices = buildEngineChoices(engines);
  const interactive = isTTY ?? input.isTTY ?? false;

  output.write('Engines detectadas:\n');
  output.write(renderChoices(choices) + '\n');

  if (!interactive) {
    output.write(
      '\nSessão não-interativa: nenhuma engine selecionada automaticamente ' +
        '(confirmação explícita é obrigatória).\n',
    );
    return Promise.resolve([]);
  }

  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    function prompt() {
      rl.question(
        '\nDigite números para marcar/desmarcar (ex.: 1,3), Enter para confirmar, ' +
          '"q" para cancelar: ',
        (answer) => {
          const trimmed = answer.trim();

          if (trimmed.toLowerCase() === 'q') {
            rl.close();
            resolve([]);
            return;
          }

          if (trimmed === '') {
            const selected = choices.filter((choice) => choice.checked);
            if (selected.length === 0) {
              output.write('Selecione pelo menos uma engine antes de confirmar.\n');
              prompt();
              return;
            }
            rl.close();
            resolve(selected);
            return;
          }

          const indexes = trimmed
            .split(',')
            .map((part) => Number.parseInt(part.trim(), 10) - 1)
            .filter((index) => Number.isInteger(index) && index >= 0 && index < choices.length);

          for (const index of indexes) {
            choices[index].checked = !choices[index].checked;
          }

          output.write('\n' + renderChoices(choices) + '\n');
          prompt();
        },
      );
    }

    prompt();
  });
}

module.exports = { buildEngineChoices, runInstallPrompts };
