import { assertEquals } from "@std/assert";
import type { HarnessDescriptor } from "../lib/capabilities/types.ts";
import { discover, type Probe, type VersionProbe } from "../lib/capabilities/discovery.ts";

function cliDescriptor(
  overrides: Partial<HarnessDescriptor> = {},
): HarnessDescriptor {
  return {
    descriptorVersion: 1,
    id: "demo-cli",
    kind: "cli",
    command: "demo",
    declared: {
      terminal: { state: "supported", source: "perfil.ts:1" },
      filesystem: { state: "supported", source: "perfil.ts:2" },
      git: { state: "supported", source: "perfil.ts:3" },
      mcp: { state: "supported", source: "perfil.ts:4" },
      browser: { state: "unknown", source: "perfil.ts:5" },
    },
    ...overrides,
  };
}

function fakeProbe(map: Record<string, string | undefined>): Probe {
  const calls: string[] = [];
  return {
    resolveExecutable(name: string): string | undefined {
      calls.push(name);
      return map[name];
    },
  };
}

function fakeProbeWithCalls(map: Record<string, string | undefined>) {
  const calls: string[] = [];
  const probe: Probe = {
    resolveExecutable(name: string): string | undefined {
      calls.push(name);
      return map[name];
    },
  };
  return { probe, calls };
}

Deno.test("descoberta passiva marca installed e promove núcleo declarado como supported", () => {
  const probe = fakeProbe({ demo: "/usr/bin/demo" });
  const obs = discover(cliDescriptor(), probe, { now: () => "2026-11-12T10:00:00.000Z" });

  assertEquals(obs.executorId, "demo-cli");
  assertEquals(obs.observedAt, "2026-11-12T10:00:00.000Z");
  assertEquals(obs.installed, true);
  assertEquals(obs.sideEffects, "none");
  assertEquals(obs.version, undefined);
  assertEquals(obs.capabilities.terminal, {
    state: "supported",
    level: "verified",
    source: "núcleo + executável resolvido",
  });
  assertEquals(obs.capabilities.filesystem, {
    state: "supported",
    level: "verified",
    source: "núcleo + executável resolvido",
  });
  assertEquals(obs.capabilities.git, {
    state: "supported",
    level: "verified",
    source: "núcleo + executável resolvido",
  });
  // capacidades fora do núcleo não são promovidas passivamente
  assertEquals(obs.capabilities.mcp, undefined);
  assertEquals(obs.capabilities.browser, undefined);
});

Deno.test("descoberta passiva não promove núcleo quando executável não está no PATH", () => {
  const probe = fakeProbe({});
  const obs = discover(cliDescriptor(), probe, { now: () => "2026-11-12T10:00:00.000Z" });

  assertEquals(obs.installed, false);
  assertEquals(obs.sideEffects, "none");
  assertEquals(obs.capabilities, {});
});

Deno.test("descoberta passiva não promove núcleo declarado como não suportado ou unknown", () => {
  const probe = fakeProbe({ demo: "/usr/bin/demo" });
  const desc = cliDescriptor({
    declared: {
      terminal: { state: "unsupported", source: "perfil.ts:1" },
      filesystem: { state: "unknown", source: "perfil.ts:2" },
      git: { state: "supported", source: "perfil.ts:3" },
    },
  });
  const obs = discover(desc, probe, { now: () => "2026-11-12T10:00:00.000Z" });

  assertEquals(obs.installed, true);
  assertEquals(obs.capabilities.terminal, undefined);
  assertEquals(obs.capabilities.filesystem, undefined);
  assertEquals(obs.capabilities.git, {
    state: "supported",
    level: "verified",
    source: "núcleo + executável resolvido",
  });
});

Deno.test("descoberta passiva não roda sonda de versão e não tem efeitos colaterais", () => {
  let versionCalls = 0;
  const versionProbe: VersionProbe = {
    probeVersion(_command: string): string | undefined {
      versionCalls++;
      return "1.2.3";
    },
  };
  const probe = fakeProbe({ demo: "/usr/bin/demo" });
  const obs = discover(cliDescriptor(), probe, { now: () => "2026-11-12T10:00:00.000Z" });

  assertEquals(versionCalls, 0);
  assertEquals(obs.sideEffects, "none");
  assertEquals(obs.version, undefined);
  // quando a flag explícita é passada, a sonda roda e marca sideEffects possible
  const obs2 = discover(cliDescriptor(), probe, {
    now: () => "2026-11-12T10:00:00.000Z",
    versionProbe,
  });
  assertEquals(versionCalls, 1);
  assertEquals(obs2.sideEffects, "possible");
  assertEquals(obs2.version, "1.2.3");
});

Deno.test("sonda de versão explícita não roda se executável não estiver instalado", () => {
  let versionCalls = 0;
  const versionProbe: VersionProbe = {
    probeVersion(_command: string): string | undefined {
      versionCalls++;
      return "1.2.3";
    },
  };
  const probe = fakeProbe({});
  const obs = discover(cliDescriptor(), probe, {
    now: () => "2026-11-12T10:00:00.000Z",
    versionProbe,
  });

  assertEquals(obs.installed, false);
  assertEquals(obs.sideEffects, "possible");
  assertEquals(versionCalls, 0);
  assertEquals(obs.version, undefined);
});

Deno.test("orquestrador sem command não usa resolução de executável na descoberta passiva", () => {
  const { probe, calls } = fakeProbeWithCalls({ demo: "/usr/bin/demo" });
  const desc: HarnessDescriptor = {
    descriptorVersion: 1,
    id: "alethe",
    kind: "orchestrator",
    declared: {
      terminal: { state: "supported", source: "modos-de-execucao.md:101" },
    },
  };
  const obs = discover(desc, probe, { now: () => "2026-11-12T10:00:00.000Z" });

  assertEquals(calls.length, 0);
  assertEquals(obs.installed, undefined);
  assertEquals(obs.capabilities, {});
  assertEquals(obs.sideEffects, "none");
});
