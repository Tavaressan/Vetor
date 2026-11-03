// Prompt padronizado dos subagentes do coordinator (issue #545). Função pura: o CLI
// scripts/dispatch-prompt.ts resolve o I/O (gh, module-test-map, Repo Map) e passa tudo pronto.
// O contrato dos campos mora em skills/shared/references/issue-coordinator-dispatch.md.

export type DispatchRole = "worker" | "ship" | "review" | "fix";

export const DISPATCH_ROLES: readonly DispatchRole[] = ["worker", "ship", "review", "fix"];

export const DEFAULT_COMMIT_TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>";

export interface DispatchIssue {
  number: number;
  title: string;
  body: string;
  /** Issue spike: modo investigação (sem TDD, relatório em docs/investigations). */
  spike?: boolean;
  /** Micro-spec JIT já validada (issue #501), colada sob a issue Sequential. */
  microSpec?: string;
}

export interface DispatchPromptInput {
  role: DispatchRole;
  /** A primeira é a Lead; as demais são Sequential Issues. */
  issues: DispatchIssue[];
  branch: string;
  baseBranch: string;
  /** Status file absoluto no root do repo (Fase 3). */
  statusFile: string;
  /** Path real do worktree; obrigatório em ship e fix, opcional no worker. */
  worktreePath?: string;
  /** Saída de `renderContextPacketPrompt` para a Lead (só worker). */
  contextPacketPrompt?: string;
  /** Onda do DAG (1 = primeira). A partir da 2 o worker sincroniza com origin. */
  wave?: number;
  /** Comando de teste por módulo, injetado quando o module-test-map não está commitado. */
  testCommands?: Record<string, string>;
  /** Falhas de ambiente conhecidas que não contam como vermelho. */
  knownEnvFailures?: string[];
  commitTrailer?: string;
  /** Número da PR (só review). */
  pr?: number;
  /** Motivo do redispatch (só fix): por que o worker anterior parou. */
  reason?: string;
}

function issueBlock(issue: DispatchIssue, label: string): string {
  const lines = [
    `### ${label}: #${issue.number} — ${issue.title}`,
    "",
    issue.body.trim() || "(sem descrição)",
  ];
  if (issue.microSpec !== undefined) {
    lines.push(
      "",
      "Micro-spec JIT desta issue (grave em `docs/specs/micro/" + issue.number +
        "-<slug>.md` no seu worktree e faça disso um commit `docs(spec): micro-spec JIT (#" +
        issue.number + ")`):",
      "",
      issue.microSpec.trim(),
    );
  }
  return lines.join("\n");
}

function statusInstructions(statusFile: string): string {
  return [
    "## Status file",
    "",
    `Escreva o status file no path absoluto \`${statusFile}\` (formato em \`agent-status.template.md\`),`,
    "atualizado a cada iteração de cada issue (ex.: `Iteration: 2/5 (Issue #<M>)`). Se a plataforma",
    'rejeitar a escrita com mensagem como *"Edit the worktree copy..."* ou qualquer bloqueio de',
    "escrita fora do worktree, salve também uma cópia em `.claude/vetor-status.md` dentro do",
    "worktree e sinalize no chat.",
  ].join("\n");
}

function prohibitions(extra: string[] = []): string {
  return [
    "## Proibições",
    "",
    "- Nunca faça `git push`, `gh pr create`, `gh pr ready` nem `gh pr merge` (o ship faz a entrega",
    "  depois do `GREEN`); precisando disso, grave `BLOCKED_WAITING`.",
    "- Nunca chame `EnterPlanMode` e não crie nem remova worktrees.",
    ...extra.map((line) => `- ${line}`),
  ].join("\n");
}

function envFailures(failures: string[] | undefined): string[] {
  if (!failures || failures.length === 0) return [];
  return [
    "## Falhas de ambiente conhecidas (não contam como vermelho)",
    "",
    ...failures.map((failure) => `- ${failure}`),
    "",
    "Formate só os arquivos que você tocou; nunca rode o formatador na raiz do repositório.",
  ];
}

function workerPrompt(input: DispatchPromptInput): string {
  const [lead, ...sequential] = input.issues;
  const trailer = input.commitTrailer ?? DEFAULT_COMMIT_TRAILER;
  const spike = input.issues.some((issue) => issue.spike);
  const parts: string[] = [];

  if (input.contextPacketPrompt) parts.push(input.contextPacketPrompt);
  parts.push(issueBlock(lead, "Lead Issue"));
  for (const issue of sequential) parts.push(issueBlock(issue, "Issue Sequencial"));

  parts.push(
    [
      "## Branch e commits",
      "",
      `Crie a branch \`${input.branch}\` como primeiro passo no worktree (\`git checkout -b ${input.branch}\`).`,
      `Base: \`${input.baseBranch}\`. Commits em conventional commits, com \`Closes #<N>\` e o trailer:`,
      "",
      `    ${trailer}`,
    ].join("\n"),
  );

  parts.push(statusInstructions(input.statusFile));

  if ((input.wave ?? 1) >= 2) {
    parts.push(
      [
        "## Sincronização com origin (primeiro passo, logo após o `git checkout -b`)",
        "",
        `Antes de investigar o escopo, rode \`git fetch origin ${input.baseBranch}\` e compare com o seu`,
        `HEAD (\`git log origin/${input.baseBranch} -1\` vs \`git log HEAD -1\`). Se o worktree nasceu de`,
        "um commit anterior aos merges das ondas anteriores, sincronize agora " +
        `(\`git merge origin/${input.baseBranch}\` ou \`git rebase origin/${input.baseBranch}\`) ` +
        "antes de procurar arquivos.",
      ].join("\n"),
    );
  }

  if (input.testCommands && Object.keys(input.testCommands).length > 0) {
    parts.push(
      [
        "## Comandos de teste pré-resolvidos (module-test-map indisponível no worktree)",
        "",
        ...Object.entries(input.testCommands).map(([module, cmd]) => `- \`${module}\`: \`${cmd}\``),
      ].join("\n"),
    );
  }

  if (spike) {
    parts.push(
      [
        "## Modo investigação (spike)",
        "",
        "- Sem TDD e sem loop de testes de produto/código.",
        "- Entregável obrigatório: `docs/investigations/<slug>.md` com Pergunta, Evidências",
        "  (comandos/fontes reproduzíveis), Opções avaliadas e Recomendação.",
        "- `GREEN` quando o relatório existe e `git diff --check` passa sem erros.",
        "- A entrega segue o PR só de docs (#427); a decisão é humana e você não cria issues de follow-up.",
      ].join("\n"),
    );
  } else {
    parts.push(
      [
        "## Validação",
        "",
        "Siga TDD (teste de reprodução vermelho antes do código do produto) e KISS/YAGNI. Valide com o",
        "`testCommand` do pacote (e com o comando do `module-test-map` de cada módulo tocado nas issues",
        "sequenciais) até a suíte completa do módulo ficar verde, no orçamento de 5 iterações.",
      ].join("\n"),
    );
  }

  const failures = envFailures(input.knownEnvFailures);
  if (failures.length) parts.push(failures.join("\n"));
  parts.push(
    "Ao concluir todas as issues, marque `Status: GREEN`. Se uma falhar, pare e marque " +
      "`FAILED_MAX_ITERATIONS` dizendo qual issue falhou.",
  );
  parts.push(prohibitions());
  return parts.join("\n\n");
}

function shipPrompt(input: DispatchPromptInput): string {
  const [lead] = input.issues;
  return [
    `Path do worktree: ${input.worktreePath}.`,
    `Branch: ${input.branch}.`,
    `Issue: #${lead.number} — ${lead.title}.`,
    `Branch default: ${input.baseBranch}.`,
    `Status file: ${input.statusFile}.`,
    "",
    `Todo comando Bash começa com \`cd "${input.worktreePath}" &&\`. Rode \`/vetor:ship --prepare ${lead.number}\`,`,
    "mantenha `Status: GREEN` enquanto trabalha e grave `PR_STAGED` ao fim (com a ferramenta Write).",
    "Se a plataforma rejeitar a escrita fora do worktree, grave também `.claude/vetor-status.md` no worktree.",
    "",
    "## Proibições",
    "",
    "- Nunca faça merge (`gh pr merge`, `vetor-merge.sh`, `/vetor:ship --finalize`).",
    `- Nunca faça push para \`${input.baseBranch}\`; nunca use \`gh pr checks --watch\`.`,
    "- Não despache revisões: o coordinator as dispara a partir do PR aberto.",
  ].join("\n");
}

function reviewPrompt(input: DispatchPromptInput): string {
  const [lead] = input.issues;
  return [
    `Revise a PR #${input.pr} (issue #${lead.number} — ${lead.title}).`,
    `Branch: ${input.branch}. Base de comparação: ${input.baseBranch}.`,
    `Status file do worker (consulta): ${input.statusFile}.`,
    "",
    "Obtenha o diff com `gh pr diff` e publique os achados como comentário na PR com `--body-file`",
    "(corpo gravado com a ferramenta Write). A revisão é consultiva.",
    "",
    "## Proibições",
    "",
    "- Nunca bloqueie nem reverta o merge; nunca faça push, `gh pr ready` ou `gh pr merge`.",
    "- Não edite o código da PR nem o status file.",
  ].join("\n");
}

function fixPrompt(input: DispatchPromptInput): string {
  const [lead, ...sequential] = input.issues;
  const parts = [
    `Entre no diretório ${input.worktreePath} (\`cd\` explícito em todo comando Bash) e retome o ` +
    `trabalho da branch \`${input.branch}\` usando a skill \`fix\`.`,
    "",
    issueBlock(lead, "Lead Issue"),
    ...sequential.map((issue) => issueBlock(issue, "Issue Sequencial")),
  ];
  if (input.reason) parts.push("", `Motivo do redispatch: ${input.reason}`);
  parts.push(
    "",
    statusInstructions(input.statusFile),
    "",
    `Commits em conventional commits com o trailer \`${
      input.commitTrailer ?? DEFAULT_COMMIT_TRAILER
    }\`.`,
  );
  const envLines = envFailures(input.knownEnvFailures);
  if (envLines.length) parts.push("", envLines.join("\n"));
  parts.push("", prohibitions());
  return parts.join("\n");
}

export function buildDispatchPrompt(input: DispatchPromptInput): string {
  if (input.issues.length === 0) throw new Error("informe ao menos uma issue");
  if (
    (input.role === "ship" || input.role === "fix") && !input.worktreePath
  ) {
    throw new Error(`--worktree é obrigatório no papel ${input.role}`);
  }
  if (input.role === "review" && input.pr === undefined) {
    throw new Error("--pr é obrigatório no papel review");
  }
  switch (input.role) {
    case "worker":
      return workerPrompt(input);
    case "ship":
      return shipPrompt(input);
    case "review":
      return reviewPrompt(input);
    case "fix":
      return fixPrompt(input);
  }
}
