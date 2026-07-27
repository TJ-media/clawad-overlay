"use strict";
// 클로애드 광고 서피스 락 테스트 (CLAW-119).
// 협약: clawad `docs/design/overlay-contract.md` §3.1

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  CORRUPT_LOCK_STALE_MS,
  LOCK_FILE_NAME,
  acquireAdSurface,
  clawadDataDir,
  isAdSurfaceEnabled,
  lockFilePath,
  ownsAdSurface,
  releaseAdSurface,
} = require("../src/clawad-surface-lock");

function tempLock() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawad-surface-"));
  return path.join(dir, LOCK_FILE_NAME);
}

/** 확실히 죽은 pid — 프로세스를 하나 띄우고 끝난 뒤 그 pid를 쓴다. */
function deadPid() {
  const result = spawnSync(process.execPath, ["-e", "0"]);
  return result.pid;
}

/**
 * 확실히 살아 있는 다른 프로세스. pid를 추정하지 않고 실제로 하나 띄운다 —
 * 엉뚱한 pid를 쓰면 "락 미감지"를 정상 동작으로 오독하게 된다.
 */
function liveProcess() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  return {
    pid: child.pid,
    stop() {
      try { child.kill(); } catch { /* 이미 끝났으면 그대로 */ }
    },
  };
}

function writeLock(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}

test("락을 획득하면 pid·startedAt·owner를 기록하고 소유 상태가 된다", () => {
  const file = tempLock();
  const now = Date.now();

  assert.strictEqual(acquireAdSurface({ file, now }), true);

  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.strictEqual(lock.pid, process.pid);
  assert.strictEqual(lock.owner, "overlay");
  assert.strictEqual(lock.startedAt, new Date(now).toISOString());
  assert.strictEqual(ownsAdSurface(), true);

  releaseAdSurface({ file });
});

test("살아 있는 다른 소유자의 락은 가져오지 않고 파일을 보존한다", () => {
  const file = tempLock();
  const owner = liveProcess();
  try {
    writeLock(file, { pid: owner.pid, startedAt: new Date(Date.now() - 3 * CORRUPT_LOCK_STALE_MS).toISOString(), owner: "overlay" });

    assert.strictEqual(acquireAdSurface({ file }), false);

    // 나이가 아무리 많아도 pid가 살아 있으면 만료시키지 않는다 — 상주 오버레이는 락을 며칠 쥔다.
    assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).pid, owner.pid);
  } finally {
    owner.stop();
  }
});

test("죽은 소유자의 락은 인계한다", () => {
  const file = tempLock();
  writeLock(file, { pid: deadPid(), startedAt: new Date().toISOString(), owner: "overlay" });

  assert.strictEqual(acquireAdSurface({ file }), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).pid, process.pid);

  releaseAdSurface({ file });
});

test("pid를 읽을 수 없는 손상 락은 만료된 것만 인계한다", () => {
  const now = Date.now();
  const fresh = tempLock();
  writeLock(fresh, "{깨진 JSON");
  assert.strictEqual(acquireAdSurface({ file: fresh, now }), false, "최근에 쓰인 손상 락은 남의 것일 수 있다");

  const stale = tempLock();
  writeLock(stale, { startedAt: new Date(now - CORRUPT_LOCK_STALE_MS - 1000).toISOString(), owner: "overlay" });
  assert.strictEqual(acquireAdSurface({ file: stale, now }), true);

  releaseAdSurface({ file: stale });
});

test("BOM이 붙은 락도 소유자를 정확히 읽는다", () => {
  const file = tempLock();
  const owner = liveProcess();
  writeLock(file, `\uFEFF${JSON.stringify({ pid: owner.pid, startedAt: new Date().toISOString(), owner: "overlay" })}`);

  assert.strictEqual(acquireAdSurface({ file }), false, "BOM 때문에 살아 있는 소유자를 놓치면 이중 표시가 된다");
  owner.stop();
});

test("같은 프로세스가 다시 획득하면 그대로 소유한다", () => {
  const file = tempLock();
  assert.strictEqual(acquireAdSurface({ file }), true);
  assert.strictEqual(acquireAdSurface({ file }), true);
  assert.strictEqual(ownsAdSurface(), true);

  releaseAdSurface({ file });
});

test("반환하면 락 파일이 사라지고 소유 상태가 풀린다", () => {
  const file = tempLock();
  acquireAdSurface({ file });

  assert.strictEqual(releaseAdSurface({ file }), true);
  assert.strictEqual(fs.existsSync(file), false);
  assert.strictEqual(ownsAdSurface(), false);
});

test("남이 쥔 락은 반환하지 않는다", () => {
  const file = tempLock();
  const owner = liveProcess();
  writeLock(file, { pid: owner.pid, startedAt: new Date().toISOString(), owner: "overlay" });

  assert.strictEqual(releaseAdSurface({ file }), false);
  assert.strictEqual(fs.existsSync(file), true, "다른 소유자의 락을 지우면 이중 표시가 된다");
  owner.stop();
});

test("락 파일 위치는 CLAWAD_DATA를 우선하고 없으면 홈의 .clawad를 쓴다", () => {
  assert.strictEqual(clawadDataDir({ CLAWAD_DATA: "D:\\clawad-data" }), "D:\\clawad-data");
  assert.strictEqual(clawadDataDir({ CLAWAD_DATA: "   " }), path.join(os.homedir(), ".clawad"));
  assert.strictEqual(clawadDataDir({}), path.join(os.homedir(), ".clawad"));
  assert.strictEqual(lockFilePath("/tmp/x"), path.join("/tmp/x", LOCK_FILE_NAME));
});

test("광고 서피스는 옵트인일 때만 활성된다 — 렌더러 없이 락을 쥐면 광고가 사라진다", () => {
  assert.strictEqual(isAdSurfaceEnabled({}), false);
  assert.strictEqual(isAdSurfaceEnabled({ CLAWAD_AD_SURFACE: "0" }), false);
  assert.strictEqual(isAdSurfaceEnabled({ CLAWAD_AD_SURFACE: "1" }), true);
});
