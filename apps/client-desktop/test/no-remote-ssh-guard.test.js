"use strict";

// 원격 SSH 제거(CLAW-140)와 키체인 접근 제거(CLAW-154)가 되돌아오지 않게 막는 가드.
//
// 되돌아오면 곧바로 사용자에게 드러나는 회귀다: safeStorage를 건드리는 순간 macOS가
// 첫 실행에 로그인 키체인 암호를 묻고, 알파 테스터가 설치 직후 만나는 화면이 암호
// 입력 대화상자가 된다. CLAW-129의 package-build-config 가드와 같은 방식이다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(js|html|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("Electron safeStorage를 쓰지 않는다 — 키체인 암호 대화상자의 원인 (CLAW-154)", () => {
  const offenders = sourceFiles(SRC_DIR).filter((file) =>
    fs.readFileSync(file, "utf8").includes("safeStorage"));
  assert.deepStrictEqual(
    offenders.map((file) => path.relative(ROOT, file)),
    [],
    "safeStorage를 다시 쓰면 첫 실행에 macOS 키체인 암호를 묻게 된다"
  );
});

test("원격 SSH 모듈이 돌아오지 않는다 (CLAW-140)", () => {
  const revived = fs.readdirSync(SRC_DIR).filter((name) => /^remote-ssh|remote-ssh/.test(name));
  assert.deepStrictEqual(revived, [], "src/에 remote-ssh 모듈이 다시 생겼다");

  const offenders = sourceFiles(SRC_DIR)
    .filter((file) => /remote-?ssh/i.test(fs.readFileSync(file, "utf8")))
    // shell-quote.js는 이름 유래를 설명하는 주석 한 줄만 남겼다.
    .filter((file) => path.basename(file) !== "shell-quote.js");
  assert.deepStrictEqual(
    offenders.map((file) => path.relative(ROOT, file)),
    [],
    "원격 SSH 참조가 다시 들어왔다"
  );
});

test("쓰지 않는 외부 전송 SDK를 다시 넣지 않는다 (CLAW-129)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const deps = Object.keys(pkg.dependencies || {});
  assert.ok(
    !deps.some((name) => name.startsWith("@larksuiteoapi")),
    "페이슈 SDK는 제거된 기능의 의존성이다 — 코드에서 쓰지 않으면서 배포 번들에만 실린다"
  );
});
