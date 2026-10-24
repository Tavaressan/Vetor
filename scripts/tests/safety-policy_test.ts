// Testes da política compartilhada (scripts/lib/safety-policy.ts) sem subprocesso: o worktree é
// um stub, então só as regras que dependem apenas do texto do comando são exercitadas aqui.
// A integração com cada hook (exit 2 no Claude Code, JSON no Antigravity) fica nos testes dos
// próprios hooks.

import { assertEquals, assertMatch } from "@std/assert";
import { evaluateShellCommand } from "../lib/safety-policy.ts";

const noWorktree = () => Promise.resolve(null);

async function assertDenied(command: string): Promise<void> {
  const result = await evaluateShellCommand(command, noWorktree);
  assertEquals(result.decision, "deny", `deveria bloquear: ${command}`);
  assertMatch((result as { reason: string }).reason, /Push to protected branches/);
}

async function assertAllowed(command: string): Promise<void> {
  const result = await evaluateShellCommand(command, noWorktree);
  assertEquals(result, { decision: "allow" }, `deveria liberar: ${command}`);
}

Deno.test("issue #488: flag depois do destino protegido é bloqueada", async () => {
  await assertDenied("git push origin main --force");
  await assertDenied("git push origin master -u");
  await assertDenied("git push origin production --force-with-lease");
});

Deno.test("issue #488: flag antes do destino protegido continua bloqueada", async () => {
  await assertDenied("git push --force origin main");
  await assertDenied("git push -u origin master");
});

Deno.test("issue #488: o destino de um refspec origem:destino é o lado direito", async () => {
  await assertDenied("git push origin HEAD:main --force");
  await assertDenied("git push origin HEAD:main");
  await assertDenied("git push origin :main");
  await assertAllowed("git push origin main:feature");
});

Deno.test("issue #488: o valor de uma flag em token separado não esconde o destino", async () => {
  await assertDenied("git push origin main -o ci.skip");
  await assertDenied("git push -o ci.skip origin main");
  await assertDenied("git push --push-option ci.skip origin main");
  await assertDenied("git push --repo https://example.com/r.git main");
});

Deno.test("issue #488: redirecionamento depois do destino não esconde o destino", async () => {
  await assertDenied("git push origin main --force 2>&1");
  await assertDenied("git push origin main --force > log.txt");
});

Deno.test("issue #488: qualquer refspec protegido bloqueia, não só o último", async () => {
  await assertDenied("git push origin main feature");
  await assertDenied("git push origin feature main");
});

Deno.test("issue #488: push de branch não protegida com flags continua liberado", async () => {
  await assertAllowed("git push origin feature --force");
  await assertAllowed("git push origin feature -u");
  await assertAllowed("git push -u origin feature");
  await assertAllowed("git push --force-with-lease origin feat/488-safety");
  await assertAllowed("git push origin feature -o ci.skip");
  await assertAllowed("git push origin feature");
  await assertAllowed("git push");
});

Deno.test("issue #488: branch protegida em outro comando do mesmo texto não bloqueia o push", async () => {
  await assertAllowed("git push origin feature --force && echo main");
  await assertAllowed("git push origin feature\ngit log main");
});
