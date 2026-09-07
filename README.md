# stream-url-router

A small path-matching router, plus a CLI for classifying a large list of
URLs against a set of route patterns.

The library part is what you'd expect: register patterns like
`/users/:id`, ask whether a given path matches any of them, get back the
route name and the captured params. Nothing unusual there.

The reason this exists is the CLI. I had a case where I needed to match
every URL in a multi-gigabyte access log against a route table, to see
which handler each request would have hit. Piping that through a script
that reads the whole file into a string (or an array of lines) either
falls over or eats all the memory on the box. `route-match` reads stdin
line by line and writes a result line by line, so memory use stays flat
no matter how big the input is.

## Library usage

```ts
import { Router } from "stream-url-router";

const router = new Router();
router.add("user-profile", "/users/:id");
router.add("user-posts", "/users/:id/posts/:postId");
router.add("static-assets", "/assets/*");

router.match("/users/42");
// { name: "user-profile", pattern: "/users/:id", params: { id: "42" } }

router.match("/assets/css/site.css");
// { name: "static-assets", pattern: "/assets/*", params: { "*": "css/site.css" } }

router.match("/nope");
// null
```

Param segments can carry a regex constraint in parentheses. The constraint
is tested against the raw segment and the whole segment must match it:

```ts
router.add("user-profile", "/users/:id(\\d+)");

router.match("/users/42");
// { name: "user-profile", pattern: "/users/:id(\\d+)", params: { id: "42" } }

router.match("/users/not-a-number");
// null - falls through to the next route, or null if there isn't one
```

A trailing `?` on a segment makes it optional:

```ts
router.add("post", "/posts/:id/:format?");

router.match("/posts/9/json");
// { name: "post", pattern: "/posts/:id/:format?", params: { id: "9", format: "json" } }

router.match("/posts/9");
// { name: "post", pattern: "/posts/:id/:format?", params: { id: "9" } }
```

Routes are matched in the order they were added, first match wins - the
same rule most web frameworks use. Put more specific routes before more
general ones.

Pattern syntax:

- `users` - literal segment, must match exactly
- `:id` - param segment, matches any single segment and captures it
- `:id(\d+)` - param segment with a regex constraint; only matches if the
  whole segment matches the constraint
- `:id?` / `users?` - trailing `?` makes a param or literal segment
  optional
- `*` - wildcard, must be the last segment, captures everything after it

`match()` also accepts a full URL string, not just a path - it strips the
query string and fragment before splitting into segments.

## CLI usage

Route definitions go in a JSON file:

```json
[
  { "name": "user-profile", "pattern": "/users/:id" },
  { "name": "static-assets", "pattern": "/assets/*" }
]
```

Then stream URLs through it:

```sh
printf '/users/42\n/assets/css/site.css\n/nope\n' | route-match --routes routes.json
```

```
{"input":"/users/42","matched":true,"name":"user-profile","pattern":"/users/:id","params":{"id":"42"}}
{"input":"/assets/css/site.css","matched":true,"name":"static-assets","pattern":"/assets/*","params":{"*":"css/site.css"}}
{"input":"/nope","matched":false}
```

Each input line produces exactly one output line, so it plays nicely with
`grep`, `jq`, or anything else downstream. Input lines can be bare paths
or full URLs (`https://example.com/users/42` works the same as
`/users/42`).

## Building

```sh
npm run build
```

Compiles `src/` to `dist/` with `tsc`. No runtime dependencies, so there's
nothing to install first beyond a TypeScript toolchain.

## Status

Early. The matcher handles static, param (with optional regex
constraints and optional segments), and trailing-wildcard segments; it
doesn't yet do route priority beyond insertion order.
