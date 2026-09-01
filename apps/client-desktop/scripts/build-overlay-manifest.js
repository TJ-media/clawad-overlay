#!/usr/bin/env node
'use strict';

// CLAW-132: 통합 설치(CLAW-133)가 조회하는 릴리스 매니페스트를 만든다.
// CLAW-92: Windows·macOS 산출물을 한 매니페스트에 담는다.
//
// 왜 latest.yml을 쓰지 않는가: clawad CLI는 Node 내장 모듈만 쓴다(규칙 §8). latest.yml은
// YAML이라 파서가 필요하다. 그래서 CLI가 자기 tarball에 쓰는 것과 같은 JSON 규약
// (version·URL·SHA-256)을 따르는 파일을 따로 만들고, CLI는 client/release.js의
// validateManifest·sha256을 그대로 재사용한다.
//
// latest.yml은 오버레이 자체 자동 업데이트(electron-updater)가 쓰므로 릴리스에 함께 올린다.
//
// dist/를 훑어 "실제로 있는" 산출물만 담는다. 이름을 추측해 조용히 깨진 매니페스트를 쓰지
// 않기 위해서다. Windows·macOS는 각각 다른 러너에서 빌드하므로, CI는 두 dist/를 한 폴더에
// 모은 뒤 이 스크립트를 한 번 돌린다.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 기본은 빌드 산출물 폴더다. 테스트가 실제 dist/를 건드리지 않도록 경로만 갈아끼운다.
const DIST = process.env.CLAWAD_OVERLAY_DIST || path.join(ROOT, 'dist');
const REPO_SLUG = 'TJ-media/clawad-overlay';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^﻿/, ''));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`package.json version이 semver가 아닙니다: ${version}`);

// 파일명은 build.{win,mac}.artifactName 템플릿에서 나온다. 템플릿을 바꾸면 여기도 깨지도록
// 실제 파일 존재를 확인한다 — 이름을 추측해 조용히 빈 매니페스트를 쓰지 않는다.
const productName = pkg.build && pkg.build.productName;
if (!productName) fail('package.json의 build.productName이 없습니다.');

// 통합 설치가 쓰는 산출물만 담는다. dmg는 사람이 직접 내려받는 경로용이라 릴리스에는
// 올리되 매니페스트에는 넣지 않는다 — 무인 설치는 zip을 ditto로 푸는 경로만 쓴다.
const CANDIDATES = [
  { key: 'win32-x64', file: `${productName}-Setup-${version}-x64.exe`, kind: 'nsis', silentArgs: ['/S'] },
  { key: 'win32-arm64', file: `${productName}-Setup-${version}-arm64.exe`, kind: 'nsis', silentArgs: ['/S'] },
  { key: 'darwin-x64', file: `${productName}-${version}-x64.zip`, kind: 'zip' },
  { key: 'darwin-arm64', file: `${productName}-${version}-arm64.zip`, kind: 'zip' },
];

// --require=win32-x64,darwin-arm64 : 이 조합이 없으면 실패한다. CI가 러너 하나를 놓친 채
// 반쪽짜리 매니페스트를 게시하는 것을 막는다.
const requireArg = process.argv.find((arg) => arg.startsWith('--require='));
const required = requireArg ? requireArg.slice('--require='.length).split(',').filter(Boolean) : [];

const artifacts = {};
const published = [];
for (const candidate of CANDIDATES) {
  const filePath = path.join(DIST, candidate.file);
  if (!fs.existsSync(filePath)) continue;

  const bytes = fs.readFileSync(filePath);
  artifacts[candidate.key] = {
    // 버전 고정 태그 경로여야 게시 후에도 내용이 바뀌지 않는다. latest 경로를 쓰면
    // 매니페스트의 체크섬과 실제 내려받는 파일이 어긋날 수 있다.
    installerUrl: `https://github.com/${REPO_SLUG}/releases/download/v${version}/${candidate.file}`,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    kind: candidate.kind,
    productName,
    // NSIS perMachine:false라 관리자 권한이 필요 없다. zip은 인수 없이 풀기만 한다.
    ...(candidate.silentArgs ? { silentArgs: candidate.silentArgs } : {}),
  };
  published.push({ key: candidate.key, file: candidate.file, size: bytes.length });
}

if (!published.length) {
  fail(`dist/에 산출물이 없습니다: ${DIST}\n먼저 npm run build:win:x64 또는 npm run build:mac 을 실행하세요.`);
}

const missing = required.filter((key) => !artifacts[key]);
if (missing.length) fail(`요구한 산출물이 dist/에 없습니다: ${missing.join(', ')}`);

// ── 경량 업데이트 (CLAW-161) ────────────────────────────────────────────
//
// 앱 358MB 중 우리 코드는 app.asar 6.8MB뿐이다. Electron 프레임워크(263MB)와 네이티브
// 모듈(87MB)이 그대로면 asar만 갈아도 된다. 그 판단에 쓰는 값이 runtimeId다.
//
// **번들 내부를 뒤지지 않는다.** Electron 버전과 의존성 목록만으로 만든다 — 둘 중 하나라도
// 바뀌면 프레임워크나 unpacked 트리가 바뀔 수 있으므로 전체 교체로 간다. devDependencies도
// 넣는다: electron-builder가 바뀌면 packing 방식이 달라질 수 있다.
//
// 방향은 보수적이다. 순수 JS 의존성만 올려도 전체 교체가 되지만, 그 반대(갈면 안 되는데
// asar만 가는 것)보다 낫다 — 그쪽은 앱이 안 켜진다.
function computeRuntimeId(packageJson) {
  const electron = (packageJson.devDependencies || {}).electron || '';
  const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  const sorted = Object.keys(deps).sort().map((name) => `${name}@${deps[name]}`).join('\n');
  return crypto.createHash('sha256').update(`electron=${electron}\n${sorted}`).digest('hex');
}

// CLAW-283: asar와 함께 unpacked 묶음도 담는다.
//
// asarUnpack 대상(themes·hooks·agents·assets·extensions)은 app.asar 밖에 있어서, asar만
// 갈면 테마·훅 변경이 사용자에게 닿지 않는다. 0.2.12가 그렇게 나갔다. runtimeId가 지키는
// 것은 87MB짜리 네이티브 트리(node_modules)뿐이고 우리 에셋은 그 관할이 아니다.
const runtimeId = computeRuntimeId(pkg);
const codeUpdate = {};
for (const arch of ['arm64', 'x64']) {
  const file = `app-${version}-${arch}.asar`;
  const filePath = path.join(DIST, file);
  if (!fs.existsSync(filePath)) continue;
  const bytes = fs.readFileSync(filePath);

  // asar만 있고 묶음이 없으면 새 CLI는 경량 경로를 포기하고 전체 교체로 내려간다 —
  // 앱은 멀쩡하지만 130MB 경로로 조용히 되돌아간 것을 아무도 눈치채지 못한다. 여기서 막는다.
  const unpackedFile = `app-${version}-${arch}.unpacked.tar.gz`;
  const unpackedPath = path.join(DIST, unpackedFile);
  if (!fs.existsSync(unpackedPath)) {
    fail(`${file}는 있는데 ${unpackedFile}가 없습니다. collect-asar.js가 둘 다 만들어야 합니다.`);
  }
  const unpackedBytes = fs.readFileSync(unpackedPath);

  codeUpdate[`darwin-${arch}`] = {
    url: `https://github.com/${REPO_SLUG}/releases/download/v${version}/${file}`,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    unpacked: {
      url: `https://github.com/${REPO_SLUG}/releases/download/v${version}/${unpackedFile}`,
      sha256: crypto.createHash('sha256').update(unpackedBytes).digest('hex'),
      bytes: unpackedBytes.length,
    },
  };
  published.push({ key: `asar-${arch}`, file, size: bytes.length });
  published.push({ key: `unpacked-${arch}`, file: unpackedFile, size: unpackedBytes.length });
}

// 0.1.12까지 배포된 CLI는 artifacts를 모르고 최상위의 평평한 필드만 읽는다. 그 CLI가
// 이 매니페스트를 만나도 Windows 설치가 계속되도록 win32-x64를 최상위에도 복제한다.
// 새 CLI는 artifacts를 먼저 보므로 이 필드에 영향받지 않는다. 배포된 CLI가 모두
// 교체되면 지운다.
const legacy = artifacts['win32-x64'];
const legacyFields = legacy ? {
  installerUrl: legacy.installerUrl,
  sha256: legacy.sha256,
  bytes: legacy.bytes,
  platform: 'win32',
  arch: 'x64',
  silentArgs: legacy.silentArgs,
} : {};

const manifest = {
  version,
  ...legacyFields,
  // AGPL: 우리가 이 바이너리를 사용자에게 전달하므로 대응 소스 위치를 함께 알린다.
  sourceUrl: `https://github.com/${REPO_SLUG}`,
  license: 'AGPL-3.0-only',
  // 알파는 무서명 배포다(CLAW-95). 상태를 매니페스트에 남겨 두면 서명을 취득한 뒤에도
  // 어느 릴리스가 무서명이었는지 릴리스만 보고 구분할 수 있다.
  signed: false,
  artifacts,
  // 설치 시 기록해 두었다가 다음 갱신에서 대조한다. 같으면 asar만, 다르면 전체 교체 (CLAW-161).
  runtimeId,
  // **선택 항목이다.** 구 CLI는 이 블록을 모르고 전체 교체만 하므로 릴리스 순서에 무관하다.
  ...(Object.keys(codeUpdate).length ? { codeUpdate } : {}),
};

const out = path.join(DIST, 'overlay-manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

console.log(out);
console.log(`  version   ${version}`);
for (const entry of published) {
  console.log(`  ${entry.key.padEnd(13)} ${entry.file} (${(entry.size / 1024 / 1024).toFixed(1)} MB)`);
}

// 릴리스에 함께 올려야 하는 자산. blockmap·latest*.yml·dmg는 존재하는 것만 나열한다.
const extras = fs.readdirSync(DIST).filter((name) => (
  name.endsWith('.blockmap') || /^latest(-mac)?\.yml$/.test(name) || name.endsWith('.dmg')
));
console.log('\n게시할 자산: ' + [...published.map((entry) => entry.file), ...extras, 'overlay-manifest.json'].join(', '));
