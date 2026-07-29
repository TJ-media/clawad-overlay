"use strict";
// CLAW-137. 두 가지가 핵심이다.
//   1. lastError.code를 상태로 정확히 번역한다 — 네트워크 장애에 로그인 버튼을 띄우면
//      사용자가 엉뚱한 조치를 하게 된다.
//   2. 트리거 포인터가 가리키는 경로를 그대로 실행하지 않는다 (overlay-contract §3.3·§3.4).
const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  readAuthState,
  resolveLoginCommand,
  startLogin,
} = require("../src/clawad-auth-state");

function makeDataDir({ auth = true, syncState, trigger } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawad-auth-"));
  if (auth) fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ accessToken: "a", refreshToken: "b" }));
  if (syncState !== undefined) fs.writeFileSync(path.join(dir, "sync-state.json"), JSON.stringify(syncState));
  if (trigger !== undefined) fs.writeFileSync(path.join(dir, "overlay-trigger.json"), JSON.stringify(trigger));
  return dir;
}

/** 실제로 존재하는 파일 두 개로 유효한 트리거 포인터를 만든다. */
function makeInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawad-install-"));
  const clientDir = path.join(root, "client");
  fs.mkdirSync(clientDir);
  const node = path.join(root, "node.exe");
  fs.writeFileSync(node, "");
  fs.writeFileSync(path.join(clientDir, "overlay-events.js"), "");
  fs.writeFileSync(path.join(clientDir, "login.js"), "");
  return { node, script: path.join(clientDir, "overlay-events.js") };
}

describe("클로애드 로그인 상태 판정", () => {
  it("오류가 없으면 정상으로 본다", () => {
    const dataDir = makeDataDir({ syncState: { lastSuccessAt: "2026-07-29T00:00:00.000Z", lastError: null } });
    const state = readAuthState({ dataDir });
    assert.strictEqual(state.status, "ok");
    assert.strictEqual(state.lastSuccessAt, "2026-07-29T00:00:00.000Z");
  });

  it("재동의가 필요한 상태를 세션 만료와 구분한다", () => {
    const consent = makeDataDir({ syncState: { lastError: { code: "CONSENT_REQUIRED" } } });
    assert.strictEqual(readAuthState({ dataDir: consent }).status, "consent-needed");

    const expired = makeDataDir({ syncState: { lastError: { code: "SESSION_EXPIRED" } } });
    assert.strictEqual(readAuthState({ dataDir: expired }).status, "login-needed");
  });

  it("일시적 장애는 로그인이 필요한 상태로 보지 않는다", () => {
    for (const code of ["NETWORK_UNAVAILABLE", "SERVER_UNAVAILABLE", "LOCAL_LEDGER_BUSY"]) {
      const dataDir = makeDataDir({ syncState: { lastError: { code } } });
      assert.strictEqual(readAuthState({ dataDir }).status, "degraded", `${code}가 degraded로 분류되지 않았다`);
    }
  });

  it("로그인 정보가 없으면 logged-out이다", () => {
    const dataDir = makeDataDir({ auth: false, syncState: { lastError: { code: "LOCAL_AUTH_MISSING" } } });
    assert.strictEqual(readAuthState({ dataDir }).status, "logged-out");
  });

  it("데이터 디렉터리가 비어 있으면 unknown이다", () => {
    const dataDir = makeDataDir({ auth: false });
    const state = readAuthState({ dataDir });
    assert.strictEqual(state.status, "unknown");
    assert.strictEqual(state.canLogin, false);
  });
});

describe("로그인 커맨드 유도", () => {
  it("트리거 포인터와 같은 디렉터리의 login.js로 유도한다", () => {
    const install = makeInstall();
    const dataDir = makeDataDir({ trigger: { version: 1, ...install, args: ["collect"] } });
    const command = resolveLoginCommand({ dataDir });
    assert.ok(command, "커맨드를 얻지 못했다");
    assert.strictEqual(path.basename(command.script), "login.js");
    assert.strictEqual(path.dirname(command.script), path.dirname(install.script));
  });

  it("script 파일명이 overlay-events.js가 아니면 실행하지 않는다", () => {
    // 계약 §3.3의 검사다. 이게 없으면 트리거 파일을 바꿔 임의 경로를 실행시킬 수 있다.
    const install = makeInstall();
    const evil = path.join(path.dirname(install.script), "evil.js");
    fs.writeFileSync(evil, "");
    const dataDir = makeDataDir({ trigger: { version: 1, node: install.node, script: evil } });
    assert.strictEqual(resolveLoginCommand({ dataDir }), null);
  });

  it("트리거가 없거나 버전이 다르면 실행하지 않는다", () => {
    assert.strictEqual(resolveLoginCommand({ dataDir: makeDataDir({}) }), null);
    const install = makeInstall();
    const wrongVersion = makeDataDir({ trigger: { version: 99, ...install } });
    assert.strictEqual(resolveLoginCommand({ dataDir: wrongVersion }), null);
  });

  it("가리키는 파일이 실제로 없으면 실행하지 않는다", () => {
    const dataDir = makeDataDir({
      trigger: { version: 1, node: path.join(os.tmpdir(), "no-such-node.exe"), script: path.join(os.tmpdir(), "client", "overlay-events.js") },
    });
    assert.strictEqual(resolveLoginCommand({ dataDir }), null);
  });
});

describe("로그인 실행", () => {
  it("유효한 포인터에서만 프로세스를 띄운다", () => {
    const install = makeInstall();
    const dataDir = makeDataDir({ trigger: { version: 1, ...install } });
    const calls = [];
    const spawn = (file, args) => {
      calls.push({ file, args });
      return { on() {}, unref() {} };
    };

    const started = startLogin({ dataDir, spawn });
    assert.strictEqual(started.status, "started");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(path.basename(calls[0].args[0]), "login.js");

    const missing = startLogin({ dataDir: makeDataDir({}), spawn });
    assert.strictEqual(missing.status, "unavailable");
    assert.strictEqual(calls.length, 1, "포인터가 없는데 프로세스를 띄웠다");
  });

  it("spawn이 던져도 예외를 흘리지 않는다", () => {
    const install = makeInstall();
    const dataDir = makeDataDir({ trigger: { version: 1, ...install } });
    const result = startLogin({ dataDir, spawn: () => { throw new Error("spawn 실패"); } });
    assert.strictEqual(result.status, "failed");
    assert.match(result.message, /spawn 실패/);
  });
});
