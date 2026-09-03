#!/usr/bin/env node
// Thin wrapper around Router. The only job here is to get URLs from stdin
// to the router and results to stdout without ever holding the full input
// in memory - readline hands us one line at a time, and we write each
// result out before asking for the next line.

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { Router } from "./router.js";

interface RouteConfig {
  name: string;
  pattern: string;
}

function usage(): never {
  process.stderr.write(
    "usage: route-match --routes <routes.json>\n" +
      "  reads URLs or paths from stdin, one per line, and writes a\n" +
      "  JSON match result per line to stdout\n",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { routesPath: string } {
  const flagIndex = argv.indexOf("--routes");
  if (flagIndex === -1 || argv[flagIndex + 1] === undefined) {
    usage();
  }
  return { routesPath: argv[flagIndex + 1] as string };
}

function loadRouter(routesPath: string): Router {
  const raw = readFileSync(routesPath, "utf8");
  const configs = JSON.parse(raw) as RouteConfig[];

  const router = new Router();
  for (const config of configs) {
    router.add(config.name, config.pattern);
  }
  return router;
}

function pathOf(line: string): string {
  try {
    return new URL(line).pathname;
  } catch {
    // not a full URL, assume it's already a path
    return line;
  }
}

async function main(): Promise<void> {
  const { routesPath } = parseArgs(process.argv.slice(2));
  const router = loadRouter(routesPath);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const result = router.match(pathOf(trimmed));
    const output = result
      ? { input: trimmed, matched: true, ...result }
      : { input: trimmed, matched: false };

    process.stdout.write(JSON.stringify(output) + "\n");
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
