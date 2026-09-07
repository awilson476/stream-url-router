// Segment-by-segment matcher. No regex compilation, no dependency on the
// Node URL parser for the matching itself, so it can be reused unchanged
// in a browser or a worker.

export type Segment =
  | { type: "static"; value: string; optional?: boolean }
  | { type: "param"; name: string; constraint?: RegExp; optional?: boolean }
  | { type: "wildcard" };

export interface CompiledRoute {
  name: string;
  pattern: string;
  segments: Segment[];
}

export interface MatchResult {
  name: string;
  pattern: string;
  params: Record<string, string>;
}

function compilePattern(pattern: string): Segment[] {
  const parts = pattern.split("/").filter((part) => part.length > 0);
  const segments: Segment[] = [];

  parts.forEach((part, index) => {
    // A trailing "?" marks the segment optional, e.g. ":format?" or
    // "index.html?". Stripped before the rest of the parsing below, so it
    // doesn't interfere with the constraint syntax on param segments.
    let raw = part;
    let optional = false;
    if (raw.length > 1 && raw.endsWith("?")) {
      optional = true;
      raw = raw.slice(0, -1);
    }

    if (raw === "*") {
      if (optional) {
        throw new Error(`wildcard cannot be optional in "${pattern}"`);
      }
      if (index !== parts.length - 1) {
        throw new Error(`wildcard must be the last segment in "${pattern}"`);
      }
      segments.push({ type: "wildcard" });
    } else if (raw.startsWith(":")) {
      // :name or :name(constraint), e.g. :id(\d+). The constraint is a
      // regex fragment tested against the raw (still-encoded) segment,
      // anchored on both ends so ":id(\d+)" can't match "12abc".
      const match = /^:([^():]+)(?:\((.+)\))?$/.exec(raw);
      if (match === null || match[1] === undefined || match[1].length === 0) {
        throw new Error(`empty param name in "${pattern}"`);
      }
      const name = match[1];
      const constraintSource = match[2];

      let constraint: RegExp | undefined;
      if (constraintSource !== undefined) {
        try {
          constraint = new RegExp(`^(?:${constraintSource})$`);
        } catch (err) {
          throw new Error(
            `invalid constraint in "${pattern}": ${String(err)}`,
          );
        }
      }

      segments.push({ type: "param", name, constraint, optional });
    } else {
      segments.push({ type: "static", value: raw, optional });
    }
  });

  return segments;
}

function splitPath(path: string): string[] {
  // Drop query string and fragment before splitting so callers can pass
  // either a bare path or a full URL string.
  const withoutFragment = path.split("#", 1)[0] ?? "";
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? "";
  return withoutQuery.split("/").filter((part) => part.length > 0);
}

export class Router {
  private routes: CompiledRoute[] = [];

  add(name: string, pattern: string): void {
    this.routes.push({ name, pattern, segments: compilePattern(pattern) });
  }

  // First route added that matches wins, same precedence rule as most
  // web frameworks. Callers that need static-before-param ordering should
  // add their most specific routes first.
  match(path: string): MatchResult | null {
    const parts = splitPath(path);

    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (params !== null) {
        return { name: route.name, pattern: route.pattern, params };
      }
    }

    return null;
  }
}

function matchSegments(
  segments: Segment[],
  parts: string[],
): Record<string, string> | null {
  return matchFrom(segments, parts, 0, 0, {});
}

// Optional segments mean a given part index doesn't map to a fixed segment
// index, so this can't be a single linear pass: "/:a?/:b" has to try
// consuming a part with the optional segment, and if that leaves nothing
// for the required segment after it, back off and skip the optional one
// instead. Recursion with a fallback branch is the simplest way to get
// that backtracking right.
function matchFrom(
  segments: Segment[],
  parts: string[],
  segIndex: number,
  partIndex: number,
  params: Record<string, string>,
): Record<string, string> | null {
  const segment = segments[segIndex];

  if (segment === undefined) {
    return partIndex === parts.length ? params : null;
  }

  if (segment.type === "wildcard") {
    return { ...params, "*": parts.slice(partIndex).join("/") };
  }

  const part = parts[partIndex];

  if (segment.optional === true) {
    if (part !== undefined) {
      const consumed = matchOne(segment, part, params);
      if (consumed !== null) {
        const result = matchFrom(
          segments,
          parts,
          segIndex + 1,
          partIndex + 1,
          consumed,
        );
        if (result !== null) {
          return result;
        }
      }
    }
    return matchFrom(segments, parts, segIndex + 1, partIndex, params);
  }

  if (part === undefined) {
    return null;
  }

  const consumed = matchOne(segment, part, params);
  if (consumed === null) {
    return null;
  }

  return matchFrom(segments, parts, segIndex + 1, partIndex + 1, consumed);
}

function matchOne(
  segment: Exclude<Segment, { type: "wildcard" }>,
  part: string,
  params: Record<string, string>,
): Record<string, string> | null {
  if (segment.type === "static") {
    return part === segment.value ? params : null;
  }

  if (segment.constraint !== undefined && !segment.constraint.test(part)) {
    return null;
  }

  return { ...params, [segment.name]: decodeURIComponent(part) };
}
