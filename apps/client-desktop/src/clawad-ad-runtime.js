"use strict";
// 클로애드 광고 표시 로직 (CLAW-90 오버레이측).
//
// 하는 일: 광고 번들 선택·회전, 표시 구간 추적, 표시가 끝난 구간을 스풀 파일로 남기기,
// 수거 트리거 1회 실행. 렌더링·창 배치는 clawad-ad-window.js가 맡는다 — 여기엔 Electron이 없다.
//
// 협약은 clawad 저장소 `docs/design/overlay-contract.md`가 정의한다 (§2 읽는 파일, §2.1 정책 캐시,
// §3.2 스풀 포맷, §3.3 수거 트리거). clawad 코드를 가져오지 않는다 (docs/BOUNDARY.md §1).
//
// 경계 [CRITICAL]: 여기서 만들지 않는 것 — 금액·단가·배분율·리워드, sequence 채번, machineId,
// 부정 여부 판정. 오버레이는 "이 광고를 이 구간에 표시했다"는 사실만 남긴다. 인정 여부는
// clawad 수거와 서버가 판정한다.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { clawadDataDir } = require("./clawad-surface-lock");

const SPOOL_VERSION = 1;
const SPOOL_DIR_NAME = "overlay-events";
const POLICY_CACHE_NAME = "overlay-policy.json";
const POLICY_CACHE_VERSION = 1;
const REWARD_SUMMARY_NAME = "reward-summary.json";
const REWARD_SUMMARY_VERSION = 1;
const TRIGGER_FILE_NAME = "overlay-trigger.json";
const TRIGGER_VERSION = 1;
/** 트리거로 실행을 허용하는 스크립트 파일명. 포인터가 가리키는 임의 경로를 실행하지 않는다 (§3.3). */
const TRIGGER_SCRIPT_BASENAME = "overlay-events.js";
const WORK_STATE_DIR_NAME = "work-state";
const SESSION_FILE_PATTERN = /^[0-9a-f]{32}\.json$/;
/**
 * 인정으로 이어지지 않은 표시를 같은 토큰으로 몇 번까지 다시 시도할지 (CLAW-142).
 * 리워드 정책값이 아니라 재고 교착을 막는 런타임 상한이라 정책 캐시로 받지 않는다.
 * 짧은 작업이 반복돼도 재고가 살아남을 만큼은 크고, 안 되는 토큰에 매달리지 않을 만큼은 작아야 한다.
 */
const MAX_UNCOUNTED_SHOWS = 3;
/** 광고 문구 표시 상한. 길이 제한은 표시 안전장치이고 정책값이 아니다. */
const MAX_AD_TEXT_LENGTH = 120;
const MAX_AD_BRAND_LENGTH = 60;

function readJsonFile(file) {
  try {
    // 다른 도구가 붙인 BOM을 제거한 뒤 파싱한다.
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function positiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * 정책 캐시 (§2.1). 값이 하나라도 이상하면 null — 광고 기능을 켜지 않는다.
 * 정책값을 추측하거나 기본값으로 넘겨짚지 않는다.
 */
function readPolicyCache(dataDir) {
  const cache = readJsonFile(path.join(dataDir, POLICY_CACHE_NAME));
  if (!cache || cache.version !== POLICY_CACHE_VERSION) return null;
  const overlay = cache.overlay;
  const impression = cache.impression;
  if (!overlay || !impression) return null;
  if (!positiveInt(overlay.adRotateMs) || !positiveInt(overlay.idleThresholdMs) || !positiveInt(overlay.maxWidthPx)) return null;
  if (!positiveInt(impression.minViewMs)) return null;
  // 인정 구간 사이 간격 (CLAW-135, contract §2.1). **선택 항목이다.**
  //
  // 다른 정책값과 달리 없을 때 광고를 끄지 않는다. 이 값은 adGapMs를 담기 시작한 CLI가
  // 써주는데, 오버레이는 자동 업데이트되고 CLI는 수동 업데이트라(`clawad update`) 새 오버레이 +
  // 구 CLI 조합이 실제로 생긴다. 그때 광고를 끄면 사용자는 이유도 모른 채 적립이 영구히 0이 된다.
  //
  // 없을 때의 0은 "추측한 정책값"이 아니라 계약 이전 판(간격 없음)의 동작 그대로다. 이 값은
  // 우리가 신고하는 구간을 **줄이기만** 하므로, 없다고 해서 인정되면 안 될 노출이 인정되지 않는다.
  // 그래서 다른 값들과 달리 열어두는 것이 안전하다. 반대로 값이 들어 있는데 형식이 틀리면
  // 손상된 캐시이므로 그때는 광고를 켜지 않는다.
  if (overlay.adGapMs !== undefined && !positiveInt(overlay.adGapMs)) return null;
  // 활동 상태의 유효기간 (CLAW-142). adGapMs와 같은 이유로 **선택 항목이다** — 이 값을 담기
  // 시작한 CLI가 아직 안 깔린 조합에서 광고를 꺼버리면 안 된다. 없으면 0으로 두고,
  // isWorkActive가 기존처럼 active 플래그를 그대로 믿는다.
  const activity = cache.activity;
  const staleActiveMs = activity && activity.staleActiveMs !== undefined ? activity.staleActiveMs : 0;
  if (staleActiveMs !== 0 && !positiveInt(staleActiveMs)) return null;
  return {
    adRotateMs: overlay.adRotateMs,
    adGapMs: overlay.adGapMs === undefined ? 0 : overlay.adGapMs,
    idleThresholdMs: overlay.idleThresholdMs,
    maxWidthPx: overlay.maxWidthPx,
    minViewMs: impression.minViewMs,
    staleActiveMs,
  };
}

/**
 * 적립 현황 (CLAW-138). 서버가 계산해 sync가 내려준 값을 **그대로 표시하기 위해서만** 읽는다.
 * 오버레이는 포인트를 계산하지 않는다 (CLAUDE.md §2 [CRITICAL]) — 노출당 단가는 serveToken 안에
 * 있지만 그것을 열어 곱하지 않는다. 여기서 하는 일은 두 정수를 읽어 넘기는 것뿐이다.
 *
 * 파일이 없거나(미로그인·첫 sync 이전) 형식이 어긋나면 null이고, 2행에서 적립 표시만 빠진다 —
 * 광고 자체는 계속 뜬다. 적립 표시는 광고 표시의 전제 조건이 아니다.
 */
function readRewardSummary(dataDir) {
  const summary = readJsonFile(path.join(dataDir, REWARD_SUMMARY_NAME));
  if (!summary || summary.version !== REWARD_SUMMARY_VERSION) return null;
  // 0은 정상값이다(적립 전). positiveInt를 쓰면 갓 시작한 사용자에게만 표시가 사라진다.
  if (!nonNegativeInt(summary.verifyingPoints) || !nonNegativeInt(summary.confirmedPoints)) return null;
  return { verifying: summary.verifyingPoints, confirmed: summary.confirmedPoints };
}

/** 표시 후보 번들. 읽기 전용이다 — 오버레이는 bundles.json을 쓰지 않는다 (§2). */
function readBundles(dataDir, now) {
  const bundles = readJsonFile(path.join(dataDir, "bundles.json"));
  if (!Array.isArray(bundles)) return [];
  return bundles.filter((bundle) => bundle
    && typeof bundle.serveToken === "string" && bundle.serveToken.length > 0
    && Number.isFinite(bundle.expiresAt) && bundle.expiresAt > now
    && bundle.ad && typeof bundle.ad.text === "string" && bundle.ad.text.length > 0);
}

/**
 * Claude Code가 작업 중인가. clawad의 훅이 쓰는 work-state를 읽고 idleThresholdMs를 적용한다.
 * 수거(clawad)가 활성 구간 교집합으로 인정 여부를 판정하므로, 표시도 같은 신호에 맞춘다 —
 * 어긋나면 "보이지만 인정되지 않는" 노출만 쌓인다.
 */
function isWorkActive(dataDir, now, idleThresholdMs, staleActiveMs) {
  const dir = path.join(dataDir, WORK_STATE_DIR_NAME);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return false; }
  for (const name of names) {
    if (!SESSION_FILE_PATTERN.test(name)) continue;
    const activity = readJsonFile(path.join(dir, name));
    if (!activity || activity.version !== 1) continue;
    if (activity.active === true && Number.isFinite(activity.startedAt)) {
      // 훅이 Stop을 못 보내면 세션이 active=true로 굳는다(터미널 강제 종료 등). 그걸 그대로
      // 믿으면 며칠 전 좀비 세션 하나 때문에 "영원히 작업 중"이 된다 (CLAW-142). 수거측
      // loadActivity와 **같은 규칙**으로 닫는다 — 넘긴 구간은 startedAt + staleActiveMs에
      // 끝난 것으로 보고 아래 idleThresholdMs 판정에 태운다.
      if (staleActiveMs <= 0 || now - activity.startedAt <= staleActiveMs) return true;
      if (now - (activity.startedAt + staleActiveMs) <= idleThresholdMs) return true;
    }
    const intervals = Array.isArray(activity.intervals) ? activity.intervals : [];
    for (const interval of intervals) {
      if (interval && Number.isFinite(interval.endedAt) && now - interval.endedAt <= idleThresholdMs) return true;
    }
  }
  return false;
}

/** 광고 문구 정화. 제어문자·ANSI 이스케이프를 제거하고 길이를 제한한다. */
function safeText(value, maxLength) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * 클릭 링크. https만 허용하고 제어문자가 섞인 값은 버린다.
 * 클릭 자체는 기록·전송하지 않는다 — 클릭 정보 수집은 별도 동의가 있을 때만 가능하다(규칙 §6).
 */
function safeClickUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function displayPayload(bundle, maxWidthPx, reward) {
  return {
    text: safeText(bundle.ad.text, MAX_AD_TEXT_LENGTH) || "광고",
    brand: safeText(bundle.ad.brand, MAX_AD_BRAND_LENGTH),
    clickUrl: safeClickUrl(bundle.clickUrl),
    maxWidthPx,
    reward,
  };
}

/**
 * 표시 사실을 스풀 파일 한 건으로 남긴다 (§3.2).
 * 같은 디렉터리에 `.tmp`로 쓰고 rename — 수거가 반쪽 파일을 읽지 않게 한다.
 */
function writeSpoolEvent(dataDir, event) {
  const dir = path.join(dataDir, SPOOL_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const name = crypto.randomBytes(16).toString("hex");
  const target = path.join(dir, `${name}.json`);
  const temp = path.join(dir, `${name}.json.tmp`);
  const body = JSON.stringify({
    version: SPOOL_VERSION,
    serveToken: event.serveToken,
    renderStarted: event.renderStarted,
    displayStartedAt: event.displayStartedAt,
    displayEndedAt: event.displayEndedAt,
  });
  try {
    fs.writeFileSync(temp, body, { mode: 0o600 });
    fs.renameSync(temp, target);
    return target;
  } catch {
    try { fs.unlinkSync(temp); } catch { /* 정리 실패는 무시한다 */ }
    return null;
  }
}

/**
 * 수거 트리거 (§3.3). 포인터가 가리키는 스크립트의 **파일명을 검증한 뒤** 한 번만 실행한다.
 * 실패·타임아웃은 무시한다 — 유실이 아니라 지연이고, clawad의 주기 sync가 같은 수거를 돌린다.
 */
function readTriggerPointer(dataDir) {
  const pointer = readJsonFile(path.join(dataDir, TRIGGER_FILE_NAME));
  if (!pointer || pointer.version !== TRIGGER_VERSION) return null;
  if (typeof pointer.node !== "string" || typeof pointer.script !== "string") return null;
  if (path.basename(pointer.script) !== TRIGGER_SCRIPT_BASENAME) return null;
  if (!fs.existsSync(pointer.node) || !fs.existsSync(pointer.script)) return null;
  const args = Array.isArray(pointer.args) ? pointer.args.filter((arg) => typeof arg === "string") : [];
  return { node: pointer.node, script: pointer.script, args };
}

/**
 * 광고 런타임. `tick(now)`을 주기적으로 호출하면 지금 표시할 광고를 돌려준다.
 * 표시 대상이 바뀌거나 사라질 때 직전 구간을 스풀에 남긴다.
 */
function createAdRuntime(options = {}) {
  const dataDir = options.dataDir || clawadDataDir();
  const spawnCollector = options.spawnCollector || defaultSpawnCollector;
  /** 스풀에 남긴 토큰. serveToken은 단일 사용이므로 다시 쓰지 않는다. */
  const spooledTokens = new Set();
  /**
   * 표시했지만 인정 요청까지 가지 못한 토큰의 횟수 (CLAW-142).
   * 이런 토큰은 clawad가 캐시에서 지우지 않고 서버도 "미사용"으로 세므로, 여기서 영구 소모로
   * 처리해 버리면 재고가 말라붙어 광고가 멈춘다. 재사용은 허용하되 같은 소재만 반복하지 않도록
   * 우선순위를 낮추고 상한을 둔다.
   */
  const uncountedShows = new Map();
  /** 현재 표시 중인 구간. { serveToken, renderStarted, displayStartedAt } */
  let current = null;
  let currentBundle = null;
  let collectorBusy = false;
  /**
   * 직전에 스풀로 남긴 인정 구간의 종료 시각 (CLAW-135). 다음 구간의 시작을 여기서
   * adGapMs 이후로 미뤄 서버의 동시 노출 판정에 걸리지 않게 한다. 스풀에 남기지 못한
   * 구간(최소 시청 시간 미달)은 서버가 본 적이 없으므로 기준점을 갱신하지 않는다.
   */
  let lastSpooledEndAt = null;

  function finishCurrent(now, policy) {
    if (!current) return null;
    const finished = { ...current, displayEndedAt: now };
    current = null;
    currentBundle = null;
    // 최소 시청 시간에 못 미친 구간은 이벤트를 만들지 않는다 (CLAW-90 요구사항).
    // 최종 인정 판정은 clawad 수거와 서버가 한다.
    const countUncounted = () => {
      uncountedShows.set(finished.serveToken, (uncountedShows.get(finished.serveToken) || 0) + 1);
    };
    if (!policy || finished.displayEndedAt - finished.displayStartedAt < policy.minViewMs) {
      countUncounted();
      return null;
    }
    const file = writeSpoolEvent(dataDir, finished);
    if (!file) {
      countUncounted();
      return null;
    }
    spooledTokens.add(finished.serveToken);
    uncountedShows.delete(finished.serveToken);
    lastSpooledEndAt = finished.displayEndedAt;
    triggerCollector();
    return file;
  }

  /**
   * 인정을 요청할 구간의 시작 (CLAW-135). 실제 렌더는 now에 시작하지만, 직전 인정 구간과
   * adGapMs 이상 떨어지도록 시작점만 미룬다. 실제 표시 구간의 부분집합이라 과대 신고가 아니고,
   * renderStarted는 실제 첫 렌더 시각을 그대로 유지한다(CLAW-71 퍼널 진단).
   *
   * 표시 자체는 끊지 않는다 — 광고창이 사라졌다 다시 뜨면 사용자 피로가 생기므로
   * 화면에는 틈을 만들지 않고 문구만 바뀐다. 틈은 인정 구간에만 있다.
   */
  function countedStartAt(now, policy) {
    if (lastSpooledEndAt === null) return now;
    return Math.max(now, lastSpooledEndAt + policy.adGapMs);
  }

  function triggerCollector() {
    if (collectorBusy) return false;
    const pointer = readTriggerPointer(dataDir);
    if (!pointer) return false;
    collectorBusy = true;
    try {
      spawnCollector(pointer, () => { collectorBusy = false; });
      return true;
    } catch {
      collectorBusy = false;
      return false;
    }
  }

  /**
   * 표시할 번들을 고른다 (CLAW-142).
   * 아직 안 보여준 것 → 인정 안 된 채 보여준 것 순으로 고르고, 직전 소재는 피한다.
   * 상한(MAX_UNCOUNTED_SHOWS)을 넘긴 토큰은 더 시도하지 않는다 — 계속 미달로 끝나는 토큰에
   * 재고를 묶어두지 않기 위해서다. 스풀에 남긴 토큰은 단일 사용이라 영구 제외한다.
   */
  function chooseBundle(bundles, previousToken) {
    const usable = bundles.filter((bundle) => !spooledTokens.has(bundle.serveToken)
      && (uncountedShows.get(bundle.serveToken) || 0) < MAX_UNCOUNTED_SHOWS);
    const fresh = usable.filter((bundle) => !uncountedShows.has(bundle.serveToken)
      && bundle.serveToken !== previousToken);
    if (fresh.length) return fresh[0];
    const notPrevious = usable.filter((bundle) => bundle.serveToken !== previousToken);
    if (notPrevious.length) return notPrevious[0];
    // 후보가 직전 소재 하나뿐이면 화면을 비우기보다 그대로 이어 보여준다.
    return usable.length ? usable[0] : null;
  }

  /**
   * 지금 표시할 광고를 돌려준다. null이면 광고를 숨긴다.
   * 정책 캐시가 없거나 작업 중이 아니거나 후보 번들이 없으면 표시하지 않는다.
   */
  function tick(now = Date.now()) {
    const policy = readPolicyCache(dataDir);
    if (!policy) {
      finishCurrent(now, null);
      return null;
    }
    if (!isWorkActive(dataDir, now, policy.idleThresholdMs, policy.staleActiveMs)) {
      finishCurrent(now, policy);
      return null;
    }
    // 표시 중인 광고는 회전 주기를 채운다. 기준은 인정 구간 시작이 아니라 **실제 렌더 시각**이다
    // (CLAW-135) — 인정 구간 시작은 adGapMs만큼 뒤로 밀리므로, 그걸 기준으로 삼으면 화면
    // 회전 주기가 같이 늘어난다. 화면 리듬은 adRotateMs 그대로 유지한다.
    if (current && currentBundle && now - current.renderStarted < policy.adRotateMs) {
      // 적립 현황은 매 tick 다시 읽는다 — 같은 소재를 보여주는 동안 sync가 값을 갱신하면 반영된다.
      return displayPayload(currentBundle, policy.maxWidthPx, readRewardSummary(dataDir));
    }
    // finishCurrent가 current를 비우므로 직전 소재를 미리 잡아둔다 — 연속 반복 방지용이다.
    const previousToken = current ? current.serveToken : null;
    finishCurrent(now, policy);
    const bundles = readBundles(dataDir, now);
    const bundle = chooseBundle(bundles, previousToken);
    if (!bundle) return null;
    currentBundle = bundle;
    current = { serveToken: bundle.serveToken, renderStarted: now, displayStartedAt: countedStartAt(now, policy) };
    return displayPayload(bundle, policy.maxWidthPx, readRewardSummary(dataDir));
  }

  /** 종료·일시중지에서 호출한다. 표시 중이던 구간을 닫고 스풀에 남긴다. */
  function stop(now = Date.now()) {
    return finishCurrent(now, readPolicyCache(dataDir));
  }

  /** 광고를 표시할 준비가 됐는가 = 서피스 락을 쥘 자격이 있는가 (CLAW-119의 옵트인을 대체). */
  function canRender(now = Date.now()) {
    return Boolean(readPolicyCache(dataDir)) && readBundles(dataDir, now).length > 0;
  }

  /**
   * 광고 재고와 **무관하게** 지금 이 창을 띄워도 되는 맥락인가 (CLAW-138 후속).
   * canRender와 달리 번들 유무를 보지 않는다 — 재고가 없을 때 안내 문구를 띄우기 위한 것이다.
   * 안내도 광고와 같은 조건(정책 있음 + 작업 중)에서만 뜬다. 놀고 있을 때 띄우면 잔소리가 된다.
   */
  function displayContext(now = Date.now()) {
    const policy = readPolicyCache(dataDir);
    if (!policy) return null;
    if (!isWorkActive(dataDir, now, policy.idleThresholdMs, policy.staleActiveMs)) return null;
    return { maxWidthPx: policy.maxWidthPx };
  }

  return {
    canRender,
    displayContext,
    stop,
    tick,
    get dataDir() { return dataDir; },
    get displayedToken() { return current ? current.serveToken : null; },
  };
}

/** 기본 트리거 실행기. 창 없이 띄우고 결과를 기다리지 않는다. */
function defaultSpawnCollector(pointer, done) {
  const { spawn } = require("node:child_process");
  const child = spawn(pointer.node, [pointer.script, ...pointer.args], {
    stdio: "ignore",
    windowsHide: true,
    detached: false,
  });
  child.on("error", () => done());
  child.on("close", () => done());
  child.unref();
}

module.exports = {
  MAX_AD_TEXT_LENGTH,
  POLICY_CACHE_NAME,
  SPOOL_DIR_NAME,
  TRIGGER_SCRIPT_BASENAME,
  createAdRuntime,
  isWorkActive,
  readBundles,
  readPolicyCache,
  readRewardSummary,
  readTriggerPointer,
  safeClickUrl,
  safeText,
  writeSpoolEvent,
};
