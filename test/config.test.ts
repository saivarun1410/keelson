import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseConfig } from "../src/config.ts";
import { ConfigError } from "../src/types.ts";

const MINIMAL = 'version: 1\nrules:\n  - id: max-file-lines\n    files: ["*.ts"]\n    max: 10\n';

describe("config", () => {
  it("defaults onPatternTimeout to fail", () => {
    assert.equal(parseConfig(MINIMAL).onPatternTimeout, "fail");
  });

  it("accepts warn", () => {
    assert.equal(parseConfig(`onPatternTimeout: warn\n${MINIMAL}`).onPatternTimeout, "warn");
  });

  it("rejects an unknown policy", () => {
    assert.throws(() => parseConfig(`onPatternTimeout: maybe\n${MINIMAL}`), ConfigError);
    assert.throws(() => parseConfig(`onPatternTimeout: 1\n${MINIMAL}`), ConfigError);
  });

  it("normalises a scalar glob to a list", () => {
    const config = parseConfig('version: 1\nrules:\n  - id: max-file-lines\n    files: "*.ts"\n    max: 10\n');
    assert.deepEqual(config.rules[0].files, ["*.ts"]);
  });

  it("rejects a non-string glob", () => {
    assert.throws(
      () => parseConfig("version: 1\nrules:\n  - id: max-file-lines\n    files: [1]\n    max: 10\n"),
      ConfigError,
    );
  });
});
