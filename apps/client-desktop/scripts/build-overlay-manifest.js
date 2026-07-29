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

const manifest = {
  version,
  // AGPL: 우리가 이 바이너리를 사용자에게 전달하므로 대응 소스 위치를 함께 알린다.
  sourceUrl: `https://github.com/${REPO_SLUG}`,
  license: 'AGPL-3.0-only',
  // 알파는 무서명 배포다(CLAW-95). 상태를 매니페스트에 남겨 두면 서명을 취득한 뒤에도
  // 어느 릴리스가 무서명이었는지 릴리스만 보고 구분할 수 있다.
  signed: false,
  artifacts,
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
