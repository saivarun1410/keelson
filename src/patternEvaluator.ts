import { Worker } from "node:worker_threads";
import type { FileEntry, FileMatches, MatchIndex } from "./types.ts";

/**
 * Runs every user-supplied regex off the main thread, under a hard deadline,
 * and returns the matches for rules to consume.
 *
 * Regex execution is synchronous: once a catastrophically backtracking pattern
 * starts on the main thread, nothing can interrupt it — not a try/catch, not a
 * timer. Evaluating in a worker is what makes the cost abandonable.
 *
 * Both `check` and `hook` come through here, so a pattern can never be fast in
 * one and hang the other. What differs is only the response to a timeout, which
 * each command decides: the hook fails open, `check` fails loudly.
 *
 * One worker is reused across files and results come back as matches, so no
 * pattern is ever executed twice.
 */

const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
let compiled = [];

// V8 interprets a regex before tiering it up to compiled code, and the
// interpreted path is several times slower. Without this warm-up, whether a
// pattern beats the deadline depends on how many files happened to be scanned
// first — so 'check' (many files) and 'hook' (one) could disagree on identical
// content. A few throwaway executions make the timing depend on the pattern,
// not on call order.
const warmUp = (expression) => {
  for (let round = 0; round < 16; round += 1) expression.test("warmup");
};

parentPort.on("message", (message) => {
  if (message.type === "patterns") {
    compiled = message.patterns.map((source) => {
      const expression = new RegExp(source);
      warmUp(expression);
      return { source, expression };
    });
    parentPort.postMessage({ type: "ready" });
    return;
  }

  const wanted = new Set(message.patterns);
  const matches = new Map();
  for (const { source, expression } of compiled) {
    if (!wanted.has(source)) continue;
    const hits = [];
    for (let index = 0; index < message.lines.length; index += 1) {
      if (expression.test(message.lines[index])) hits.push(index + 1);
    }
    if (hits.length > 0) matches.set(source, hits);
  }
  parentPort.postMessage({ type: "matches", matches });
});
`;

/**
 * Per-file budget, shared by both commands.
 *
 * It must be identical either side: a pattern that completes under one deadline
 * and times out under another would make `hook` and `check` disagree for a
 * reason that has nothing to do with the code being judged.
 */
export const PATTERN_DEADLINE_MS = 2000;

export class PatternTimeoutError extends Error {
  // A plain field, not a constructor parameter property: Node's type stripping
  // runs this source directly and does not support that syntax.
  readonly path: string;

  constructor(path: string, milliseconds: number) {
    super(
      `Evaluating banned-symbols patterns against ${path} exceeded ${milliseconds}ms. ` +
        `One of them backtracks catastrophically — rewrite it (a pattern like "(a+)+" or ` +
        `"^(a|aa)+$" is exponential on non-matching input).`,
    );
    this.name = "PatternTimeoutError";
    this.path = path;
  }
}

/**
 * Awaits one worker reply. Both listeners are removed on every outcome — the
 * worker is reused across files, so leaving the unfired one attached would leak
 * a listener per file and eventually warn about an EventEmitter leak.
 */
function awaitMessage<T>(worker: Worker, path: string, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout;

    const cleanup = (): void => {
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
    };
    const onMessage = (value: T): void => {
      cleanup();
      resolve(value);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new PatternTimeoutError(path, milliseconds));
    }, milliseconds);

    worker.on("message", onMessage);
    worker.on("error", onError);
  });
}

/**
 * `selectPatterns` decides which patterns apply to each file, so a pattern is
 * never executed against a file its own rule does not cover.
 */
export async function evaluatePatterns(
  files: readonly FileEntry[],
  selectPatterns: (path: string) => readonly string[],
  milliseconds: number,
): Promise<MatchIndex> {
  const index: MatchIndex = new Map();
  const perFile = files.map((file) => ({ file, patterns: selectPatterns(file.path) }));
  const union = [...new Set(perFile.flatMap((entry) => entry.patterns))];
  if (union.length === 0) return index;

  const worker = new Worker(WORKER_SOURCE, { eval: true });

  try {
    worker.postMessage({ type: "patterns", patterns: union });
    await awaitMessage(worker, "config", milliseconds);

    for (const { file, patterns } of perFile) {
      if (patterns.length === 0) continue;
      worker.postMessage({ type: "file", lines: file.content.split("\n"), patterns: [...patterns] });
      const reply = await awaitMessage<{ matches: FileMatches }>(worker, file.path, milliseconds);
      if (reply.matches.size > 0) index.set(file.path, reply.matches);
    }
  } finally {
    await worker.terminate();
  }

  return index;
}
