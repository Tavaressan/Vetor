'use strict';

const { install } = require('./commands/install.js');
const { makeStub } = require('./commands/stub.js');
const { printBanner } = require('./banner.js');

const COMMANDS = {
  install: { fn: install, description: 'Instala o Vetor no projeto atual' },
  update: { fn: makeStub('update'), description: '(stub) Atualiza a instalação existente' },
  status: { fn: makeStub('status'), description: '(stub) Mostra o status da instalação' },
  uninstall: { fn: makeStub('uninstall'), description: '(stub) Remove a instalação' },
};

function printHelp() {
  printBanner();
  console.info('Uso: vetor <comando>');
  console.info('');
  console.info('Comandos:');
  for (const [name, { description }] of Object.entries(COMMANDS)) {
    console.info(`  ${name.padEnd(12)} ${description}`);
  }
}

function run(argv) {
  const [command] = argv;

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const entry = COMMANDS[command];
  if (!entry) {
    console.error(`Comando desconhecido: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  entry.fn();
}

module.exports = { run, COMMANDS };
