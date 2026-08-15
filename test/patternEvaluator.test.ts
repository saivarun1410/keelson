import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { evaluatePatterns } from "../src/patternEvaluator.ts";

describe("patternEvaluator", () => {
  it("returns matches with 1-indexed line numbers", async () => {
    const { matches } = await evaluatePatterns(
      [{ path: "A.java", content: "class A {\n  System.out.println(1);\n}" }],
      () => ["System\\.out"],
      1000,
    );
    assert.deepEqual(matches.get("A.java")?.get("System\\.out"), [2]);
  });

  it("abandons an exponentially backtracking pattern within the deadline", async () => {
    // `^(a|aa)+$` has no nested quantifier, so no shape heuristic catches it.
    // On the main thread this runs for many seconds and cannot be interrupted.
    const started = Date.now();
    const { matches, timeouts } = await evaluatePatterns(
      [{ path: "x.ts", content: `${"a".repeat(60)}!` }],
      () => ["^(a|aa)+$"],
      250,
    );
    assert.equal(matches.size, 0, "the abandoned pattern contributes no matches");
    assert.deepEqual(timeouts, [{ path: "x.ts", patterns: ["^(a|aa)+$"] }]);
    assert.ok(Date.now() - started < 3000, "should abandon near the deadline");
  });

  it("evaluates every file through one worker", async () => {
    const files = Array.from({ length: 5 }, (_, index) => ({
      path: `f${index}.ts`,
      content: index % 2 === 0 ? "BAD" : "fine",
    }));
    const { matches } = await evaluatePatterns(files, () => ["BAD"], 1000);
    assert.deepEqual([...matches.keys()], ["f0.ts", "f2.ts", "f4.ts"]);
  });

  it("is a no-op when there is nothing to evaluate", async () => {
    assert.equal((await evaluatePatterns([{ path: "a", content: "x" }], () => [], 50)).matches.size, 0);
    assert.equal((await evaluatePatterns([], () => ["x"], 50)).matches.size, 0);
  });
});

describe("patternEvaluator resilience", () => {
  it("keeps matches from fast patterns when another times out", async () => {
    const { matches, timeouts } = await evaluatePatterns(
      [{ path: "x.ts", content: `${"a".repeat(60)}!` }],
      () => ["^(a|aa)+$", "!$"],
      2000,
    );
    // Batching every pattern into one job meant one slow regex discarded the
    // results of every fast one beside it, hiding a real violation.
    assert.deepEqual(matches.get("x.ts")?.get("!$"), [1]);
    assert.deepEqual(timeouts, [{ path: "x.ts", patterns: ["^(a|aa)+$"] }]);
  });

  it("does not leave a worker alive when startup times out", async () => {
    // A leaked worker keeps its listener registered, which keeps the event loop
    // alive and hangs the process — the failure the guard exists to prevent.
    const before = process.getActiveResourcesInfo().filter((r) => r === "Worker").length;
    const { timeouts } = await evaluatePatterns([{ path: "x.ts", content: "x" }], () => ["x"], 1);
    assert.equal(timeouts.length, 1);
    const after = process.getActiveResourcesInfo().filter((r) => r === "Worker").length;
    assert.equal(after, before, "no worker should still be running");
  });
});
