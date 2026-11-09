// Orçamento de contexto por skill (issue #570).
//
// Medição estática, sem harness: para cada skill, o tamanho do SKILL.md e das referências que ele
// cita (fecho transitivo), separando leitura obrigatória de leitura sob demanda; para cada agent,
// o corpo mais as skills pré-carregadas via `skills:` no frontmatter.
//
// Obrigatória x sob demanda: obrigatória é a referência listada na seção `## Referências` sem
// gatilho condicional ("quando", "se", "ao", "caso", "só", "somente", "apenas") no item que a cita;
// é a lista que o modelo lê ao carregar a skill. Citação no corpo (num passo, numa tabela, numa
// restrição) só é lida quando o fluxo chega lá, então é sob demanda. Referência listada assim por
// uma obrigatória entra pela mesma regra.
//
// Tokens são estimados por caracteres / 4: servem para comparar versões, não para faturar.
//
// Uso: deno run --allow-read scripts/skill-budget.ts [--json] [--check]
//   --json   relatório em JSON
//   --check  exit 1 quando a leitura obrigatória de alguma skill passa do limite de
//            scripts/skill-budget.json (`limits.<skill>`, senão `limits.default`)

export interface FileCost {
  path: string;
  chars: number;
  tokens: number;
}

export interface SkillBudget {
  name: string;
  skill: FileCost;
  mandatory: FileCost[];
  onDemand: FileCost[];
  mandatoryTokens: number;
  onDemandTokens: number;
}

export interface AgentBudget {
  name: string;
  body: FileCost;
  preloads: string[];
  mandatoryTokens: number;
}

export interface BudgetConfig {
  limits: Record<string, number>;
}

const CONDITIONAL_RE = /\b(?:quando|se|ao|caso|só|somente|apenas)\b/i;
const REFERENCE_RE = /([\w./-]*?)([\w-]+\.md)\b/g;
const REFERENCES_HEADING_RE = /refer[êe]ncias|references/i;

export const estimateTokens = (chars: number) => Math.ceil(chars / 4);

function cost(root: string, path: string): FileCost {
  const chars = Deno.readTextFileSync(`${root}/${path}`).length;
  return { path, chars, tokens: estimateTokens(chars) };
}

function exists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/**
 * Referências citadas em `text`, resolvidas a partir do diretório do arquivo citante e, para nomes
 * soltos, de `skills/shared/references/` e de `<skill>/references/`. Devolve, por path relativo à
 * raiz, se alguma citação foi incondicional.
 */
export function citedReferences(
  root: string,
  citingPath: string,
  skillDir: string,
  text: string,
): Map<string, boolean> {
  const found = new Map<string, boolean>();
  const citingDir = citingPath.split("/").slice(0, -1).join("/");
  for (const { text: unit, inReferences } of sectionedUnits(text)) {
    const unconditional = inReferences && !CONDITIONAL_RE.test(unit);
    for (const [, prefix, file] of unit.matchAll(REFERENCE_RE)) {
      if (file === "SKILL.md") continue;
      // Prefixado: relativo ao arquivo citante ou, como as referências declaram, à skill.
      const candidates = prefix
        ? [normalize(`${citingDir}/${prefix}${file}`), normalize(`${skillDir}/${prefix}${file}`)]
        : [
          normalize(`${citingDir}/${file}`),
          `${skillDir}/references/${file}`,
          `skills/shared/references/${file}`,
        ];
      const resolved = candidates.find((c) =>
        c.startsWith("skills/") && c !== citingPath && exists(`${root}/${c}`)
      );
      if (!resolved) continue;
      found.set(resolved, (found.get(resolved) ?? false) || unconditional);
    }
  }
  return found;
}

/**
 * Unidades de citação: cada item de lista ou parágrafo, sem o frontmatter. A prosa quebra linhas no
 * meio da frase, então o gatilho condicional de uma citação pode estar na linha anterior.
 */
export function citationUnits(text: string): string[] {
  return sectionedUnits(text).map((u) => u.text);
}

/** Como `citationUnits`, marcando as unidades que estão numa seção `## Referências`. */
function sectionedUnits(text: string): Array<{ text: string; inReferences: boolean }> {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const units: Array<{ text: string; inReferences: boolean }> = [];
  let current: string[] = [];
  let inReferences = false;
  const flush = () => {
    if (current.length > 0) units.push({ text: current.join(" "), inReferences });
    current = [];
  };
  for (const line of body.split("\n")) {
    if (line.trim() === "" || /^\s*(?:[-*]|\d+[.)]|#+)\s/.test(line)) flush();
    const heading = line.match(/^#+\s+(.*)$/);
    if (heading) inReferences = REFERENCES_HEADING_RE.test(heading[1]);
    if (line.trim() !== "") current.push(line.trim());
  }
  flush();
  return units;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

export function measureSkill(root: string, name: string): SkillBudget {
  const skillDir = `skills/${name}`;
  const skillPath = `${skillDir}/SKILL.md`;
  const mandatory = new Set<string>();
  const reachable = new Set<string>();
  const queue: Array<{ path: string; mandatory: boolean }> = [{ path: skillPath, mandatory: true }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { path, mandatory: isMandatory } = queue.shift()!;
    const key = `${path}:${isMandatory}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = Deno.readTextFileSync(`${root}/${path}`);
    for (const [ref, unconditional] of citedReferences(root, path, skillDir, text)) {
      reachable.add(ref);
      const refMandatory = isMandatory && unconditional;
      if (refMandatory) mandatory.add(ref);
      queue.push({ path: ref, mandatory: refMandatory });
    }
  }

  const skill = cost(root, skillPath);
  const mandatoryCosts = [...mandatory].sort().map((p) => cost(root, p));
  const onDemandCosts = [...reachable].filter((p) => !mandatory.has(p)).sort().map((p) =>
    cost(root, p)
  );
  const sum = (costs: FileCost[]) => costs.reduce((total, c) => total + c.tokens, 0);
  return {
    name,
    skill,
    mandatory: mandatoryCosts,
    onDemand: onDemandCosts,
    mandatoryTokens: skill.tokens + sum(mandatoryCosts),
    onDemandTokens: sum(onDemandCosts),
  };
}

export function measureAgent(
  root: string,
  file: string,
  skills: Map<string, SkillBudget>,
): AgentBudget {
  const path = `agents/${file}`;
  const text = Deno.readTextFileSync(`${root}/${path}`);
  const list = text.match(/^skills:\s*\[([^\]]*)\]/m)?.[1] ?? "";
  const preloads = list.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const body = cost(root, path);
  const preloadTokens = preloads.reduce((t, s) => t + (skills.get(s)?.mandatoryTokens ?? 0), 0);
  return {
    name: file.replace(/\.md$/, ""),
    body,
    preloads,
    mandatoryTokens: body.tokens + preloadTokens,
  };
}

export function measureAll(root: string): { skills: SkillBudget[]; agents: AgentBudget[] } {
  const names = [...Deno.readDirSync(`${root}/skills`)]
    .filter((e) => e.isDirectory && exists(`${root}/skills/${e.name}/SKILL.md`))
    .map((e) => e.name)
    .sort();
  const skills = names.map((n) => measureSkill(root, n));
  const byName = new Map(skills.map((s) => [s.name, s]));
  const agents = [...Deno.readDirSync(`${root}/agents`)]
    .filter((e) => e.isFile && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort()
    .map((f) => measureAgent(root, f, byName));
  return { skills, agents };
}

export function limitFor(config: BudgetConfig, name: string): number {
  return config.limits[name] ?? config.limits.default;
}

/** Skills cuja leitura obrigatória passa do limite configurado. */
export function overBudget(skills: SkillBudget[], config: BudgetConfig): SkillBudget[] {
  return skills.filter((s) => s.mandatoryTokens > limitFor(config, s.name));
}

function report(skills: SkillBudget[], agents: AgentBudget[], config: BudgetConfig): string {
  const lines = [
    "| Skill | SKILL.md | Obrigatória (tokens) | Sob demanda (tokens) | Limite |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...skills.map((s) =>
      `| ${s.name} | ${s.skill.tokens} | ${s.mandatoryTokens} | ${s.onDemandTokens} | ${
        limitFor(config, s.name)
      } |`
    ),
    "",
    "| Agent | Corpo (tokens) | Preloads | Obrigatória (tokens) |",
    "| --- | ---: | --- | ---: |",
    ...agents.map((a) =>
      `| ${a.name} | ${a.body.tokens} | ${a.preloads.join(", ") || "—"} | ${a.mandatoryTokens} |`
    ),
  ];
  return lines.join("\n");
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const config = JSON.parse(
    Deno.readTextFileSync(`${root}/scripts/skill-budget.json`),
  ) as BudgetConfig;
  const { skills, agents } = measureAll(root);
  if (Deno.args.includes("--json")) {
    console.log(JSON.stringify({ skills, agents }, null, 2));
  } else {
    console.log(report(skills, agents, config));
  }
  if (Deno.args.includes("--check")) {
    const over = overBudget(skills, config);
    for (const s of over) {
      console.error(
        `ERRO: ${s.name} lê ${s.mandatoryTokens} tokens obrigatórios; limite ${
          limitFor(config, s.name)
        }.`,
      );
    }
    Deno.exit(over.length > 0 ? 1 : 0);
  }
}
