"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs
  .readFileSync(path.join(__dirname, "..", "src", "clawad-ad.html"), "utf8")
  .replace(/^\uFEFF/, "");

test("광고와 안내는 HUD 상태 칩 색상으로 구분된다", () => {
  assert.match(html, /#label\s*\{[^}]*background:\s*rgba\(245, 158, 11, 0\.15\)[^}]*color:\s*#b45309/s);
  assert.match(html, /#notice-label\s*\{[^}]*background:\s*rgba\(22, 163, 74, 0\.13\)[^}]*color:\s*#16a34a/s);
  assert.match(html, />\[광고\]</);
  assert.match(html, />\[안내\]</);
});

test("어두운 화면에서도 광고와 안내 상태 칩을 구분한다", () => {
  assert.match(html, /#label\s*\{[^}]*background:\s*rgba\(245, 158, 11, 0\.20\)[^}]*color:\s*#fbbf24/s);
  assert.match(html, /#notice-label\s*\{[^}]*background:\s*rgba\(22, 163, 74, 0\.20\)[^}]*color:\s*#4ade80/s);
});

test("안내 끄기는 배지 대신 밑줄 버튼이다", () => {
  assert.match(html, /#notice-dismiss\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*text-decoration:\s*underline/s);
  assert.doesNotMatch(html, /#notice-dismiss\s*\{[^}]*border-radius:/s);
  assert.match(html, /#notice-dismiss:focus-visible/);
  assert.match(html, /<button id="notice-dismiss" type="button" hidden><\/button>/);
});
