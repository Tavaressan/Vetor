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

function runNumberPrompt(choices, input, output) {
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

function runKeypressPrompt(choices, input, output) {
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  let cursor = 0;
  let active = true;
  let drawnLines = 0;

  function draw(message = '') {
    if (drawnLines > 0) output.write(`\u001b[${drawnLines}A\r\u001b[J`);
    const lines = choices.map((choice, index) => {
      const marker = index === cursor ? '❯' : ' ';
      const box = choice.checked ? '[x]' : '[ ]';
      const suffix = choice.detected ? ' (detectada)' : '';
      return `${marker} ${index + 1}. ${box} ${choice.name}${suffix}`;
    });
    if (message) lines.unshift(message);
    lines.push('', '↑/↓ navega, espaço alterna, Enter confirma, q/Esc cancela');
    drawnLines = lines.length;
    output.write(`${lines.join('\n')}\n`);
  }

  function cleanup(selected) {
    if (!active) return;
    active = false;
    input.removeListener('keypress', onKeypress);
    input.setRawMode(false);
    output.write('\n');
    resolvePromise(selected);
  }

  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  function onKeypress(sequence, key = {}) {
    if (!active) return;
    if (
      (key.name === 'c' && key.ctrl) || sequence === '\u0003' || key.name === 'escape' ||
      sequence === 'q' || key.name === 'q'
    ) {
      cleanup([]);
      return;
    }
    if (key.name === 'up' || sequence === '\u001b[A') cursor = Math.max(0, cursor - 1);
    else if (key.name === 'down' || sequence === '\u001b[B') cursor = Math.min(choices.length - 1, cursor + 1);
    else if (key.name === 'space' || sequence === ' ') choices[cursor].checked = !choices[cursor].checked;
    else if (key.name === 'return' || key.name === 'enter' || sequence === '\r' || sequence === '\n') {
      const selected = choices.filter((choice) => choice.checked);
      if (selected.length) cleanup(selected);
      else draw('Selecione pelo menos uma engine antes de confirmar.');
      return;
    } else return;
    draw();
  }
  input.on('keypress', onKeypress);
  draw();
  return promise;
}

/**
 * Prompt de seleção com navegação por setas e alternância por espaço quando há setRawMode.
 * Sem setRawMode, usa o fallback por números digitados; ambos exigem uma engine marcada.
 * Em sessão não-interativa, imprime as engines detectadas e resolve com seleção vazia, pois
 * não h? confirmação expl?cita do usuário.
 */
function runInstallPrompts(
  engines,
  { input = process.stdin, output = process.stdout, isTTY } = {},
) {
  const choices = buildEngineChoices(engines);
  const interactive = isTTY ?? input.isTTY ?? false;
  output.write('Selecione as engines para instalar:\n');
  if (!interactive) {
    output.write(renderChoices(choices) + '\n');
    output.write('\nSessão não-interativa: nenhuma engine selecionada automaticamente ' +
      '(confirmação explícita é obrigatória).\n');
    return Promise.resolve([]);
  }
  if (typeof input.setRawMode === 'function') return runKeypressPrompt(choices, input, output);
  output.write(renderChoices(choices) + '\n');
  return runNumberPrompt(choices, input, output);
}

module.exports = { buildEngineChoices, runInstallPrompts };
