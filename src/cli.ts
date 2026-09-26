#!/usr/bin/env node
// Thin wrapper around Router. The only job here is to get URLs from stdin
// to the router and results to stdout without ever holding the full input
// in memory - readline hands us one line at a time, and we write each
// result out before asking for the next line.

import { createInterface } from "node:readline";
import {
  readFileSync,
  createReadStream,
  accessSync,
  constants as fsConstants,
} from "node:fs";
import { once } from "node:events";
import { Router } from "./router.js";

interface RouteConfig {
  name: string;
  pattern: string;
}

function usage(): never {
  process.stderr.write(
    "usage: route-match --routes <routes.json> [--urls <urls.txt>]\n" +
      "  reads URLs or paths one per line - from the --urls file if given,\n" +
      "  otherwise from stdin - and writes a JSON match result per line to\n" +
      "  stdout\n",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { routesPath: string; urlsPath: string | undefined } {
  const routesIndex = argv.indexOf("--routes");
  if (routesIndex === -1 || argv[routesIndex + 1] === undefined) {
    usage();
  }

  const urlsIndex = argv.indexOf("--urls");
  if (urlsIndex !== -1 && argv[urlsIndex + 1] === undefined) {
    usage();
  }

  return {
    routesPath: argv[routesIndex + 1] as string,
    urlsPath: urlsIndex === -1 ? undefined : (argv[urlsIndex + 1] as string),
  };
}

function isRouteConfig(value: unknown): value is RouteConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).name === "string" &&
    typeof (value as Record<string, unknown>).pattern === "string"
  );
}

function loadRouter(routesPath: string): Router {
  const raw = readFileSync(routesPath, "utf8");

  let configs: unknown;
  try {
    configs = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${routesPath} is not valid JSON: ${String(err)}`);
  }

  if (!Array.isArray(configs)) {
    throw new Error(`${routesPath} must contain a JSON array of routes`);
  }

  const router = new Router();
  configs.forEach((config: unknown, index: number) => {
    if (!isRouteConfig(config)) {
      throw new Error(
        `${routesPath}: route at index ${index} needs a string "name" and "pattern"`,
      );
    }
    try {
      router.add(config.name, config.pattern);
    } catch (err) {
      throw new Error(
        `${routesPath}: route "${config.name}": ${String(err)}`,
      );
    }
  });
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

// process.stdout.write() returns false once the internal buffer is full and
// queues the chunk instead of writing it right away. Ignoring that return
// value means a slow consumer downstream (a pipe into `sort`, a network
// socket, whatever) never applies backpressure, and readline keeps handing
// us lines as fast as it can read them - the write buffer grows without
// bound and we end up buffering the whole input in memory after all.
// Waiting for "drain" before asking readline for the next line caps memory
// at roughly one buffer's worth regardless of how slow the consumer is.
async function writeLine(line: string): Promise<void> {
  if (!process.stdout.write(line)) {
    await once(process.stdout, "drain");
  }
}

async function main(): Promise<void> {
  const { routesPath, urlsPath } = parseArgs(process.argv.slice(2));
  const router = loadRouter(routesPath);

  // createReadStream, like stdin, hands data over in chunks rather than
  // all at once, so pointing --urls at a multi-gigabyte file keeps the
  // same flat memory profile as piping it through stdin. A missing or
  // unreadable file is checked up front - once the stream is handed to
  // readline, an "error" event closes the interface without one, which
  // would make the CLI exit 0 having silently matched nothing.
  let input: NodeJS.ReadableStream = process.stdin;
  if (urlsPath !== undefined) {
    try {
      accessSync(urlsPath, fsConstants.R_OK);
    } catch (err) {
      throw new Error(`cannot read --urls file ${urlsPath}: ${String(err)}`);
    }
    input = createReadStream(urlsPath);
  }
  const rl = createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const result = router.match(pathOf(trimmed));
    const output = result
      ? { input: trimmed, matched: true, ...result }
      : { input: trimmed, matched: false };

    await writeLine(JSON.stringify(output) + "\n");
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
