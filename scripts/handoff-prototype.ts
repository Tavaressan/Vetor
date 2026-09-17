// CLI do handoff de protótipo → Design Contract (#229). Lógica pura em lib/design-handoff.ts;
// este script só lê a extração estruturada (JSON escrito pelo agente após observar o protótipo —
// ver skills/design/SKILL.md, seção "Handoff") e grava o Design Contract resultante em
// `.vetor/design/handoff/`.

import { readJson } from "./lib/project.ts";
import { writeDesignFiles } from "./lib/design-mode.ts";
import {
  findUnaddressedStates,
  type PrototypeExtraction,
  renderPrototypeHandoffFile,
} from "./lib/design-handoff.ts";

function main() {
  const extractionPath = Deno.args[0];
  const dir = Deno.args[1] ?? ".";

  if (!extractionPath) {
    console.error(
      "uso: deno run -A scripts/handoff-prototype.ts <extração.json> [diretório-alvo]",
    );
    Deno.exit(1);
  }

  let extraction: PrototypeExtraction;
  try {
    extraction = readJson(extractionPath) as PrototypeExtraction;
  } catch (err) {
    console.error(`falha ao ler ${extractionPath}: ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
    return;
  }

  const file = renderPrototypeHandoffFile(extraction);
  const { written, skipped } = writeDesignFiles(dir, [file]);
  const unaddressedStates = findUnaddressedStates(extraction);

  console.log(JSON.stringify({ written, skipped, unaddressedStates }));
}

if (import.meta.main) main();
