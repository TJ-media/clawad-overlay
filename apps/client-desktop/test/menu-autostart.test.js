const { describe, it } = require("node:test");
const assert = require("node:assert");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AUTOSTART_FILE, firstRunOpenAtLogin, getLoginItemSettings } = require("../src/login-item");
const { removeLoginItem } = require("../hooks/cleanup-integrations");

describe("login item settings", () => {
  it("includes the app path when enabling login items for an unpackaged Windows app", () => {
    const settings = getLoginItemSettings({
      isPackaged: false,
      openAtLogin: true,
      execPath: "D:\\clawd-on-desk\\node_modules\\electron\\dist\\electron.exe",
      appPath: "D:\\clawd-on-desk",
    });

    assert.deepStrictEqual(settings, {
      openAtLogin: true,
      path: "D:\\clawd-on-desk\\node_modules\\electron\\dist\\electron.exe",
      args: ["D:\\clawd-on-desk"],
    });
  });

  it("uses the default packaged login item settings", () => {
    const settings = getLoginItemSettings({
      isPackaged: true,
      openAtLogin: true,
      execPath: "C:\\Program Files\\Clawd on Desk\\Clawd on Desk.exe",
      appPath: "C:\\Program Files\\Clawd on Desk\\resources\\app.asar",
    });

    assert.deepStrictEqual(settings, { openAtLogin: true });
  });

  it("includes the app path when disabling login items for an unpackaged app", () => {
    const settings = getLoginItemSettings({
      isPackaged: false,
      openAtLogin: false,
      execPath: "D:\\clawd-on-desk\\node_modules\\electron\\dist\\electron.exe",
      appPath: "D:\\clawd-on-desk",
    });

    assert.deepStrictEqual(settings, {
      openAtLogin: false,
      path: "D:\\clawd-on-desk\\node_modules\\electron\\dist\\electron.exe",
      args: ["D:\\clawd-on-desk"],
    });
  });

});

// 오버레이가 뜨지 않으면 광고도 적립도 없다. 새 설치는 로그인 시 자동 실행으로 시작하되,
// 기존 사용자가 일부러 꺼 둔 것은 되켜지 않는다 (CLAW-228).
describe("first-run open at login", () => {
  it("turns login startup on for a fresh install", () => {
    assert.deepStrictEqual(firstRunOpenAtLogin({ systemValue: false, freshInstall: true }),
      { openAtLogin: true, enable: true });
  });

  it("keeps an upgrading user's explicit off", () => {
    assert.deepStrictEqual(firstRunOpenAtLogin({ systemValue: false, freshInstall: false }),
      { openAtLogin: false, enable: false });
  });

  it("keeps an already-enabled login item without writing again", () => {
    for (const freshInstall of [true, false]) {
      assert.deepStrictEqual(firstRunOpenAtLogin({ systemValue: true, freshInstall }),
        { openAtLogin: true, enable: false });
    }
  });
});

// 제거는 설치가 바꾼 것을 전부 되돌린다 (규칙 §8). 정리 진입점은 Electron API 없이 도는
// 순수 Node 스크립트라 OS 저장소를 직접 지운다.
describe("uninstall removes the login item", () => {
  it("deletes the Windows Run values under HKCU", () => {
    const calls = [];
    const result = removeLoginItem({
      platform: "win32",
      spawnSync: (file, args) => { calls.push({ file, args }); return { status: 0 }; },
    });
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(calls.map((c) => c.file), ["reg", "reg"]);
    for (const call of calls) {
      assert.strictEqual(call.args[0], "delete");
      assert.strictEqual(call.args[1], ["HKCU", "Software", "Microsoft", "Windows", "CurrentVersion", "Run"].join("\\"));
      assert.strictEqual(call.args[4], "/f");
    }
    assert.deepStrictEqual(result.removed, ["Claw-Ad", "clawd-on-desk"]);
  });

  it("treats a missing Run value as nothing to do", () => {
    const result = removeLoginItem({ platform: "win32", spawnSync: () => ({ status: 1 }) });
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(result.removed, []);
  });

  it("deletes the Linux autostart file and matches src/login-item.js", () => {
    assert.strictEqual(
      AUTOSTART_FILE,
      path.join(os.homedir(), ".config", "autostart", "clawd-on-desk.desktop"),
      "정리 스크립트가 쓰는 경로와 어긋나면 제거가 파일을 남긴다",
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawad-autostart-"));
    const file = path.join(dir, "clawd-on-desk.desktop");
    fs.writeFileSync(file, "[Desktop Entry]");
    const result = removeLoginItem({ platform: "linux", autostartFile: file });
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(result.removed, [file]);
    assert.strictEqual(fs.existsSync(file), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("leaves macOS alone — the login item goes with the bundle", () => {
    const result = removeLoginItem({
      platform: "darwin",
      spawnSync: () => { throw new Error("불려선 안 된다"); },
    });
    assert.strictEqual(result.status, "ok");
    assert.deepStrictEqual(result.removed, []);
  });
});
