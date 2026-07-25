const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");

// Load default theme for test ctx
const themeLoader = require("../src/theme-loader");
themeLoader.init(path.join(__dirname, "..", "src"));
const _defaultTheme = themeLoader.loadTheme(themeLoader.DEFAULT_THEME_ID);

// 이 파일은 display_svg 힌트의 **허용목록 동작**을 검증한다. 허용목록은 테마의
// displayHintMap에서 오고(src/state-session-events.js:27), 배포 테마가 그 필드를
// 갖고 있는지는 별개 문제다(CLAW-121). 테마 내용에 검증이 휘둘리지 않도록
// 테스트가 필요한 능력을 직접 구성한다 (CLAW-122).
//
// 스프라이트는 테마에서 가져온다 — 허용목록에 든 이름은 실제로 그릴 수 있어야 한다.
function tierFile(tiers, minSessions) {
  const tier = tiers.find((t) => t.minSessions === minSessions);
  assert.ok(tier, `theme has no tier for minSessions=${minSessions}`);
  return tier.file;
}

// 힌트가 없을 때의 기본값. 세션 1개 → working tier 1.
const WORKING_FALLBACK = tierFile(_defaultTheme.workingTiers, 1);
// 허용목록에 넣을 힌트들. 서로 달라야 "어느 것이 이겼는지" 판별이 된다.
const HINT_WORKING = tierFile(_defaultTheme.workingTiers, 3);
const HINT_ALT = tierFile(_defaultTheme.jugglingTiers, 2);
const HINT_THINKING = _defaultTheme.states.thinking[0];
// follow 스프라이트 = states.idle[0] (src/state.js:409)
const FOLLOW_SVG = _defaultTheme.states.idle[0];
// 사용자가 고른 idle 비주얼과 명시적으로 넘기는 svg는 허용목록 대상이 아니다.
const IDLE_CHOICE = _defaultTheme.states.attention[0];
const EXPLICIT_SVG = _defaultTheme.states.notification[0];

function themeWithHints() {
  const theme = JSON.parse(JSON.stringify(_defaultTheme));
  theme.displayHintMap = {
    [HINT_WORKING]: HINT_WORKING,
    [HINT_ALT]: HINT_ALT,
    [HINT_THINKING]: HINT_THINKING,
  };
  return theme;
}

function makeCtx() {
  return {
    theme: themeWithHints(),
    doNotDisturb: false,
    miniTransitioning: false,
    miniMode: false,
    mouseOverPet: false,
    idlePaused: false,
    forceEyeResend: false,
    mouseStillSince: Date.now(),
    playSound() {},
    sendToRenderer() {},
    syncHitWin() {},
    sendToHitWin() {},
    miniPeekIn() {},
    miniPeekOut() {},
    buildContextMenu() {},
    buildTrayMenu() {},
    pendingPermissions: [],
    resolvePermissionEntry() {},
    t: (k) => k,
    focusTerminalWindow() {},
  };
}

describe("display_svg session hints (updateSession path)", () => {
  let api;
  const pid = process.pid;

  beforeEach(() => {
    api = require("../src/state")(makeCtx());
  });

  function baseOpts(overrides = {}) {
    return {
      cwd: "/tmp",
      editor: "cursor",
      agentPid: pid,
      agentId: "cursor-agent",
      ...overrides,
    };
  }

  it("uses allowlisted display_svg for working state", () => {
    api.updateSession("c1", "working", "PreToolUse", baseOpts({ displayHint: HINT_WORKING }));
    assert.strictEqual(api.getSvgOverride("working"), HINT_WORKING);
  });

  it("falls back to getWorkingSvg when no hint", () => {
    api.updateSession("c1", "working", "PreToolUse", baseOpts());
    assert.strictEqual(api.getSvgOverride("working"), WORKING_FALLBACK);
  });

  it("ignores non-allowlisted svg and falls back", () => {
    api.updateSession("c1", "working", "PreToolUse", baseOpts({ displayHint: "evil.svg" }));
    assert.strictEqual(api.getSvgOverride("working"), WORKING_FALLBACK);
  });

  it("picks the most recently updated session among working sessions", async () => {
    api.updateSession("a", "working", "PreToolUse", baseOpts({ cwd: "/a", displayHint: HINT_WORKING }));
    await new Promise((r) => setTimeout(r, 5));
    api.updateSession("b", "working", "PostToolUse", baseOpts({ cwd: "/b", displayHint: HINT_ALT }));
    assert.strictEqual(api.getSvgOverride("working"), HINT_ALT);
  });

  it("clears hint when display_svg is null", () => {
    api.updateSession("c1", "working", "PreToolUse", baseOpts({ displayHint: HINT_WORKING }));
    assert.strictEqual(api.getSvgOverride("working"), HINT_WORKING);
    api.updateSession("c1", "working", "PostToolUse", baseOpts({ displayHint: null }));
    assert.strictEqual(api.getSvgOverride("working"), WORKING_FALLBACK);
  });

  it("applies thinking hint for thinking state", () => {
    api.updateSession("c1", "thinking", "AfterAgentThought", baseOpts({ displayHint: HINT_THINKING }));
    assert.strictEqual(api.getSvgOverride("thinking"), HINT_THINKING);
  });
});

// #509: user-selected default idle visual flows through state.js
describe("default idle visual (getIdleVisualChoice ctx hook)", () => {
  it("getSvgOverride('idle') returns the user choice when set", () => {
    const ctx = makeCtx();
    ctx.getIdleVisualChoice = () => IDLE_CHOICE;
    const api = require("../src/state")(ctx);
    assert.strictEqual(api.getSvgOverride("idle"), IDLE_CHOICE);
  });

  it("getSvgOverride('idle') falls back to the follow sprite when unset", () => {
    const ctx = makeCtx();
    ctx.getIdleVisualChoice = () => null;
    const api = require("../src/state")(ctx);
    assert.strictEqual(api.getSvgOverride("idle"), FOLLOW_SVG);

    const apiNoHook = require("../src/state")(makeCtx());
    assert.strictEqual(apiNoHook.getSvgOverride("idle"), FOLLOW_SVG);
  });

  it("applyState('idle') with no override rests on the user choice", () => {
    const ctx = makeCtx();
    ctx.getIdleVisualChoice = () => IDLE_CHOICE;
    const api = require("../src/state")(ctx);
    api.applyState("idle");
    assert.strictEqual(api.getCurrentSvg(), IDLE_CHOICE);
  });

  it("applyState('idle') without the hook keeps today's behavior", () => {
    const api = require("../src/state")(makeCtx());
    api.applyState("idle");
    assert.strictEqual(api.getCurrentSvg(), FOLLOW_SVG);
  });

  it("an explicit svgOverride still wins over the user choice", () => {
    const ctx = makeCtx();
    ctx.getIdleVisualChoice = () => IDLE_CHOICE;
    const api = require("../src/state")(ctx);
    api.applyState("idle", EXPLICIT_SVG);
    assert.strictEqual(api.getCurrentSvg(), EXPLICIT_SVG);
  });
});
