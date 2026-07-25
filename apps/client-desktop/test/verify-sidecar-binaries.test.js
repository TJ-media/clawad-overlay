"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  VERIFY_COMMAND,
  normalizeLifecycleEvent,
  sidecarBinaryPath,
  getRequiredSidecarsForLifecycle,
  verifySidecarBinaries,
} = require("../scripts/verify-sidecar-binaries");

function fakeFs(existingFiles) {
  const existing = new Set(existingFiles);
  return {
    existsSync(filePath) {
      return existing.has(filePath);
    },
    statSync(filePath) {
      if (!existing.has(filePath)) throw new Error("missing");
      return { isFile: () => true };
    },
  };
}

test("normalizeLifecycleEvent maps npm prebuild hooks to build scripts", () => {
  assert.equal(normalizeLifecycleEvent("prebuild:win:x64"), "build:win:x64");
  assert.equal(normalizeLifecycleEvent("build:linux"), "build:linux");
});

test("getRequiredSidecarsForLifecycle maps configured build targets", () => {
  assert.deepEqual(getRequiredSidecarsForLifecycle("prebuild:win:x64"), [
    { platform: "windows", arch: "x64" },
  ]);
  assert.deepEqual(getRequiredSidecarsForLifecycle("prebuild:mac"), [
    { platform: "darwin", arch: "x64" },
    { platform: "darwin", arch: "arm64" },
  ]);
});

test("sidecarBinaryPath uses resolver-compatible binary names", () => {
  assert.equal(
    sidecarBinaryPath("D:\\repo", "windows", "arm64"),
    path.join("D:\\repo", "bin", "cc-connect-clawd", "windows-arm64", "cc-connect-clawd.exe")
  );
  assert.equal(
    sidecarBinaryPath("/repo", "linux", "x64"),
    path.join("/repo", "bin", "cc-connect-clawd", "linux-x64", "cc-connect-clawd")
  );
});

test("verifySidecarBinaries reports missing binaries for the active build", () => {
  const rootDir = "D:\\repo";
  const result = verifySidecarBinaries({
    rootDir,
    lifecycleEvent: "prebuild:win:arm64",
    fs: fakeFs([]),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [
    {
      platform: "windows",
      arch: "arm64",
      path: path.join(rootDir, "bin", "cc-connect-clawd", "windows-arm64", "cc-connect-clawd.exe"),
    },
  ]);
});

test("verifySidecarBinaries passes when all required files exist", () => {
  const rootDir = "D:\\repo";
  const filePath = sidecarBinaryPath(rootDir, "windows", "x64");
  const result = verifySidecarBinaries({
    rootDir,
    lifecycleEvent: "prebuild:win:x64",
    fs: fakeFs([filePath]),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

// CLAW-89에서 사이드카 의존을 제거했다. 사이드카는 텔레그램 원격 승인 전용이고
// 그 기능은 기본 비활성인데, prebuild 훅이 빌드마다 외부 GitHub 릴리스에서
// 서명 없는 실행 바이너리를 내려받도록 강제하고 있었다 (FORK.md §4).
//
// 원래 이 테스트는 prebuild 훅이 존재할 것을 단정했다. 방향을 뒤집어
// 훅이 다시 들어오지 않는지 지킨다 — 되돌아오면 빌드가 조용히 외부 바이너리
// 다운로드에 의존하게 되므로 회귀를 잡아야 한다.
test("build scripts must not reintroduce the sidecar prebuild hooks", () => {
  const pkg = require("../package.json");

  // 수동 실행용 별칭은 남겨둔다 (스크립트 자체는 보존).
  assert.equal(pkg.scripts["verify:sidecars"], VERIFY_COMMAND);

  for (const name of [
    "prebuild",
    "prebuild:win:x64",
    "prebuild:win:arm64",
    "prebuild:win:all",
    "prebuild:mac",
    "prebuild:linux",
    "prebuild:all",
  ]) {
    assert.equal(
      pkg.scripts[name],
      undefined,
      `${name} must stay unset — packaging must not require sidecar binaries`
    );
  }

  // npm start 도 사이드카 프리페치를 거치지 않아야 한다.
  assert.doesNotMatch(
    pkg.scripts.start,
    /sidecar/i,
    "npm start must not preflight sidecar binaries"
  );
});
