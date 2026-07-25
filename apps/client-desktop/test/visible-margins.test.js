const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const themeLoader = require("../src/theme-loader");
const hitGeometry = require("../src/hit-geometry");
const {
  getThemeMarginBox,
  computeThemeAnchorRect,
  collectThemeEnvelopeFiles,
  computeStableVisibleContentMargins,
  getLooseDragMargins,
  getRestClampMargins,
} = require("../src/visible-margins");

themeLoader.init(path.join(__dirname, "..", "src"));

describe("visible margin envelopes", () => {
  const bounds = { x: 0, y: 0, width: 280, height: 280 };

  // marginBox는 선택 필드다. 배포 테마가 그걸 갖고 있는지와, 있을 때 contentBox보다
  // 우선하는지는 별개 문제이므로 테스트가 직접 구성한다 (CLAW-122).
  it("prefers layout.marginBox over contentBox when present", () => {
    const theme = structuredClone(themeLoader.loadTheme(themeLoader.DEFAULT_THEME_ID));
    const contentBox = theme.layout.contentBox;
    // 위로만 넓힌다 — 아래는 그대로 두어 bottom 여백이 바뀌지 않는지 확인한다.
    const grow = 40;
    theme.layout.marginBox = {
      x: contentBox.x,
      y: contentBox.y - grow,
      width: contentBox.width,
      height: contentBox.height + grow,
    };

    assert.deepStrictEqual(getThemeMarginBox(theme), theme.layout.marginBox);

    const idleFile = theme.states.idle[0];
    const contentRect = hitGeometry.getContentRectScreen(theme, bounds, "idle", idleFile, {
      box: contentBox,
    });
    const marginRect = hitGeometry.getContentRectScreen(theme, bounds, "idle", idleFile, {
      box: theme.layout.marginBox,
    });

    assert.ok(marginRect.top < contentRect.top, "marginBox는 contentBox보다 위로 넓어야 한다");
    assert.strictEqual(
      Math.round(bounds.y + bounds.height - marginRect.bottom),
      Math.round(bounds.y + bounds.height - contentRect.bottom)
    );
  });

  it("collects a non-mini envelope file set", () => {
    const theme = themeLoader.loadTheme(themeLoader.DEFAULT_THEME_ID);
    const files = collectThemeEnvelopeFiles(theme);

    // 특정 파일명을 단정하면 테마 교체마다 깨진다. 계약만 확인한다 —
    // 일반 상태 스프라이트는 포함하고, mini 전용 스프라이트는 제외한다.
    assert.ok(files.length > 0, "envelope이 비어 있다");
    assert.ok(files.includes(theme.states.idle[0]));
    assert.ok(files.includes(theme.workingTiers[0].file));
    assert.ok(
      !files.some((file) => /(^|[-/])mini-/.test(file)),
      `mini 전용 스프라이트가 섞였다: ${files.filter((f) => /mini-/.test(f)).join(", ")}`
    );
  });

  it("uses the minimum top and bottom margins across a theme envelope", () => {
    const theme = themeLoader.loadTheme(themeLoader.DEFAULT_THEME_ID);
    const files = collectThemeEnvelopeFiles(theme);
    const expected = files.reduce((acc, file) => {
      const rect = hitGeometry.getContentRectScreen(theme, bounds, null, file, {
        box: theme.layout.contentBox,
      });
      if (!rect) return acc;
      return {
        top: Math.min(acc.top, Math.max(0, Math.round(rect.top - bounds.y))),
        bottom: Math.min(acc.bottom, Math.max(0, Math.round(bounds.y + bounds.height - rect.bottom))),
      };
    }, { top: Infinity, bottom: Infinity });

    const stable = computeStableVisibleContentMargins(theme, bounds);
    assert.deepStrictEqual(stable, expected);

    // idle도 envelope의 일부이므로 최솟값은 idle보다 크지 않다. 원래 이 단정은
    // `<` 였는데, 그건 스프라이트별 지오메트리 편차가 있는 테마에서만 성립한다.
    const idleRect = hitGeometry.getContentRectScreen(theme, bounds, "idle", theme.states.idle[0], {
      box: theme.layout.contentBox,
    });
    assert.ok(stable.top <= Math.round(idleRect.top - bounds.y));
    assert.ok(stable.bottom <= Math.round(bounds.y + bounds.height - idleRect.bottom));
  });

  it("builds the update anchor from marginBox and the idle file", () => {
    const clawd = themeLoader.loadTheme("clawd");
    const expected = hitGeometry.getContentRectScreen(clawd, bounds, "idle", clawd.states.idle[0], {
      box: clawd.layout.marginBox,
    });

    assert.deepStrictEqual(computeThemeAnchorRect(clawd, bounds), expected);
  });

  it("prefers updateBubbleAnchorBox over layout-derived boxes when present", () => {
    const clawd = structuredClone(themeLoader.loadTheme("clawd"));
    clawd.updateBubbleAnchorBox = { x: -2, y: -1, width: 12, height: 11 };

    assert.deepStrictEqual(
      computeThemeAnchorRect(clawd, bounds),
      hitGeometry.getContentRectScreen(clawd, bounds, "idle", clawd.states.idle[0], {
        box: clawd.updateBubbleAnchorBox,
      })
    );
  });

  it("keeps a stable update anchor for calico even though per-state hit bottoms differ", () => {
    const calico = themeLoader.loadTheme("calico");
    const anchor = computeThemeAnchorRect(calico, bounds);
    const thinkingHit = hitGeometry.getHitRectScreen(
      calico,
      bounds,
      "thinking",
      "calico-thinking.apng",
      calico.hitBoxes.default
    );
    const notificationHit = hitGeometry.getHitRectScreen(
      calico,
      bounds,
      "notification",
      "calico-notification.apng",
      calico.hitBoxes.wide
    );

    assert.notStrictEqual(Math.round(thinkingHit.bottom), Math.round(notificationHit.bottom));
    assert.deepStrictEqual(
      anchor,
      hitGeometry.getContentRectScreen(calico, bounds, "idle", calico.states.idle[0], {
        box: calico.layout.contentBox,
      })
    );
  });

  it("returns null for the update anchor when the theme has no layout", () => {
    const theme = structuredClone(themeLoader.loadTheme("clawd"));
    delete theme.layout;
    assert.strictEqual(computeThemeAnchorRect(theme, bounds), null);
  });

  it("still returns an anchor without layout when updateBubbleAnchorBox is present", () => {
    const theme = structuredClone(themeLoader.loadTheme("clawd"));
    delete theme.layout;
    theme.updateBubbleAnchorBox = { x: 0, y: 0, width: 20, height: 10 };

    assert.deepStrictEqual(
      computeThemeAnchorRect(theme, bounds),
      hitGeometry.getContentRectScreen(theme, bounds, "idle", theme.states.idle[0], {
        box: theme.updateBubbleAnchorBox,
      })
    );
  });
});

describe("edge pinning margin policy", () => {
  it("keeps OFF drag bottom rubber band but caps total top overflow at half the window", () => {
    const margins = getLooseDragMargins({
      width: 200,
      height: 280,
      visibleMargins: { top: 100, bottom: 50 },
      allowEdgePinning: false,
    });

    assert.deepStrictEqual(margins, {
      marginX: 50,
      marginTop: 140, // capped to round(280 * 0.5)
      marginBottom: 70, // round(280 * 0.25), bottom drag OFF ignores visibleMargins.bottom
    });
  });

  it("OFF drag keeps the full 0.25h top overshoot when headroom is modest", () => {
    const margins = getLooseDragMargins({
      width: 200,
      height: 280,
      visibleMargins: { top: 40, bottom: 50 },
      allowEdgePinning: false,
    });

    assert.deepStrictEqual(margins, {
      marginX: 50,
      marginTop: 110, // 40 + round(280 * 0.25)
      marginBottom: 70,
    });
  });

  it("OFF drag stops adding extra top overshoot once rest headroom already exceeds half the window", () => {
    const margins = getLooseDragMargins({
      width: 200,
      height: 280,
      visibleMargins: { top: 170, bottom: 50 },
      allowEdgePinning: false,
    });

    assert.deepStrictEqual(margins, {
      marginX: 50,
      marginTop: 170,
      marginBottom: 70,
    });
  });

  it("ON drag uses height ratios 0.6/0.25 (Peter hitRect parity) regardless of visibleMargins", () => {
    const margins = getLooseDragMargins({
      width: 200,
      height: 280,
      visibleMargins: { top: 100, bottom: 50 }, // should be ignored when ON
      allowEdgePinning: true,
    });

    assert.deepStrictEqual(margins, {
      marginX: 50,
      marginTop: 168, // round(280 * 0.6)
      marginBottom: 70, // round(280 * 0.25)
    });
  });

  it("ON drag caps bottom slack by display inset", () => {
    const margins = getLooseDragMargins({
      width: 200,
      height: 280,
      visibleMargins: { top: 100, bottom: 50 },
      allowEdgePinning: true,
      bottomInset: 48,
    });

    assert.deepStrictEqual(margins, {
      marginX: 50,
      marginTop: 168,
      marginBottom: 48,
    });
  });

  it("OFF rest clamp keeps the visibleMargins verbatim", () => {
    assert.deepStrictEqual(
      getRestClampMargins({
        height: 280,
        visibleMargins: { top: 22, bottom: 14 },
        allowEdgePinning: false,
      }),
      { top: 22, bottom: 14 }
    );
  });

  it("ON rest clamp matches ON drag (no rubber-band bounce-back)", () => {
    const height = 280;
    const drag = getLooseDragMargins({
      width: 200,
      height,
      visibleMargins: { top: 22, bottom: 14 },
      allowEdgePinning: true,
    });
    const rest = getRestClampMargins({
      height,
      visibleMargins: { top: 22, bottom: 14 },
      allowEdgePinning: true,
    });

    assert.strictEqual(rest.top, drag.marginTop);
    assert.strictEqual(rest.bottom, drag.marginBottom);
    assert.deepStrictEqual(rest, { top: 168, bottom: 70 });
  });

  it("ON rest clamp caps bottom slack by display inset", () => {
    assert.deepStrictEqual(
      getRestClampMargins({
        height: 280,
        visibleMargins: { top: 500, bottom: 500 },
        allowEdgePinning: true,
        bottomInset: 48,
      }),
      { top: 168, bottom: 48 }
    );
  });

  it("ON cap uses the smaller of ratio and inset", () => {
    assert.deepStrictEqual(
      getRestClampMargins({
        height: 280,
        visibleMargins: { top: 500, bottom: 500 },
        allowEdgePinning: true,
        bottomInset: 120,
      }),
      { top: 168, bottom: 70 }
    );
  });

  it("ON bottom can clamp fully to zero when no physical inset is available", () => {
    const drag = getLooseDragMargins({
      width: 200,
      height: 280,
      visibleMargins: { top: 22, bottom: 14 },
      allowEdgePinning: true,
      bottomInset: 0,
    });
    const rest = getRestClampMargins({
      height: 280,
      visibleMargins: { top: 22, bottom: 14 },
      allowEdgePinning: true,
      bottomInset: 0,
    });

    assert.strictEqual(drag.marginBottom, 0);
    assert.strictEqual(rest.bottom, 0);
  });

  it("ON rest clamp ignores visibleMargins and uses height ratios", () => {
    assert.deepStrictEqual(
      getRestClampMargins({
        height: 280,
        visibleMargins: { top: 500, bottom: 500 }, // should be ignored
        allowEdgePinning: true,
      }),
      { top: 168, bottom: 70 }
    );
  });
});
