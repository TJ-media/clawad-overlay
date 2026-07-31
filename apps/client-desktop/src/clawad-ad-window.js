"use strict";
// 오버레이 광고 표시 창 (CLAW-90).
//
// 펫 창 바로 아래에 광고 한 줄을 띄운다. 표시 판단·번들 선택·스풀 기록은 clawad-ad-runtime.js가
// 하고, 여기서는 창 생성·배치·표시만 맡는다.
//
// 창 규칙: 투명·프레임 없음·최상단·작업표시줄 제외·포커스 불가, 그리고 **클릭 통과**.
// 클릭 광고는 별도 동의가 필요한 기능이라 이 창은 입력을 전혀 받지 않는다.

const path = require("node:path");
const { BrowserWindow, ipcMain, shell } = require("electron");
const { createAdRuntime } = require("./clawad-ad-runtime");
const clawadAuthState = require("./clawad-auth-state");
const { LOGIN_NOTICE, rotatingNotice } = require("./clawad-ad-notices");
const clawadSurfaceLock = require("./clawad-surface-lock");
const { keepOutOfTaskbar } = require("./taskbar");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";

/** 표시 재평가 주기. 노출 빈도 정책이 아니라 "지금 무엇을 보여줄지" 다시 계산하는 간격이다. */
const TICK_MS = 1000;
/**
 * 2행 패널 높이(논리 픽셀). 세션 HUD처럼 body 여백을 두므로 그만큼 더 잡는다. 폭은 정책값 maxWidthPx.
 * 1행 17 + 행간 2 + 2행 14 + 패널 상하 패딩 10 + body 상하 여백 8 = 51에 여유 2 (CLAW-138).
 * 실측값이다 — 행 높이는 폰트 스택의 line-height에 달려 있어 줄이면 2행이 잘린다.
 */
const STRIP_HEIGHT = 53;
/** 펫과 광고 줄 사이 여백. */
const PET_GAP = 6;
/**
 * 안내 문구를 띄울 때의 창 폭. 정책값 maxWidthPx는 광고 표시 폭이고, 미로그인 상태에는
 * 정책 캐시 자체가 없다(정책은 sync가 받아오는데 sync는 로그인이 필요하다). 광고가 아닌
 * 안내에까지 정책값을 요구하면 로그인 안내를 영영 못 띄운다. 정책이 있으면 그 폭을 쓴다.
 */
const NOTICE_WIDTH = 320;
/** 로그인으로 해결되는 상태. 그 외(네트워크 장애 등)는 안내해도 사용자가 할 일이 없다. */
const LOGIN_PROMPT_STATUSES = new Set(["logged-out", "login-needed", "consent-needed"]);

function scaled(value, scale) {
  return Math.max(1, Math.round(value * (Number.isFinite(scale) && scale > 0 ? scale : 1)));
}

module.exports = function initClawadAdWindow(ctx) {
  const runtime = createAdRuntime({ dataDir: ctx.dataDir });
  let adWindow = null;
  let ready = false;
  let timer = null;
  let lastPayload = null;
  let lastBounds = null;
  let lastClickable = null;
  let ipcBound = false;

  function getScale() {
    return typeof ctx.getTextScale === "function" ? ctx.getTextScale() : 1;
  }

  function computeBounds(maxWidthPx) {
    const petBounds = typeof ctx.getPetWindowBounds === "function" ? ctx.getPetWindowBounds() : null;
    if (!petBounds) return null;
    const scale = getScale();
    const width = scaled(Math.min(maxWidthPx, 720), scale);
    const height = scaled(STRIP_HEIGHT, scale);
    const centerX = petBounds.x + Math.round(petBounds.width / 2);
    const centerY = petBounds.y + Math.round(petBounds.height / 2);
    const workArea = typeof ctx.getNearestWorkArea === "function"
      ? ctx.getNearestWorkArea(centerX, centerY)
      : null;
    let x = centerX - Math.round(width / 2);
    let y = petBounds.y + petBounds.height + scaled(PET_GAP, scale);
    if (workArea) {
      // 화면 밖으로 나가면 안쪽으로 당기고, 아래에 자리가 없으면 펫 위로 올린다.
      x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width);
      if (y + height > workArea.y + workArea.height) {
        y = petBounds.y - height - scaled(PET_GAP, scale);
      }
      y = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height);
    }
    return { x, y, width, height };
  }

  function ensureWindow() {
    if (adWindow && !adWindow.isDestroyed()) return adWindow;
    ready = false;
    adWindow = new BrowserWindow({
      parent: ctx.win && !ctx.win.isDestroyed() ? ctx.win : undefined,
      width: 320,
      height: scaled(STRIP_HEIGHT, getScale()),
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: !isMac,
      focusable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      ...(isMac ? { type: "panel" } : {}),
      ...(isLinux ? { type: "toolbar" } : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload-clawad-ad.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // 기본은 클릭 통과다. 링크가 있는 광고를 표시할 때만 입력을 받는다(applyClickable).
    adWindow.setIgnoreMouseEvents(true, { forward: false });
    if (isWin) adWindow.setAlwaysOnTop(true, "screen-saver");
    if (typeof ctx.guardAlwaysOnTop === "function") ctx.guardAlwaysOnTop(adWindow);

    adWindow.loadFile(path.join(__dirname, "clawad-ad.html"));
    adWindow.webContents.once("did-finish-load", () => {
      ready = true;
      if (lastPayload) send(lastPayload);
    });
    adWindow.on("closed", () => {
      adWindow = null;
      ready = false;
    });
    return adWindow;
  }

  function send(payload) {
    if (!adWindow || adWindow.isDestroyed() || !ready) return;
    // 렌더러에는 URL을 주지 않는다. 링크 여부만 알려주고 실제 열기는 메인이 한다.
    // kind는 [광고] 표기를 붙일지 정한다 — 광고가 아닌 안내에 [광고]를 붙이지 않는다.
    adWindow.webContents.send("clawad-ad:update", payload
      ? {
        kind: payload.kind,
        text: payload.text,
        brand: payload.brand,
        reward: payload.reward,
        linked: payload.kind === "login" || Boolean(payload.clickUrl),
      }
      : null);
  }

  /**
   * 지금 무엇을 보여줄지 고른다 (CLAW-138 후속). 우선순위는 로그인 안내 → 광고 → 안내 문구다.
   *
   * 미로그인이 가장 앞인 이유: 그 상태에서는 번들도 정책도 내려오지 않으므로 광고가 뜰 수 없고,
   * 사용자가 손쓸 수 있는 유일한 상태다. 안내 문구는 광고 재고가 없을 때의 자리 채움이라 맨 뒤다.
   */
  function choosePayload(now) {
    const auth = readLoginPrompt();
    if (auth) {
      // 광고에서 안내로 넘어가는 순간 열려 있던 표시 구간을 닫는다.
      // 안 닫으면 안내를 띄우는 내내 광고를 보여준 것으로 신고된다.
      try { runtime.stop(now); } catch { /* 표시 전환을 막지 않는다 */ }
      return { kind: "login", text: LOGIN_NOTICE, brand: "", reward: null, clickUrl: null, maxWidthPx: NOTICE_WIDTH };
    }
    const ad = runtime.tick(now);
    if (ad) return { ...ad, kind: "ad" };
    const context = runtime.displayContext(now);
    if (!context) return null;
    return {
      kind: "notice",
      text: rotatingNotice(now),
      brand: "",
      reward: null,
      clickUrl: null,
      maxWidthPx: context.maxWidthPx,
    };
  }

  /** 로그인 안내를 띄울 상태인가. 로그인을 실행할 수 없으면(CLI 미설치) 누를 곳이 없으므로 띄우지 않는다. */
  function readLoginPrompt() {
    try {
      const state = clawadAuthState.readAuthState({ dataDir: runtime.dataDir });
      return state && state.canLogin && LOGIN_PROMPT_STATUSES.has(state.status) ? state : null;
    } catch {
      // 상태를 못 읽는다고 광고 표시를 막지 않는다.
      return null;
    }
  }

  /** 누를 곳이 있는 표시(링크 광고·로그인 안내)만 클릭을 받는다. 없으면 창이 입력을 통째로 통과시킨다. */
  function applyClickable(win, clickable) {
    if (clickable === lastClickable) return;
    win.setIgnoreMouseEvents(!clickable, { forward: false });
    lastClickable = clickable;
  }

  /**
   * 표시 중인 광고의 링크를 기본 브라우저로 연다.
   * 열기만 하고 **클릭을 기록·전송하지 않는다** — 클릭 정보 수집은 별도 동의가 있을 때만 가능하다(규칙 §6).
   * URL은 런타임이 https만 통과시킨 값이고, 렌더러가 보낸 값을 쓰지 않는다.
   */
  function openCurrentAd() {
    // 로그인 안내를 누르면 로그인 흐름을 띄운다. login.js가 브라우저를 열고 loopback으로 받는다 —
    // 오버레이는 인증을 재구현하지 않는다 (clawad-auth-state.js 주석, 계약 §3.4).
    if (lastPayload && lastPayload.kind === "login") {
      try {
        const result = clawadAuthState.startLogin({ dataDir: runtime.dataDir });
        return result && result.status === "started";
      } catch (err) {
        console.warn("ClawAd: failed to start login:", err && err.message);
        return false;
      }
    }
    const url = lastPayload && lastPayload.clickUrl;
    if (!url) return false;
    try {
      shell.openExternal(url);
      // URL은 남기지 않는다 — 클릭 대상 기록은 클릭 정보 수집에 해당한다.
      console.log("ClawAd: opened the current ad link in the default browser");
      return true;
    } catch (err) {
      console.warn("ClawAd: failed to open ad link:", err && err.message);
      return false;
    }
  }

  function applyBounds(win, maxWidthPx) {
    const bounds = computeBounds(maxWidthPx);
    if (!bounds) return;
    // 매 tick마다 같은 값을 다시 넣으면 창이 깜빡인다. 바뀔 때만 적용한다.
    if (lastBounds && lastBounds.x === bounds.x && lastBounds.y === bounds.y
      && lastBounds.width === bounds.width && lastBounds.height === bounds.height) return;
    win.setBounds(bounds);
    lastBounds = bounds;
  }

  function showAd(payload) {
    lastPayload = payload;
    const win = ensureWindow();
    if (!win || win.isDestroyed()) return;
    applyBounds(win, payload.maxWidthPx);
    applyClickable(win, payload.kind === "login" || Boolean(payload.clickUrl));
    send(payload);
    if (!win.isVisible()) {
      win.showInactive();
      keepOutOfTaskbar(win);
      if (typeof ctx.reapplyMacVisibility === "function") ctx.reapplyMacVisibility();
    }
  }

  function hideAd() {
    lastPayload = null;
    if (!adWindow || adWindow.isDestroyed()) return;
    send(null);
    applyClickable(adWindow, false);
    if (adWindow.isVisible()) adWindow.hide();
  }

  /** 표시 구간을 닫고 광고를 숨긴다. 락은 계속 쥔 채로 둔다(같은 서피스가 곧 다시 표시한다). */
  function suspend() {
    runtime.stop();
    hideAd();
  }

  /**
   * 한 번 평가해서 표시/숨김을 반영한다.
   *
   * 광고를 그릴 수 있을 때만 서피스 락을 쥐고, **락을 쥔 동안에만** 표시한다 (CLAW-119).
   * 락이 없으면(다른 서피스가 쥐고 있으면) 표시하지 않는다 — 이중 표시·이중 계상 방지.
   * 펫이 숨겨져 있으면 광고도 숨긴다: 안 보이는 시간을 노출 구간으로 남기지 않는다.
   */
  function tick() {
    const petHidden = typeof ctx.petHidden === "boolean" ? ctx.petHidden : false;
    if (petHidden) {
      suspend();
      releaseSurface();
      return;
    }
    // 광고·안내·로그인 중 무엇을 띄울지는 choosePayload가 정한다. 광고 재고가 없어도
    // 안내 문구가 남으므로 canRender()로 미리 잘라내지 않는다.
    const payload = choosePayload(Date.now());
    if (!payload) {
      suspend();
      releaseSurface();
      return;
    }
    // 안내를 띄울 때도 락을 쥔다 — 오버레이가 둘 뜨면 안내도 둘로 보인다.
    if (!clawadSurfaceLock.ownsAdSurface() && !clawadSurfaceLock.acquireAdSurface()) {
      suspend();
      return;
    }
    showAd(payload);
  }

  function releaseSurface() {
    if (!clawadSurfaceLock.ownsAdSurface()) return;
    try {
      clawadSurfaceLock.releaseAdSurface();
    } catch { /* 반환 실패는 statusline이 stale로 회수한다 */ }
  }

  function start() {
    if (timer) return;
    if (!ipcBound) {
      // 렌더러는 "열어달라"만 보낸다. 어떤 URL을 열지는 메인이 결정한다.
      ipcMain.on("clawad-ad:open", (event) => {
        if (!adWindow || adWindow.isDestroyed()) return;
        if (event.sender !== adWindow.webContents) return;
        openCurrentAd();
      });
      ipcBound = true;
    }
    tick();
    timer = setInterval(() => {
      try { tick(); } catch (err) { console.warn("ClawAd: ad tick failed:", err && err.message); }
    }, TICK_MS);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function reposition() {
    if (!adWindow || adWindow.isDestroyed() || !adWindow.isVisible() || !lastPayload) return;
    const bounds = computeBounds(lastPayload.maxWidthPx);
    if (bounds) adWindow.setBounds(bounds);
  }

  /** 종료·일시중지. 표시 중이던 구간을 스풀에 남기고 락을 반환한 뒤 창을 정리한다. */
  function cleanup() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    try { runtime.stop(); } catch { /* 종료 경로를 막지 않는다 */ }
    releaseSurface();
    if (ipcBound) {
      ipcMain.removeAllListeners("clawad-ad:open");
      ipcBound = false;
    }
    lastPayload = null;
    lastBounds = null;
    lastClickable = null;
    if (adWindow && !adWindow.isDestroyed()) adWindow.destroy();
    adWindow = null;
    ready = false;
  }

  return {
    canRender: (now) => runtime.canRender(now),
    cleanup,
    getWindow: () => adWindow,
    openCurrentAd,
    reposition,
    start,
    tick,
  };
};

module.exports.__test = { STRIP_HEIGHT, TICK_MS, scaled };
