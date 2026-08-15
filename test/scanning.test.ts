import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { matchesGlob } from "../src/glob.ts";
import { extractImports, resolveSpecifier } from "../src/imports.ts";

describe("glob", () => {
  it("matches ** across zero or more directories", () => {
    assert.ok(matchesGlob("src/a.ts", "src/**/*.ts"));
    assert.ok(matchesGlob("src/deep/nested/a.ts", "src/**/*.ts"));
    assert.ok(!matchesGlob("test/a.ts", "src/**/*.ts"));
  });

  it("keeps * from crossing directory separators", () => {
    assert.ok(matchesGlob("src/a.ts", "src/*.ts"));
    assert.ok(!matchesGlob("src/deep/a.ts", "src/*.ts"));
  });

  it("expands brace alternatives", () => {
    assert.ok(matchesGlob("src/a.tsx", "src/*.{ts,tsx}"));
    assert.ok(!matchesGlob("src/a.css", "src/*.{ts,tsx}"));
  });

  it("treats wildcards inside braces as glob tokens, not regex operators", () => {
    assert.equal(matchesGlob("src/foo.ts", "src/{foo?,bar}.ts"), false);
    assert.equal(matchesGlob("src/fooX.ts", "src/{foo?,bar}.ts"), true);
    assert.equal(matchesGlob("src/fo.ts", "src/{foo*,bar}.ts"), false);
    assert.equal(matchesGlob("src/a.test.ts", "src/{*.test,*.spec}.ts"), true);
  });

  it("supports nested brace groups", () => {
    assert.ok(matchesGlob("src/a.spec.tsx", "src/*.{test,spec}.{ts,tsx}"));
  });
});

describe("imports", () => {
  it("extracts specifiers across languages", () => {
    const found = extractImports(
      [
        'import { a } from "./a.ts";',
        'const b = require("lodash");',
        "import com.acme.data.Repo;",
        "from pkg.mod import thing",
      ].join("\n"),
    );
    assert.deepEqual(
      found.map((ref) => ref.specifier),
      ["./a.ts", "lodash", "com.acme.data.Repo", "pkg.mod"],
    );
  });

  it("ignores quoted text that is not an import", () => {
    assert.deepEqual(extractImports('export const route = "src/repository/users";'), []);
    assert.deepEqual(extractImports(`const d = 'call require("src/repository/users")';`), []);
    assert.deepEqual(extractImports('var paths = []string{\n    "src/repository/users"\n}'), []);
  });

  it("ignores imports inside comments", () => {
    assert.deepEqual(extractImports('// import { R } from "../repository/r.ts";'), []);
    assert.deepEqual(extractImports('/*\nimport { R } from "../repository/r.ts";\n*/'), []);
  });

  it("ignores trailing comments and multiline template text", () => {
    assert.deepEqual(extractImports('doThing(); // require("src/repository/users")'), []);
    assert.deepEqual(
      extractImports('const docs = `\nimport { R } from "src/repository/users";\n`;'),
      [],
    );
  });

  it("ignores Python trailing comments, triple-quoted blocks and regex literals", () => {
    assert.deepEqual(extractImports('do_thing()  # require("src/repository/users")', "a.py"), []);
    assert.deepEqual(extractImports('docs = """\nimport pkg.repository as repository\n"""', "a.py"), []);
    assert.deepEqual(extractImports('val docs = """\nimport com.acme.repository.Repo\n"""'), []);
    assert.deepEqual(extractImports('const pattern = /require("src/repository/users")/;'), []);
  });

  it("keeps a TypeScript private field out of the # comment rule", () => {
    const [ref] = extractImports('class A { #n = 0; }\nimport { R } from "../repo/r.ts";');
    assert.equal(ref?.specifier, "../repo/r.ts");
  });

  it("treats division as division, not a regex literal", () => {
    const [ref] = extractImports('const ratio = a / b;\nimport { R } from "../repo/r.ts";');
    assert.equal(ref?.specifier, "../repo/r.ts");
  });

  it("extracts Python aliased imports with trailing comments and comma lists", () => {
    const [aliased] = extractImports("import pkg.repository as repository  # boundary", "a.py");
    assert.equal(aliased?.specifier, "pkg.repository");
    assert.deepEqual(
      extractImports("import pkg.repository, pkg.service").map((ref) => ref.specifier),
      ["pkg.repository", "pkg.service"],
    );
  });

  it("extracts a dynamic import whose argument wraps", () => {
    const [ref] = extractImports('const repo = import(\n  "../repository/users"\n);');
    assert.equal(ref?.specifier, "../repository/users");
  });

  it("keeps a specifier containing // inside a string", () => {
    const [ref] = extractImports('import x from "http://example.com/m.js";');
    assert.equal(ref?.specifier, "http://example.com/m.js");
  });

  it("reads require inside template interpolation as real code", () => {
    const [ref] = extractImports('const v = `loaded: ${require("../repository/users")}`;');
    assert.equal(ref?.specifier, "../repository/users");
  });

  it("extracts multiline re-exports and aliased Go imports", () => {
    const [reExport] = extractImports('export {\n  Repo\n} from "../repository/users";');
    assert.equal(reExport?.specifier, "../repository/users");
    const [goAlias] = extractImports('import alias "example.com/project/repository"');
    assert.equal(goAlias?.specifier, "example.com/project/repository");
  });

  it("extracts a dotted import that has a trailing comment", () => {
    const [ref] = extractImports("import com.acme.repository.Repo; // boundary");
    assert.equal(ref?.specifier, "com.acme.repository.Repo");
  });

  it("extracts Go entries only inside an import block", () => {
    const found = extractImports('import (\n    "fmt"\n)\n\nconst x = "not/an/import"');
    assert.deepEqual(
      found.map((ref) => ref.specifier),
      ["fmt"],
    );
  });

  it("extracts dynamic, multiline and aliased imports", () => {
    assert.equal(extractImports('const r = await import("../repo/users");')[0]?.specifier, "../repo/users");
    assert.equal(extractImports('import {\n  Repo\n} from "../repo/users";')[0]?.specifier, "../repo/users");
    assert.equal(extractImports("import pkg.repository as repository")[0]?.specifier, "pkg.repository");
    assert.equal(extractImports("import com.acme.repository.Repo as R")[0]?.specifier, "com.acme.repository.Repo");
  });

  it("resolves Python relative imports by package level", () => {
    const [ref] = extractImports("from ..repository.users import User");
    assert.equal(ref.syntax, "python-relative");
    assert.equal(resolveSpecifier(ref, "src/controller/a.py"), "src/repository/users");
  });

  it("resolves relative specifiers against the importing file", () => {
    const rel = { specifier: "../rules/x.ts", line: 1, syntax: "es" } as const;
    const pkg = { specifier: "lodash", line: 1, syntax: "es" } as const;
    assert.equal(resolveSpecifier(rel, "src/commands/check.ts"), "src/rules/x.ts");
    assert.equal(resolveSpecifier(pkg, "src/commands/check.ts"), "lodash");
  });
});

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
