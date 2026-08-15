import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { extractImports } from "../src/imports.ts";

describe("import false positives", () => {
  it("ignores a Python comment with no space before it", () => {
    assert.deepEqual(extractImports('x = 1# require("src/repository/users")', "a.py"), []);
  });

  it("ignores a regex literal after return", () => {
    assert.deepEqual(
      extractImports('function f() {\n  return /require("src/repository/users")/;\n}'),
      [],
    );
  });

  it("ignores member calls that merely look like module loaders", () => {
    assert.deepEqual(extractImports('client.require("src/repository/users");'), []);
    assert.deepEqual(extractImports('loader.import("src/repository/users");'), []);
  });

  it("still reads module.require as a real load", () => {
    const [ref] = extractImports('module.require("../repository/users");');
    assert.equal(ref?.specifier, "../repository/users");
  });

  it("abandons a multiline import that closes without a literal", () => {
    assert.deepEqual(
      extractImports('const m = import(\n  moduleName\n);\nconst p = "src/repository/users";'),
      [],
    );
  });

  it("extracts per-item aliases and private-field requires", () => {
    assert.deepEqual(
      extractImports("import pkg.repository as repo, pkg.service as service", "a.py").map(
        (ref) => ref.specifier,
      ),
      ["pkg.repository", "pkg.service"],
    );
    const [ref] = extractImports('class A {\n  #repo = require("src/repository/users");\n}');
    assert.equal(ref?.specifier, "src/repository/users");
  });
});

describe("statement position and JSX", () => {
  it("reads a regex after a control condition as a regex", () => {
    assert.deepEqual(
      extractImports('if (enabled) /require("src/config.ts")/.test(text);', "src/rules/a.ts"),
      [],
    );
  });

  it("still treats a parenthesised expression divided by a number as division", () => {
    const [ref] = extractImports(
      'const x = (a + b) / 2;\nimport { R } from "../repo/r.ts";',
      "src/a.ts",
    );
    assert.equal(ref?.specifier, "../repo/r.ts");
  });

  it("ignores dependency-like prose in JSX text", () => {
    assert.deepEqual(
      extractImports('<p>Call require("src/config.ts") only in Node</p>', "src/rules/a.tsx"),
      [],
    );
  });

  it("still reads code inside a JSX expression", () => {
    const [ref] = extractImports('const A = () => <div>{require("../repo/r.ts")}</div>;', "a.tsx");
    assert.equal(ref?.specifier, "../repo/r.ts");
  });

  it("leaves generics and comparisons alone", () => {
    assert.equal(
      extractImports('const x = foo<Bar>(1);\nimport { R } from "../repo/r.ts";', "a.ts")[0]
        ?.specifier,
      "../repo/r.ts",
    );
    assert.equal(
      extractImports('const y = a < b && c > d;\nimport { R } from "../repo/r.ts";', "a.ts")[0]
        ?.specifier,
      "../repo/r.ts",
    );
  });

  it("extracts every require on a single line", () => {
    assert.deepEqual(
      extractImports(
        'const ok = require("src/service/helper"), bad = require("src/repository/users");',
        "src/service/a.ts",
      ).map((ref) => ref.specifier),
      ["src/service/helper", "src/repository/users"],
    );
  });
});

describe("multiline statement position", () => {
  it("recognises a regex after a control condition that wraps lines", () => {
    assert.deepEqual(
      extractImports('if (\n  enabled\n) /require("src/config.ts")/.test(text);', "src/rules/a.ts"),
      [],
    );
  });

  it("still treats a wrapped parenthesised expression as division", () => {
    const [ref] = extractImports(
      'const x = (a +\n  b) / 2;\nimport { R } from "../repo/r.ts";',
      "src/a.ts",
    );
    assert.equal(ref?.specifier, "../repo/r.ts");
  });
});
