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

test("1 오르면 0.1씩 굴러 올라가고 정확히 서버 값에서 멈춘다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reward } = mountRenderer();
  render(ad(407, 2000));

  render(ad(408, 2000));

  const seen = [];
  for (let i = 0; i < 10; i += 1) {
    t.mock.timers.tick(100);
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
  t.mock.timers.tick(1000);
  assert.strictEqual(reward.textContent, "예상 408P · 확정 2,000P");
});

test("큰 점프와 감소는 굴리지 않고 바로 맞춘다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reward } = mountRenderer();
  render(ad(407, 2000));

  // 밀린 sync가 한 번에 들어오는 경우. 0.1씩 기어오르면 몇 분이 걸린다.
  render(ad(507, 2000));
  assert.strictEqual(reward.textContent, "예상 507P · 확정 2,000P");

  // 검증이 끝나 확정으로 넘어가면 예상은 줄어든다. 거꾸로 굴리지 않는다.
  render(ad(0, 2507));
  assert.strictEqual(reward.textContent, "예상 0P · 확정 2,507P");
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
