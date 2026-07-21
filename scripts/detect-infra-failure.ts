// Detecção de falhas de infraestrutura da plataforma CI (billing, outage, job not started).
//
// Uso: detect-infra-failure.ts <run-id>
//
// Consulta as anotações dos jobs de um run do GitHub Actions via `gh run view --json jobs`
// e identifica padrões de falha de infraestrutura que não são resolvidos por fix de código.
//
// Exit 0 + JSON stdout se falha de infraestrutura detectada:
//   {"isInfrastructureFailure": true, "reason": "<motivo resumido>", "annotations": [...]}
// Exit 1 + JSON stdout se NÃO é falha de infraestrutura (falha de código ou outro):
//   {"isInfrastructureFailure": false}
// Exit 2 se houve erro no comando (ex.: run não encontrado, gh CLI ausente).

const INFRA_PATTERNS = [
  /job.*not.*started/i,
  /spending.*limit/i,
  /billing/i,
  /outage/i,
  /account.*payment/i,
  /payment.*fail/i,
  /runner.*unavailable/i,
  /resource.*unavailable/i,
  /workflow.*unavailable/i,
];

interface JobAnnotation {
  name: string;
  message: string;
}

interface GhRunJob {
  name: string;
  annotations: { message: string; level: string }[];
}

interface GhRunOutput {
  jobs: GhRunJob[];
}

function matchesInfrastructureFailure(annotations: JobAnnotation[]): string | null {
  for (const { name, message } of annotations) {
    for (const pattern of INFRA_PATTERNS) {
      if (pattern.test(message)) {
        return `[${name}] ${message}`;
      }
    }
  }
  return null;
}

async function main() {
  const runId = Deno.args[0];
  if (!runId) {
    console.error("Uso: detect-infra-failure.ts <run-id>");
    Deno.exit(2);
  }

  let output: string;
  try {
    const cmd = new Deno.Command("gh", {
      args: ["run", "view", runId, "--json", "jobs"],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      console.error(`[detect-infra-failure] gh run view falhou: ${stderr}`);
      Deno.exit(2);
    }
    output = new TextDecoder().decode(result.stdout);
  } catch (err) {
    console.error(`[detect-infra-failure] Erro ao executar gh: ${err}`);
    Deno.exit(2);
  }

  let run: GhRunOutput;
  try {
    run = JSON.parse(output);
  } catch {
    console.error("[detect-infra-failure] Resposta do gh não é JSON válido");
    Deno.exit(2);
  }

  const allAnnotations: JobAnnotation[] = [];
  for (const job of run.jobs ?? []) {
    for (const ann of job.annotations ?? []) {
      allAnnotations.push({ name: job.name, message: ann.message });
    }
  }

  const match = matchesInfrastructureFailure(allAnnotations);
  if (match) {
    const result = {
      isInfrastructureFailure: true,
      reason: match,
      annotations: allAnnotations,
    };
    console.log(JSON.stringify(result, null, 2));
    Deno.exit(0);
  }

  console.log(JSON.stringify({ isInfrastructureFailure: false }));
  Deno.exit(1);
}

await main();
