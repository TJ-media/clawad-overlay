"use strict";

// CLAW-137: 클로애드 로그인 상태를 읽고, 로그인 커맨드를 실행한다.
//
// 인증 로직은 clawad(비공개)가 전담한다 — 이 파일은 OAuth 흐름·auth.json 쓰기 형식·토큰
// 갱신을 재구현하지 않는다 (docs/design/overlay-contract.md §0 위임, §3.4).
// 여기서 하는 일은 두 가지뿐이다:
//   1. auth.json의 **존재 여부**와 sync-state.json의 lastError를 읽어 상태를 판단한다
//   2. overlay-trigger.json이 가리키는 설치본의 login.js를 실행한다
//
// 토큰 값은 읽지 않는다. 광고 런타임과 데이터 경로를 섞지 않기 위해 이 모듈은
// clawad-ad-runtime.js와 독립적이다.

const fs = require("fs");
const path = require("path");

const { clawadDataDir } = require("./clawad-surface-lock");
const { resolveSiblingCommand } = require("./clawad-cli-bridge");

const LOGIN_SCRIPT_NAME = "login.js";

// 로그인으로 해결되는 상태. 그 외(네트워크·서버 장애)는 일시적이므로 안내하지 않는다.
const NEEDS_LOGIN_CODES = new Set([
  "LOCAL_AUTH_MISSING",
  "LOCAL_AUTH_INVALID",
  "SESSION_EXPIRED",
  "SESSION_REFRESH_INVALID",
]);
const NEEDS_CONSENT_CODES = new Set(["CONSENT_REQUIRED"]);

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

/**
 * 로그인 상태. status는 다음 중 하나다.
 *   unknown        — 클로애드 CLI가 설치돼 있지 않다(데이터 디렉터리·트리거 없음)
 *   logged-out     — 로그인 정보가 없다
 *   consent-needed — 약관·방침이 개정되어 재동의가 필요하다
 *   login-needed   — 세션이 만료·폐기됐다
 *   degraded       — 일시적 장애(네트워크·서버). 로그인으로 해결되지 않는다
 *   ok             — 정상
 */
function readAuthState(options = {}) {
  const dataDir = options.dataDir || clawadDataDir(options.env || process.env);
  const hasAuth = fs.existsSync(path.join(dataDir, "auth.json"));
  const state = readJsonFile(path.join(dataDir, "sync-state.json"));
  const canLogin = Boolean(resolveLoginCommand({ dataDir }));

  if (!hasAuth && !state) {
    // 데이터 디렉터리가 비어 있으면 CLI가 아직 설치·실행되지 않은 것이다.
    return { status: canLogin ? "logged-out" : "unknown", canLogin, lastSuccessAt: null, code: null };
  }

  const error = state && state.lastError && typeof state.lastError === "object" ? state.lastError : null;
  const code = error && typeof error.code === "string" ? error.code : null;
  const lastSuccessAt = state && typeof state.lastSuccessAt === "string" ? state.lastSuccessAt : null;

  if (!hasAuth) return { status: "logged-out", canLogin, lastSuccessAt, code };
  if (code && NEEDS_CONSENT_CODES.has(code)) return { status: "consent-needed", canLogin, lastSuccessAt, code };
  if (code && NEEDS_LOGIN_CODES.has(code)) return { status: "login-needed", canLogin, lastSuccessAt, code };
  if (code) return { status: "degraded", canLogin, lastSuccessAt, code };
  return { status: "ok", canLogin, lastSuccessAt, code: null };
}

/**
 * 실행할 로그인 커맨드. 트리거 포인터의 script와 **같은 디렉터리**의 login.js로 유도한다.
 * script 파일명이 overlay-events.js가 아니면 null을 돌려준다 — 계약 §3.3·§3.4의
 * "임의 경로를 그대로 실행하지 않는다"를 지킨다.
 */
function resolveLoginCommand(options = {}) {
  return resolveSiblingCommand(LOGIN_SCRIPT_NAME, options);
}

/**
 * 로그인을 실행한다. login.js가 loopback 서버를 열고 브라우저를 직접 띄우므로 터미널이
 * 필요 없다. 완료를 기다리지 않는다 — 사용자가 브라우저에서 동의를 마치면 clawad가
 * auth.json을 쓰고 최초 sync를 시작한다.
 */
function startLogin(options = {}) {
  const command = resolveLoginCommand(options);
  if (!command) return { status: "unavailable" };
  try {
    const spawn = options.spawn || require("node:child_process").spawn;
    const child = spawn(command.node, [command.script], {
      stdio: "ignore",
      windowsHide: true,
      detached: false,
    });
    child.on("error", () => {});
    child.unref();
    return { status: "started" };
  } catch (err) {
    return { status: "failed", message: (err && err.message) || String(err) };
  }
}

module.exports = {
  NEEDS_CONSENT_CODES,
  NEEDS_LOGIN_CODES,
  readAuthState,
  resolveLoginCommand,
  startLogin,
};
