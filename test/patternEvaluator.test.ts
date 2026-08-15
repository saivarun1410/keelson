import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { evaluatePatterns, PatternTimeoutError } from "../src/patternEvaluator.ts";

describe("patternEvaluator", () => {
  it("returns matches with 1-indexed line numbers", async () => {
    const matches = await evaluatePatterns(
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
    await assert.rejects(
      () =>
        evaluatePatterns([{ path: "x.ts", content: `${"a".repeat(60)}!` }], () => ["^(a|aa)+$"], 250),
      PatternTimeoutError,
    );
    assert.ok(Date.now() - started < 3000, "should abandon near the deadline");
  });

  it("evaluates every file through one worker", async () => {
    const files = Array.from({ length: 5 }, (_, index) => ({
      path: `f${index}.ts`,
      content: index % 2 === 0 ? "BAD" : "fine",
    }));
    const matches = await evaluatePatterns(files, () => ["BAD"], 1000);
    assert.deepEqual([...matches.keys()], ["f0.ts", "f2.ts", "f4.ts"]);
  });

  it("is a no-op when there is nothing to evaluate", async () => {
    assert.equal((await evaluatePatterns([{ path: "a", content: "x" }], () => [], 50)).size, 0);
    assert.equal((await evaluatePatterns([], () => ["x"], 50)).size, 0);
  });
});
