import { Worker } from "node:worker_threads";
import { WORKER_SOURCE } from "./patternWorkerSource.ts";
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
/** A file whose patterns could not be evaluated in time, and so were skipped. */
export interface PatternTimeout {
  path: string;
  patterns: string[];
}

export interface EvaluationResult {
  matches: MatchIndex;
  /** Empty unless a pattern was abandoned. Diagnostics, not violations. */
  timeouts: PatternTimeout[];
}

/**
 * Starts a worker with the patterns compiled and warmed.
 *
 * If startup itself exceeds the deadline the worker must be terminated before
 * rethrowing: a live worker keeps its message listener registered, which keeps
 * the event loop alive and hangs the process — the exact failure this whole
 * mechanism exists to prevent.
 */
async function startWorker(union: string[], milliseconds: number): Promise<Worker> {
  const worker = new Worker(WORKER_SOURCE, { eval: true });
  try {
    worker.postMessage({ type: "patterns", patterns: union });
    await awaitMessage(worker, "config", milliseconds);
    return worker;
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}

/**
 * Evaluates each file's patterns and reports which ones had to be abandoned.
 *
 * A timeout is deliberately not an exception. Throwing meant one slow pattern
 * suppressed every other rule for that edit, and left the two entry points
 * reporting different violations for identical input. Skipping only the
 * offending pattern keeps the violation set the same on both sides; what each
 * command does about the diagnostic is its own decision.
 */
export async function evaluatePatterns(
  files: readonly FileEntry[],
  selectPatterns: (path: string) => readonly string[],
  milliseconds: number,
): Promise<EvaluationResult> {
  const matches: MatchIndex = new Map();
  const timeouts: PatternTimeout[] = [];
  const perFile = files.map((file) => ({ file, patterns: selectPatterns(file.path) }));
  const union = [...new Set(perFile.flatMap((entry) => entry.patterns))];
  if (union.length === 0) return { matches, timeouts };

  let worker: Worker;
  try {
    worker = await startWorker(union, milliseconds);
  } catch {
    // Compiling the patterns itself failed or hung: nothing can be evaluated,
    // and both commands must see the same thing.
    const affected = perFile.filter((entry) => entry.patterns.length > 0);
    return {
      matches,
      timeouts: affected.map((entry) => ({ path: entry.file.path, patterns: [...entry.patterns] })),
    };
  }

  try {
    for (const { file, patterns } of perFile) {
      if (patterns.length === 0) continue;
      const lines = file.content.split("\n");
      const fileMatches: FileMatches = new Map();
      const abandoned: string[] = [];

      // One message per pattern. Batching them meant a single pathological
      // pattern discarded the results of every fast pattern beside it, so a
      // real violation went unreported because an unrelated regex was slow.
      for (const pattern of patterns) {
        try {
          worker.postMessage({ type: "file", lines, pattern });
          const reply = await awaitMessage<{ hits: number[] }>(worker, file.path, milliseconds);
          if (reply.hits.length > 0) fileMatches.set(pattern, reply.hits);
        } catch (error) {
          if (!(error instanceof PatternTimeoutError)) throw error;
          abandoned.push(pattern);
          // The worker is still grinding on the abandoned match; replace it so
          // the remaining patterns and files are still evaluated.
          await worker.terminate();
          worker = await startWorker(union, milliseconds);
        }
      }

      if (fileMatches.size > 0) matches.set(file.path, fileMatches);
      if (abandoned.length > 0) timeouts.push({ path: file.path, patterns: abandoned });
    }
  } finally {
    await worker.terminate();
  }

  return { matches, timeouts };
}
