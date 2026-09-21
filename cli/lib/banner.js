'use strict';

// Banner ASCII estático — linhas hardcoded, sem dependência nova (ex.: figlet),
// mesmo padrão do banner.js do reversa (referência empírica da issue #253).
const BANNER_LINES = [
  '█   █  █████  █████   ███   ████',
  '█   █  █        █    █   █  █   █',
  '█   █  ████     █    █   █  ████',
  ' █ █   █        █    █   █  █  █',
  '  █    █████    █     ███   █   █',
];

const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

// Só aplica cor quando stdout é um terminal e a convenção NO_COLOR (https://no-color.org/) não
// está definida — evita poluir saída redirecionada para arquivo/pipe (CI, `vetor --help > log`).
function shouldUseColor() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function printBanner() {
  const useColor = shouldUseColor();
  for (const line of BANNER_LINES) {
    console.info(useColor ? `${CYAN}${line}${RESET}` : line);
  }
  console.info('');
}

module.exports = { printBanner, BANNER_LINES };
