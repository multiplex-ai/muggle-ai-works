import assert from "node:assert/strict";
import { test } from "node:test";

import { renderGreeting } from "../src/greeting.js";

test("greets a named visitor", () => {
  assert.equal(renderGreeting("Ada"), "<h1>Hello, Ada!</h1>");
});

test("falls back to friend for a blank name", () => {
  assert.equal(renderGreeting("  "), "<h1>Hello, friend!</h1>");
});
