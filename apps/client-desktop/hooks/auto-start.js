#!/usr/bin/env node
// Clawd Desktop Pet — Auto-Start Script
// Registered as a SessionStart hook BEFORE clawd-hook.js.
// Checks if the Electron app is running; if not, launches it detached.
// Uses shared server discovery helpers and should exit quickly in normal cases.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { discoverClawdPort } = require("./server-config");
const { buildElectronLaunchConfig } = require("./shared-process");

// 패키징된 앱의 실행 파일 이름은 electron-builder가 productName에서 만든다. 이름을
// 문자열로 박아두면 제품명을 바꿀 때마다 조용히 깨진다(CLAW-126에서 실제로 깨졌다).
// 설치 폴더를 훑어 실행 파일을 찾고, 제거 프로그램은 걸러낸다.
function resolvePackagedExecutable(installDir, platform) {
  const isWin = platform === "win32";
  let names = [];
  try { names = fs.readdirSync(installDir); } catch { return null; }
  const candidates = names.filter((name) => {
    if (/^Uninstall /i.test(name)) return false;
    if (isWin) return name.toLowerCase().endsWith(".exe");
    if (name.includes(".")) return false;
    try { return fs.statSync(path.join(installDir, name)).isFile(); } catch { return false; }
  });
  if (candidates.length === 0) return null;
  // 이름 하나면 그것, 여러 개면 elevate.exe 같은 보조 실행 파일을 피해 가장 큰 것을 고른다.
  if (candidates.length === 1) return path.join(installDir, candidates[0]);
  let best = null;
  let bestSize = -1;
  for (const name of candidates) {
    let size = 0;
    try { size = fs.statSync(path.join(installDir, name)).size; } catch { continue; }
    if (size > bestSize) { bestSize = size; best = name; }
  }
  return best ? path.join(installDir, best) : null;
}

const INITIAL_DISCOVER_TIMEOUT_MS = 300;
const STARTUP_READY_TIMEOUT_MS = 6000;
const STARTUP_DISCOVER_TIMEOUT_MS = 100;
const STARTUP_POLL_INTERVAL_MS = 100;

function waitForClawdPort(options, callback) {
  const discover = options.discoverClawdPort || discoverClawdPort;
  const setTimeoutFn = options.setTimeout || setTimeout;
  const nowFn = options.now || Date.now;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : STARTUP_READY_TIMEOUT_MS;
  const discoverTimeoutMs = Number.isFinite(options.discoverTimeoutMs)
    ? options.discoverTimeoutMs
    : STARTUP_DISCOVER_TIMEOUT_MS;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : STARTUP_POLL_INTERVAL_MS;
  const deadline = nowFn() + Math.max(0, timeoutMs);

  function probe() {
    discover({ timeoutMs: discoverTimeoutMs }, (port) => {
      if (port || nowFn() >= deadline) {
        callback(port || null);
        return;
      }
      setTimeoutFn(probe, intervalMs);
    });
  }

  probe();
}

function main(deps = {}) {
  const discover = deps.discoverClawdPort || discoverClawdPort;
  const launch = deps.launchApp || launchApp;
  const exit = deps.exit || ((code) => process.exit(code));

  discover({ timeoutMs: INITIAL_DISCOVER_TIMEOUT_MS }, (port) => {
    if (port) {
      exit(0);
      return;
    }
    launch();
    waitForClawdPort({
      discoverClawdPort: discover,
      setTimeout: deps.setTimeout,
      now: deps.now,
      timeoutMs: deps.startupReadyTimeoutMs,
      discoverTimeoutMs: deps.startupDiscoverTimeoutMs,
      intervalMs: deps.startupPollIntervalMs,
    }, () => exit(0));
  });
}

function launchApp() {
  const isPackaged = __dirname.includes("app.asar");
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  try {
    if (isPackaged) {
      if (isWin) {
        // __dirname: <install>/resources/app.asar.unpacked/hooks
        // exe:       <install>/<productName>.exe  (현재 Claw-Ad.exe)
        const installDir = path.resolve(__dirname, "..", "..", "..");
        const exe = resolvePackagedExecutable(installDir, "win32");
        if (!exe) return;
        spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
      } else if (isMac) {
        // __dirname: <name>.app/Contents/Resources/app.asar.unpacked/hooks
        // .app bundle: 4 levels up
        const appBundle = path.resolve(__dirname, "..", "..", "..", "..");
        spawn("open", ["-a", appBundle], {
          detached: true,
          stdio: "ignore",
        }).unref();
      } else {
        // Linux packaged app:
        // AppImage: process.env.APPIMAGE holds the .AppImage file path.
        // deb/dir:  executable is <install>/<executableName>, same depth as Windows.
        //   __dirname: <install>/resources/app.asar.unpacked/hooks
        //   install:   3 levels up
        const appImage = process.env.APPIMAGE;
        if (appImage) {
          spawn(appImage, [], { detached: true, stdio: "ignore" }).unref();
        } else {
          const installDir = path.resolve(__dirname, "..", "..", "..");
          const exe = resolvePackagedExecutable(installDir, process.platform);
          if (!exe) return;
          spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
        }
      }
    } else {
      // Source / development mode: start Electron directly so Windows does not
      // flash a console through the cmd/npm/launch.js process chain.
      const projectDir = path.resolve(__dirname, "..");
      const electron = require("electron");
      const launchConfig = buildElectronLaunchConfig(projectDir);
      spawn(electron, launchConfig.args, {
        cwd: launchConfig.cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: launchConfig.env,
      }).unref();
    }
  } catch (err) {
    process.stderr.write(`clawd auto-start: ${err.message}\n`);
  }
}

if (require.main === module) main();

module.exports = {
  INITIAL_DISCOVER_TIMEOUT_MS,
  STARTUP_READY_TIMEOUT_MS,
  STARTUP_DISCOVER_TIMEOUT_MS,
  STARTUP_POLL_INTERVAL_MS,
  waitForClawdPort,
  launchApp,
  main,
};
