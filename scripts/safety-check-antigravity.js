#!/usr/bin/env node
"use strict";

/**
 * Safety gate do Vetor para o Google Antigravity (hook PreToolUse, matcher run_command).
 *
 * Contrato do Antigravity (antigravity.google/docs/plugins, hooks.json):
 * - Recebe o contexto em JSON no stdin:
 *   {
 *     "toolCall": {
 *       "name": "run_command",
 *       "args": { "CommandLine": "..." }
 *     },
 *     ...
 *   }
 * - Emite o resultado em JSON no stdout:
 *   { "decision": "allow" }
 *   ou
 *   { "decision": "deny", "reason": "..." }
 *
 * Executa em Node.js de forma 100% multiplataforma (Windows com cmd /c ou powershell,
 * macOS e Linux com sh -c), garantindo resiliência contra exceções e latência mínima (<150ms).
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROTECTED_BRANCHES = ["main", "master", "production"];

const DESTRUCTIVE_GIT_COMMAND_RE =
  /(?:^|&&|\|\||;|\|)\s*(git\s+reset\s+--hard\S*|git\s+clean\s+-[a-z]*f[a-z]*|git\s+branch\s+-D\S*|git\s+checkout\s+\.(?=\s|$))/;

const WORKER_GATE_COMMAND_RE = /(?:^|&&|\|\||;|\|)\s*(git push|gh pr (?:create|ready|merge))/;

function allow() {
  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ decision: "deny", reason }) + "\n");
  process.exit(0);
}

/** Extrai a branch de destino de um `git push [flags] [remote] <branch>[:<remote-branch>]`. */
function pushDestination(command) {
  const joined = command.replace(/\\\r?\n/g, " ");
  const push = joined.match(/git push[^&|;\n]*/)?.[0];
  if (!push) return null;

  const parts = push.trim().split(/\s+/);
  let last = parts.pop();
  while (last && last.startsWith("-")) {
    last = parts.pop();
  }
  if (!last || last === "push" || last === "git") return null;
  return last.split(":")[0];
}

function readStatusFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/^Status:\s*([^\r\n]+)/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function checkWorkerGate(command, cwd) {
  if (!command.match(WORKER_GATE_COMMAND_RE)) return;

  try {
    const execOpts = {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
      env: { ...process.env, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL || "NUL" },
    };
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], execOpts).trim();
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], execOpts).trim();

    if (gitDir && commonDir && path.resolve(cwd, gitDir) !== path.resolve(cwd, commonDir)) {
      // Estamos dentro de um worktree linkado
      const branch = execFileSync("git", ["branch", "--show-current"], execOpts).trim();
      const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], execOpts).trim();
      const root = path.dirname(path.resolve(cwd, commonDir));

      const branchSlug = branch.replace(/\//g, "-");
      const rootStatusFile = path.join(root, ".claude", "vetor", "status", `${branchSlug}.md`);
      const localStatusFile = path.join(toplevel, ".claude", "vetor-status.md");

      let status = readStatusFile(rootStatusFile);
      if (status !== "GREEN" && fs.existsSync(localStatusFile)) {
        const localStatus = readStatusFile(localStatusFile);
        if (localStatus === "GREEN") {
          status = "GREEN";
        } else if (!status && localStatus) {
          status = localStatus;
        }
      }

      if (branch && status && status !== "GREEN") {
        deny(
          `ERROR: worker não-GREEN (Status: ${status}) — push/PR bloqueado pelo Vetor Safety Hook.\n` +
            "Registre BLOCKED_WAITING no status file se precisar de intervenção; o ship faz a entrega após GREEN.",
        );
      }
    }
  } catch (err) {
    // Se a consulta git falhar por timeout ou outro erro, registra no stderr e não bloqueia
    console.error("[vetor-safety-hook] Falha ao verificar worktree:", err.message);
  }
}

function checkDestructiveGit(command) {
  const joined = command.replace(/\\\r?\n/g, " ");
  const match = joined.match(DESTRUCTIVE_GIT_COMMAND_RE);
  if (!match) return;

  deny(
    `ERROR: comando git destrutivo bloqueado incondicionalmente pelo Vetor Safety Hook: "${
      match[1].trim()
    }"\n` +
      "git reset --hard / git clean -f* / git branch -D / git checkout . descartam trabalho local sem chance de recuperação — não são permitidos em nenhum contexto.",
  );
}

function checkProtectedBranches(command) {
  const dest = pushDestination(command);
  if (dest && PROTECTED_BRANCHES.includes(dest)) {
    deny(
      "ERROR: Push to protected branches (main, master, production) is prohibited by Vetor Safety Hook.",
    );
  }
}

function main() {
  let raw = "";
  try {
    if (!process.stdin.isTTY) {
      raw = fs.readFileSync(0, "utf8");
    }
  } catch (err) {
    console.error("[vetor-safety-hook] Aviso ao ler stdin:", err.message);
  }

  let input = {};
  if (raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch (err) {
      console.error("[vetor-safety-hook] JSON inválido recebido no stdin:", err.message);
      // Entrada ilegível não deve travar a execução do agente
      allow();
    }
  }

  // Antigravity expõe toolCall.args.CommandLine para run_command.
  // Suporta também fallbacks de payloads de outros hooks e argv para testes.
  let command = input?.toolCall?.args?.CommandLine ??
    input?.toolCall?.args?.command ??
    input?.tool_input?.command ??
    input?.command;

  if (!command && process.argv.length > 2) {
    command = process.argv.slice(2).join(" ");
  }

  if (Array.isArray(command)) {
    command = command.at(-1);
  }

  if (typeof command !== "string" || !command.trim()) {
    allow();
  }

  const cwd = input?.cwd ?? process.cwd();

  // 1. Bloqueia comandos destrutivos incondicionalmente
  checkDestructiveGit(command);

  // 2. Bloqueia push para branches protegidas
  checkProtectedBranches(command);

  // 3. Bloqueia push/PR de worker não-GREEN em worktree linkado
  checkWorkerGate(command, cwd);

  // Se passou em todas as regras, autoriza a execução
  allow();
}

try {
  main();
} catch (err) {
  console.error("[vetor-safety-hook] Erro inesperado capturado:", err);
  allow();
}
