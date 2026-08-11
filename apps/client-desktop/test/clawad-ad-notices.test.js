"use strict";
// 광고가 아닌 안내 문구 (CLAW-138 후속).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { IDLE_NOTICES, LOGIN_NOTICE, NOTICE_ROTATE_MS, rotatingNotice } = require("../src/clawad-ad-notices");
const { NOTICE_MAX_WIDTH } = require("../src/clawad-ad-width");

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

// 문구가 길어져 말줄임되는 사고를 두 번 냈다: CLAW-170이 문구를 늘려 회전 중 잘렸고,
// 로그인 안내는 상한(당시 320px)보다 길어 항상 잘렸다. 폭은 렌더러가 실측하지만 node
// 테스트에는 폰트가 없으므로, 실측값으로 보정한 어림식으로 상한을 넘는 문구를 막는다.
//
// 어림식은 실측 대비 3~9px **높게** 나오도록 잡았다(4종 실측 350·365·332·329px).
// 정확한 값이 필요한 게 아니라 "이 문구가 상한을 넘겠는가"만 판별하면 되고,
// 넘칠 때 놓치는 것보다 여유를 적게 잡는 편이 안전하다.
const CJK_PX = 12; // 12px 폰트에서 한글 한 글자
const SPACE_PX = 4;
const ASCII_PX = 7; // 문장부호·영문
const CHROME_PX = 72; // [안내] 배지 + 열 간격 + 패널/본문 좌우 여백 + 테두리

function estimateNoticeWidth(notice) {
  let width = CHROME_PX;
  for (const ch of notice) {
    if (ch === " ") width += SPACE_PX;
    else if (/[ㄱ-힝一-鿿]/.test(ch)) width += CJK_PX;
    else width += ASCII_PX;
  }
  return width;
}

test("안내 문구가 창 폭 상한 안에 들어간다 — 넘치면 말줄임된다", () => {
  for (const notice of [...IDLE_NOTICES, LOGIN_NOTICE]) {
    const estimated = estimateNoticeWidth(notice);
    assert.ok(
      estimated <= NOTICE_MAX_WIDTH,
      `문구가 상한(${NOTICE_MAX_WIDTH}px)을 넘어 잘린다: 약 ${estimated}px — ${notice}`
    );
  }
});

test("안내 문구는 광고로 오인되지 않아야 한다", () => {
  for (const notice of [...IDLE_NOTICES, LOGIN_NOTICE]) {
    assert.ok(notice.length > 0, "빈 문구는 렌더러가 숨겨 버린다");
    assert.doesNotMatch(notice, /\[광고\]/, "안내에 광고 표기를 붙이지 않는다");
    // Anthropic 공식으로 오인될 표현 금지 (CLAUDE.md §4)
    assert.doesNotMatch(notice, /Anthropic|Claude/i, `공식 서비스로 오인될 표현: ${notice}`);
  }
});
