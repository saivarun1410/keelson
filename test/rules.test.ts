import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { bannedSymbolsRule } from "../src/rules/bannedSymbols.ts";
import { layerBoundariesRule } from "../src/rules/layerBoundaries.ts";
import { maxFileLinesRule } from "../src/rules/maxFileLines.ts";
import { requiredCompanionRule } from "../src/rules/requiredCompanion.ts";
import { ConfigError, type FileEntry, type RuleContext } from "../src/types.ts";

function contextOf(files: FileEntry[], allPaths: string[] = []): RuleContext {
  return { files, allPaths, root: "/repo" };
}

describe("max-file-lines", () => {
  const config = maxFileLinesRule.parse({ id: "max-file-lines", files: ["**/*.ts"], max: 3 });

  it("flags a file over the cap", () => {
    const ctx = contextOf([{ path: "a.ts", content: "1\n2\n3\n4\n5" }]);
    const [violation] = maxFileLinesRule.check(config, ctx);
    assert.equal(violation.ruleId, "max-file-lines");
    assert.match(violation.message, /5 lines, over the 3-line limit/);
  });

  it("passes a file at exactly the cap", () => {
    const ctx = contextOf([{ path: "a.ts", content: "1\n2\n3" }]);
    assert.equal(maxFileLinesRule.check(config, ctx).length, 0);
  });

  it("rejects a non-positive max at parse time", () => {
    assert.throws(
      () => maxFileLinesRule.parse({ id: "max-file-lines", files: ["*.ts"], max: 0 }),
      ConfigError,
    );
  });

  it("does not count the newline terminating the final line", () => {
    const strict = maxFileLinesRule.parse({ id: "max-file-lines", files: ["**/*.ts"], max: 1 });
    assert.equal(maxFileLinesRule.check(strict, contextOf([{ path: "a.ts", content: "one\n" }])).length, 0);
    assert.equal(maxFileLinesRule.check(strict, contextOf([{ path: "a.ts", content: "one" }])).length, 0);
    assert.equal(maxFileLinesRule.check(strict, contextOf([{ path: "a.ts", content: "one\ntwo\n" }])).length, 1);
  });

  it("rejects non-string globs at parse time", () => {
    assert.throws(
      () => maxFileLinesRule.parse({ id: "max-file-lines", files: [123], max: 10 }),
      ConfigError,
    );
  });
});

describe("banned-symbols", () => {
  const config = bannedSymbolsRule.parse({
    id: "banned-symbols",
    files: ["**/*.java"],
    symbols: [{ pattern: "System\\.out", message: "Use SLF4J" }],
  });

  it("reports the offending line number", () => {
    const ctx = contextOf([{ path: "A.java", content: "class A {\n  System.out.println(1);\n}" }]);
    const [violation] = bannedSymbolsRule.check(config, ctx);
    assert.equal(violation.line, 2);
    assert.equal(violation.message, "Use SLF4J");
  });

  it("ignores files outside the glob", () => {
    const ctx = contextOf([{ path: "a.ts", content: "System.out" }]);
    assert.equal(bannedSymbolsRule.check(config, ctx).length, 0);
  });

  it("rejects catastrophically backtracking patterns at parse time", () => {
    // Synchronous regex execution cannot be interrupted, so a nested quantifier
    // must be refused before it can ever run against a line.
    for (const pattern of ["(a+)+$", "([a-z]*)*", "(\\d+)+"]) {
      assert.throws(
        () => bannedSymbolsRule.parse({ id: "banned-symbols", files: ["*.ts"], symbols: [{ pattern }] }),
        ConfigError,
        `expected ${pattern} to be rejected`,
      );
    }
  });

  it("still accepts ordinary quantified patterns", () => {
    assert.doesNotThrow(() =>
      bannedSymbolsRule.parse({
        id: "banned-symbols",
        files: ["*.ts"],
        symbols: [{ pattern: "console\\.log\\(" }, { pattern: "TODO\\s*:" }, { pattern: "a+b*" }],
      }),
    );
  });
});

describe("layer-boundaries", () => {
  const config = layerBoundariesRule.parse({
    id: "layer-boundaries",
    from: "src/controller/**",
    disallow: ["src/repository/**"],
  });

  it("blocks a relative import that crosses the boundary", () => {
    const ctx = contextOf([
      { path: "src/controller/a.ts", content: 'import { R } from "../repository/r.ts";' },
    ]);
    const [violation] = layerBoundariesRule.check(config, ctx);
    assert.equal(violation.line, 1);
    assert.match(violation.message, /must not import/);
  });

  it("allows imports that stay within the layer", () => {
    const ctx = contextOf([
      { path: "src/controller/a.ts", content: 'import { S } from "../service/s.ts";' },
    ]);
    assert.equal(layerBoundariesRule.check(config, ctx).length, 0);
  });

  it("matches non-relative specifiers such as Java packages", () => {
    const javaConfig = layerBoundariesRule.parse({
      id: "layer-boundaries",
      from: "**/controller/**",
      disallow: ["com.acme.**.repository.**"],
    });
    const ctx = contextOf([
      { path: "src/controller/A.java", content: "import com.acme.x.repository.Repo;" },
    ]);
    assert.equal(layerBoundariesRule.check(javaConfig, ctx).length, 1);
  });
});

describe("required-companion", () => {
  const config = requiredCompanionRule.parse({
    id: "required-companion",
    files: ["src/*.ts"],
    companion: "test/{name}.test.ts",
  });

  it("flags an implementation with no test", () => {
    const ctx = contextOf([{ path: "src/a.ts", content: "" }], ["src/a.ts"]);
    const [violation] = requiredCompanionRule.check(config, ctx);
    assert.match(violation.message, /test\/a\.test\.ts/);
    assert.equal(violation.line, undefined);
  });

  it("passes when the companion exists", () => {
    const ctx = contextOf([{ path: "src/a.ts", content: "" }], ["src/a.ts", "test/a.test.ts"]);
    assert.equal(requiredCompanionRule.check(config, ctx).length, 0);
  });

  it("resolves {dir} to a repo-relative path for root-level files", () => {
    const rooted = requiredCompanionRule.parse({
      id: "required-companion",
      files: ["*.ts"],
      companion: "{dir}/{name}.test.ts",
    });
    const ctx = contextOf([{ path: "a.ts", content: "" }], ["a.ts", "a.test.ts"]);
    assert.equal(requiredCompanionRule.check(rooted, ctx).length, 0);
  });

  it("does not require a file to be its own companion", () => {
    const selfish = requiredCompanionRule.parse({
      id: "required-companion",
      files: ["src/*.ts"],
      companion: "{dir}/{name}.ts",
    });
    const ctx = contextOf([{ path: "src/new.ts", content: "" }], ["src/new.ts"]);
    assert.equal(requiredCompanionRule.check(selfish, ctx).length, 0);
  });
});
