"use strict";

// ── userData 디렉터리 이름 이전 (CLAW-155) ──
//
// Electron의 app.getName()은 package.json의 최상위 productName을 먼저 보고, 없으면 name을
// 쓴다. 이 앱은 오래도록 productName 없이 name("clawd-on-desk")만 두었고 — build.productName은
// electron-builder가 번들 이름·Info.plist에만 반영한다 — 그래서 app.getPath("userData")가
// 포크 원본 이름으로 만들어졌다:
//   macOS   ~/Library/Application Support/clawd-on-desk/
//   Windows %APPDATA%\clawd-on-desk\
// 사용자에게 보이는 경로에 포크 원본 이름이 남는다.
//
// 최상위 productName을 넣으면 경로가 제품 이름으로 바뀌는데, 그대로 배포하면 기존 설치본의
// 설정이 고아가 된다. 이 모듈이 그 이전을 맡는다. 파일 몇 개가 아니라 **디렉터리 전체**를
// 옮기는 이유는 이 디렉터리에 설정(clawd-prefs.json)뿐 아니라 사용자가 설치한
// 테마({userData}/themes)·사운드 오버라이드·업데이터 식별자(.updaterId)가 같이 살기
// 때문이다. 이름만 바꿔 배포하면 테스터가 그걸 전부 다시 잡아야 한다.
//
// **main.js에서 app.getPath("userData")를 처음 읽기 전에 호출해야 한다.** 한 번 읽고 나면
// 그 경로로 파일이 만들어지기 시작해 이전 대상이 두 곳으로 갈린다.

const path = require("path");
const fs = require("fs");

const LEGACY_DIR_NAME = "clawd-on-desk";

// 순수 판정 — 파일 시스템 접근은 주입받은 exists/isEmptyDir로만 한다 (linux-ozone.js와 같은 방식).
// 반환값이 null이면 "옮길 것이 없다"이며, 그것이 정상 경로다(신규 설치·이전 완료 모두 null).
function planUserDataMigration({ appDataDir, currentDirName, exists, isEmptyDir }) {
  if (!appDataDir || !currentDirName) return null;
  // productName을 다시 떼어내 이름이 원래대로 돌아온 경우 — 자기 자신으로 옮기지 않는다.
  if (currentDirName === LEGACY_DIR_NAME) return null;

  const from = path.join(appDataDir, LEGACY_DIR_NAME);
  const to = path.join(appDataDir, currentDirName);

  if (!exists(from)) return null; // 신규 설치 — 남은 것이 없다
  if (!exists(to)) return { from, to, removeEmptyTarget: false };

  // Electron이 실행 초기에 새 이름의 디렉터리를 **비어 있는 채로** 먼저 만들어 두는 경우가
  // 있다. 그것을 "이미 이전됨"으로 오인하면 설정을 영영 못 옮긴다. 비어 있으면 치우고 옮기되,
  // 내용이 있으면 실제로 쓰이는 디렉터리이므로 건드리지 않는다.
  if (isEmptyDir(to)) return { from, to, removeEmptyTarget: true };
  return null;
}

// 계획을 실제로 수행한다. 실패해도 예외를 던지지 않는다 — 이전 실패로 앱이 못 뜨면
// 설정이 고아가 되는 것보다 나쁘다. 실패 시 구 디렉터리는 그대로 남으므로 수동 복구가 가능하다.
function migrateUserDataDir({ appDataDir, currentDirName, fsImpl = fs, log = console.error } = {}) {
  let plan = null;
  try {
    plan = planUserDataMigration({
      appDataDir,
      currentDirName,
      exists: (target) => fsImpl.existsSync(target),
      isEmptyDir: (target) => {
        try {
          return fsImpl.readdirSync(target).length === 0;
        } catch {
          return false; // 읽을 수 없으면 비었다고 단정하지 않는다
        }
      },
    });
  } catch (err) {
    log(`Clawd: userData 이전 판정 실패 (CLAW-155) — ${err && err.message ? err.message : err}`);
    return null;
  }
  if (!plan) return null;

  try {
    if (plan.removeEmptyTarget) fsImpl.rmdirSync(plan.to); // 비어 있지 않으면 여기서 던진다
    fsImpl.renameSync(plan.from, plan.to);
    return plan;
  } catch (err) {
    log(`Clawd: userData 이전 실패 (CLAW-155) — ${err && err.message ? err.message : err}`);
    return null;
  }
}

module.exports = {
  LEGACY_DIR_NAME,
  planUserDataMigration,
  migrateUserDataDir,
};
