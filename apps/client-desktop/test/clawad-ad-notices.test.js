"use strict";
// 광고가 아닌 안내 문구 (CLAW-138 후속).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { IDLE_NOTICES, LOGIN_NOTICE, NOTICE_ROTATE_MS, rotatingNotice } = require("../src/clawad-ad-notices");

test("안내 문구는 회전 간격마다 다음 문구로 넘어가고 한 바퀴 돌면 처음으로 돌아온다", () => {
  const base = 0;
  const seen = [];
  for (let i = 0; i < IDLE_NOTICES.length; i += 1) {
    seen.push(rotatingNotice(base + i * NOTICE_ROTATE_MS));
  }

  assert.deepStrictEqual(seen, IDLE_NOTICES, "간격마다 순서대로 나와야 한다");
  assert.strictEqual(rotatingNotice(base + IDLE_NOTICES.length * NOTICE_ROTATE_MS), IDLE_NOTICES[0]);
});

test("같은 간격 안에서는 문구가 바뀌지 않는다 — 매 tick마다 깜빡이면 안 된다", () => {
  const start = 7 * NOTICE_ROTATE_MS;
  assert.strictEqual(rotatingNotice(start), rotatingNotice(start + NOTICE_ROTATE_MS - 1));
  assert.notStrictEqual(rotatingNotice(start), rotatingNotice(start + NOTICE_ROTATE_MS));
});

test("안내 문구는 광고로 오인되지 않아야 한다", () => {
  for (const notice of [...IDLE_NOTICES, LOGIN_NOTICE]) {
    assert.ok(notice.length > 0, "빈 문구는 렌더러가 숨겨 버린다");
    assert.doesNotMatch(notice, /\[광고\]/, "안내에 광고 표기를 붙이지 않는다");
    // Anthropic 공식으로 오인될 표현 금지 (CLAUDE.md §4)
    assert.doesNotMatch(notice, /Anthropic|Claude/i, `공식 서비스로 오인될 표현: ${notice}`);
  }
});
