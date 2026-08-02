"use strict";
// 광고 스트립 렌더러 — 예상 포인트 보간 (CLAW-138 후속).
//
// 실제 clawad-ad-renderer.js를 최소 DOM 스텁 위에서 그대로 돌린다. 렌더러는 Electron이 아니라
// 브라우저 API만 쓰므로 getElementById·classList·addEventListener만 흉내내면 된다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const IDS = ["strip", "text", "brand", "reward", "open", "label", "notice-label"];

/** 렌더러를 새 DOM 위에 올리고 render 함수를 돌려준다. */
function mountRenderer() {
  const nodes = new Map(IDS.map((id) => [id, {
    textContent: "",
    classes: new Set(),
    // 폭 측정이 잠깐 바꿨다 되돌리는 값 (CLAW-156). 되돌렸는지 테스트가 확인한다.
    style: { flex: "", width: "" },
    // 실제 레이아웃이 없으므로 문구 길이에 비례하는 가짜 폭을 돌려준다.
    getBoundingClientRect: () => ({ width: 40 + nodes.get("text").textContent.length * 7 }),
    classList: {
      add: (...names) => names.forEach((n) => nodes.get(id).classes.add(n)),
      remove: (...names) => names.forEach((n) => nodes.get(id).classes.delete(n)),
      toggle: (name, on) => (on ? nodes.get(id).classes.add(name) : nodes.get(id).classes.delete(name)),
    },
    addEventListener: () => {},
  }]));

  let render = null;
  global.document = { getElementById: (id) => nodes.get(id) || null };
  const reported = [];
  global.window = {
    clawadAdAPI: {
      onAd: (cb) => { render = cb; },
      openAd: () => {},
      reportWidth: (px) => reported.push(px),
    },
  };

  const file = require.resolve("../src/clawad-ad-renderer");
  delete require.cache[file];
  require(file);

  assert.ok(render, "렌더러가 onAd로 등록돼야 한다");
  return { render, reward: nodes.get("reward"), strip: nodes.get("strip"), text: nodes.get("text"), reported };
}

function ad(verifying, confirmed) {
  return { kind: "ad", text: "광고 문구", brand: "클로애드", linked: false, reward: { verifying, confirmed } };
}

test("첫 표시는 굴리지 않고 서버 값을 바로 보여준다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reward } = mountRenderer();

  render(ad(407, 2000));

  assert.strictEqual(reward.textContent, "예상 407P · 확정 2,000P");
});

// 페이싱이 직전 갱신 간격을 따라가므로(CLAW-157) Date도 함께 목킹해 간격을 통제한다.
// 통제하지 않으면 두 render가 같은 ms에 일어나 하한(1s)이 걸리고 한 번에 여러 칸이 오른다.
test("1 오르면 0.1씩 굴러 올라가고 정확히 서버 값에서 멈춘다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { render, reward } = mountRenderer();
  render(ad(407, 2000));

  t.mock.timers.tick(6000); // 갱신 간격 6초
  render(ad(408, 2000));

  const seen = [];
  for (let i = 0; i < 10; i += 1) {
    t.mock.timers.tick(200);
    seen.push(reward.textContent);
  }

  assert.deepStrictEqual(seen.slice(0, 3), [
    "예상 407.1P · 확정 2,000P",
    "예상 407.2P · 확정 2,000P",
    "예상 407.3P · 확정 2,000P",
  ]);
  // 부동소수 오차로 407.9999가 남으면 안 된다. 끝점은 서버 값 그대로여야 한다.
  assert.strictEqual(seen[9], "예상 408P · 확정 2,000P");

  // 도달한 뒤로는 더 움직이지 않는다.
  t.mock.timers.tick(2000);
  assert.strictEqual(reward.textContent, "예상 408P · 확정 2,000P");
});

// CLAW-157: 예전에는 1.0P 넘는 변화를 통째로 스냅해 굴러가는 표시가 아예 안 보였다. 이제는
// 거리 대신 **시간**을 묶는다 — 한 번에 올리는 양을 거리에 맞춰 키워 먼 거리도 같은 시간에 끝낸다.
test("밀린 sync가 크게 들어와도 굴리되 오래 기어오르지 않는다 (CLAW-157)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reward } = mountRenderer();
  render(ad(407, 2000));

  render(ad(507, 2000)); // 100P = 1000 tenths
  assert.notStrictEqual(reward.textContent, "예상 507P · 확정 2,000P", "즉시 스냅하지 않는다");

  // 기본 span(6s) 안에 끝난다. 0.1씩이었다면 100초가 걸렸을 거리다.
  t.mock.timers.tick(6000);
  assert.strictEqual(reward.textContent, "예상 507P · 확정 2,000P");
});

test("감소는 굴리지 않고 바로 맞춘다 — 거꾸로 굴리지 않는다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reward } = mountRenderer();
  render(ad(407, 2000));

  // 검증이 끝나 확정으로 넘어가면 예상은 줄어든다.
  render(ad(0, 2507));
  assert.strictEqual(reward.textContent, "예상 0P · 확정 2,507P");
});

// CLAW-157: 예전 목표값(verifying)은 서버 구조상 항상 0이라 굴러가는 표시가 한 번도 동작하지
// 않았다. 캐리까지 담은 총액(accruedTenths)이 오면 그걸 굴린다.
function accruedAd(accruedTenths, confirmed) {
  return {
    kind: "ad", text: "광고 문구", brand: "클로애드", linked: false,
    reward: { verifying: 0, confirmed, accruedTenths },
  };
}

test("적립 총액이 오면 그 값을 굴리고 확정을 괄호로 묶는다 (CLAW-157)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { render, reward } = mountRenderer();

  render(accruedAd(333, 33));
  // 확정을 더하는 것으로 읽히지 않게 괄호로 묶는다 — 총액이 확정을 이미 포함한다.
  assert.strictEqual(reward.textContent, "예상 33.3P (확정 33P)");

  t.mock.timers.tick(6000);
  render(accruedAd(336, 33)); // 노출 1건 = +0.3P

  t.mock.timers.tick(200);
  assert.strictEqual(reward.textContent, "예상 33.4P (확정 33P)", "굴러 올라간다");
  t.mock.timers.tick(6000);
  assert.strictEqual(reward.textContent, "예상 33.6P (확정 33P)", "서버 값에서 정확히 멈춘다");
});

test("적립 총액이 없는 구 CLI에서는 기존 표기와 동작을 유지한다 (CLAW-157)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { render, reward } = mountRenderer();

  render(ad(12, 34));
  assert.strictEqual(reward.textContent, "예상 12P · 확정 34P");
});

test("적립 총액이 정수가 아니면 무시하고 검증 중 값으로 되돌아간다 (CLAW-157)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { render, reward } = mountRenderer();

  render({
    kind: "ad", text: "광고 문구", brand: "클로애드", linked: false,
    reward: { verifying: 7, confirmed: 34, accruedTenths: 33.6 },
  });
  assert.strictEqual(reward.textContent, "예상 7P · 확정 34P");
});

test("적립 정보가 없으면 빈 문자열이고 굴러가던 것도 멈춘다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reward } = mountRenderer();
  render(ad(407, 2000));
  render(ad(408, 2000));

  render({ kind: "notice", text: "안내", brand: "", linked: false, reward: null });

  assert.strictEqual(reward.textContent, "");
  t.mock.timers.tick(1000);
  assert.strictEqual(reward.textContent, "", "멈춘 뒤에도 다시 그리지 않는다");
});

test("광고가 아닌 표시에는 notice 클래스가 붙어 [광고]가 [안내]로 바뀐다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, strip } = mountRenderer();

  render({ kind: "notice", text: "안내 문구", brand: "", linked: false, reward: null });
  assert.ok(strip.classes.has("notice"));

  render(ad(1, 1));
  assert.ok(!strip.classes.has("notice"), "광고에는 [광고]가 붙어야 한다");

  // kind가 없으면 광고로 본다 — 표기가 빠지는 쪽이 아니라 붙는 쪽으로 기운다.
  render({ text: "구 payload", brand: "", linked: false, reward: null });
  assert.ok(!strip.classes.has("notice"));
});

// --- 가변 폭 측정 (CLAW-156) ---

test("렌더 후 내용 자연 폭을 메인에 보고한다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reported } = mountRenderer();

  render({ kind: "ad", text: "짧은 광고", brand: "클로애드", linked: false, reward: null });

  assert.strictEqual(reported.length, 1);
  assert.strictEqual(reported[0], 40 + "짧은 광고".length * 7);
});

test("문구가 길어지면 보고하는 폭도 커진다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reported } = mountRenderer();

  render({ kind: "ad", text: "짧은", brand: "b", linked: false, reward: null });
  render({ kind: "ad", text: "아주 아주 아주 긴 광고 문구", brand: "b", linked: false, reward: null });

  assert.ok(reported[1] > reported[0], "긴 문구가 더 넓게 보고돼야 한다");
});

test("측정이 끝나면 임시로 바꾼 스타일을 되돌린다 — 화면에 남으면 안 된다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, strip, text } = mountRenderer();

  render({ kind: "ad", text: "광고 문구", brand: "클로애드", linked: false, reward: null });

  assert.strictEqual(text.style.flex, "", "#text의 flex가 원래대로 돌아와야 한다");
  assert.strictEqual(strip.style.width, "", "#strip의 width가 원래대로 돌아와야 한다");
});

test("광고를 숨길 때는 폭을 보고하지 않는다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reported } = mountRenderer();

  render(null);

  assert.deepStrictEqual(reported, []);
});
