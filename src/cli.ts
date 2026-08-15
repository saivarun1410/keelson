import { checkCommand } from "./commands/check.ts";
import { hookCommand } from "./commands/hook.ts";
import { initCommand } from "./commands/init.ts";
import { ConfigError } from "./types.ts";

const USAGE = `keelson — architecture rules enforced at agent edit time and in CI.

Usage:
  keelson check [globs...]   Check the repo (or matching files). Exit 1 on error-severity violations.
  keelson hook               PreToolUse hook. Reads the hook payload on stdin, denies violating edits.
  keelson init               Write a starter keelson.yaml inferred from this repo.

Wire the hook into .claude/settings.json:
  { "hooks": { "PreToolUse": [ { "matcher": "Write|Edit|MultiEdit",
      "hooks": [ { "type": "command", "command": "npx keelson hook" } ] } ] } }
`;

async function main(): Promise<number> {
  const [command, ...argv] = process.argv.slice(2);

  switch (command) {
    case "check":
      return checkCommand(argv);
    case "hook":
      return hookCommand();
    case "init":
      return initCommand();
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE);
      return command === undefined ? 1 : 0;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

const isHookMode = process.argv[2] === "hook";

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // The hook runs on every agent edit. If keelson itself breaks, it must get
    // out of the way rather than wedge the session.
    if (isHookMode) {
      process.exitCode = 0;
      return;
    }
    const message = error instanceof ConfigError ? error.message : String(error);
    process.stderr.write(`keelson: ${message}\n`);
    process.exitCode = 2;
  });
