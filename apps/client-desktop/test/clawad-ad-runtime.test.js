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
  readAdInventoryExhausted,
  readPolicyCache,
  readRewardSummary,
  readTriggerPointer,
  safeClickUrl,
  safeText,
} = require("../src/clawad-ad-runtime");

const POLICY = { adRotateMs: 15000, adGapMs: 3000, idleThresholdMs: 60000, maxWidthPx: 360, minViewMs: 5000, staleActiveMs: 3600000 };

function makeData(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawad-ad-"));
  if (overrides.policy !== null) {
    fs.writeFileSync(path.join(dir, "overlay-policy.json"), JSON.stringify(overrides.policy || {
      version: 1,
      overlay: { adRotateMs: POLICY.adRotateMs, adGapMs: POLICY.adGapMs, idleThresholdMs: POLICY.idleThresholdMs, maxWidthPx: POLICY.maxWidthPx },
      impression: { minViewMs: POLICY.minViewMs },
      activity: { staleActiveMs: POLICY.staleActiveMs },
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

// adGapMs는 선택 항목이다. 오버레이는 자동 업데이트되고 CLI는 수동 업데이트라
// 새 오버레이 + 구 CLI 조합이 실제로 생긴다. 그때 광고를 끄면 적립이 영구히 0이 된다 (CLAW-135).
test("adGapMs가 없는 구 CLI 캐시에서도 광고는 계속 표시한다 (CLAW-135)", () => {
  const data = makeData({
    policy: {
      version: 1,
      overlay: { adRotateMs: POLICY.adRotateMs, idleThresholdMs: POLICY.idleThresholdMs, maxWidthPx: POLICY.maxWidthPx },
      impression: { minViewMs: POLICY.minViewMs },
      updatedAt: Date.now(),
    },
  });
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  assert.strictEqual(runtime.tick(start).text, "광고 token.a", "구 CLI라고 광고를 끄면 안 된다");
  runtime.tick(start + POLICY.adRotateMs);
  runtime.tick(start + POLICY.adRotateMs * 2);

  // 간격 없이(= 계약 이전 판 그대로) 동작한다. CLI가 올라오면 그때부터 간격이 생긴다.
  const spooled = spoolContents(data).sort((a, b) => a.displayStartedAt - b.displayStartedAt);
  assert.strictEqual(spooled.length, 2);
  assert.strictEqual(spooled[1].displayStartedAt - spooled[0].displayEndedAt, 0);
});

test("adGapMs 값이 들어 있는데 형식이 틀리면 손상된 캐시로 본다 (CLAW-135)", () => {
  for (const adGapMs of [0, -1, 1.5, "3000"]) {
    const data = makeData({
      policy: {
        version: 1,
        overlay: { adRotateMs: POLICY.adRotateMs, adGapMs, idleThresholdMs: POLICY.idleThresholdMs, maxWidthPx: POLICY.maxWidthPx },
        impression: { minViewMs: POLICY.minViewMs },
        updatedAt: Date.now(),
      },
    });
    const { runtime } = runtimeWithRecorder(data);
    assert.strictEqual(runtime.tick(Date.now()), null, `adGapMs=${JSON.stringify(adGapMs)}는 거절해야 한다`);
  }
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
  const S = POLICY.staleActiveMs;
  const running = makeData();
  assert.strictEqual(isWorkActive(running, Date.now(), POLICY.idleThresholdMs, S), true);

  const recent = makeData({ active: false });
  writeActive(recent, { active: false, endedAgoMs: 1000 });
  assert.strictEqual(isWorkActive(recent, Date.now(), POLICY.idleThresholdMs, S), true);

  const idle = makeData({ active: false });
  writeActive(idle, { active: false, endedAgoMs: POLICY.idleThresholdMs + 1 });
  assert.strictEqual(isWorkActive(idle, Date.now(), POLICY.idleThresholdMs, S), false);

  const missing = makeData({ active: false });
  assert.strictEqual(isWorkActive(missing, Date.now(), POLICY.idleThresholdMs, S), false, "work-state가 없으면 비활성");
});

/** 훅이 Stop을 못 보내 active=true로 굳은 세션. 터미널 강제 종료 등으로 실제로 생긴다. */
function writeZombie(dataDir, startedAgoMs) {
  const dir = path.join(dataDir, "work-state");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "b".repeat(32) + ".json"), JSON.stringify({
    version: 1, active: true, startedAt: Date.now() - startedAgoMs, intervals: [], updatedAt: Date.now() - startedAgoMs,
  }));
}

// 좀비 세션 하나 때문에 "영원히 작업 중"이 되면, 작업하지 않는 동안에도 광고를 돌려
// 재고를 소진하고 결국 광고가 멈춘다 (CLAW-142).
test("staleActiveMs를 넘긴 좀비 active 세션은 작업 중으로 보지 않는다 (CLAW-142)", () => {
  const S = POLICY.staleActiveMs;
  const zombie = makeData({ active: false });
  writeZombie(zombie, S + 60000);
  assert.strictEqual(isWorkActive(zombie, Date.now(), POLICY.idleThresholdMs, S), false);

  // 임계 안이면 여전히 작업 중이다 — 긴 턴을 끊어버리면 안 된다.
  const longTurn = makeData({ active: false });
  writeZombie(longTurn, S - 60000);
  assert.strictEqual(isWorkActive(longTurn, Date.now(), POLICY.idleThresholdMs, S), true);

  // 수거(loadActivity)와 같은 규칙: 넘긴 구간은 startedAt + staleActiveMs에 끝난 것으로 본다.
  // 그 종료 시각이 유휴 임계 안이면 아직 작업 중으로 인정한다.
  const justPast = makeData({ active: false });
  writeZombie(justPast, S + Math.floor(POLICY.idleThresholdMs / 2));
  assert.strictEqual(isWorkActive(justPast, Date.now(), POLICY.idleThresholdMs, S), true);
});

test("staleActiveMs가 0이면(구 CLI 캐시) 기존 판정을 유지한다 (CLAW-142)", () => {
  const zombie = makeData({ active: false });
  writeZombie(zombie, POLICY.staleActiveMs * 100);
  assert.strictEqual(isWorkActive(zombie, Date.now(), POLICY.idleThresholdMs, 0), true,
    "값이 없다고 광고를 꺼버리면 구 CLI 사용자는 적립이 영구히 0이 된다");
});

test("정책 캐시에 activity가 없으면 staleActiveMs 0으로 동작한다 (CLAW-142)", () => {
  const data = makeData({
    policy: {
      version: 1,
      overlay: { adRotateMs: POLICY.adRotateMs, adGapMs: POLICY.adGapMs, idleThresholdMs: POLICY.idleThresholdMs, maxWidthPx: POLICY.maxWidthPx },
      impression: { minViewMs: POLICY.minViewMs },
      updatedAt: Date.now(),
    },
  });
  assert.strictEqual(readPolicyCache(data).staleActiveMs, 0);
  const { runtime } = runtimeWithRecorder(data);
  assert.ok(runtime.tick(Date.now()), "구 CLI 캐시에서도 광고는 계속 표시한다");
});

test("staleActiveMs 값이 들어 있는데 형식이 틀리면 손상된 캐시로 본다 (CLAW-142)", () => {
  for (const staleActiveMs of [-1, 1.5, "3600000"]) {
    const data = makeData({
      policy: {
        version: 1,
        overlay: { adRotateMs: POLICY.adRotateMs, adGapMs: POLICY.adGapMs, idleThresholdMs: POLICY.idleThresholdMs, maxWidthPx: POLICY.maxWidthPx },
        impression: { minViewMs: POLICY.minViewMs },
        activity: { staleActiveMs },
        updatedAt: Date.now(),
      },
    });
    assert.strictEqual(readPolicyCache(data), null, `staleActiveMs=${JSON.stringify(staleActiveMs)}는 거절해야 한다`);
  }
});

// 인정되지 않은 표시가 토큰을 영구 소모하면, clawad는 캐시에서 지우지 않고 서버도 "미사용"으로
// 세기 때문에 재고가 교착돼 광고가 완전히 멈춘다 (CLAW-142).
test("인정되지 않은 표시는 토큰을 영구 소모하지 않는다 (CLAW-142)", () => {
  const data = makeData({ bundles: [bundle("token.only")] });
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  // 최소 시청 시간에 못 미치게 표시하고 끝낸다 → 스풀 없음.
  runtime.tick(start);
  runtime.stop(start + 1000);
  assert.strictEqual(spoolContents(data).length, 0);

  // 하나뿐인 토큰이 소모 처리됐다면 여기서 null이 나온다.
  assert.ok(runtime.tick(start + 2000), "인정 안 된 토큰은 다시 표시할 수 있어야 한다");
});

test("인정된 토큰은 다시 표시하지 않는다 (CLAW-142)", () => {
  const data = makeData({ bundles: [bundle("token.only")] });
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  runtime.tick(start);
  runtime.stop(start + POLICY.adRotateMs);
  assert.strictEqual(spoolContents(data).length, 1, "인정 요청까지 갔다");

  assert.strictEqual(runtime.tick(start + POLICY.adRotateMs + 1), null, "단일 사용 토큰을 재사용하면 안 된다");
});

test("계속 미달로 끝나는 토큰은 재표시 상한에서 멈춘다 (CLAW-142)", () => {
  const data = makeData({ bundles: [bundle("token.only")] });
  const { runtime } = runtimeWithRecorder(data);
  let now = Date.now();

  let shows = 0;
  for (let i = 0; i < 10; i += 1) {
    if (!runtime.tick(now)) break;
    shows += 1;
    now += 1000;
    runtime.stop(now); // 매번 minViewMs 미달로 끝난다
    now += 1000;
  }
  assert.strictEqual(spoolContents(data).length, 0);
  assert.ok(shows > 1, '한 번 실패했다고 즉시 포기하면 안 된다');
  assert.ok(shows <= 3, `무한 재시도하면 안 된다 (실제 ${shows}회)`);
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

test("리워드샵 URL은 정책 캐시의 https 선택 필드만 노출한다 (CLAW-166)", () => {
  const basePolicy = {
    version: 1,
    overlay: { adRotateMs: POLICY.adRotateMs, adGapMs: POLICY.adGapMs, idleThresholdMs: POLICY.idleThresholdMs, maxWidthPx: POLICY.maxWidthPx },
    impression: { minViewMs: POLICY.minViewMs },
    activity: { staleActiveMs: POLICY.staleActiveMs },
  };
  const valid = runtimeWithRecorder(makeData({
    policy: { ...basePolicy, rewardShopUrl: "https://clawad.whatsup.house/" },
  })).runtime;
  assert.strictEqual(valid.rewardShopUrl && valid.rewardShopUrl(), "https://clawad.whatsup.house/");

  const insecure = runtimeWithRecorder(makeData({
    policy: { ...basePolicy, rewardShopUrl: "http://clawad.whatsup.house/" },
  })).runtime;
  assert.strictEqual(insecure.rewardShopUrl && insecure.rewardShopUrl(), null, "http 링크는 메뉴에 내보내지 않는다");
  assert.ok(insecure.canRender(), "잘못된 선택 필드 때문에 광고 기능까지 꺼지면 안 된다");

  const legacy = runtimeWithRecorder(makeData({ policy: basePolicy })).runtime;
  assert.strictEqual(legacy.rewardShopUrl && legacy.rewardShopUrl(), null, "구 CLI에는 메뉴를 숨긴다");
  assert.ok(legacy.canRender(), "선택 필드가 없는 구 CLI에서도 광고는 유지한다");
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

// --- 적립 현황 2행 표시 (CLAW-138) ---

function writeReward(dataDir, summary) {
  fs.writeFileSync(path.join(dataDir, "reward-summary.json"), JSON.stringify(summary));
  return dataDir;
}

test("적립 현황은 서버가 내려준 정수를 그대로 payload에 싣는다", () => {
  const data = writeReward(makeData(), { version: 1, verifyingPoints: 12, confirmedPoints: 407, fetchedAt: Date.now() });

  const ad = runtimeWithRecorder(data).runtime.tick(Date.now());

  assert.deepStrictEqual(ad.reward, { verifying: 12, confirmed: 407 });
});

test("캐리까지 담은 적립 총액을 payload에 함께 싣는다 (CLAW-157)", () => {
  const data = writeReward(makeData(), {
    version: 1, verifyingPoints: 0, confirmedPoints: 33, accruedPointsTenths: 336, fetchedAt: Date.now(),
  });

  const ad = runtimeWithRecorder(data).runtime.tick(Date.now());

  assert.deepStrictEqual(ad.reward, { verifying: 0, confirmed: 33, accruedTenths: 336 });
});

test("적립 총액이 없거나 형식이 틀리면 싣지 않는다 — 구 CLI 호환 (CLAW-157)", () => {
  for (const bad of [undefined, -1, 33.6, "336", null]) {
    const summary = { version: 1, verifyingPoints: 0, confirmedPoints: 33, fetchedAt: Date.now() };
    if (bad !== undefined) summary.accruedPointsTenths = bad;
    const data = writeReward(makeData(), summary);

    const ad = runtimeWithRecorder(data).runtime.tick(Date.now());

    assert.deepStrictEqual(ad.reward, { verifying: 0, confirmed: 33 }, `거절해야 한다: ${JSON.stringify(bad)}`);
  }
});

test("적립이 0이어도 표시한다 — 갓 시작한 사용자에게만 2행이 사라지면 안 된다", () => {
  const data = writeReward(makeData(), { version: 1, verifyingPoints: 0, confirmedPoints: 0, fetchedAt: Date.now() });

  assert.deepStrictEqual(runtimeWithRecorder(data).runtime.tick(Date.now()).reward, { verifying: 0, confirmed: 0 });
});

test("적립 파일이 없거나 깨져 있어도 광고는 계속 뜬다 — 적립 표시만 빠진다", () => {
  const cases = [
    ["파일 없음", null],
    ["버전 불일치", { version: 2, verifyingPoints: 1, confirmedPoints: 1 }],
    ["음수", { version: 1, verifyingPoints: -1, confirmedPoints: 10 }],
    ["정수 아님", { version: 1, verifyingPoints: 1.5, confirmedPoints: 10 }],
    ["문자열", { version: 1, verifyingPoints: "12", confirmedPoints: 10 }],
    ["필드 없음", { version: 1, fetchedAt: Date.now() }],
  ];
  for (const [label, summary] of cases) {
    const data = makeData();
    if (summary) writeReward(data, summary);

    const ad = runtimeWithRecorder(data).runtime.tick(Date.now());

    assert.ok(ad, `${label}: 광고 자체는 계속 표시해야 한다`);
    assert.strictEqual(ad.reward, null, `${label}: 적립은 표시하지 않는다`);
  }
});

test("적립 현황은 매 tick 다시 읽는다 — 같은 광고를 보여주는 동안 sync가 갱신하면 반영된다", () => {
  const data = writeReward(makeData(), { version: 1, verifyingPoints: 0, confirmedPoints: 407 });
  const { runtime } = runtimeWithRecorder(data);
  const start = Date.now();

  assert.strictEqual(runtime.tick(start).reward.confirmed, 407);
  writeReward(data, { version: 1, verifyingPoints: 0, confirmedPoints: 500 });

  // 회전 주기 안이라 같은 소재를 유지하는 경로에서도 갱신돼야 한다
  const ad = runtime.tick(start + 1000);
  assert.strictEqual(ad.text, "광고 token.a", "같은 소재를 유지하는 구간이어야 한다");
  assert.strictEqual(ad.reward.confirmed, 500);
});

test("BOM이 붙은 적립 요약도 읽는다", () => {
  const data = writeReward(makeData(), { version: 1, verifyingPoints: 3, confirmedPoints: 9 });
  const file = path.join(data, "reward-summary.json");
  fs.writeFileSync(file, `﻿${fs.readFileSync(file, "utf8")}`);

  assert.deepStrictEqual(readRewardSummary(data), { verifying: 3, confirmed: 9 });
});

test("displayContext는 광고 재고가 없어도 작업 중이면 맥락을 돌려준다 — 안내 문구용", () => {
  const idle = { maxWidthPx: POLICY.maxWidthPx, exhausted: false, reward: null };
  const withAds = makeData();
  assert.deepStrictEqual(runtimeWithRecorder(withAds).runtime.displayContext(Date.now()), idle);

  // 번들이 비어도 맥락은 남는다. canRender와 갈리는 지점이 여기다.
  const noAds = makeData({ bundles: [] });
  const runtime = runtimeWithRecorder(noAds).runtime;
  assert.strictEqual(runtime.canRender(Date.now()), false, "표시할 광고는 없다");
  assert.deepStrictEqual(runtime.displayContext(Date.now()), idle, "안내 문구는 띄울 수 있어야 한다");
});

test("displayContext는 정책이 없을 때만 null이고 유휴 상태에서도 안내 맥락을 돌려준다 (CLAW-163)", () => {
  assert.strictEqual(runtimeWithRecorder(makeData({ policy: null })).runtime.displayContext(Date.now()), null,
    "정책이 없으면 안내도 띄우지 않는다");

  const idle = makeData({ active: false });
  writeActive(idle, { active: false, endedAgoMs: POLICY.idleThresholdMs + 60000 });
  assert.deepStrictEqual(runtimeWithRecorder(idle).runtime.displayContext(Date.now()), {
    maxWidthPx: POLICY.maxWidthPx,
    exhausted: false,
    reward: null,
  }, "광고와 달리 안내는 작업 중 여부와 무관하게 보여줄 수 있어야 한다");
});

// --- 광고 소진 신호 (CLAW-138 후속) ---

function writeInventory(dataDir, inventory) {
  fs.writeFileSync(path.join(dataDir, "ad-inventory.json"), JSON.stringify(inventory));
  return dataDir;
}

test("소진 신호가 없으면 소진이 아니다 — 구 CLI 조합에서 없는 상태를 만들지 않는다", () => {
  assert.strictEqual(readAdInventoryExhausted(makeData()), false, "파일 없음");

  const cases = [
    ["버전 불일치", { version: 2, exhausted: true }],
    ["문자열", { version: 1, exhausted: "true" }],
    ["1", { version: 1, exhausted: 1 }],
    ["필드 없음", { version: 1 }],
  ];
  for (const [label, inventory] of cases) {
    assert.strictEqual(readAdInventoryExhausted(writeInventory(makeData(), inventory)), false, label);
  }
});

test("exhausted가 정확히 true일 때만 소진으로 본다", () => {
  assert.strictEqual(readAdInventoryExhausted(writeInventory(makeData(), { version: 1, exhausted: true })), true);
  assert.strictEqual(readAdInventoryExhausted(writeInventory(makeData(), { version: 1, exhausted: false })), false);
});

test("displayContext는 소진 여부와 적립 현황을 함께 실어 준다 — 안내 2행 구성용", () => {
  const data = makeData({ bundles: [] });
  writeInventory(data, { version: 1, exhausted: true });
  fs.writeFileSync(path.join(data, "reward-summary.json"),
    JSON.stringify({ version: 1, verifyingPoints: 150, confirmedPoints: 2000 }));

  assert.deepStrictEqual(runtimeWithRecorder(data).runtime.displayContext(Date.now()), {
    maxWidthPx: POLICY.maxWidthPx,
    exhausted: true,
    reward: { verifying: 150, confirmed: 2000 },
  });
});

test("소진 신호는 광고 표시를 막지 않는다 — 재고가 남아 있으면 그대로 보여준다", () => {
  // 신호와 재고가 어긋난 순간(소진 직전 받아둔 번들)에 화면을 비우지 않는다.
  const data = writeInventory(makeData(), { version: 1, exhausted: true });

  assert.ok(runtimeWithRecorder(data).runtime.tick(Date.now()), "번들이 있으면 광고가 우선이다");
});
