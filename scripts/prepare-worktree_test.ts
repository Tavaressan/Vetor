import { assert, assertStringIncludes } from "@std/assert";
import { prepareDeps } from "./prepare-worktree.ts";
import { prepareFailedMarkerPath } from "./lib/status.ts";

Deno.test("prepareDeps grava marcador quando npm ci falha (sem package-lock.json)", async () => {
  const sourceDir = await Deno.makeTempDir();
  const worktreePath = await Deno.makeTempDir();

  try {
    // package.json sem package-lock.json: `npm ci` falha de imediato, sem rede.
    await Deno.writeTextFile(`${sourceDir}/package.json`, JSON.stringify({ name: "fixture" }));

    await prepareDeps(worktreePath, sourceDir);

    const marker = await Deno.readTextFile(prepareFailedMarkerPath(worktreePath));
    assertStringIncludes(marker, "npm install falhou no worktree");
  } finally {
    await Deno.remove(sourceDir, { recursive: true });
    await Deno.remove(worktreePath, { recursive: true });
  }
});

Deno.test("prepareDeps não grava marcador quando não há instalação necessária", async () => {
  const sourceDir = await Deno.makeTempDir();
  const worktreePath = await Deno.makeTempDir();

  try {
    await Deno.writeTextFile(`${sourceDir}/deno.json`, "{}");

    await prepareDeps(worktreePath, sourceDir);

    let markerExists = true;
    try {
      await Deno.stat(prepareFailedMarkerPath(worktreePath));
    } catch {
      markerExists = false;
    }
    assert(!markerExists);
  } finally {
    await Deno.remove(sourceDir, { recursive: true });
    await Deno.remove(worktreePath, { recursive: true });
  }
});
