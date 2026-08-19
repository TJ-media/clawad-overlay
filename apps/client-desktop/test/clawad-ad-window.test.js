"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const AD_WINDOW_MODULE = require.resolve("../src/clawad-ad-window");

function loadAdWindowWithFakes({ BrowserWindow, runtime }) {
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
      if (request === "./clawad-auth-state") return { readAuthState: () => null };
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
      this.webContents = {
        once: (_event, listener) => listener(),
        send() {},
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
});
