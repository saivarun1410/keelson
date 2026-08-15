# keelson

**Your repo's architecture rules, enforced the moment an AI agent tries to break them — not 20 minutes later in CI.**

One rule file. Works at agent edit time *and* in CI. Any language.

![keelson blocking a controller-to-repository edit](docs/hero.gif)

The agent reads that denial, corrects itself, and moves on — in the same turn. You never see the bad commit.

*(Recorded against [`demo/fixture`](demo/fixture) — reproduce it with `cd demo && vhs hero.tape`.)*

---

## Why

Coding agents don't read your CONTRIBUTING.md. They take the shortest path to a working diff: a 900-line file gets another 200 lines appended, a controller reaches straight into a repository, the implementation lands without its test.

You already know this, which is why you wrote it down in `CLAUDE.md` — and why it keeps happening anyway. Prompts are suggestions. Hooks are enforcement.

CI catches it eventually, but by then the agent has moved on, the context is gone, and fixing it is your job instead of the model's.

## Install

```bash
npm install -D keelson
npx keelson init          # writes a keelson.yaml inferred from your repo
```

`init` sets the initial line limit just above your repo's 95th-percentile file, so it passes on day one and you ratchet it down. A linter that fails 400 times on install gets deleted.

Then wire up the hook in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "npx keelson hook" }]
      }
    ]
  }
}
```

And the same rules in CI:

```yaml
- run: npx keelson check
```

## Rules

```yaml
version: 1

rules:
  - id: max-file-lines
    files: ["src/**/*.ts"]
    max: 300

  - id: banned-symbols
    files: ["**/*.java"]
    symbols:
      - pattern: "System\\.out\\.print"
        message: "Use SLF4J, not System.out"
      - pattern: "@Autowired\\s*$"
        message: "Use constructor injection, not field @Autowired"

  - id: layer-boundaries
    from: "**/controller/**"
    disallow: ["**/repository/**"]
    message: "Controllers must go through a service."

  - id: required-companion
    files: ["src/**/*.ts"]
    companion: "test/{name}.test.ts"
```

| Rule | Catches |
|---|---|
| `max-file-lines` | Agents appending to a file instead of splitting it |
| `banned-symbols` | `console.log`, `System.out`, field injection, debug leftovers |
| `layer-boundaries` | Dependency-direction breaches, in any language |
| `required-companion` | Implementation shipped without its test |

Every rule takes `severity: error` (blocks, exit 1) or `severity: warn` (reports only).

## Why not…

| | Runs at edit time | Languages | Config |
|---|---|---|---|
| **keelson** | **yes** | **any** | one file |
| ESLint / rules | no | JS/TS | per-language |
| ArchUnit | no (test time) | Java | Java code |
| dependency-cruiser | no (CI time) | JS/TS | one file |
| hand-rolled hook scripts | yes | any | per-repo bash |

The existing architecture linters are good, and they all run *after* the code exists. keelson runs the same rules at both points, so nothing passes the hook and then fails the build.

## Language support

`layer-boundaries` matches import specifiers both as resolved repo paths and as raw strings, so one rule shape covers relative imports (`../repository/x`), package names (`lodash`), and fully-qualified names (`com.acme.data.Repo`). There is no AST parser and no per-language plugin — that's the point.

Import extraction currently understands ES modules, CommonJS, Java/Kotlin, Python, and Go.

## Design guarantees

- **Fails open, always.** A malformed payload, a missing config, or a bug in keelson exits 0 with no decision. A tool that wedges your session when it breaks gets uninstalled. It will never block you for its own reasons — only for yours.
- **~40ms per hook invocation**, of which ~17ms is Node's own startup. Bundled to a single minified file with one runtime dependency.
- **Same engine both sides.** `check` and `hook` run identical rule code, so the hook can't disagree with CI.
- **keelson enforces its own `keelson.yaml` on itself**, in CI and at edit time. See the repo root.

## Commands

```
keelson check [globs...]   Check the repo. Exit 1 on error-severity violations.
keelson hook               PreToolUse hook. Reads the payload on stdin.
keelson init               Write a starter keelson.yaml inferred from this repo.
```

## Status

v0.1 — four rules, working end to end. Rule ideas and bug reports welcome; see the open issues tagged `good first issue`.

## License

MIT
