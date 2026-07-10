import { expect, test } from "bun:test";

const root = new URL("../..", import.meta.url).pathname;

async function runCli(args: readonly string[]) {
  const process = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("reports usage failures once without a stack", async () => {
  const result = await runCli(["git", "--since", "2023-02-29"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    "context git: Unknown --since value: 2023-02-29 (expected an ISO/RFC date, epoch timestamp, or relative duration like 2d / 2 days ago)\n" +
      "Run 'context --help' to see available commands.\n",
  );
  expect(result.stderr).not.toContain("src/");
  expect(result.stderr).not.toContain("UsageError");
});

test("shows command help only after validating all arguments", async () => {
  const help = await runCli(["help", "--help"]);
  expect(help.exitCode).toBe(0);
  expect(help.stdout).toStartWith("Usage: context help [command]");

  const invalid = await runCli(["git", "--help", "--unknown"]);
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stdout).toBe("");
  expect(invalid.stderr).toContain("context git: unknown option '--unknown'");
});
