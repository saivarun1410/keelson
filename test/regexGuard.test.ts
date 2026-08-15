import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { assertPatternsTerminate, RegexTimeoutError } from "../src/regexGuard.ts";

describe("regexGuard", () => {
  it("resolves quickly for ordinary patterns", async () => {
    await assertPatternsTerminate(["console\\.log\\(", "TODO"], ["console.log(1);", "ok"], 1000);
  });

  it("abandons an exponentially backtracking pattern within the deadline", async () => {
    // `^(a|aa)+$` has no nested quantifier, so no shape heuristic catches it.
    // Left on the main thread this runs for many seconds and cannot be
    // interrupted, which is exactly what would defeat failing open.
    const started = Date.now();
    await assert.rejects(
      () => assertPatternsTerminate(["^(a|aa)+$"], [`${"a".repeat(60)}!`], 250),
      RegexTimeoutError,
    );
    assert.ok(Date.now() - started < 2000, "should abandon near the deadline, not run to completion");
  });

  it("is a no-op when there is nothing to evaluate", async () => {
    await assertPatternsTerminate([], ["anything"], 50);
    await assertPatternsTerminate(["x"], [], 50);
  });
});
