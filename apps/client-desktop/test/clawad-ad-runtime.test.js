"use strict";
// 오버레이 광고 표시 로직 테스트 (CLAW-90).
// 협약: clawad `docs/design/overlay-contract.md` §2.1 정책 캐시, §3.2 스풀, §3.3 트리거

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createAdRuntime,
  isWorkActive,
  readPolicyCache,
  readTriggerPointer,
  safeClickUrl,
  safeText,
} = require("../src/clawad-ad-runtime");

const POLICY = { adRotateMs: 15000, adGapMs: 3000, idleThresholdMs: 60000, maxWidthPx: 360, minViewMs: 5000 };

function makeData(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawad-ad-"));
  if (overrides.policy !== null) {
    fs.writeFileSync(path.join(dir, "overlay-policy.json"), JSON.stringify(overrides.policy || {
      version: 1,
      overlay: { adRotateMs: POLICY.adRotateMs, adGapMs: POLICY.adGapMs, idleThresholdMs: POLICY.idleThresholdMs, maxWidthPx: POLICY.maxWidthPx },
      impression: { minViewMs: POLICY.minViewMs },
      updatedAt: Date.now(),
    }));
  }
  if (overrides.bundles !== null) {
    fs.writeFileSync(path.join(dir, "bundles.json"), JSON.stringify(overrides.bundles || [bundle("token.a"), bundle("token.b")]));
  }
  if (overrides.active !== false) writeActive(dir);
  return dir;
}

function bundle(serveToken, extra = {}) {
  return {
    serveToken,
    expiresAt: Date.now() + 600000,
    minViewMs: POLICY.minViewMs,
    ad: { text: `광고 ${serveToken}`, brand: "클로애드", campaignType: "PAID", creativeId: "c1" },
    ...extra,
  };
}

/** 작업 중 상태를 만든다. statusline 훅이 쓰는 work-state 포맷 그대로. */
function writeActive(dataDir, { active = true, endedAgoMs = 0 } = {}) {
  const dir = path.join(dataDir, "work-state");
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  fs.writeFileSync(path.join(dir, "a".repeat(32) + ".json"), JSON.stringify(active
    ? { version: 1, active: true, startedAt: now - 30000, intervals: [], updatedAt: now }
    : { version: 1, active: false, intervals: [{ startedAt: now - 60000, endedAt: now - endedAgoMs }], updatedAt: now }));
}

function spoolFiles(dataDir) {
  const dir = path.join(dataDir, "overlay-events");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => !name.endsWith(".tmp")) : [];
}

function spoolContents(dataDir) {
  const dir = path.join(dataDir, "overlay-events");
  return spoolFiles(dataDir).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

/** 트리거를 실행하지 않고 호출만 기록하는 런타임. */
function runtimeWithRecorder(dataDir) {
  const calls = [];
  const runtime = createAdRuntime({
    dataDir,
    spawnCollector: (pointer, done) => { calls.push(pointer); done(); },
  });
  return { runtime, calls };
}

test("작업 중이고 번들이 있으면 광고 한 건을 표시한다", () => {
  const data = makeData();
  const { runtime } = runtimeWithRecorder(data);

  const ad = runtime.tick(Date.now());

  assert.ok(ad, "표시할 광고가 있어야 한다");
  assert.strictEqual(ad.text, "광고 token.a");
  assert.strictEqual(ad.brand, "클로애드");
  assert.strictEqual(ad.maxWidthPx, POLICY.maxWidthPx);
  assert.strictEqual(runtime.displayedToken, "token.a");
});

test("회전 주기 안에는 같은 광고를 유지하고, 주기가 끝나면 다음 광고로 바꾼다", () => {
  const data = makeData();
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  runtime.tick(start);
  assert.strictEqual(runtime.tick(start + POLICY.adRotateMs - 1).text, "광고 token.a", "주기 안에서는 유지");

  const rotated = runtime.tick(start + POLICY.adRotateMs);
  assert.strictEqual(rotated.text, "광고 token.b");
  assert.strictEqual(runtime.displayedToken, "token.b");
});

test("표시가 끝나면 표시 구간을 스풀 파일로 남긴다 — 8필드 밖의 값은 넣지 않는다", () => {
  const data = makeData();
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  runtime.tick(start);
  runtime.tick(start + POLICY.adRotateMs);

  const [spooled] = spoolContents(data);
  assert.deepStrictEqual(Object.keys(spooled), ["version", "serveToken", "renderStarted", "displayStartedAt", "displayEndedAt"]);
  assert.strictEqual(spooled.version, 1);
  assert.strictEqual(spooled.serveToken, "token.a");
  assert.strictEqual(spooled.renderStarted, start);
  assert.strictEqual(spooled.displayStartedAt, start);
  assert.strictEqual(spooled.displayEndedAt, start + POLICY.adRotateMs);
  // 채번·머신ID·금액은 오버레이가 만들지 않는다.
  const serialized = JSON.stringify(spooled);
  for (const forbidden of ["sequence", "machineId", "clientVersion", "userId", "gross", "points"]) {
    assert.ok(!serialized.includes(forbidden), `스풀에 ${forbidden}가 들어 있다`);
  }
});

// 서버는 동시 노출 판정 구간을 concurrentToleranceMs만큼 양쪽으로 넓힌다. 인정 구간이
// 0ms 간격으로 붙으면 연속으로 본 광고가 서로 CONCURRENT_USER_IMPRESSION으로 걸린다 (CLAW-135).
test("연속 인정 구간 사이에 adGapMs 이상 간격을 둔다 (CLAW-135)", () => {
  const data = makeData();
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  runtime.tick(start);
  runtime.tick(start + POLICY.adRotateMs);
  runtime.tick(start + POLICY.adRotateMs * 2);

  const spooled = spoolContents(data).sort((a, b) => a.displayStartedAt - b.displayStartedAt);
  assert.strictEqual(spooled.length, 2);
  const gap = spooled[1].displayStartedAt - spooled[0].displayEndedAt;
  assert.strictEqual(gap, POLICY.adGapMs, "직전 인정 구간 종료로부터 adGapMs만큼 미뤄야 한다");
  // 인정 구간은 실제 표시 구간의 부분집합이다 — 과대 신고가 아니다.
  assert.ok(spooled[1].renderStarted <= spooled[1].displayStartedAt);
  assert.strictEqual(spooled[1].renderStarted, start + POLICY.adRotateMs, "실제 첫 렌더 시각은 그대로다");
  assert.strictEqual(spooled[1].displayEndedAt - spooled[1].displayStartedAt, POLICY.adRotateMs - POLICY.adGapMs);
});

// 틈은 인정 구간에만 둔다. 광고창이 사라졌다 다시 뜨면 사용자 피로가 생기므로
// 화면에는 틈을 만들지 않고 문구만 바뀐다 (CLAW-135).
test("인정 구간 간격이 화면 회전 주기를 늘리지 않는다 (CLAW-135)", () => {
  const data = makeData();
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  runtime.tick(start);
  runtime.tick(start + POLICY.adRotateMs); // token.b로 회전
  // 간격이 회전 기준에 섞이면 이 시점에 아직 token.b가 남아 있다.
  assert.strictEqual(runtime.tick(start + POLICY.adRotateMs * 2 - 1).text, "광고 token.b");
  // 회전 시점에도 표시는 끊기지 않는다 — 후보가 없을 때만 null이다.
  assert.strictEqual(runtime.tick(start + POLICY.adRotateMs + POLICY.adGapMs).text, "광고 token.b",
    "간격 구간에도 광고는 계속 떠 있어야 한다");
});

test("정책 캐시에 adGapMs가 없으면 광고 기능을 켜지 않는다 (CLAW-135)", () => {
  const data = makeData({
    policy: {
      version: 1,
      overlay: { adRotateMs: POLICY.adRotateMs, idleThresholdMs: POLICY.idleThresholdMs, maxWidthPx: POLICY.maxWidthPx },
      impression: { minViewMs: POLICY.minViewMs },
      updatedAt: Date.now(),
    },
  });
  const { runtime } = runtimeWithRecorder(data);

  assert.strictEqual(runtime.tick(Date.now()), null, "정책값을 추측하지 않는다");
});

test("최소 시청 시간에 못 미친 표시 구간은 스풀을 만들지 않는다", () => {
  const data = makeData();
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  runtime.tick(start);
  runtime.stop(start + POLICY.minViewMs - 1);

  assert.deepStrictEqual(spoolFiles(data), []);
});

test("작업이 멈추면 광고를 숨기고 그때까지의 구간을 남긴다", () => {
  const data = makeData();
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();
  runtime.tick(start);

  // 유휴 임계를 넘긴 상태로 바꾼다.
  writeActive(data, { active: false, endedAgoMs: POLICY.idleThresholdMs + 1000 });
  const ad = runtime.tick(start + POLICY.minViewMs + 500);

  assert.strictEqual(ad, null, "작업 중이 아니면 광고를 표시하지 않는다");
  assert.strictEqual(spoolContents(data).length, 1);
  assert.strictEqual(runtime.displayedToken, null);
});

test("표시한 토큰은 다시 고르지 않는다 — serveToken은 단일 사용이다", () => {
  const data = makeData({ bundles: [bundle("token.only")] });
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  assert.strictEqual(runtime.tick(start).text, "광고 token.only");
  assert.strictEqual(runtime.tick(start + POLICY.adRotateMs), null, "후보가 소진되면 표시하지 않는다");
  assert.strictEqual(spoolContents(data).length, 1);
});

test("정책 캐시가 없으면 광고를 표시하지 않는다 — 정책값을 추측하지 않는다", () => {
  const data = makeData({ policy: null });
  const { runtime } = runtimeWithRecorder(data);

  assert.strictEqual(runtime.tick(Date.now()), null);
  assert.strictEqual(runtime.canRender(), false);
});

test("정책 캐시의 값이 이상하면 무효로 본다", () => {
  assert.strictEqual(readPolicyCache(makeData({ policy: { version: 2, overlay: {}, impression: {} } })), null, "버전 불일치");
  assert.strictEqual(readPolicyCache(makeData({
    policy: { version: 1, overlay: { adRotateMs: 0, adGapMs: 1, idleThresholdMs: 1, maxWidthPx: 1 }, impression: { minViewMs: 1 } },
  })), null, "양의 정수가 아닌 값");
  assert.deepStrictEqual(readPolicyCache(makeData()), POLICY);
});

test("만료된 번들과 문구 없는 번들은 후보가 아니다", () => {
  const data = makeData({
    bundles: [
      { ...bundle("token.expired"), expiresAt: Date.now() - 1000 },
      { ...bundle("token.empty"), ad: { text: "", brand: "x", campaignType: "PAID" } },
      bundle("token.good"),
    ],
  });
  const { runtime } = runtimeWithRecorder(data);

  assert.strictEqual(runtime.tick(Date.now()).text, "광고 token.good");
});

test("스풀을 남기면 수거 트리거를 실행한다 — 파일명이 다른 스크립트는 실행하지 않는다", () => {
  const data = makeData();
  const node = process.execPath;
  const script = path.join(data, "overlay-events.js");
  fs.writeFileSync(script, "// 수거 스크립트 자리\n");
  fs.writeFileSync(path.join(data, "overlay-trigger.json"), JSON.stringify({
    version: 1, node, script, args: ["collect"], clientVersion: "0.1.8",
  }));

  const { runtime, calls } = runtimeWithRecorder(data);
  const start = Date.now();
  runtime.tick(start);
  runtime.stop(start + POLICY.minViewMs + 100);

  assert.strictEqual(calls.length, 1, "스풀 1건에 트리거 1회");
  assert.deepStrictEqual(calls[0], { node, script, args: ["collect"] });

  // 포인터가 다른 스크립트를 가리키면 실행하지 않는다.
  const evil = path.join(data, "evil.js");
  fs.writeFileSync(evil, "// 실행돼서는 안 된다\n");
  fs.writeFileSync(path.join(data, "overlay-trigger.json"), JSON.stringify({ version: 1, node, script: evil, args: [] }));
  assert.strictEqual(readTriggerPointer(data), null);
});

test("트리거 포인터가 없어도 스풀은 남는다 — 지연일 뿐 유실이 아니다", () => {
  const data = makeData();
  const { runtime, calls } = runtimeWithRecorder(data);
  const start = Date.now();

  runtime.tick(start);
  runtime.stop(start + POLICY.minViewMs + 100);

  assert.strictEqual(calls.length, 0);
  assert.strictEqual(spoolContents(data).length, 1);
});

test("작업 활성 판정은 진행 중 세션과 유휴 임계 안의 종료 구간을 인정한다", () => {
  const running = makeData();
  assert.strictEqual(isWorkActive(running, Date.now(), POLICY.idleThresholdMs), true);

  const recent = makeData({ active: false });
  writeActive(recent, { active: false, endedAgoMs: 1000 });
  assert.strictEqual(isWorkActive(recent, Date.now(), POLICY.idleThresholdMs), true);

  const idle = makeData({ active: false });
  writeActive(idle, { active: false, endedAgoMs: POLICY.idleThresholdMs + 1 });
  assert.strictEqual(isWorkActive(idle, Date.now(), POLICY.idleThresholdMs), false);

  const missing = makeData({ active: false });
  assert.strictEqual(isWorkActive(missing, Date.now(), POLICY.idleThresholdMs), false, "work-state가 없으면 비활성");
});

test("광고 문구의 ANSI·제어문자를 지우고 길이를 제한한다", () => {
  const esc = String.fromCharCode(27);
  assert.strictEqual(safeText(`${esc}[1;33m위험${esc}[0m 광고`, 50), "위험 광고");
  assert.strictEqual(safeText(`a${String.fromCharCode(10)}b`, 50), "a b");
  assert.strictEqual(safeText("클라우드-네이티브 도구", 50), "클라우드-네이티브 도구");
  assert.strictEqual(safeText("가".repeat(200), 120).length, 120);
});

test("클릭 링크는 https만 통과시킨다", () => {
  assert.strictEqual(safeClickUrl("https://clawad.whatsup.house/survey.html"), "https://clawad.whatsup.house/survey.html");
  assert.strictEqual(safeClickUrl("http://example.com"), null, "http는 열지 않는다");
  assert.strictEqual(safeClickUrl("javascript:alert(1)"), null);
  assert.strictEqual(safeClickUrl("file:///C:/Windows/System32/cmd.exe"), null);
  assert.strictEqual(safeClickUrl(`https://a.com/${String.fromCharCode(10)}`), null, "제어문자가 섞이면 버린다");
  assert.strictEqual(safeClickUrl(`https://a.com/${"x".repeat(2100)}`), null, "너무 긴 URL은 버린다");
  assert.strictEqual(safeClickUrl(undefined), null);
});

test("표시 payload에 검증된 링크가 실려 온다 — 없으면 null", () => {
  const withLink = makeData({ bundles: [{ ...bundle("token.link"), clickUrl: "https://www.instagram.com/whatsup_house/" }] });
  assert.strictEqual(runtimeWithRecorder(withLink).runtime.tick(Date.now()).clickUrl, "https://www.instagram.com/whatsup_house/");

  const badLink = makeData({ bundles: [{ ...bundle("token.bad"), clickUrl: "http://insecure.example" }] });
  assert.strictEqual(runtimeWithRecorder(badLink).runtime.tick(Date.now()).clickUrl, null);

  const noLink = makeData({ bundles: [bundle("token.plain")] });
  assert.strictEqual(runtimeWithRecorder(noLink).runtime.tick(Date.now()).clickUrl, null);
});

test("BOM이 붙은 정책 캐시·번들도 읽는다", () => {
  const data = makeData();
  for (const name of ["overlay-policy.json", "bundles.json"]) {
    const file = path.join(data, name);
    fs.writeFileSync(file, `﻿${fs.readFileSync(file, "utf8")}`);
  }

  const { runtime } = runtimeWithRecorder(data);
  assert.ok(runtime.tick(Date.now()), "BOM 때문에 광고가 사라지면 안 된다");
});
