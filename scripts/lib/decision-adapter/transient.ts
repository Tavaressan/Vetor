// Heurística determinística de falha transitória a partir do texto do erro (spike #558).
//
// Dois conjuntos de padrões:
// - STRICT: mensagens específicas de rede, DNS, TLS, gateway e rate limit, que um erro de código não
//   costuma produzir. É o conjunto proposto.
// - LOOSE: palavras genéricas ("network", "timeout", um 503 solto). Fica só para comparação: na #557
//   foram elas que casaram com nomes de teste.
// Duas salvaguardas, ajustadas na segunda iteração do spike (ver docs/investigations/
// decision-adapter.md, seção da #558):
// - a guarda ignora linhas de asserção e títulos de teste, onde um 503 ou um ECONNRESET pode ser
//   exatamente o que o teste verifica;
// - erro de DNS só conta como transitório para um host público (com ponto, fora de .local,
//   .internal, .svc e localhost). Um nome de serviço interno que não resolve é serviço ausente no
//   job, e repetir não resolve.

export interface TransientMatch {
  pattern: string;
  line: string;
}

/** Padrões de DNS: o host precisa passar por `isPublicHost`. */
const DNS_PATTERNS: RegExp[] = [
  /Could not resolve host:?\s*([\w.-]+)/i,
  /getaddrinfo (?:ENOTFOUND|EAI_AGAIN)\s+([\w.-]+)/,
  /\bEAI_AGAIN\b(?:\s+([\w.-]+))?/,
  /Temporary failure in name resolution/i,
  /failed to lookup address information/i,
];

export const STRICT_PATTERNS: RegExp[] = [
  ...DNS_PATTERNS,
  /\bECONNRESET\b|connection reset by peer/i,
  /\bETIMEDOUT\b/,
  /socket hang up/i,
  /TLS handshake timeout|net\/http: TLS handshake/i,
  /\b502 Bad Gateway\b|\b503 Service Unavailable\b|\b504 Gateway Time-?out\b/i,
  /\b(?:HTTP\/\d(?:\.\d)?|status(?: code)?) (?:502|503|504)\b/i,
  /(?:API )?rate limit exceeded|secondary rate limit|429 Too Many Requests/i,
  /The remote end hung up unexpectedly|early EOF|RPC failed; curl \d+/i,
];

export const LOOSE_PATTERNS: RegExp[] = [
  /network/i,
  /time(?:d)? ?out/i,
  /\b50[234]\b/,
  /ECONNREFUSED/,
  /temporar(?:y|ily)/i,
];

/** Linhas onde um padrão transitório costuma ser o objeto do teste, não a causa da falha. */
const TEST_CONTEXT = new RegExp(
  [
    String.raw`^\s*(?:●|✗|✕|×|✓|✔|FAIL\b|not ok\b)`, // títulos de teste (Jest, Mocha, TAP)
    String.raw`\bAssertionError\b|\bassert(?:Equals|Strict|ion)\b|\bexpect\(`,
    String.raw`^\s*(?:Expected|Received):`,
    String.raw`\bto(?:Be|Equal|Throw|HaveBeenCalled)\w*\b`,
    String.raw`\s>\s.*\bFAILED\s*$`, // Gradle/JUnit: Classe > teste FAILED
  ].join("|"),
  "i",
);

const URL_HOST = /https?:\/\/([\w.-]+)/i;

function isPublicHost(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/[.:]+$/, "");
  if (h === "localhost" || !h.includes(".")) return false;
  return !/\.(?:local|internal|svc|lan|home|cluster\.local)$/.test(h);
}

export function detectTransient(
  text: string | undefined,
  options: { patterns?: RegExp[]; guard?: boolean } = {},
): TransientMatch | null {
  if (!text) return null;
  const patterns = options.patterns ?? STRICT_PATTERNS;
  const guard = options.guard ?? true;
  for (const line of text.split("\n")) {
    if (guard && TEST_CONTEXT.test(line)) continue;
    for (const pattern of patterns) {
      const m = pattern.exec(line);
      if (!m) continue;
      if (DNS_PATTERNS.includes(pattern) && !isPublicHost(m[1] ?? URL_HOST.exec(line)?.[1])) {
        continue;
      }
      return { pattern: pattern.source, line: line.trim().slice(0, 200) };
    }
  }
  return null;
}
