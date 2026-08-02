"use strict";

// clawad CLI 위임 다리 (CLAW-160).
//
// 검사 하나가 여기 모여 있다: 트리거 포인터의 script 파일명이 overlay-events.js가 아니면
// 실행하지 않는다 (계약 §3.3). 로그인(§3.4)과 갱신(§3.5)이 같은 검사를 쓰므로 한 곳만 뚫려도
// 두 경로가 함께 뚫린다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { resolveSiblingCommand } = require("../src/clawad-cli-bridge");

const NODE = "/usr/local/bin/node";
const INSTALL_DIR = path.join("/opt", "clawad", "client");

function deps(pointer, { existing } = {}) {
  const present = new Set(existing || [NODE, path.join(INSTALL_DIR, "overlay-update.js")]);
  return {
    dataDir: "/tmp/clawad-data",
    readJson: () => pointer,
    fsImpl: { existsSync: (p) => present.has(p) },
  };
}

function validPointer(extra = {}) {
  return {
    version: 1,
    node: NODE,
    script: path.join(INSTALL_DIR, "overlay-events.js"),
    args: ["collect"],
    ...extra,
  };
}

test("형제 스크립트를 끌어낸다", () => {
  const command = resolveSiblingCommand("overlay-update.js", deps(validPointer()));
  assert.deepStrictEqual(command, { node: NODE, script: path.join(INSTALL_DIR, "overlay-update.js") });
});

test("script 파일명이 overlay-events.js가 아니면 실행하지 않는다 — 임의 경로 실행 금지 (§3.3)", () => {
  for (const script of [
    "/tmp/evil.js",
    path.join(INSTALL_DIR, "anything-else.js"),
    path.join("/tmp", "overlay-events.js.sh"),
  ]) {
    const pointer = validPointer({ script });
    assert.strictEqual(resolveSiblingCommand("overlay-update.js", deps(pointer)), null, script);
  }
});

test("포인터가 없거나 버전이 다르면 null", () => {
  for (const pointer of [null, undefined, {}, { version: 2, node: NODE, script: validPointer().script }]) {
    assert.strictEqual(resolveSiblingCommand("overlay-update.js", deps(pointer)), null);
  }
});

test("node·script가 문자열이 아니면 null", () => {
  for (const extra of [{ node: 42 }, { script: null }, { node: undefined }]) {
    assert.strictEqual(resolveSiblingCommand("overlay-update.js", deps(validPointer(extra))), null);
  }
});

test("가리키는 파일이 실제로 없으면 null — 구 CLI에는 overlay-update.js가 없다", () => {
  // node는 있지만 갱신 스크립트가 없는 설치본.
  const command = resolveSiblingCommand("overlay-update.js", deps(validPointer(), { existing: [NODE] }));
  assert.strictEqual(command, null);
});

test("같은 검사로 로그인 스크립트도 끌어낸다 (§3.4)", () => {
  const command = resolveSiblingCommand("login.js", deps(validPointer(), {
    existing: [NODE, path.join(INSTALL_DIR, "login.js")],
  }));
  assert.deepStrictEqual(command, { node: NODE, script: path.join(INSTALL_DIR, "login.js") });
});
