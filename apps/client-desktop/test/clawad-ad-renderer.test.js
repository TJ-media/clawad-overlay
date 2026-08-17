"use strict";
// 광고 스트립 렌더러 — 예상 포인트 보간 (CLAW-138 후속).
//
// 실제 clawad-ad-renderer.js를 최소 DOM 스텁 위에서 그대로 돌린다. 렌더러는 Electron이 아니라
// 브라우저 API만 쓰므로 getElementById·classList·addEventListener만 흉내내면 된다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const IDS = ["strip", "text", "meta", "brand", "reward", "open", "label", "notice-label", "notice-dismiss"];

/** 렌더러를 새 DOM 위에 올리고 render 함수를 돌려준다. */
function mountRenderer() {
  const measuredCutouts = [];
  const nodes = new Map(IDS.map((id) => [id, {
    textContent: "",
    hidden: false,
    classes: new Set(),
    listeners: new Map(),
    // 폭 측정이 잠깐 바꿨다 되돌리는 값 (CLAW-156). 되돌렸는지 테스트가 확인한다.
    // setProperty는 문구 컷아웃 폭을 넘기는 데 쓴다 (CLAW-169) — 실제 CSSStyleDeclaration과
    // 같이 커스텀 속성이 조회되게 둔다.
    style: {
      flex: "",
      width: "",
      custom: new Map(),
      setProperty(name, value) { this.custom.set(name, value); },
      getPropertyValue(name) { return this.custom.get(name) || ""; },
      removeProperty(name) { this.custom.delete(name); },
    },
    // 실제 레이아웃이 없으므로 문구 길이에 비례하는 가짜 폭을 돌려준다.
    // 폭을 재는 순간의 컷아웃도 함께 남긴다 — float 기여를 뺐는지 검사한다 (CLAW-219).
    getBoundingClientRect() {
      const self = nodes.get(id);
      if (id === "strip" && self.style.width === "max-content") {
        measuredCutouts.push(self.style.getPropertyValue("--meta-cutout"));
      }
      return { width: 40 + nodes.get("text").textContent.length * 7 };
    },
    classList: {
      add: (...names) => names.forEach((n) => nodes.get(id).classes.add(n)),
      remove: (...names) => names.forEach((n) => nodes.get(id).classes.delete(n)),
      toggle: (name, on) => (on ? nodes.get(id).classes.add(name) : nodes.get(id).classes.delete(name)),
    },
    addEventListener(type, callback) { nodes.get(id).listeners.set(type, callback); },
    click() {
      const callback = nodes.get(id).listeners.get("click");
      if (callback) callback({ stopPropagation: () => {} });
    },
  }]));

  let render = null;
  const body = {};
  global.document = { getElementById: (id) => nodes.get(id) || null, body };
  const reported = [];
  let dismissed = 0;
  global.window = {
    // clawad-ad.html의 `body { padding: 2px 3px 8px; }`와 같은 값. 창 폭은 스트립 바깥의
    // 이 여백까지 포함해야 한다 — 빼먹으면 문구가 길이와 무관하게 말줄임된다.
    // 스트립의 열 간격은 문구 컷아웃 폭에 더해진다 (CLAW-169). clawad-ad.html의 column-gap과 같은 값.
    getComputedStyle: (node) => (node === body
      ? { paddingLeft: "3px", paddingRight: "3px" }
      : { columnGap: "8px" }),
    clawadAdAPI: {
      onAd: (cb) => { render = cb; },
      openAd: () => {},
      dismissNotice: () => { dismissed += 1; },
      reportWidth: (px) => reported.push(px),
    },
  };

  const file = require.resolve("../src/clawad-ad-renderer");
  delete require.cache[file];
  require(file);

  assert.ok(render, "렌더러가 onAd로 등록돼야 한다");
  return {
    render,
    reward: nodes.get("reward"),
    strip: nodes.get("strip"),
    text: nodes.get("text"),
    meta: nodes.get("meta"),
    noticeDismiss: nodes.get("notice-dismiss"),
    dismissed: () => dismissed,
    reported,
    measuredCutouts,
  };
}

function ad(verifying, confirmed) {
  return { kind: "ad", text: "광고 문구", brand: "클로애드", linked: false, reward: { verifying, confirmed } };
}

test("첫 표시는 굴리지 않고 서버 값을 바로 보여준다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reward } = mountRenderer();

  render(ad(407, 2000));

  assert.strictEqual(reward.textContent, "예상 적립 407P · 확정 2,000P");
});

// 페이싱이 직전 갱신 간격을 따라가므로(CLAW-157) Date도 함께 목킹해 간격을 통제한다.
// 통제하지 않으면 두 render가 같은 ms에 일어나 하한(1s)이 걸리고 한 번에 여러 칸이 오른다.
test("1 오르면 0.1씩 굴러 올라가고 정확히 서버 값에서 멈춘다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { render, reward } = mountRenderer();
  render(ad(407, 2000));

  t.mock.timers.tick(6000); // 갱신 간격 6초
  render(ad(408, 2000));

  // 거리 10틱을 span(6s × 0.9 = 5.4s)에 걸쳐 나누므로 한 칸에 540ms다 (CLAW-165).
  const seen = [];
  for (let i = 0; i < 10; i += 1) {
    t.mock.timers.tick(540);
    seen.push(reward.textContent);
  }

  assert.deepStrictEqual(seen.slice(0, 3), [
    "예상 적립 407.1P · 확정 2,000P",
    "예상 적립 407.2P · 확정 2,000P",
    "예상 적립 407.3P · 확정 2,000P",
  ]);
  // 부동소수 오차로 407.9999가 남으면 안 된다. 끝점은 서버 값 그대로여야 한다.
  assert.strictEqual(seen[9], "예상 적립 408P · 확정 2,000P");

  // 도달한 뒤로는 더 움직이지 않는다.
  t.mock.timers.tick(2000);
  assert.strictEqual(reward.textContent, "예상 적립 408P · 확정 2,000P");
});

// CLAW-157: 예전에는 1.0P 넘는 변화를 통째로 스냅해 굴러가는 표시가 아예 안 보였다. 이제는
// 거리 대신 **시간**을 묶는다 — 한 번에 올리는 양을 거리에 맞춰 키워 먼 거리도 같은 시간에 끝낸다.
test("밀린 sync가 크게 들어와도 굴리되 오래 기어오르지 않는다 (CLAW-157)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reward } = mountRenderer();
  render(ad(407, 2000));

  render(ad(507, 2000)); // 100P = 1000 tenths
  assert.notStrictEqual(reward.textContent, "예상 적립 507P · 확정 2,000P", "즉시 스냅하지 않는다");

  // 기본 span(6s) 안에 끝난다. 0.1씩이었다면 100초가 걸렸을 거리다.
  t.mock.timers.tick(6000);
  assert.strictEqual(reward.textContent, "예상 적립 507P · 확정 2,000P");
});

test("감소는 굴리지 않고 바로 맞춘다 — 거꾸로 굴리지 않는다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reward } = mountRenderer();
  render(ad(407, 2000));

  // 검증이 끝나 확정으로 넘어가면 예상은 줄어든다.
  render(ad(0, 2507));
  assert.strictEqual(reward.textContent, "예상 적립 0P · 확정 2,507P");
});

// CLAW-157: 예전 목표값(verifying)은 서버 구조상 항상 0이라 굴러가는 표시가 한 번도 동작하지
// 않았다. 캐리까지 담은 총액(accruedTenths)이 오면 그걸 굴린다.
function accruedAd(accruedTenths, confirmed) {
  return {
    kind: "ad", text: "광고 문구", brand: "클로애드", linked: false,
    reward: { verifying: 0, confirmed, accruedTenths },
  };
}

test("적립 총액이 오면 그 값만 굴린다 — 확정은 따로 쓰지 않는다 (CLAW-165)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { render, reward } = mountRenderer();

  render(accruedAd(333, 33));
  // 총액이 확정을 이미 포함하므로 확정을 나란히 쓰면 더하는 것으로 오독된다. 하나만 보여준다.
  assert.strictEqual(reward.textContent, "예상 적립 33.3P");

  t.mock.timers.tick(6000);
  render(accruedAd(336, 33)); // 노출 1건 = +0.3P

  // 거리 3틱을 span(5.4s)에 걸쳐 나누므로 한 칸에 1.8초다. 예전에는 200ms마다 올려
  // 0.6초 만에 끝내고 다음 갱신까지 멈춰 있었다 (CLAW-165).
  t.mock.timers.tick(200);
  assert.strictEqual(reward.textContent, "예상 적립 33.3P", "짧은 거리를 몰아서 올리지 않는다");
  t.mock.timers.tick(1600);
  assert.strictEqual(reward.textContent, "예상 적립 33.4P", "굴러 올라간다");
  t.mock.timers.tick(6000);
  assert.strictEqual(reward.textContent, "예상 적립 33.6P", "서버 값에서 정확히 멈춘다");
});

// CLAW-165의 핵심: 거리가 짧아도 다음 갱신까지의 시간에 **걸쳐** 올라가야 한다.
// 예전 구현은 증분의 하한이 1이라 짧은 거리에서 간격이 늘어나지 않았고, 그래서
// 0.6초 움직이고 몇 분을 멈춰 있었다.
test("짧은 거리도 갱신 간격 전체에 걸쳐 고르게 올라간다 (CLAW-165)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { render, reward } = mountRenderer();

  render(accruedAd(1000, 100));
  t.mock.timers.tick(60000); // 갱신 간격 60초
  render(accruedAd(1003, 100)); // +0.3P

  // span은 54초, 거리는 3틱 → 한 칸에 18초. 예전이라면 0.6초 만에 끝났을 거리다.
  t.mock.timers.tick(10000);
  assert.strictEqual(reward.textContent, "예상 적립 100P", "10초 시점에는 아직 안 움직였다");
  t.mock.timers.tick(9000);
  assert.strictEqual(reward.textContent, "예상 적립 100.1P");
  t.mock.timers.tick(18000);
  assert.strictEqual(reward.textContent, "예상 적립 100.2P");
  t.mock.timers.tick(18000);
  assert.strictEqual(reward.textContent, "예상 적립 100.3P", "갱신 간격 끝에 서버 값에 닿는다");
});

test("적립 총액이 없는 구 CLI에서는 기존 표기와 동작을 유지한다 (CLAW-157)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { render, reward } = mountRenderer();

  // 이 조합의 굴러가는 값은 **검증 중**이라 대개 0P다. 확정을 지우면 잔액이 화면에서 사라지므로
  // 구 CLI에서는 두 값을 그대로 유지한다 (CLAW-165).
  render(ad(12, 34));
  assert.strictEqual(reward.textContent, "예상 적립 12P · 확정 34P");
});

test("적립 총액이 정수가 아니면 무시하고 검증 중 값으로 되돌아간다 (CLAW-157)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  const { render, reward } = mountRenderer();

  render({
    kind: "ad", text: "광고 문구", brand: "클로애드", linked: false,
    reward: { verifying: 7, confirmed: 34, accruedTenths: 33.6 },
  });
  assert.strictEqual(reward.textContent, "예상 적립 7P · 확정 34P");
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

/** clawad-ad.html의 body 좌우 여백(3px + 3px). 창 폭은 스트립 바깥의 이 여백까지 포함해야 한다. */
const BODY_SIDE_PADDING = 6;

test("렌더 후 내용 자연 폭을 메인에 보고한다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reported } = mountRenderer();

  render({ kind: "ad", text: "짧은 광고", brand: "클로애드", linked: false, reward: null });

  assert.strictEqual(reported.length, 1);
  assert.strictEqual(reported[0], 40 + "짧은 광고".length * 7 + BODY_SIDE_PADDING);
});

// 메인은 보고받은 값을 그대로 **창 폭**으로 쓴다. 스트립 폭만 보고하면 창이 body 여백만큼
// 좁게 떠서 스트립이 눌리고, 문구가 짧든 길든 전부 말줄임된다. 그 회귀를 여기서 잡는다.
test("보고 폭은 스트립 폭이 아니라 body 여백을 더한 창 폭이다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reported } = mountRenderer();

  render({ kind: "ad", text: "짧은", brand: "", linked: false, reward: null });
  const stripWidth = 40 + "짧은".length * 7;

  assert.ok(reported[0] > stripWidth, "창 폭은 스트립 폭보다 커야 한다 — 안 그러면 항상 말줄임된다");
  assert.strictEqual(reported[0] - stripWidth, BODY_SIDE_PADDING);
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

  assert.strictEqual(strip.style.width, "", "#strip의 width가 원래대로 돌아와야 한다");
});

test("문구가 비켜 갈 폭을 적립 현황 폭 + 열 간격으로 넘긴다 (CLAW-169)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, strip, meta } = mountRenderer();

  render({ kind: "ad", text: "광고 문구", brand: "클로애드", linked: false, reward: { verifying: 5, confirmed: 1 } });

  // 스텁의 getBoundingClientRect는 문구 길이에 비례한 가짜 폭을 준다. 컷아웃은 그 폭 + 8px이어야 한다.
  const expected = `${Math.ceil(meta.getBoundingClientRect().width + 8)}px`;
  assert.strictEqual(strip.style.getPropertyValue("--meta-cutout"), expected);
});

test("광고를 숨길 때는 폭을 보고하지 않는다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, reported } = mountRenderer();

  render(null);

  assert.deepStrictEqual(reported, []);
});

test("안내 끄기 버튼은 끌 수 있는 안내에만 보이고 별도 신호를 보낸다 (CLAW-163)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { render, noticeDismiss, dismissed } = mountRenderer();

  render({
    kind: "notice", text: "안내", brand: "", linked: false, reward: null,
    dismissible: true, dismissLabel: "안내 끄기",
  });
  assert.strictEqual(noticeDismiss.hidden, false);
  assert.strictEqual(noticeDismiss.textContent, "안내 끄기");
  noticeDismiss.click();
  assert.strictEqual(dismissed(), 1);

  render(ad(1, 1));
  assert.strictEqual(noticeDismiss.hidden, true, "광고에는 안내 끄기 버튼을 노출하지 않는다");

  render({ kind: "login", text: "로그인", brand: "", linked: true, reward: null, dismissible: false });
  assert.strictEqual(noticeDismiss.hidden, true, "로그인 안내는 기존 동작을 유지한다");
});

// 고유 폭 계산에는 float의 박스 폭이 더해지고 shape-outside는 반영되지 않는다. 컷아웃을 켜 둔
// 채로 재면 창이 그만큼 넓어지고, 실제 배치에서는 shape가 1행을 통과시켜 문구 오른쪽에 컷아웃
// 폭만큼 빈칸이 남는다 (macOS 실측 55~74px, CLAW-219).
test("자연 폭을 잴 때는 컷아웃 float을 빼고 잰다 (CLAW-219)", () => {
  const { render, strip, measuredCutouts } = mountRenderer();

  render({ kind: "ad", text: "광고 문구", brand: "클로애드", linked: false, reward: { verifying: 10, confirmed: 100 } });

  assert.ok(measuredCutouts.length > 0, "max-content로 재는 순간이 있어야 한다");
  for (const seen of measuredCutouts) {
    assert.strictEqual(seen, "0px", "재는 동안에는 컷아웃이 폭에 더해지지 않아야 한다");
  }
  // 레이아웃 시점의 컷아웃은 건드리지 않는다 — 두 줄로 감기는 문구가 2행을 비켜 가야 한다.
  const restored = strip.style.getPropertyValue("--meta-cutout");
  assert.match(restored, /^\d+px$/, `측정 뒤 컷아웃이 복원돼야 한다: ${restored}`);
  assert.notStrictEqual(restored, "0px");
});
