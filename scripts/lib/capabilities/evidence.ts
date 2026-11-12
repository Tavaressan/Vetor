import {
  CAPABILITY_NAMES,
  type CapabilityName,
  type CapabilityState,
  type EffectiveCapability,
  type EvidenceLevel,
  type HarnessDescriptor,
  type HarnessObservation,
} from "./types.ts";

export type EvidenceMode = "manual" | "assisted" | "autonomous";

export interface ResolveEffectiveOptions {
  /** Current time used for freshness checks; required when maxAgeMs is set. */
  now?: number | string;
  /** Ignore observations older than this many milliseconds. */
  maxAgeMs?: number;
}

const LEVEL_ORDER: Record<EvidenceLevel, number> = {
  declared: 0,
  verified: 1,
  operational: 2,
};

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: (number | string)[];
}

interface PartialSemver {
  major: number;
  minor: number;
  patch: number;
  precision: 1 | 2 | 3;
  prerelease: (number | string)[];
}

function parseSemver(value: string): Semver | undefined {
  const match = value.match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) return undefined;
  const prerelease = match[4]
    ? match[4].split(".").map((part) => /^\d+$/.test(part) ? Number(part) : part)
    : [];
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function parsePartialSemver(value: string): PartialSemver | undefined {
  const match = value.match(
    /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*|x|X|\*))?(?:\.(0|[1-9]\d*|x|X|\*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  if (!match) return undefined;

  const minor = match[2];
  const patch = match[3];
  if (minor && /[xX*]/.test(minor) && patch) return undefined;
  if (patch && /[xX*]/.test(patch) && !minor) return undefined;
  const precision = !minor || /[xX*]/.test(minor) ? 1 : !patch || /[xX*]/.test(patch) ? 2 : 3;
  const prerelease = match[4]
    ? match[4].split(".").map((part) => /^\d+$/.test(part) ? Number(part) : part)
    : [];
  if (prerelease.length > 0 && precision !== 3) return undefined;

  return {
    major: Number(match[1]),
    minor: minor && !/[xX*]/.test(minor) ? Number(minor) : 0,
    patch: patch && !/[xX*]/.test(patch) ? Number(patch) : 0,
    precision,
    prerelease,
  };
}

function compareSemver(left: Semver, right: Semver): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) {
      if (a === b) return 0;
      return a === undefined ? -1 : 1;
    }
    if (a === b) continue;
    if (typeof a === "number" && typeof b !== "number") return -1;
    if (typeof a !== "number" && typeof b === "number") return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function asSemver(version: PartialSemver): Semver {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch,
    prerelease: version.prerelease,
  };
}

function nextBoundary(version: PartialSemver, operator: "^" | "~"): Semver {
  if (operator === "~") {
    return version.precision === 1
      ? { major: version.major + 1, minor: 0, patch: 0, prerelease: [] }
      : { major: version.major, minor: version.minor + 1, patch: 0, prerelease: [] };
  }
  if (version.major > 0 || version.precision === 1) {
    return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] };
  }
  if (version.minor > 0 || version.precision === 2) {
    return { major: 0, minor: version.minor + 1, patch: 0, prerelease: [] };
  }
  return { major: 0, minor: 0, patch: version.patch + 1, prerelease: [] };
}

function matchesComparator(
  version: Semver,
  operator: string,
  target: PartialSemver,
): boolean {
  const minimum = asSemver(target);
  if (operator === "^" || operator === "~") {
    return compareSemver(version, minimum) >= 0 &&
      compareSemver(version, nextBoundary(target, operator)) < 0;
  }

  if (operator === "" || operator === "=") {
    if (target.precision === 3) return compareSemver(version, minimum) === 0;
    const upper = nextBoundary(target, "~");
    return compareSemver(version, minimum) >= 0 && compareSemver(version, upper) < 0;
  }

  if (operator === ">=") return compareSemver(version, minimum) >= 0;
  if (operator === ">") {
    return target.precision === 3
      ? compareSemver(version, minimum) > 0
      : compareSemver(version, nextBoundary(target, "~")) >= 0;
  }
  if (operator === "<") return compareSemver(version, minimum) < 0;
  if (operator === "<=") {
    return target.precision === 3
      ? compareSemver(version, minimum) <= 0
      : compareSemver(version, nextBoundary(target, "~")) < 0;
  }
  return false;
}

function rangeGroupMatches(version: Semver, expression: string): boolean {
  const trimmed = expression.trim();
  if (trimmed === "" || trimmed === "*" || /^[xX]$/.test(trimmed)) return true;

  const hyphenRange = trimmed.match(/^(\S+)\s+-\s+(\S+)$/);
  if (hyphenRange) {
    const lower = parsePartialSemver(hyphenRange[1]);
    const upper = parsePartialSemver(hyphenRange[2]);
    if (!lower || !upper) return false;
    const lowerMatch = compareSemver(version, asSemver(lower)) >= 0;
    const upperMatch = upper.precision === 3
      ? compareSemver(version, asSemver(upper)) <= 0
      : compareSemver(version, nextBoundary(upper, "~")) < 0;
    return lowerMatch && upperMatch;
  }

  const comparators = trimmed.split(/[\s,]+/).filter(Boolean);
  const parsed = comparators.map((comparator) => {
    const match = comparator.match(/^(>=|<=|>|<|=|\^|~)?(.+)$/);
    if (!match) return undefined;
    const target = parsePartialSemver(match[2]);
    return target ? { operator: match[1] ?? "", target } : undefined;
  });
  if (parsed.some((comparator) => comparator === undefined)) return false;

  if (
    version.prerelease.length > 0 &&
    !parsed.some((comparator) =>
      comparator!.target.prerelease.length > 0 &&
      comparator!.target.major === version.major &&
      comparator!.target.minor === version.minor &&
      comparator!.target.patch === version.patch
    )
  ) return false;

  return parsed.every((comparator) =>
    matchesComparator(version, comparator!.operator, comparator!.target)
  );
}

function versionSatisfiesRange(version: string, range: string): boolean {
  const parsedVersion = parseSemver(version);
  if (!parsedVersion) return false;
  const groups = range.split("||");
  return groups.every((group) => group.trim().length > 0) &&
    groups.some((group) => rangeGroupMatches(parsedVersion, group));
}

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isFresh(
  observation: HarnessObservation,
  options: ResolveEffectiveOptions,
  now: number | undefined,
): boolean {
  if (options.maxAgeMs === undefined) return true;
  const observedAt = timestamp(observation.observedAt);
  return observedAt !== undefined && now !== undefined &&
    observedAt <= now && now - observedAt <= options.maxAgeMs;
}

function effectiveForCapability(
  capability: CapabilityName,
  descriptor: HarnessDescriptor,
  observations: HarnessObservation[],
  versionOutOfRange: boolean,
): EffectiveCapability {
  const claim = descriptor.declared[capability];
  const claims: { state: CapabilityState; level: EvidenceLevel; source: string }[] = [];

  if (claim && claim.state !== "unknown" && !versionOutOfRange) {
    claims.push({ state: claim.state, level: "declared", source: claim.source });
  }
  for (const observation of observations) {
    const evidence = observation.capabilities[capability];
    if (evidence && evidence.state !== "unknown") {
      claims.push({ state: evidence.state, level: evidence.level, source: evidence.source });
    }
  }

  if (claims.length === 0) {
    return {
      state: "unknown",
      level: "declared",
      sources: claim ? [claim.source] : [],
    };
  }

  const highestLevel = claims.reduce(
    (highest, item) => Math.max(highest, LEVEL_ORDER[item.level]),
    LEVEL_ORDER.declared,
  );
  const topClaims = claims.filter((item) => LEVEL_ORDER[item.level] === highestLevel);
  const state = topClaims.some((item) => item.state === "unsupported")
    ? "unsupported"
    : topClaims[0].state;
  const level = topClaims[0].level;
  const states = new Set(claims.map((item) => item.state));
  const sources = [...new Set(claims.map((item) => item.source))].sort();

  return {
    state,
    level,
    sources,
    ...(states.size > 1
      ? { conflict: claims.map((item) => `${item.level}=${item.state}`).sort().join(", ") }
      : {}),
  };
}

/**
 * Resolves the best evidence for each capability. Authorization is deliberately
 * separate; callers must filter executors using `authorizedExecutors`.
 */
export function resolveEffective(
  descriptor: HarnessDescriptor,
  observations: readonly HarnessObservation[],
  options: ResolveEffectiveOptions = {},
): Record<CapabilityName, EffectiveCapability> {
  let now: number | undefined;
  if (options.maxAgeMs !== undefined) {
    if (!Number.isFinite(options.maxAgeMs) || options.maxAgeMs < 0) {
      throw new RangeError("maxAgeMs deve ser um número finito não negativo");
    }
    if (options.now === undefined) {
      throw new TypeError("now é obrigatório quando maxAgeMs é informado");
    }
    now = typeof options.now === "number" ? options.now : Date.parse(options.now);
    if (!Number.isFinite(now)) throw new TypeError("now deve ser um timestamp válido");
  }

  const freshObservations = observations.filter((observation) =>
    observation.executorId === descriptor.id && isFresh(observation, options, now)
  );
  let versionOutOfRange = false;
  if (descriptor.versionRange !== undefined) {
    const versioned = freshObservations
      .filter((observation) => observation.version !== undefined)
      .map((observation) => ({
        observedAt: timestamp(observation.observedAt) ?? Number.NEGATIVE_INFINITY,
        version: observation.version!,
      }));
    if (versioned.length > 0) {
      const newest = Math.max(...versioned.map((item) => item.observedAt));
      versionOutOfRange = versioned
        .filter((item) => item.observedAt === newest)
        .some((item) => !versionSatisfiesRange(item.version, descriptor.versionRange!));
    }
  }

  return Object.fromEntries(
    CAPABILITY_NAMES.map((capability) => [
      capability,
      effectiveForCapability(
        capability,
        descriptor,
        freshObservations,
        versionOutOfRange,
      ),
    ]),
  ) as Record<CapabilityName, EffectiveCapability>;
}

/**
 * Checks support and the minimum evidence required by policy. `minimumLevel`
 * raises (but never lowers) the mode's baseline requirement.
 */
export function meetsEvidence(
  capability: EffectiveCapability,
  mode: EvidenceMode,
  minimumLevel?: EvidenceLevel,
): boolean {
  if (mode === "manual") return true;
  const modeMinimum: EvidenceLevel = mode === "assisted" ? "declared" : "verified";
  const minimum = minimumLevel !== undefined &&
      LEVEL_ORDER[minimumLevel] > LEVEL_ORDER[modeMinimum]
    ? minimumLevel
    : modeMinimum;
  return capability.state === "supported" &&
    LEVEL_ORDER[capability.level] >= LEVEL_ORDER[minimum];
}
