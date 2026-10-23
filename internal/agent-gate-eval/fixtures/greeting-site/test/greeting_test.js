import assert from "node:assert/strict";
import { test } from "node:test";

import { renderGreeting } from "../src/greeting.js";

test("greets a named visitor and bids them farewell", () => {
  assert.equal(renderGreeting("Ada"), "<h1>Hello, Ada!</h1>\n<p>See you soon, Ada!</p>");
});

test("falls back to friend for a blank name in both lines", () => {
  assert.equal(renderGreeting("  "), "<h1>Hello, friend!</h1>\n<p>See you soon, friend!</p>");
});
