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

function printBanner() {
  for (const line of BANNER_LINES) {
    console.info(`${CYAN}${line}${RESET}`);
  }
  console.info('');
}

module.exports = { printBanner, BANNER_LINES };
