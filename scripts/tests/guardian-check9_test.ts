import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

// Exercita o snippet real documentado em skills/guardian/SKILL.md (Check 9), via o
// subcomando `architectural-risk` de vetor-checks.sh — não uma reimplementação em memória
// (issue #198, gap 6: o teste anterior testava uma função mock local que nunca rodava o
// snippet bash e por isso não pegou o bug de sintaxe corrigido no PR #197).

const SCRIPT = fileURLToPath(new URL("../vetor-checks.sh", import.meta.url));

async function git(args: string[], cwd: string): Promise<string> {
  const output = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  if (!output.success) {
    throw new Error(`git ${args.join(" ")} falhou: ${new TextDecoder().decode(output.stderr)}`);
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function runArchitecturalRisk(
  cwd: string,
  map = ".claude/vetor/module-test-map.md",
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command("bash", {
    args: [SCRIPT, "architectural-risk", map],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: output.success ? 0 : 1,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function makeRepoWithModuleMap(mapBody: string): Promise<string> {
  const repo = await Deno.realPath(await Deno.makeTempDir());
  await git(["init", "-q", "-b", "main"], repo);
  await git(["config", "user.email", "test@example.com"], repo);
  await git(["config", "user.name", "Test"], repo);
  await Deno.mkdir(`${repo}/.claude/vetor`, { recursive: true });
  await Deno.writeTextFile(`${repo}/.claude/vetor/module-test-map.md`, mapBody);
  await git(["add", "."], repo);
  await git(["commit", "-q", "-m", "init"], repo);
  return repo;
}

const MODULE_MAP = `# Module Test Map

## Detecção de módulo por arquivos alterados

| Prefixo do path | Módulo |
|-----------------|--------|
| \`lib/core/\` | \`core\` |
| \`lib/utils/\` | \`utils\` |
`;

Deno.test("architectural-risk: módulo tocado nos últimos 7 dias com fan-in > 10 é candidato", async () => {
  const repo = await makeRepoWithModuleMap(MODULE_MAP);
  try {
    await Deno.mkdir(`${repo}/lib/core`, { recursive: true });
    await Deno.writeTextFile(`${repo}/lib/core/auth.ts`, "export const auth = 1;\n");
    await git(["add", "."], repo);
    await git(["commit", "-q", "-m", "toca modulo core"], repo);

    // 12 arquivos importando o módulo "core" — acima do threshold de 10 (issue #181 item 4).
    await Deno.mkdir(`${repo}/consumers`, { recursive: true });
    for (let i = 0; i < 12; i++) {
      await Deno.writeTextFile(
        `${repo}/consumers/c${i}.ts`,
        `import { auth } from "../lib/core/auth";\n`,
      );
    }
    await git(["add", "."], repo);
    await git(["commit", "-q", "-m", "consumidores"], repo);

    const { code, stdout } = await runArchitecturalRisk(repo);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "core|12|yes");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("architectural-risk: módulo tocado com fan-in <= 10 não é candidato", async () => {
  const repo = await makeRepoWithModuleMap(MODULE_MAP);
  try {
    await Deno.mkdir(`${repo}/lib/utils`, { recursive: true });
    await Deno.writeTextFile(`${repo}/lib/utils/helper.ts`, "export const helper = 1;\n");
    await git(["add", "."], repo);
    await git(["commit", "-q", "-m", "toca modulo utils"], repo);

    await Deno.mkdir(`${repo}/consumers`, { recursive: true });
    await Deno.writeTextFile(
      `${repo}/consumers/c0.ts`,
      `import { helper } from "../lib/utils/helper";\n`,
    );
    await git(["add", "."], repo);
    await git(["commit", "-q", "-m", "um consumidor"], repo);

    const { code, stdout } = await runArchitecturalRisk(repo);
    assertEquals(code, 0);
    assertStringIncludes(stdout, "utils|1|no");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("architectural-risk: nenhum módulo tocado nos últimos 7 dias reporta vazio (skipped)", async () => {
  const repo = await makeRepoWithModuleMap(MODULE_MAP);
  try {
    const { code, stdout } = await runArchitecturalRisk(repo);
    assertEquals(code, 0);
    assertEquals(stdout.trim(), "");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});
