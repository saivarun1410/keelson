/**
 * The worker program that executes user regexes, kept as source text so the
 * bundled CLI needs no second entry point. Split from `patternEvaluator.ts`
 * to stay under keelson's own line cap.
 */

export const WORKER_SOURCE = `
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

  const entry = compiled.find((candidate) => candidate.source === message.pattern);
  const hits = [];
  if (entry) {
    for (let index = 0; index < message.lines.length; index += 1) {
      if (entry.expression.test(message.lines[index])) hits.push(index + 1);
    }
  }
  parentPort.postMessage({ type: "matches", hits });
});
`;
