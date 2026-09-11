"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const AD_WINDOW_MODULE = require.resolve("../src/clawad-ad-window");

function loadAdWindowWithFakes({ BrowserWindow, runtime, authState = null, ipcMain = null, syncRunner = null }) {
  delete require.cache[AD_WINDOW_MODULE];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && parent.filename === AD_WINDOW_MODULE) {
      if (request === "electron") {
        return {
          BrowserWindow,
          ipcMain: ipcMain || { on() {}, removeAllListeners() {} },
          shell: { openExternal() {} },
        };
      }
      if (request === "./clawad-ad-runtime") return { createAdRuntime: () => runtime };
      if (request === "./clawad-cli-bridge") {
        return { createSiblingCommandRunner: () => syncRunner || { run: () => false } };
      }
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
  return class FakeBrowserWindow extends EventEmitter {
    constructor(options = {}) {
      super();
      this.options = options;
      this.boundsCalls = [];
      this.destroyed = false;
      this.visible = false;
      this.sent = [];
      this.webContents = new EventEmitter();
      this.webContents.send = (_channel, payload) => { this.sent.push(payload); };
      this.webContents.once = (event, listener) => {
        if (event === "did-finish-load") listener();
        else EventEmitter.prototype.once.call(this.webContents, event, listener);
      };
      instances.push(this);
    }

    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    loadFile() {}
    setAlwaysOnTop() {}
    setBounds(bounds) { this.boundsCalls.push({ ...bounds }); }
    setIgnoreMouseEvents() {}
    showInactive() { this.visible = true; }
  };
}

function createFakeIpcMain() {
  const listeners = new Map();
  return {
    listeners,
    on(channel, listener) { listeners.set(channel, listener); },
    removeAllListeners(channel) { listeners.delete(channel); },
    emit(channel, event, ...args) {
      const listener = listeners.get(channel);
      if (listener) listener(event, ...args);
    },
  };
}

describe("clawad-ad-window", () => {
  it("Windows 광고창은 owned parent를 두지 않아 펫 아래 z-order가 가능하다 (CLAW-287)", {
    skip: process.platform !== "win32",
  }, () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    const runtime = {
      canRender: () => true, dataDir: "C:\\clawad-test", displayContext: () => null,
      rewardShopUrl: () => "", stop() {},
      tick: () => ({ kind: "ad", renderId: "render-1", text: "광고", brand: "", reward: null, clickUrl: null, maxWidthPx: 320 }),
    };
    const initAdWindow = loadAdWindowWithFakes({ BrowserWindow, runtime });
    const ad = initAdWindow({
      win: { isDestroyed: () => false }, dataDir: runtime.dataDir,
      getPetWindowBounds: () => ({ x: 0, y: 0, width: 80, height: 80 }),
    });

    ad.tick();

    assert.ok(!Object.hasOwn(instances[0].options, "parent"));
  });

  it("work-state 변경은 1초 poll을 기다리지 않고 즉시 표시를 재평가한다 (CLAW-287)", () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    const watches = [];
    const scheduled = [];
    let ticks = 0;
    const runtime = {
      canRender: () => false,
      dataDir: "C:\\clawad-test",
      displayContext: () => null,
      isWorking: () => false,
      rewardShopUrl: () => "",
      stop() {},
      tick: () => { ticks += 1; return null; },
    };
    const initAdWindow = loadAdWindowWithFakes({ BrowserWindow, runtime });
    const ad = initAdWindow({
      dataDir: runtime.dataDir,
      watch: (target, listener) => {
        watches.push({ target, listener, close() {} });
        return watches.at(-1);
      },
      setTimeout: (callback) => { scheduled.push(callback); return scheduled.length; },
      clearTimeout() {},
    });

    ad.start();
    assert.strictEqual(ticks, 1, "시작 시 한 번 평가한다");
    const workWatch = watches.find((item) => item.target.endsWith("work-state"));
    assert.ok(workWatch, "work-state 디렉터리를 감시해야 한다");
    workWatch.listener("change", "a".repeat(32) + ".json");
    scheduled.shift()();
    assert.strictEqual(ticks, 2, "파일 변경 직후 재평가한다");
    ad.cleanup();
  });

  it("작업 중 캐시가 비면 즉시 sync를 한 번 요청하고 준비 안내를 표시한다 (CLAW-287)", () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    const syncCalls = [];
    const runtime = {
      canRender: () => false,
      dataDir: "C:\\clawad-test",
      displayContext: () => ({ maxWidthPx: 320, exhausted: false, reward: null }),
      isWorking: () => true,
      rewardShopUrl: () => "",
      stop() {},
      tick: () => null,
    };
    const syncRunner = { run: (args) => { syncCalls.push(args); return true; } };
    const initAdWindow = loadAdWindowWithFakes({ BrowserWindow, runtime, syncRunner });
    const ad = initAdWindow({
      dataDir: runtime.dataDir,
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
      getPetWindowBounds: () => ({ x: 300, y: 50, width: 80, height: 80 }),
      getTextScale: () => 1,
    });

    ad.tick();

    assert.deepStrictEqual(syncCalls, [[runtime.dataDir]]);
    const sent = instances[0].sent.at(-1);
    assert.strictEqual(sent.kind, "notice");
    assert.strictEqual(sent.text, "광고 준비 중…");
    assert.strictEqual(sent.dismissible, false);
  });

  it("현재 광고창이 보낸 현재 renderId ACK만 런타임에 확정한다 (CLAW-287)", () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    const ipcMain = createFakeIpcMain();
    const confirmations = [];
    const payload = {
      kind: "ad", renderId: "render-1", text: "개발자 광고", brand: "ClawAd",
      reward: null, clickUrl: null, maxWidthPx: 320,
    };
    const runtime = {
      canRender: () => true,
      dataDir: "C:\\clawad-test",
      displayContext: () => null,
      rewardShopUrl: () => "",
      stop() {},
      tick: () => payload,
      confirmRendered: (renderId, now) => { confirmations.push([renderId, now]); return true; },
      cancelPending() {},
    };
    const initAdWindow = loadAdWindowWithFakes({ BrowserWindow, runtime, ipcMain });
    const ad = initAdWindow({
      dataDir: runtime.dataDir,
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
      getPetWindowBounds: () => ({ x: 300, y: 50, width: 80, height: 80 }),
      getTextScale: () => 1,
    });

    ad.start();
    const win = instances[0];
    ipcMain.emit("clawad-ad:painted", { sender: {} }, "render-1");
    ipcMain.emit("clawad-ad:painted", { sender: win.webContents }, "stale");
    assert.deepStrictEqual(confirmations, [], "sender나 ID가 다르면 확정하면 안 된다");

    ipcMain.emit("clawad-ad:painted", { sender: win.webContents }, "render-1");
    assert.strictEqual(confirmations.length, 1);
    assert.strictEqual(confirmations[0][0], "render-1");
    assert.ok(Number.isFinite(confirmations[0][1]));
    ad.cleanup();
  });

  it("페인트 ACK가 제한 시간 안에 없으면 표시 구간을 닫고 빈 창을 폐기한다 (CLAW-287)", () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    const timers = [];
    let stopped = 0;
    const runtime = {
      canRender: () => true,
      dataDir: "C:\\clawad-test",
      displayContext: () => null,
      rewardShopUrl: () => "",
      stop() { stopped += 1; },
      tick: () => ({ kind: "ad", renderId: "render-timeout", text: "개발자 광고", brand: "ClawAd", reward: null, clickUrl: null, maxWidthPx: 320 }),
    };
    const initAdWindow = loadAdWindowWithFakes({ BrowserWindow, runtime });
    const ad = initAdWindow({
      dataDir: runtime.dataDir,
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
      getPetWindowBounds: () => ({ x: 300, y: 50, width: 80, height: 80 }),
      getTextScale: () => 1,
      setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
      clearTimeout() {},
    });

    ad.tick();
    assert.strictEqual(timers[0].ms, 2500);
    timers[0].callback();

    assert.strictEqual(stopped, 1);
    assert.strictEqual(instances[0].destroyed, true);
  });

  it("렌더러가 종료되면 미확인 후보를 취소하고 다음 tick에 창을 다시 만든다 (CLAW-287)", () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    let cancelled = 0;
    let stopped = 0;
    const runtime = {
      canRender: () => true,
      dataDir: "C:\\clawad-test",
      displayContext: () => null,
      rewardShopUrl: () => "",
      stop() { stopped += 1; cancelled += 1; },
      tick: () => ({ kind: "ad", renderId: "render-1", text: "개발자 광고", brand: "ClawAd", reward: null, clickUrl: null, maxWidthPx: 320 }),
      confirmRendered: () => false,
      cancelPending: () => { cancelled += 1; },
    };
    const initAdWindow = loadAdWindowWithFakes({ BrowserWindow, runtime });
    const ad = initAdWindow({
      dataDir: runtime.dataDir,
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
      getPetWindowBounds: () => ({ x: 300, y: 50, width: 80, height: 80 }),
      getTextScale: () => 1,
    });

    ad.tick();
    instances[0].webContents.emit("render-process-gone", {}, { reason: "crashed" });
    assert.strictEqual(cancelled, 1);
    assert.strictEqual(stopped, 1, "이미 ACK된 구간도 장애 시각에 닫을 수 있어야 한다");
    assert.strictEqual(instances[0].destroyed, true);

    ad.tick();
    assert.strictEqual(instances.length, 2);
  });

  it("로드 실패 로그는 오류 설명과 로컬 경로를 노출하지 않는다 (CLAW-287)", () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    const runtime = {
      canRender: () => true,
      dataDir: "C:\\clawad-test",
      displayContext: () => null,
      rewardShopUrl: () => "",
      stop() {},
      tick: () => ({ kind: "ad", renderId: "render-1", text: "개발자 광고", brand: "ClawAd", reward: null, clickUrl: null, maxWidthPx: 320 }),
    };
    const initAdWindow = loadAdWindowWithFakes({ BrowserWindow, runtime });
    const ad = initAdWindow({ dataDir: runtime.dataDir });
    const warnings = [];
    const originalWarn = console.warn;

    try {
      console.warn = (message) => warnings.push(message);
      ad.tick();
      instances[0].webContents.emit(
        "did-fail-load",
        {},
        -105,
        "ERR_NAME_NOT_RESOLVED private-description",
        "file:///C:/Users/private-user/clawad-ad.html",
        true,
      );
    } finally {
      console.warn = originalWarn;
    }

    assert.deepStrictEqual(warnings, ["ClawAd: reset ad window after load failed (-105)"]);
  });

  it("폐기된 광고창의 늦은 실패 이벤트는 새 광고창을 닫지 않는다 (CLAW-287)", () => {
    const instances = [];
    const BrowserWindow = createFakeBrowserWindow(instances);
    const runtime = {
      canRender: () => true,
      dataDir: "C:\\clawad-test",
      displayContext: () => null,
      rewardShopUrl: () => "",
      stop() {},
      tick: () => ({ kind: "ad", renderId: "render-1", text: "개발자 광고", brand: "ClawAd", reward: null, clickUrl: null, maxWidthPx: 320 }),
    };
    const initAdWindow = loadAdWindowWithFakes({ BrowserWindow, runtime });
    const ad = initAdWindow({ dataDir: runtime.dataDir });

    ad.tick();
    const staleWindow = instances[0];
    staleWindow.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    ad.tick();
    const currentWindow = instances[1];

    staleWindow.webContents.emit("did-fail-load", {}, -105, "stale", "file:///stale", true);

    assert.strictEqual(currentWindow.destroyed, false);
  });

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
