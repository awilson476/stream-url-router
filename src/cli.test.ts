// Exercises the compiled dist/cli.js the way npm and a real shell would,
// not the src/ source - a bug in the shebang, the bin path in package.json,
// or what actually ends up in dist/ would slip past tests that only import
// router.ts directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  accessSync,
  constants as fsConstants,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs from dist/cli.test.js once compiled, so its own directory
// is dist/ - the same directory package.json's "bin" entry points into.
const distDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(distDir, "cli.js");

function writeRoutesFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "route-match-test-"));
  const routesPath = join(dir, "routes.json");
  writeFileSync(
    routesPath,
    JSON.stringify([{ name: "user-profile", pattern: "/users/:id" }]),
  );
  return routesPath;
}

function run(
  args: string[],
  input: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    child.stdin.end(input);
  });
}

test("dist/cli.js starts with a node shebang", () => {
  const firstLine = readFileSync(cliPath, "utf8").split("\n")[0];
  assert.equal(firstLine, "#!/usr/bin/env node");
});

test("dist/cli.js can be marked executable and invoked directly", {
  skip: process.platform === "win32",
}, () => {
  // npm sets this bit itself when it installs a package's "bin" entries,
  // so this isn't testing npm - it's checking that nothing about the file
  // (a shebang typo, a BOM, CRLF line endings from tsc) would stop the
  // OS from running it once that bit is set.
  chmodSync(cliPath, 0o755);
  accessSync(cliPath, fsConstants.X_OK);
});

test("built CLI matches routes end to end over stdin/stdout", async () => {
  const routesPath = writeRoutesFile();
  const { stdout, stderr, code } = await run(
    ["--routes", routesPath],
    "/users/42\n/nope\n",
  );

  assert.equal(stderr, "");
  assert.equal(code, 0);

  const lines = stdout.trim().split("\n");
  assert.deepEqual(JSON.parse(lines[0] as string), {
    input: "/users/42",
    matched: true,
    name: "user-profile",
    pattern: "/users/:id",
    params: { id: "42" },
  });
  assert.deepEqual(JSON.parse(lines[1] as string), {
    input: "/nope",
    matched: false,
  });
});

test("missing --routes prints usage on stderr and exits non-zero", async () => {
  const { stderr, code } = await run([], "");
  assert.notEqual(code, 0);
  assert.match(stderr, /usage: route-match/);
});

function writeRoutesFileWith(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "route-match-test-"));
  const routesPath = join(dir, "routes.json");
  writeFileSync(routesPath, contents);
  return routesPath;
}

test("routes file that isn't a JSON array fails with a clear message", async () => {
  const routesPath = writeRoutesFileWith(
    JSON.stringify({ name: "user-profile", pattern: "/users/:id" }),
  );
  const { stderr, code } = await run(["--routes", routesPath], "");
  assert.notEqual(code, 0);
  assert.match(stderr, /must contain a JSON array/);
});

test("route entry missing a name or pattern fails with a clear message", async () => {
  const routesPath = writeRoutesFileWith(
    JSON.stringify([{ name: "user-profile" }]),
  );
  const { stderr, code } = await run(["--routes", routesPath], "");
  assert.notEqual(code, 0);
  assert.match(stderr, /needs a string "name" and "pattern"/);
});

test("invalid route pattern fails with a clear message naming the route", async () => {
  const routesPath = writeRoutesFileWith(
    JSON.stringify([{ name: "bad", pattern: "/*/users" }]),
  );
  const { stderr, code } = await run(["--routes", routesPath], "");
  assert.notEqual(code, 0);
  assert.match(stderr, /route "bad"/);
});

test("malformed JSON in the routes file fails with a clear message", async () => {
  const routesPath = writeRoutesFileWith("not json");
  const { stderr, code } = await run(["--routes", routesPath], "");
  assert.notEqual(code, 0);
  assert.match(stderr, /is not valid JSON/);
});
