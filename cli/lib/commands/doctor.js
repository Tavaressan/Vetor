'use strict';

const { spawnSync: defaultSpawnSync } = require('node:child_process');
const { commandExists: defaultCommandExists } = require('../installer/command-exists.js');
const { detectEngines: defaultDetectEngines } = require('../installer/detector.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function checkOpenCodeGlobal(options) {
  const home = options.homedir ?? os.homedir();
  const root = path.join(home, '.opencode');
  const found = [];
  for (const directory of ['agent', 'agents']) {
    for (const file of ['issue-coordinator.md', 'issue-worker.md', 'code-review.md']) {
      const candidate = path.join(root, directory, file);
      if (fs.existsSync(candidate)) found.push(candidate);
    }
  }
  for (const directory of ['plugin', 'plugins']) {
    const candidate = path.join(root, directory, 'vetor.ts');
    if (fs.existsSync(candidate)) found.push(candidate);
  }
  return found.length
    ? {
      name: 'OpenCode global',
      ok: false,
      hint: `Encontrado(s): ${found.join(', ')}. Cópias do Vetor em ~/.opencode sobrepõem agentes do projeto e carregam um segundo plugin vetor.ts no OpenCode; mova ou remova esses arquivos.`,
      required: false,
    }
    : { name: 'OpenCode global', ok: true, hint: 'sem cópias do Vetor em ~/.opencode', required: false };
}

async function checkAiMemory(cwd, options) {
  let config;
  try {
    config = JSON.parse((options.readFileSync ?? fs.readFileSync)(`${cwd}/.mcp.json`, 'utf8'));
  } catch {
    return { name: 'ai-memory MCP', ok: false, hint: 'não configurado', required: false };
  }
  const server = config?.mcpServers?.['ai-memory'];
  if (!server || server.type !== 'http' || typeof server.url !== 'string') {
    return { name: 'ai-memory MCP', ok: false, hint: 'não configurado', required: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.aiMemoryTimeoutMs ?? 2000);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vetor-doctor', version: '1.0.0' } } }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('HTTP indisponível');
    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();
    let reply;
    if (contentType.includes('text/event-stream')) {
      const data = body.split(/\r?\n/).find((line) => line.startsWith('data:'));
      if (data) reply = JSON.parse(data.slice(5).trim());
    } else if (body.trim()) {
      reply = JSON.parse(body);
    }
    if (reply?.error || (reply && reply.id !== 1)) throw new Error('Resposta MCP inválida');
    return { name: 'ai-memory MCP', ok: true, hint: 'conectado', required: false };
  } catch {
    return { name: 'ai-memory MCP', ok: false, hint: 'indisponível', required: false };
  } finally {
    clearTimeout(timer);
  }
}

async function doctor(cwd = process.cwd(), options = {}) {
  const spawnSync = options.spawnSync ?? defaultSpawnSync;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const detectEngines = options.detectEngines ?? defaultDetectEngines;
  const checks = [
    {
      name: 'Deno',
      ok: commandExists('deno'),
      hint: 'Instale o Deno e adicione-o ao PATH.',
      required: true,
    },
  ];

  let ghResult;
  try {
    ghResult = spawnSync('gh', ['auth', 'status'], { cwd, encoding: 'utf8', shell: false });
  } catch {
    ghResult = { status: 1 };
  }
  checks.push({
    name: 'gh autenticado',
    ok: ghResult.status === 0,
    hint: 'Execute "gh auth login" para autenticar o GitHub CLI.',
    required: true,
  });

  checks.push(await checkAiMemory(cwd, options));
  checks.push(checkOpenCodeGlobal(options));

  let gitResult;
  try {
    gitResult = spawnSync('git', ['worktree', '-h'], { cwd, encoding: 'utf8', shell: false });
  } catch {
    gitResult = { status: 1 };
  }
  checks.push({
    name: 'Git worktree',
    ok: /git worktree add/i.test(`${gitResult.stdout ?? ''}\n${gitResult.stderr ?? ''}`),
    hint: 'Instale uma versão do Git com suporte a "git worktree".',
    required: true,
  });

  const engines = detectEngines(cwd);
  const detected = engines.filter((engine) => engine.detected).map((engine) => engine.name);
  checks.push({
    name: 'Engines',
    ok: detected.length > 0,
    hint: detected.length > 0 ? `Detectadas: ${detected.join(', ')}.` : 'Nenhuma engine detectada (informativo).',
    required: false,
  });

  for (const check of checks) {
    const label = check.ok ? '[ok]' : (check.required ? '[falha]' : '[info]');
    console.info(`${label} ${check.name}${check.ok && check.required ? '' : ` — ${check.hint}`}`);
  }
  if (checks.some((check) => check.required && !check.ok)) process.exitCode = 1;
}

module.exports = { doctor };
