import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "./router.js";

test("matches a static route", () => {
  const router = new Router();
  router.add("home", "/");
  router.add("about", "/about");

  assert.deepEqual(router.match("/about"), {
    name: "about",
    pattern: "/about",
    params: {},
  });
});

test("returns null when no route matches", () => {
  const router = new Router();
  router.add("about", "/about");

  assert.equal(router.match("/nope"), null);
});

test("captures a single param segment", () => {
  const router = new Router();
  router.add("user", "/users/:id");

  assert.deepEqual(router.match("/users/42"), {
    name: "user",
    pattern: "/users/:id",
    params: { id: "42" },
  });
});

test("captures multiple param segments", () => {
  const router = new Router();
  router.add("post", "/users/:userId/posts/:postId");

  assert.deepEqual(router.match("/users/7/posts/99"), {
    name: "post",
    pattern: "/users/:userId/posts/:postId",
    params: { userId: "7", postId: "99" },
  });
});

test("decodes percent-encoded param values", () => {
  const router = new Router();
  router.add("search", "/search/:term");

  assert.deepEqual(router.match("/search/a%20b"), {
    name: "search",
    pattern: "/search/:term",
    params: { term: "a b" },
  });
});

test("does not match when segment counts differ", () => {
  const router = new Router();
  router.add("user", "/users/:id");

  assert.equal(router.match("/users"), null);
  assert.equal(router.match("/users/42/extra"), null);
});

test("enforces a regex constraint on a param segment", () => {
  const router = new Router();
  router.add("user", "/users/:id(\\d+)");

  assert.deepEqual(router.match("/users/42")?.params, { id: "42" });
  assert.equal(router.match("/users/not-a-number"), null);
});

test("constraint is anchored, not a partial match", () => {
  const router = new Router();
  router.add("user", "/users/:id(\\d+)");

  assert.equal(router.match("/users/42abc"), null);
});

test("optional trailing param segment can be present or absent", () => {
  const router = new Router();
  router.add("post", "/posts/:id/:format?");

  assert.deepEqual(router.match("/posts/9/json")?.params, {
    id: "9",
    format: "json",
  });
  assert.deepEqual(router.match("/posts/9")?.params, { id: "9" });
});

test("optional static segment can be present or absent", () => {
  const router = new Router();
  router.add("index", "/docs/index.html?");

  assert.deepEqual(router.match("/docs/index.html")?.params, {});
  assert.deepEqual(router.match("/docs")?.params, {});
});

test("backtracks past an optional segment when the rest can't match", () => {
  const router = new Router();
  // If ":a?" greedily consumes "x", nothing is left to satisfy ":b" and the
  // match should back off and treat ":a?" as absent instead.
  router.add("pair", "/:a?/:b");

  assert.deepEqual(router.match("/x")?.params, { b: "x" });
  assert.deepEqual(router.match("/x/y")?.params, { a: "x", b: "y" });
});

test("wildcard captures everything after it, including slashes", () => {
  const router = new Router();
  router.add("assets", "/assets/*");

  assert.deepEqual(router.match("/assets/css/site.css")?.params, {
    "*": "css/site.css",
  });
});

test("wildcard can match an empty remainder", () => {
  const router = new Router();
  router.add("assets", "/assets/*");

  assert.deepEqual(router.match("/assets")?.params, { "*": "" });
});

test("first added route wins on overlapping patterns", () => {
  const router = new Router();
  router.add("specific", "/users/me");
  router.add("generic", "/users/:id");

  assert.equal(router.match("/users/me")?.name, "specific");
  assert.equal(router.match("/users/42")?.name, "generic");
});

test("match() strips query string and fragment", () => {
  const router = new Router();
  router.add("user", "/users/:id");

  assert.deepEqual(router.match("/users/42?tab=posts#top")?.params, {
    id: "42",
  });
});

test("match() accepts a full URL string", () => {
  const router = new Router();
  router.add("user", "/users/:id");

  assert.deepEqual(router.match("https://example.com/users/42")?.params, {
    id: "42",
  });
});

test("throws when a wildcard is not the last segment", () => {
  const router = new Router();
  assert.throws(() => router.add("bad", "/*/users"));
});

test("throws on an empty param name", () => {
  const router = new Router();
  assert.throws(() => router.add("bad", "/users/:"));
});
