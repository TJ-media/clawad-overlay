"use strict";

// CLAW-92: 릴리스 매니페스트가 clawad CLI의 통합 설치 규약과 맞는지 확인한다.
// 여기서 깨지면 사용자가 setup을 돌렸을 때 오버레이만 설치되지 않는다.

const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "build-overlay-manifest.js");
const VERSION = require("../package.json").version;
const PRODUCT = require("../package.json").build.productName;

function withDist(files) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-manifest-test-"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dist, name), body);
  }
  return dist;
}

function run(dist, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, CLAWAD_OVERLAY_DIST: dist },
    encoding: "utf8",
  });
}

function readManifest(dist) {
  return JSON.parse(fs.readFileSync(path.join(dist, "overlay-manifest.json"), "utf8"));
}

const WIN = `${PRODUCT}-Setup-${VERSION}-x64.exe`;
const MAC_ARM = `${PRODUCT}-${VERSION}-arm64.zip`;
const MAC_X64 = `${PRODUCT}-${VERSION}-x64.zip`;

test("dist에 있는 산출물만 매니페스트에 담는다", () => {
  const dist = withDist({ [WIN]: "win payload", [MAC_ARM]: "mac arm payload" });

  const result = run(dist);
  assert.strictEqual(result.status, 0, result.stderr);

  const manifest = readManifest(dist);
  assert.deepStrictEqual(Object.keys(manifest.artifacts).sort(), ["darwin-arm64", "win32-x64"]);
  assert.strictEqual(manifest.version, VERSION);
  assert.strictEqual(manifest.license, "AGPL-3.0-only");
  assert.strictEqual(manifest.signed, false);
});

test("체크섬과 크기는 실제 파일에서 나온다", () => {
  const payload = "mac arm payload";
  const dist = withDist({ [MAC_ARM]: payload });

  assert.strictEqual(run(dist).status, 0);

  const entry = readManifest(dist).artifacts["darwin-arm64"];
  assert.strictEqual(entry.sha256, crypto.createHash("sha256").update(payload).digest("hex"));
  assert.strictEqual(entry.bytes, Buffer.byteLength(payload));
});

test("zip은 kind가 zip이고 silentArgs가 없다", () => {
  // clawad의 overlay-install.js가 zip에 silentArgs가 실려 오면 거절한다.
  const dist = withDist({ [MAC_X64]: "mac payload" });

  assert.strictEqual(run(dist).status, 0);

  const entry = readManifest(dist).artifacts["darwin-x64"];
  assert.strictEqual(entry.kind, "zip");
  assert.ok(!("silentArgs" in entry), "zip 산출물에 silentArgs가 들어갔다");
  assert.strictEqual(entry.productName, PRODUCT);
});

test("exe는 kind가 nsis이고 무인 설치 인수를 담는다", () => {
  const dist = withDist({ [WIN]: "win payload" });

  assert.strictEqual(run(dist).status, 0);

  const entry = readManifest(dist).artifacts["win32-x64"];
  assert.strictEqual(entry.kind, "nsis");
  assert.deepStrictEqual(entry.silentArgs, ["/S"]);
});

test("URL은 버전 고정 태그 경로를 가리킨다", () => {
  // latest 경로면 게시 후 파일이 바뀌어 체크섬이 어긋날 수 있다.
  const dist = withDist({ [MAC_ARM]: "mac arm payload" });

  assert.strictEqual(run(dist).status, 0);

  const entry = readManifest(dist).artifacts["darwin-arm64"];
  assert.strictEqual(
    entry.installerUrl,
    `https://github.com/TJ-media/clawad-overlay/releases/download/v${VERSION}/${MAC_ARM}`
  );
});

test("--require에 없는 산출물이 빠지면 실패한다", () => {
  // 러너 하나가 실패한 채로 반쪽 매니페스트를 게시하지 않게 막는다.
  const dist = withDist({ [WIN]: "win payload" });

  const result = run(dist, ["--require=win32-x64,darwin-arm64"]);

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /darwin-arm64/);
});

test("--require를 모두 만족하면 성공한다", () => {
  const dist = withDist({ [WIN]: "win payload", [MAC_ARM]: "mac arm payload" });

  assert.strictEqual(run(dist, ["--require=win32-x64,darwin-arm64"]).status, 0);
});

test("예전 CLI를 위해 win32-x64를 최상위에도 복제한다", () => {
  // 0.1.12까지 배포된 CLI는 artifacts를 모르고 최상위 평평한 필드만 읽는다.
  const dist = withDist({ [WIN]: "win payload", [MAC_ARM]: "mac arm payload" });

  assert.strictEqual(run(dist).status, 0);

  const manifest = readManifest(dist);
  const entry = manifest.artifacts["win32-x64"];
  assert.strictEqual(manifest.installerUrl, entry.installerUrl);
  assert.strictEqual(manifest.sha256, entry.sha256);
  assert.strictEqual(manifest.bytes, entry.bytes);
  assert.strictEqual(manifest.platform, "win32");
  assert.strictEqual(manifest.arch, "x64");
  assert.deepStrictEqual(manifest.silentArgs, ["/S"]);
});

test("Windows 산출물이 없으면 최상위 평평한 필드도 없다", () => {
  // macOS만 올린 릴리스를 예전 CLI가 만나면 "산출물 없음"으로 실패해야 한다.
  // 엉뚱한 URL을 최상위에 남겨 mac zip을 exe로 실행하게 두지 않는다.
  const dist = withDist({ [MAC_ARM]: "mac arm payload" });

  assert.strictEqual(run(dist).status, 0);

  const manifest = readManifest(dist);
  assert.ok(!("installerUrl" in manifest), "최상위에 installerUrl이 남았다");
  assert.ok(!("platform" in manifest), "최상위에 platform이 남았다");
});

test("산출물이 하나도 없으면 실패한다", () => {
  const result = run(withDist({}));

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /산출물이 없습니다/);
});

test("버전이 다른 파일은 줍지 않는다", () => {
  // 이전 빌드가 dist/에 남아 있어도 이번 버전 자산만 담아야 한다.
  const dist = withDist({ [`${PRODUCT}-0.0.1-arm64.zip`]: "stale payload", [MAC_ARM]: "mac arm payload" });

  assert.strictEqual(run(dist).status, 0);

  const manifest = readManifest(dist);
  assert.deepStrictEqual(Object.keys(manifest.artifacts), ["darwin-arm64"]);
  assert.strictEqual(manifest.artifacts["darwin-arm64"].bytes, Buffer.byteLength("mac arm payload"));
});

// ── 경량 업데이트 (CLAW-161) ──────────────────────────────────────────
// app.asar만 갈아 123MB를 6.8MB로 줄인다. 잘못 판단하면 다른 Electron 위에 우리 코드가
// 얹혀 앱이 안 켜지므로, 판정에 쓰는 runtimeId가 정확히 무엇으로 정해지는지 못 박는다.

const ASAR_ARM = `app-${VERSION}-arm64.asar`;
const ASAR_X64 = `app-${VERSION}-x64.asar`;

test("asar가 있으면 codeUpdate에 아키텍처별로 담는다 (CLAW-161)", () => {
  const dist = withDist({
    [MAC_ARM]: "mac-arm", [MAC_X64]: "mac-x64",
    [ASAR_ARM]: "asar-arm-bytes", [ASAR_X64]: "asar-x64-bytes",
  });

  assert.strictEqual(run(dist).status, 0);
  const manifest = readManifest(dist);

  assert.deepStrictEqual(Object.keys(manifest.codeUpdate).sort(), ["darwin-arm64", "darwin-x64"]);
  const arm = manifest.codeUpdate["darwin-arm64"];
  assert.match(arm.url, new RegExp(`/releases/download/v${VERSION}/${ASAR_ARM}$`));
  assert.strictEqual(arm.bytes, Buffer.byteLength("asar-arm-bytes"));
  assert.strictEqual(arm.sha256, crypto.createHash("sha256").update("asar-arm-bytes").digest("hex"));
  // 아키텍처별로 따로 담는다 — 같다고 가정하지 않는다.
  assert.notStrictEqual(arm.sha256, manifest.codeUpdate["darwin-x64"].sha256);
});

test("asar가 없으면 codeUpdate를 넣지 않는다 — 구 CLI는 전체 교체만 한다 (CLAW-161)", () => {
  const dist = withDist({ [MAC_ARM]: "mac-arm", [MAC_X64]: "mac-x64" });

  assert.strictEqual(run(dist).status, 0);
  const manifest = readManifest(dist);

  assert.ok(!("codeUpdate" in manifest), "선택 항목이라 없으면 아예 빼야 한다");
  assert.ok(manifest.runtimeId, "runtimeId는 asar 유무와 무관하게 항상 담는다");
});

test("runtimeId는 Electron 버전과 의존성으로만 정해진다 (CLAW-161)", () => {
  const dist = withDist({ [MAC_ARM]: "mac-arm" });
  assert.strictEqual(run(dist).status, 0);
  const first = readManifest(dist).runtimeId;

  // 같은 package.json이면 몇 번을 돌려도 같아야 한다 — 설치 시 기록한 값과 대조하기 때문이다.
  const again = withDist({ [MAC_ARM]: "mac-arm", [MAC_X64]: "mac-x64" });
  assert.strictEqual(run(again).status, 0);
  assert.strictEqual(readManifest(again).runtimeId, first, "산출물 구성이 달라도 runtimeId는 같다");

  assert.match(first, /^[a-f0-9]{64}$/);
});
