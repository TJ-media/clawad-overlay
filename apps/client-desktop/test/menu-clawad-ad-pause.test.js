"use strict";
// 트레이·펫 메뉴의 광고 일시중지 항목 (CLAW-89, 규칙 §7).
// 펫 숨기기와 다른 축이다 — 펫은 그대로 두고 광고 표시와 적립만 멈춘다.

const assert = require("node:assert");
const Module = require("node:module");
const { describe, it } = require("node:test");

const MENU_MODULE_PATH = require.resolve("../src/menu");

function loadMenuWithElectron(fakeElectron) {
  delete require.cache[MENU_MODULE_PATH];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === "electron") return fakeElectron;
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/menu");
  } finally {
    Module._load = originalLoad;
  }
}

function fakeElectron() {
  return {
    app: { quit: () => {}, setActivationPolicy: () => {}, dock: { show: () => {}, hide: () => {} } },
    BrowserWindow: function BrowserWindow() {},
    Menu: { buildFromTemplate(template) { return { template }; } },
    Tray: function Tray() {},
    nativeImage: {
      createFromPath() {
        return { resize() { return this; }, setTemplateImage() {} };
      },
    },
    screen: {
      getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ id: 1 }),
    },
  };
}

function buildBaseCtx(overrides = {}) {
  return {
    win: { isDestroyed: () => false },
    sessions: new Map(),
    currentSize: "P:15",
    doNotDisturb: false,
    lang: "en",
    showTray: true,
    showDock: true,
    openAtLogin: false,
    bubbleFollowPet: false,
    hideBubbles: false,
    soundMuted: false,
    menuOpen: false,
    tray: null,
    contextMenuOwner: null,
    contextMenu: null,
    isQuitting: false,
    petHidden: false,
    getMiniMode: () => false,
    getMiniTransitioning: () => false,
    getDisableMiniMode: () => false,
    getActiveThemeCapabilities: () => ({ miniMode: true, petTint: true }),
    openDashboard: () => {},
    openSettingsWindow: () => {},
    togglePetVisibility: () => {},
    bringPetToPrimaryDisplay: () => {},
    enableDoNotDisturb: () => {},
    disableDoNotDisturb: () => {},
    enterMiniViaMenu: () => {},
    exitMiniMode: () => {},
    miniHandleResize: () => false,
    getPetWindowBounds: () => ({ x: 10, y: 20, width: 120, height: 120 }),
    applyPetWindowBounds: () => {},
    getCurrentPixelSize: () => ({ width: 200, height: 200 }),
    isProportionalMode: () => true,
    repositionBubbles: () => {},
    syncHitWin: () => {},
    flushRuntimeStateToPrefs: () => {},
    reapplyMacVisibility: () => {},
    clampToScreenVisual: (x, y) => ({ x, y }),
    ...overrides,
  };
}

function trayLabels(ctx, initMenu) {
  let template = null;
  ctx.tray = { setContextMenu(menuObj) { template = menuObj.template; } };
  initMenu(ctx).buildTrayMenu();
  return { template, labels: template.map((item) => item.label) };
}

describe("광고 일시중지 메뉴 항목 (CLAW-89)", () => {
  it("광고를 쓸 수 있으면 트레이와 펫 메뉴에 일시중지 항목을 노출한다", () => {
    const initMenu = loadMenuWithElectron(fakeElectron());
    let toggles = 0;
    const ctx = buildBaseCtx({
      clawadAdsAvailable: true,
      clawadAdsPaused: false,
      toggleClawadAds: () => { toggles += 1; },
    });

    const tray = trayLabels(ctx, initMenu);
    assert.ok(tray.labels.includes("Pause Ads"), "트레이에 Pause Ads가 있어야 한다");

    initMenu(ctx).buildContextMenu();
    const contextLabels = ctx.contextMenu.template.map((item) => item.label);
    assert.ok(contextLabels.includes("Pause Ads"), "펫 우클릭 메뉴에도 있어야 한다");

    tray.template[tray.labels.indexOf("Pause Ads")].click();
    assert.strictEqual(toggles, 1, "클릭이 토글로 이어져야 한다");
  });

  it("일시중지 상태면 라벨이 재개로 바뀐다", () => {
    const initMenu = loadMenuWithElectron(fakeElectron());
    const ctx = buildBaseCtx({
      clawadAdsAvailable: true,
      clawadAdsPaused: true,
      toggleClawadAds: () => {},
    });

    const { labels } = trayLabels(ctx, initMenu);
    assert.ok(labels.includes("Resume Ads"));
    assert.ok(!labels.includes("Pause Ads"));
  });

  it("광고 기능이 없는 환경에서는 항목을 노출하지 않는다", () => {
    const initMenu = loadMenuWithElectron(fakeElectron());
    // 정책 캐시·번들이 없어 광고를 그릴 수 없는 상태.
    const unavailable = buildBaseCtx({
      clawadAdsAvailable: false,
      clawadAdsPaused: false,
      toggleClawadAds: () => {},
    });
    assert.ok(!trayLabels(unavailable, initMenu).labels.some((label) => /Ads$/.test(label || "")));

    // 광고 기능 자체가 없는 빌드(ctx에 토글이 없음)에서도 조용히 빠진다.
    const legacy = buildBaseCtx({ clawadAdsAvailable: true });
    assert.ok(!trayLabels(legacy, initMenu).labels.some((label) => /Ads$/.test(label || "")));
  });

  it("펫 숨기기와 별개 항목이다 — 둘이 함께 보인다", () => {
    const initMenu = loadMenuWithElectron(fakeElectron());
    const ctx = buildBaseCtx({
      clawadAdsAvailable: true,
      clawadAdsPaused: false,
      toggleClawadAds: () => {},
    });

    const { labels } = trayLabels(ctx, initMenu);
    assert.ok(labels.includes("Hide Pet"), "펫 숨기기는 그대로 남는다");
    assert.ok(labels.includes("Pause Ads"));
    assert.strictEqual(labels[labels.length - 1], "Quit", "종료는 계속 마지막이다");
  });
});

describe("안내 숨김 메뉴 항목 (CLAW-163)", () => {
  it("트레이와 펫 메뉴에서 광고 일시중지 바로 다음에 안내 숨김을 토글한다", () => {
    const initMenu = loadMenuWithElectron(fakeElectron());
    let toggles = 0;
    const ctx = buildBaseCtx({
      clawadAdsAvailable: true,
      clawadAdsPaused: false,
      toggleClawadAds: () => {},
      clawadNoticesAvailable: true,
      clawadNoticesHidden: false,
      toggleClawadNotices: () => { toggles += 1; },
    });

    const tray = trayLabels(ctx, initMenu);
    const pauseIndex = tray.labels.indexOf("Pause Ads");
    assert.strictEqual(tray.labels[pauseIndex + 1], "Hide Notices");

    initMenu(ctx).buildContextMenu();
    const contextLabels = ctx.contextMenu.template.map((item) => item.label);
    const contextPauseIndex = contextLabels.indexOf("Pause Ads");
    assert.strictEqual(contextLabels[contextPauseIndex + 1], "Hide Notices");

    tray.template[pauseIndex + 1].click();
    assert.strictEqual(toggles, 1);
  });

  it("숨긴 상태에서는 다시 켜기 라벨을 보여준다", () => {
    const initMenu = loadMenuWithElectron(fakeElectron());
    const ctx = buildBaseCtx({
      clawadNoticesAvailable: true,
      clawadNoticesHidden: true,
      toggleClawadNotices: () => {},
    });

    const { labels } = trayLabels(ctx, initMenu);
    assert.ok(labels.includes("Show Notices"));
    assert.ok(!labels.includes("Hide Notices"));
  });
});

describe("광고 일시중지 라벨 로케일 (CLAW-89)", () => {
  it("지원 언어 5종 모두에 라벨이 있다 — i18n은 폴백 없이 키를 그대로 노출한다", () => {
    const { i18n, SUPPORTED_LANGS } = require("../src/i18n");
    for (const lang of SUPPORTED_LANGS) {
      const dict = i18n[lang];
      assert.ok(dict.pauseAds && dict.pauseAds !== "pauseAds", `${lang}: pauseAds 라벨 필요`);
      assert.ok(dict.resumeAds && dict.resumeAds !== "resumeAds", `${lang}: resumeAds 라벨 필요`);
    }
    assert.strictEqual(i18n.ko.pauseAds, "광고 일시중지");
  });
});

describe("안내 숨김 라벨 로케일 (CLAW-163)", () => {
  it("지원 언어 5종 모두에 숨김·다시 켜기 라벨이 있다", () => {
    const { i18n, SUPPORTED_LANGS } = require("../src/i18n");
    for (const lang of SUPPORTED_LANGS) {
      const dict = i18n[lang];
      assert.ok(dict.hideNotices && dict.hideNotices !== "hideNotices", `${lang}: hideNotices 라벨 필요`);
      assert.ok(dict.showNotices && dict.showNotices !== "showNotices", `${lang}: showNotices 라벨 필요`);
    }
    assert.strictEqual(i18n.ko.hideNotices, "안내 끄기");
    assert.strictEqual(i18n.ko.showNotices, "안내 다시 켜기");
  });
});

describe("광고 일시중지 prefs (CLAW-89)", () => {
  it("스키마에 clawadAdsPaused가 있고 기본값은 off다", () => {
    const { SCHEMA, SCHEMA_KEYS, getDefaults } = require("../src/prefs");
    assert.ok(SCHEMA_KEYS.includes("clawadAdsPaused"), "스키마에 없으면 prefs 저장 시 값이 버려진다");
    assert.strictEqual(SCHEMA.clawadAdsPaused.type, "boolean");
    assert.strictEqual(getDefaults().clawadAdsPaused, false, "기본값은 광고 표시(off)여야 한다");
  });

  // 실기동 검증 중 발견: PowerShell·메모장이 붙인 BOM 때문에 prefs 전체가 초기화됐다.
  // 일시중지 같은 사용자 제어가 조용히 풀려버리므로 파싱 전에 BOM을 제거해야 한다 (CLAUDE.md §5).
  it("BOM이 붙은 prefs도 읽고 사용자 설정을 잃지 않는다", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { load } = require("../src/prefs");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawad-prefs-bom-"));
    const file = path.join(dir, "clawd-prefs.json");
    fs.writeFileSync(file, `﻿${JSON.stringify({ version: 12, clawadAdsPaused: true, lang: "ko" })}`, "utf8");

    const loaded = load(file);
    assert.strictEqual(loaded.snapshot.clawadAdsPaused, true, "BOM 때문에 일시중지가 풀리면 안 된다");
    assert.strictEqual(loaded.snapshot.lang, "ko");
    assert.strictEqual(fs.existsSync(`${file}.bak`), false, "정상 파일을 손상으로 취급해 백업하지 않는다");
  });
});

describe("안내 숨김 prefs (CLAW-163)", () => {
  it("스키마에 독립된 boolean 설정이 있고 기본값은 안내 표시다", () => {
    const { SCHEMA, SCHEMA_KEYS, getDefaults } = require("../src/prefs");
    assert.ok(SCHEMA_KEYS.includes("clawadNoticesHidden"));
    assert.strictEqual(SCHEMA.clawadNoticesHidden.type, "boolean");
    assert.strictEqual(getDefaults().clawadNoticesHidden, false);
  });
});

// 스키마와 메뉴 배선이 멀쩡해도 쓰기가 거절되면 세 컨트롤(광고판 `안내 끄기` 버튼, 메뉴의
// `안내 끄기`·`광고 일시중지`)이 전부 무반응이 된다. 위 테스트들은 스키마만 봐서 이걸 놓쳤다.
// 여기서는 컨트롤러 왕복까지 확인한다 — 커밋이 돼야 미러 변수가 갱신되고 표시 효과가 돈다 (CLAW-170).
describe("일시중지·안내 끄기 쓰기 경로 (CLAW-170)", () => {
  const { createSettingsController } = require("../src/settings-controller");
  const { getDefaults } = require("../src/prefs");

  // locked: true — 디스크에 쓰지 않고도 store 커밋은 그대로 일어난다.
  const controller = () =>
    createSettingsController({ loadResult: { snapshot: getDefaults(), locked: true } });

  for (const key of ["clawadAdsPaused", "clawadNoticesHidden"]) {
    it(`${key}를 켜면 실제로 커밋된다`, () => {
      const c = controller();
      const result = c.applyUpdate(key, true);
      assert.strictEqual(result.status, "ok", `쓰기가 거절되면 컨트롤이 무반응이 된다: ${result.message}`);
      assert.strictEqual(c.get(key), true);
    });

    it(`${key}는 boolean만 받는다`, () => {
      assert.strictEqual(controller().applyUpdate(key, "true").status, "error");
    });
  }

  it("커밋되면 구독자가 발화한다 — 광고판을 즉시 내리는 효과가 여기에 달려 있다", () => {
    const c = controller();
    const seen = [];
    c.subscribeKey("clawadNoticesHidden", (value) => seen.push(value));
    c.applyUpdate("clawadNoticesHidden", true);
    assert.deepStrictEqual(seen, [true], "구독자가 안 돌면 광고판이 그대로 남는다");
  });
});

describe("홈페이지 메뉴 항목 (CLAW-166)", () => {
  it("트레이와 컨텍스트 메뉴에서 안내 설정 다음에 홈페이지를 연다", () => {
    const initMenu = loadMenuWithElectron(fakeElectron());
    let opens = 0;
    const ctx = buildBaseCtx({
      clawadNoticesAvailable: true,
      clawadNoticesHidden: false,
      toggleClawadNotices: () => {},
      clawadRewardShopUrl: "https://clawad.whatsup.house/",
      openClawadRewardShop: () => { opens += 1; },
    });

    const tray = trayLabels(ctx, initMenu);
    const noticeIndex = tray.labels.indexOf("Hide Notices");
    assert.strictEqual(tray.labels[noticeIndex + 1], "Open Homepage");
    tray.template[noticeIndex + 1].click();
    assert.strictEqual(opens, 1);

    initMenu(ctx).buildContextMenu();
    const contextLabels = ctx.contextMenu.template.map((item) => item.label);
    const contextNoticeIndex = contextLabels.indexOf("Hide Notices");
    assert.strictEqual(contextLabels[contextNoticeIndex + 1], "Open Homepage");
  });

  it("정책에 유효한 URL이 없으면 홈페이지 메뉴만 숨긴다", () => {
    const initMenu = loadMenuWithElectron(fakeElectron());
    const ctx = buildBaseCtx({
      clawadRewardShopUrl: null,
      openClawadRewardShop: () => {},
    });

    const { labels } = trayLabels(ctx, initMenu);
    assert.ok(!labels.includes("Open Homepage"));
    initMenu(ctx).buildContextMenu();
    assert.ok(!ctx.contextMenu.template.some((item) => item.label === "Open Homepage"));
  });
});

describe("홈페이지 메뉴 로케일 (CLAW-166)", () => {
  it("지원 언어 5종 모두 홈페이지 바로가기 라벨이 있다", () => {
    const { i18n, SUPPORTED_LANGS } = require("../src/i18n");
    for (const lang of SUPPORTED_LANGS) {
      const dict = i18n[lang];
      assert.ok(dict.openHomepage && dict.openHomepage !== "openHomepage", `${lang}: openHomepage 라벨 필요`);
    }
    assert.strictEqual(i18n.ko.openHomepage, "홈페이지 바로가기");
  });
});
