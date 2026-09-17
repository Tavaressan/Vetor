// CLI da skill `design` (#228): detecta o modo de operação (Prototype-first / System-first /
// Vetor-first), importa um Design System já existente (referenciando-o, nunca duplicando) e
// garante `.vetor/design/direction/product.md`. Lógica pura em lib/design-mode.ts; este script só
// orquestra a leitura de argumentos e a escrita em disco.

import {
  detectOperationMode,
  renderDesignDirectionFile,
  renderDesignSystemFiles,
  writeDesignFiles,
} from "./lib/design-mode.ts";

function main() {
  const dir = Deno.args[0] ?? ".";
  const result = detectOperationMode(dir);

  const written: string[] = [];
  const skipped: string[] = [];

  // Import roda sempre que há evidência de Design System, independente do modo — um projeto
  // Prototype-first pode ter, além do protótipo, um Design System que também vale referenciar.
  if (result.evidence.length > 0) {
    const outcome = writeDesignFiles(dir, renderDesignSystemFiles(result.evidence));
    written.push(...outcome.written);
    skipped.push(...outcome.skipped);
  }

  const directionOutcome = writeDesignFiles(dir, [renderDesignDirectionFile()]);
  written.push(...directionOutcome.written);
  skipped.push(...directionOutcome.skipped);

  console.log(JSON.stringify({
    mode: result.mode,
    hasPrototype: result.hasPrototype,
    evidence: result.evidence,
    written,
    skipped,
  }));
}

if (import.meta.main) main();
