'use strict';

const LOGO_LINES = [
  '██╗   ██╗███████╗████████╗ ██████╗ ██████╗',
  '██║   ██║██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗',
  '██║   ██║█████╗     ██║   ██║   ██║██████╔╝',
  '╚██╗ ██╔╝██╔══╝     ██║   ██║   ██║██╔══██╗',
  ' ╚████╔╝ ███████╗   ██║   ╚██████╔╝██║  ██║',
  '  ╚═══╝  ╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝',
];

const LOGO_COLOR = '\x1b[36m';
const RESET = '\x1b[0m';

// Só aplica cor quando stdout é um terminal e a convenção NO_COLOR
// (https://no-color.org/) não está definida. Isso evita poluir saídas
// redirecionadas para arquivo/pipe (CI, `vetor --help > log`).
function shouldUseColor() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function printBanner() {
  const useColor = shouldUseColor();

  for (const line of LOGO_LINES) {
    console.info(useColor ? `${LOGO_COLOR}${line}${RESET}` : line);
  }

  console.info('');
}

module.exports = {
  printBanner,
  LOGO_LINES,
};
