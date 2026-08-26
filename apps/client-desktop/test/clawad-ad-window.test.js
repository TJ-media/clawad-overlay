"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const AD_WINDOW_MODULE = require.resolve("../src/clawad-ad-window");

function loadAdWindowWithFakes({ BrowserWindow, runtime, authState = null }) {
  delete require.cache[AD_WINDOW_MODULE];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === AD_WINDOW_MODULE) {
      if (request === "electron") {
        return {
          BrowserWindow,
          ipcMain: { on() {}, removeAllListeners() {} },
          shell: { openExternal() {} },
        };
      }
      if (request === "./clawad-ad-runtime") return { createAdRuntime: () => runtime };
      if (request === "./clawad-auth-state") return { readAuthState: () => authState, startLogin: () => ({ status: "started" }) };
      if (request === "./clawad-surface-lock") {
        return {
          ownsAdSurface: () => true,
          acquireAdSurface: () => true,
          releaseAdSurface() {},
        };
      }
      if (request === "./taskbar") return { keepOutOfTaskbar() {} };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    return require(AD_WINDOW_MODULE);
  } finally {
    Module._load = originalLoad;
    delete require.cache[AD_WINDOW_MODULE];
  }
}

function createFakeBrowserWindow(instances) {
  return class FakeBrowserWindow {
    constructor() {
      this.boundsCalls = [];
      this.destroyed = false;
      this.visible = false;
      this.sent = [];
      this.webContents = {
        once: (_event, listener) => listener(),
        send: (_channel, payload) => { this.sent.push(payload); },
      };
      instances.push(this);
    }

    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    loadFile() {}
    on() {}
    setAlwaysOnTop() {}
    setBounds(bounds) { this.boundsCalls.push({ ...bounds }); }
    setIgnoreMouseEvents() {}
    showInactive() { this.visible = true; }
  };
}

describe("clawad-ad-window", () => {
  it("repositions a visible ad from the latest pet bounds without duplicate setBounds calls", () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    const payload = {
      kind: "ad",
      text: "개발자 광고",
      brand: "ClawAd",
      reward: null,
      clickUrl: null,
      maxWidthPx: 320,
    };
    const runtime = {
      canRender: () => true,
      dataDir: "C:\\clawad-test",
      displayContext: () => null,
      rewardShopUrl: () => "",
      stop() {},
      tick: () => payload,
    };
    let petBounds = { x: 300, y: 50, width: 80, height: 80 };
    const initAdWindow = loadAdWindowWithFakes({ BrowserWindow, runtime });
    const ad = initAdWindow({
      dataDir: runtime.dataDir,
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
      getPetWindowBounds: () => petBounds,
      getTextScale: () => 1,
    });

    ad.tick();
    const win = instances[0];
    assert.deepStrictEqual(win.boundsCalls, [{ x: 180, y: 136, width: 320, height: 55 }]);

    petBounds = { ...petBounds, x: 340 };
    ad.reposition();
    ad.reposition();

    assert.deepStrictEqual(win.boundsCalls, [
      { x: 180, y: 136, width: 320, height: 55 },
      { x: 220, y: 136, width: 320, height: 55 },
    ]);
  });
  // 로그인 전에는 이 안내판이 유일한 로그인 진입점이다. 광고·안내 문구보다 먼저 뜨고,
  // 안내 문구와 달리 끌 수 없어야 한다 — 끄면 사용자가 다시 부를 방법이 없다.
  it("로그인 전에는 끌 수 없는 로그인 안내를 광고보다 먼저 띄운다", () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    let stopped = false;
    const runtime = {
      canRender: () => true,
      dataDir: "C:\clawad-test",
      displayContext: () => ({ maxWidthPx: 320, exhausted: false, reward: null }),
      rewardShopUrl: () => "https://example.test/",
      stop() { stopped = true; },
      tick: () => ({ kind: "ad", text: "개발자 광고", brand: "ClawAd", reward: null, clickUrl: null, maxWidthPx: 320 }),
    };
    const initAdWindow = loadAdWindowWithFakes({
      BrowserWindow,
      runtime,
      authState: { status: "logged-out", canLogin: true, lastSuccessAt: null, code: null },
    });
    const ad = initAdWindow({
      dataDir: runtime.dataDir,
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
      getPetWindowBounds: () => ({ x: 300, y: 50, width: 80, height: 80 }),
      getTextScale: () => 1,
      noticeDismissLabel: () => "안내 끄기",
      toggleClawadNotices() {},
    });

    ad.tick();
    const sent = instances[0].sent.at(-1);
    assert.strictEqual(sent.kind, "login");
    assert.strictEqual(sent.dismissible, false);
    assert.strictEqual(sent.dismissLabel, "");
    assert.strictEqual(sent.linked, true);
    // 광고 표시 구간이 열려 있었다면 안내로 넘어가며 닫는다.
    assert.strictEqual(stopped, true);
    // "안내 끄기" 메뉴 항목도 이 상태에서는 나오지 않는다 — 눌러도 지워지지 않는다.
    assert.strictEqual(ad.canShowNotices(), false);
  });
});
