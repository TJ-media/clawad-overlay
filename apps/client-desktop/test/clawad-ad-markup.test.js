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
  const darkModeChips = html.match(
    /@media \(prefers-color-scheme: dark\)\s*\{\s*(#label\s*\{[^}]*\}\s*#notice-label\s*\{[^}]*\})\s*\}/s,
  );
  assert.ok(darkModeChips, "다크모드 상태 칩 규칙은 dark media block 안에 있어야 한다");
  assert.match(darkModeChips[1], /#label\s*\{[^}]*background:\s*rgba\(245, 158, 11, 0\.20\)[^}]*color:\s*#fbbf24/s);
  assert.match(darkModeChips[1], /#notice-label\s*\{[^}]*background:\s*rgba\(22, 163, 74, 0\.20\)[^}]*color:\s*#4ade80/s);
});

test("안내 끄기는 배지 대신 밑줄 버튼이다", () => {
  assert.match(html, /#notice-dismiss\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*text-decoration:\s*underline/s);
  assert.doesNotMatch(html, /#notice-dismiss\s*\{[^}]*border-radius:/s);
  assert.match(html, /#notice-dismiss:focus-visible/);
  assert.match(html, /<button id="notice-dismiss" type="button" hidden><\/button>/);
});

test("광고판은 3열 2행 Grid에서 본문과 metadata가 둘째 행을 공유한다", () => {
  assert.match(html, /#strip\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto[^}]*grid-template-rows:\s*repeat\(2, 17px\)/s);
  assert.match(html, /#text\s*\{[^}]*grid-column:\s*2\s*\/\s*span 2[^}]*grid-row:\s*1\s*\/\s*span 2/s);
  assert.match(html, /#meta\s*\{[^}]*grid-column:\s*3[^}]*grid-row:\s*2/s);
  assert.match(html, /<div id="meta">\s*<span id="brand"><\/span>\s*<span id="reward"><\/span>/s);
});

test("안내 끄기는 [안내] 배지와 같은 열에서 시작한다", () => {
  // 2열에 두면 배지 폭+간격만큼 들여써져 문구에 딸린 것처럼 보인다. 1열에서 시작하되
  // 유연한 2열을 함께 걸쳐야 1열 폭이 배지가 아니라 이 버튼 기준으로 넓어지지 않는다.
  assert.match(html, /#notice-dismiss\s*\{[^}]*grid-column:\s*1\s*\/\s*span 2[^}]*grid-row:\s*2/s);
  assert.match(html, /#notice-dismiss\s*\{[^}]*justify-self:\s*start/s);
});

test("광고 문구는 2행 오른쪽만 비켜 ㄴ자로 흐른다 (CLAW-169)", () => {
  // 그리드 항목은 직사각형이라 ㄴ자로 놓을 수 없다. 2·3열 × 1·2행을 차지하고 2행 오른쪽만
  // float의 shape-outside로 도려낸다 — 위 한 줄은 비우고 아래 한 줄만 문구를 밀어낸다.
  // margin으로 내리면 마진 박스까지 줄 박스가 피해서 첫 줄도 같이 좁아진다.
  assert.match(html, /#text::before\s*\{[^}]*float:\s*right/s);
  assert.match(html, /#text::before\s*\{[^}]*shape-outside:\s*polygon\(0 17px, 100% 17px, 100% 34px, 0 34px\)/s);
  assert.doesNotMatch(html, /#text::before\s*\{[^}]*margin-top:/s);
  // 도려낼 폭은 적립 현황 길이에 따라 바뀌므로 렌더러가 변수로 넘긴다.
  assert.match(html, /#text::before\s*\{[^}]*width:\s*var\(--meta-cutout,/s);
  // 두 줄에서 줄 경계로 잘라야 세 번째 줄이 몇 px 삐져나오지 않는다.
  assert.match(html, /#text\s*\{[^}]*max-height:\s*34px[^}]*line-height:\s*17px/s);
});

test("안내 문구는 적립 현황 열까지 걸쳐 첫 행을 전부 쓴다", () => {
  // 안내는 한 줄이라 둘째 행을 비운다. 2열만 쓰면 3열 폭이 첫 행에서 그대로 비고
  // 그만큼 문구가 일찍 말줄임된다 (420px 창에서 가용 265px < 안내 문구 278px).
  assert.match(html, /#strip\.notice #text\s*\{[^}]*grid-column:\s*2\s*\/\s*span 2[^}]*grid-row:\s*1/s);
  // 한 줄뿐이라 도려낼 것이 없다. 컷아웃을 지우고 한 줄 말줄임을 쓴다.
  assert.match(html, /#strip\.notice #text::before\s*\{\s*content:\s*none;\s*\}/);
  assert.match(html, /#strip\.notice #text\s*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/s);
});
