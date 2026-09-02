"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createSpinMeter } = require("../src/spin-meter");

const R = 120;          // comfortably outside minRadius
const STEP_MS = 100;    // BOOST_TICK_MS — the cadence while the mouse is moving

// Feeds `turns` of circling as `steps` samples and returns how many times it fired.
function circle(meter, { turns, steps, stepMs = STEP_MS, startAt = 1000, radius = R, sign = 1 }) {
  let fired = 0;
  let t = startAt;
  for (let i = 0; i <= steps; i += 1) {
    const angle = sign * (i / steps) * turns * 2 * Math.PI;
    if (meter.feed(angle, radius, t)) fired += 1;
    t += stepMs;
  }
  return fired;
}

describe("spin-meter", () => {
  it("1.5바퀴를 2초 안에 돌면 발동한다", () => {
    const meter = createSpinMeter();
    // 20샘플 × 100ms = 2.0초. 첫 샘플은 기준점이라 각도를 만들지 않는다.
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19 }), 1);
  });

  it("방향이 반대여도 발동한다", () => {
    const meter = createSpinMeter();
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19, sign: -1 }), 1);
  });

  it("1.4바퀴로는 발동하지 않는다", () => {
    const meter = createSpinMeter();
    assert.strictEqual(circle(meter, { turns: 1.4, steps: 19 }), 0);
  });

  it("좌우로 흔들면 부호가 상쇄돼 발동하지 않는다", () => {
    const meter = createSpinMeter();
    let fired = 0;
    let t = 1000;
    // 매번 반 바퀴씩 왕복 — 총 이동 각도는 넉넉히 1.5바퀴를 넘지만 합은 0 근처에 머문다.
    for (let i = 0; i < 40; i += 1) {
      const angle = (i % 2 === 0 ? 0 : Math.PI * 0.9);
      if (meter.feed(angle, R, t)) fired += 1;
      t += STEP_MS;
    }
    assert.strictEqual(fired, 0);
  });

  it("2초를 넘겨 천천히 돌면 창 밖 샘플이 빠져 발동하지 않는다", () => {
    const meter = createSpinMeter();
    // 같은 1.5바퀴지만 300ms 간격 — 총 5.7초라 2초 창에는 절반도 남지 않는다.
    // 간격이 idleResetMs(500ms)보다 짧아 "멈춤"으로 끊기지도 않는다.
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19, stepMs: 300 }), 0);
  });

  it("중심에 너무 가까운 샘플은 세지 않는다", () => {
    const meter = createSpinMeter();
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19, radius: 10 }), 0);
  });

  it("중간에 오래 멈추면 누적이 끊긴다", () => {
    const meter = createSpinMeter();
    let t = 1000;
    // 1바퀴만큼 돌다가
    for (let i = 0; i <= 12; i += 1) {
      meter.feed((i / 12) * 2 * Math.PI, R, t);
      t += STEP_MS;
    }
    t += 900;  // idleResetMs(500ms)를 넘겨 멈춤
    // 이어서 1바퀴 더 — 끊기지 않았다면 2바퀴가 되어 발동했을 것이다.
    let fired = 0;
    for (let i = 0; i <= 12; i += 1) {
      if (meter.feed((i / 12) * 2 * Math.PI, R, t)) fired += 1;
      t += STEP_MS;
    }
    assert.strictEqual(fired, 0);
  });

  it("발동 직후 쿨다운 동안에는 다시 발동하지 않는다", () => {
    const meter = createSpinMeter();
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19, startAt: 1000 }), 1);
    // 발동 시각(약 2900ms)에서 쿨다운 12초가 걸린다. 바로 다시 돌려도 조용해야 한다.
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19, startAt: 3100 }), 0);
    // 쿨다운이 지나면 다시 발동한다.
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19, startAt: 20000 }), 1);
  });

  it("reset은 진행 중인 제스처만 버리고 쿨다운은 남긴다", () => {
    const meter = createSpinMeter();
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19, startAt: 1000 }), 1);
    meter.reset();
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19, startAt: 3100 }), 0, "쿨다운이 남아야 한다");
    meter.clear();
    assert.strictEqual(circle(meter, { turns: 1.5, steps: 19, startAt: 6000 }), 1, "clear는 쿨다운까지 지운다");
  });
});
