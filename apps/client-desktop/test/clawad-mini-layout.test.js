"use strict";

// 미니 모드는 layout 기반 정규화 배치를 타지 않고 objectScale 경로를 탄다.
// objectScale이 기본값(1.9×1.3)으로 돌아가면 벽에 붙은 마스코트만 일반 상태의
// 약 2배로 커지고 머리가 창 밖으로 잘린다 — 그 회귀를 여기서 잡는다.
const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const themeLoader = require("../src/theme-loader");
const hitGeometry = require("../src/hit-geometry");

themeLoader.init(path.join(__dirname, "..", "src"));
const clawad = themeLoader.loadTheme("clawad");

const BOUNDS = { x: 0, y: 0, width: 200, height: 200 };

function approx(actual, expected, label, epsilon = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${label}: ${actual} 가 ${expected} ±${epsilon} 를 벗어남`
  );
}

describe("clawad 미니 모드 배치", () => {
  it("미니 상태의 그림 크기·위치가 일반 idle과 같다", () => {
    const idle = hitGeometry.getAssetRectScreen(clawad, BOUNDS, "idle", "clawad-idle.svg");
    for (const [state, file] of Object.entries(clawad.miniMode.states)) {
      const mini = hitGeometry.getAssetRectScreen(clawad, BOUNDS, state, file[0]);
      approx(mini.x, idle.x, `${state} x`);
      approx(mini.y, idle.y, `${state} y`);
      approx(mini.w, idle.w, `${state} w`);
      approx(mini.h, idle.h, `${state} h`);
    }
  });

  it("미니 전용 viewBox를 두지 않는다 (에셋 캔버스는 일반 상태와 동일)", () => {
    assert.strictEqual(clawad.miniMode.viewBox, null);
  });
});
