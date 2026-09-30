'use strict';

const { install } = require('./commands/install.js');
const { update } = require('./commands/update.js');
const { status } = require('./commands/status.js');
const { uninstall } = require('./commands/uninstall.js');
const { printBanner } = require('./banner.js');
const { version } = require('../package.json');

const COMMANDS = {
  install: { fn: install, description: 'Instala o Vetor no projeto atual', flags: {} },
  update: { fn: update, description: 'Atualiza a instalação existente a partir do manifesto', flags: {} },
  status: { fn: status, description: 'Mostra o status da instalação por engine', flags: {} },
  uninstall: { fn: uninstall, description: 'Remove os arquivos instalados pelo Vetor', flags: {} },
};

function toCamelCase(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function normalizeFlags(flags = {}) {
  const map = new Map();
  for (const [rawKey, rawDef] of Object.entries(flags)) {
    const def = typeof rawDef === 'string' ? { description: rawDef } : (rawDef || {});
    const cleanName = rawKey.replace(/^--?/, '');
    const longFlag = `--${cleanName}`;
    const shortFlag = def.short || def.alias;
    const prop = def.property || toCamelCase(cleanName);
    const type = def.type || 'boolean';
    const description = def.description || '';

    const entry = {
      name: cleanName,
      longFlag,
      shortFlag,
      prop,
      type,
      description,
    };

    map.set(longFlag, entry);
    if (shortFlag) {
      map.set(shortFlag, entry);
    }
  }
  return map;
}

function printHelp() {
  printBanner();
  console.info('Uso: vetor <comando>');
  console.info('');
  console.info('Comandos:');
  for (const [name, { description }] of Object.entries(COMMANDS)) {
    console.info(`  ${name.padEnd(12)} ${description}`);
  }
  console.info('');
  console.info('Opções:');
  console.info('  -h, --help       Mostra esta mensagem de ajuda');
  console.info('  -v, --version    Mostra a versão instalada');
}

function printCommandHelp(name, entry) {
  printBanner();
  console.info(`Uso: vetor ${name} [opções]`);
  console.info('');
  console.info(entry.description);
  console.info('');
  console.info('Opções:');
  console.info('  -h, --help    Mostra esta mensagem de ajuda');
  if (entry.flags && Object.keys(entry.flags).length > 0) {
    const map = normalizeFlags(entry.flags);
    const seen = new Set();
    for (const flag of map.values()) {
      if (seen.has(flag.name)) continue;
      seen.add(flag.name);
      const flagLabel = flag.shortFlag
        ? `${flag.shortFlag}, ${flag.longFlag}`
        : `    ${flag.longFlag}`;
      console.info(`  ${flagLabel.padEnd(14)} ${flag.description}`);
    }
  }
}

function parseCommandArgs(command, entry, rawArgs) {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    return { showHelp: true };
  }

  const map = normalizeFlags(entry.flags || {});
  const options = {};

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (!arg.startsWith('-')) {
      return { error: `Argumento não reconhecido: ${arg}` };
    }

    let flagKey = arg;
    let inlineValue;

    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      flagKey = arg.slice(0, eqIdx);
      inlineValue = arg.slice(eqIdx + 1);
    }

    const flagDef = map.get(flagKey);
    if (!flagDef) {
      return { error: `Opção desconhecida: ${arg}` };
    }

    if (flagDef.type === 'boolean') {
      const val = inlineValue !== undefined ? inlineValue !== 'false' : true;
      options[flagDef.prop] = val;
      options[flagDef.name] = val;
    } else {
      let val;
      if (inlineValue !== undefined) {
        val = inlineValue;
      } else if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
        i++;
        val = rawArgs[i];
      } else {
        return { error: `Opção ${flagKey} requer um valor` };
      }
      options[flagDef.prop] = val;
      options[flagDef.name] = val;
    }
  }

  return { options };
}

function run(argv, callerOptions = {}) {
  const [command, ...args] = argv;

  if (command === '--version' || command === '-v') {
    console.log(version);
    return;
  }

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const entry = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!entry) {
    console.error(`Comando desconhecido: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  const parsed = parseCommandArgs(command, entry, args);
  if (parsed.showHelp) {
    printCommandHelp(command, entry);
    return;
  }

  if (parsed.error) {
    console.error(parsed.error);
    printCommandHelp(command, entry);
    process.exitCode = 1;
    return;
  }

  const finalOptions = { ...callerOptions, ...parsed.options };
  const cwd = finalOptions.cwd ?? process.cwd();

  // Comandos podem ser assíncronos (ex.: install, com prompt interativo) — aguarda a
  // promise, se houver, e reporta rejeição sem deixá-la solta (unhandled rejection).
  try {
    return Promise.resolve(entry.fn(cwd, finalOptions)).catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

module.exports = { run, COMMANDS };
