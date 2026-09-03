// Segment-by-segment matcher. No regex compilation, no dependency on the
// Node URL parser for the matching itself, so it can be reused unchanged
// in a browser or a worker.

export type Segment =
  | { type: "static"; value: string }
  | { type: "param"; name: string }
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
    if (part === "*") {
      if (index !== parts.length - 1) {
        throw new Error(`wildcard must be the last segment in "${pattern}"`);
      }
      segments.push({ type: "wildcard" });
    } else if (part.startsWith(":")) {
      const name = part.slice(1);
      if (name.length === 0) {
        throw new Error(`empty param name in "${pattern}"`);
      }
      segments.push({ type: "param", name });
    } else {
      segments.push({ type: "static", value: part });
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
  const params: Record<string, string> = {};

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === undefined) {
      return null;
    }

    if (segment.type === "wildcard") {
      params["*"] = parts.slice(i).join("/");
      return params;
    }

    const part = parts[i];
    if (part === undefined) {
      return null;
    }

    if (segment.type === "static") {
      if (part !== segment.value) {
        return null;
      }
    } else {
      params[segment.name] = decodeURIComponent(part);
    }
  }

  return parts.length === segments.length ? params : null;
}
