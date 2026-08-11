"use strict";
// 광고 패널 가변 폭 (CLAW-156).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  MIN_AD_WIDTH,
  AD_WIDTH_STEP_PX,
  AD_STRIP_HEIGHT,
  NOTICE_MAX_WIDTH,
  NOTICE_STRIP_HEIGHT,
  clampWidth,
  shouldAdopt,
  stripHeight,
} = require("../src/clawad-ad-width");

test("측정값이 없으면 예전처럼 정책 상한을 쓴다 — 좁아지지 않을 뿐 깨지지 않는다", () => {
  for (const missing of [null, undefined, 0, -10, NaN, "300"]) {
    assert.strictEqual(clampWidth(missing, 420), 420, `${JSON.stringify(missing)}`);
  }
});

test("내용이 짧으면 좁힌다", () => {
  assert.strictEqual(clampWidth(300, 420), 300);
  assert.strictEqual(clampWidth(287.2, 420), 288, "올림해서 글자가 잘리지 않게 한다");
});

test("정책 상한을 넘지 않는다 — 최대는 지금 잡아둔 크기 그대로", () => {
  assert.strictEqual(clampWidth(900, 420), 420);
  assert.strictEqual(clampWidth(800, 1000), 720, "하드 상한 720도 유지한다");
});

test("2행이 들어갈 최소 폭 아래로는 줄이지 않는다", () => {
  assert.strictEqual(clampWidth(100, 420), MIN_AD_WIDTH);
  assert.strictEqual(clampWidth(1, 420), MIN_AD_WIDTH);
});

test("상한이 최소 폭보다 작으면 상한을 지킨다 — 안내 문구처럼 좁은 창", () => {
  assert.strictEqual(clampWidth(100, 200), 200, "상한이 하한을 이긴다");
});

test("첫 측정은 항상 채택한다", () => {
  assert.strictEqual(shouldAdopt(300, null), true);
  assert.strictEqual(shouldAdopt(300, undefined), true);
});

test("임계값 미만으로 좁히는 변화는 무시한다 — 회전마다 창이 흔들리지 않게", () => {
  assert.strictEqual(shouldAdopt(300 - (AD_WIDTH_STEP_PX - 1), 300), false);
  assert.strictEqual(shouldAdopt(300 - AD_WIDTH_STEP_PX, 300), true);
});

test("넓히는 변화는 임계값 미만이어도 채택한다 — 막으면 문구가 말줄임된다", () => {
  // 흔들림 방지가 넓히는 쪽까지 막으면 창이 좁은 채로 남고, 창이 곧 패널이라 글자가 잘린다.
  assert.strictEqual(shouldAdopt(300 + 1, 300), true, "1px이라도 더 필요하면 넓혀야 한다");
  assert.strictEqual(shouldAdopt(300 + AD_WIDTH_STEP_PX - 1, 300), true);
  assert.strictEqual(shouldAdopt(300 + AD_WIDTH_STEP_PX, 300), true);
});

test("안내 문구 회전에서 말줄임이 생기지 않는다 — 실측 자연 폭 재현", () => {
  // 실측값(border-box, 12px 폰트): 안내 3종이 각각 350·365·332px.
  // 350 → 365는 15px 차이라 임계값 16px에 걸려 거절됐고, 창이 350에 머물러
  // "작업하는 동안에만 광고가 표시되며 리워드가 적립돼요"가 회전마다 잘렸다.
  const naturalWidths = [350, 365, 332];
  let current = null;

  for (let round = 0; round < 2; round += 1) {
    for (const natural of naturalWidths) {
      if (shouldAdopt(natural, current)) current = natural;
      assert.ok(
        clampWidth(current, NOTICE_MAX_WIDTH) >= natural,
        `창 폭이 자연 폭보다 좁으면 말줄임된다 (자연 ${natural}, 창 ${clampWidth(current, NOTICE_MAX_WIDTH)})`
      );
    }
  }
});

test("하한 이하로 내려가는 변화는 임계값과 무관하게 채택한다", () => {
  // 하한에 붙여두면 그 뒤로는 더 흔들리지 않는다.
  assert.strictEqual(shouldAdopt(MIN_AD_WIDTH - 1, MIN_AD_WIDTH + 5), true);
  // 이미 하한이면 더 바꿀 것이 없다.
  assert.strictEqual(shouldAdopt(MIN_AD_WIDTH - 50, MIN_AD_WIDTH), false);
});

test("측정값이 쓰레기면 채택하지 않는다", () => {
  for (const bad of [0, -1, NaN, Infinity, "300", null]) {
    assert.strictEqual(shouldAdopt(bad, 300), false, `${JSON.stringify(bad)}`);
  }
});

// --- 표시 종류별 패널 높이 (CLAW-169) ---

test("광고·안내·로그인은 모두 같은 두 행 높이를 쓴다", () => {
  for (const kind of ["ad", "notice", "login", undefined]) {
    assert.strictEqual(stripHeight(kind), NOTICE_STRIP_HEIGHT);
  }
  assert.strictEqual(AD_STRIP_HEIGHT, NOTICE_STRIP_HEIGHT);
});
