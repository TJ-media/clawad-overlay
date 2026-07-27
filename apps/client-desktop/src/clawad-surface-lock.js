"use strict";
// 클로애드 광고 서피스 락 (CLAW-119).
//
// 광고는 한 번에 한 서피스에서만 표시한다. 오버레이가 광고 서피스를 맡는 동안 이 락을 쥐고,
// clawad의 statusline은 락을 읽어(읽기 전용) 광고를 렌더하지 않는다 — 이중 표시·이중 계상 방지.
//
// 락 파일 포맷과 만료 판정 규칙은 clawad 저장소의 `docs/design/overlay-contract.md` §3.1이
// 정의한다. 여기서는 **문서화된 협약만 독립 구현**한다 — clawad 코드를 가져오지 않는다
// (docs/BOUNDARY.md §1). 두 프로그램은 이 파일 협약으로만 만난다.
//
// 판정 규칙 두 가지를 반드시 지킨다:
//   1. pid를 읽을 수 있으면 **생존 여부만** 본다. 상주 오버레이는 락을 며칠 쥐고 있으므로
//      경과 시간으로 만료시키면 소유자가 광고를 띄우는 동안 다른 서피스가 이어받는다.
//   2. pid를 읽을 수 없는 손상 락만 나이로 만료시킨다.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LOCK_FILE_NAME = "surface.lock";
/** 진단용 문자열. 판정에는 쓰지 않는다 (협약 §3.1). */
const LOCK_OWNER = "overlay";
/** pid를 읽을 수 없는 락에만 적용하는 만료 시간. 협약이 정한 15분. */
const CORRUPT_LOCK_STALE_MS = 15 * 60 * 1000;

/** 우리가 쥔 락 파일 경로. 쥐고 있지 않으면 null. */
let heldLockFile = null;

/**
 * clawad의 로컬 데이터 디렉터리.
 * 배포 설치본은 홈 디렉터리의 `.clawad`를 쓴다. 개발 체크아웃처럼 위치가 다르면
 * `CLAWAD_DATA`로 지정한다 — 오버레이는 clawad 설치 경로를 추측하지 않는다.
 */
function clawadDataDir(env = process.env) {
  const override = env.CLAWAD_DATA;
  if (typeof override === "string" && override.trim()) return override;
  return path.join(os.homedir(), ".clawad");
}

function lockFilePath(dataDir) {
  return path.join(dataDir || clawadDataDir(), LOCK_FILE_NAME);
}

/**
 * 광고 서피스를 오버레이가 맡을 준비가 됐는가.
 * 락을 쥐면 statusline이 광고를 멈추므로, **렌더러가 없는 동안 락을 쥐면 광고가 아예 사라진다.**
 * 그래서 광고 렌더(CLAW-90)가 들어오기 전까지는 옵트인으로만 활성한다. QA·개발은
 * `CLAWAD_AD_SURFACE=1`로 켠다. CLAW-90에서 렌더러가 붙으면 그 조건으로 교체한다.
 */
function isAdSurfaceEnabled(env = process.env) {
  return env.CLAWAD_AD_SURFACE === "1";
}

function readLockFile(file) {
  try {
    // 다른 도구가 BOM을 붙여 쓸 수 있다. 파싱 전에 제거한다.
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = 살아 있지만 우리 권한으로는 신호를 못 보내는 프로세스.
    return Boolean(err && err.code === "EPERM");
  }
}

/** 손상 락(pid 없음·읽기 실패)이 만료됐는가. startedAt이 없으면 파일 mtime을 쓴다. */
function corruptLockExpired(file, lock, now) {
  const startedAt = Date.parse(lock && lock.startedAt);
  let base = startedAt;
  if (!Number.isFinite(base)) {
    try {
      base = fs.statSync(file).mtimeMs;
    } catch {
      base = now;
    }
  }
  return now - base > CORRUPT_LOCK_STALE_MS;
}

/**
 * 광고 서피스 락을 획득한다. 배타 생성(`wx`)이라 경쟁에서 한 쪽만 이긴다.
 * 이미 있으면 소유자 생존을 확인하고, 죽은 락만 지우고 한 번 재시도한다.
 * 실패는 예외가 아니다 — 락이 없으면 광고만 statusline이 계속 담당하고 펫은 정상 동작한다.
 */
function acquireAdSurface(options = {}) {
  const file = options.file || lockFilePath(options.dataDir);
  const now = Number.isFinite(options.now) ? options.now : Date.now();

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    return false;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({
          pid: process.pid,
          startedAt: new Date(now).toISOString(),
          owner: LOCK_OWNER,
        }));
      } finally {
        fs.closeSync(fd);
      }
      heldLockFile = file;
      return true;
    } catch (err) {
      // 권한·경로 문제는 재시도해도 같다. 광고 없이 계속 뜬다.
      if (!err || err.code !== "EEXIST") return false;
      const existing = readLockFile(file);
      const pid = existing && Number.isInteger(existing.pid) ? existing.pid : null;
      if (pid !== null && pid > 0) {
        // 재기동 전에 우리가 쓴 락이 남았거나 같은 프로세스가 다시 호출한 경우 — 그대로 소유한다.
        if (pid === process.pid) {
          heldLockFile = file;
          return true;
        }
        if (isProcessAlive(pid)) return false;
      } else if (!corruptLockExpired(file, existing, now)) {
        return false;
      }
      try {
        fs.unlinkSync(file);
      } catch {
        return false;
      }
    }
  }
  return false;
}

/**
 * 락을 반환한다. 정상 종료와 광고 일시중지 전환에서 **반드시** 호출해야
 * statusline이 광고를 이어받는다. 남이 쥔 락은 지우지 않는다.
 */
function releaseAdSurface(options = {}) {
  const file = options.file || heldLockFile || lockFilePath(options.dataDir);
  const existing = readLockFile(file);
  if (existing && Number.isInteger(existing.pid) && existing.pid !== process.pid) return false;
  try {
    fs.unlinkSync(file);
  } catch {
    // 이미 없으면 반환된 것과 같다.
  }
  if (heldLockFile === file) heldLockFile = null;
  return true;
}

/**
 * 지금 이 프로세스가 광고 서피스를 소유하는가.
 * 광고 렌더와 노출 이벤트 방출(CLAW-90)은 이 값이 true일 때만 해야 한다.
 */
function ownsAdSurface() {
  return heldLockFile !== null;
}

module.exports = {
  CORRUPT_LOCK_STALE_MS,
  LOCK_FILE_NAME,
  LOCK_OWNER,
  acquireAdSurface,
  clawadDataDir,
  isAdSurfaceEnabled,
  lockFilePath,
  ownsAdSurface,
  releaseAdSurface,
};
