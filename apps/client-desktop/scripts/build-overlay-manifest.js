#!/usr/bin/env node
'use strict';

// CLAW-132: 통합 설치(CLAW-133)가 조회하는 릴리스 매니페스트를 만든다.
//
// 왜 latest.yml을 쓰지 않는가: clawad CLI는 Node 내장 모듈만 쓴다(규칙 §8). latest.yml은
// YAML이라 파서가 필요하다. 그래서 CLI가 자기 tarball에 쓰는 것과 같은 JSON 규약
// (version·URL·SHA-256)을 따르는 파일을 따로 만들고, CLI는 client/release.js의
// validateManifest·sha256을 그대로 재사용한다.
//
// latest.yml은 오버레이 자체 자동 업데이트(electron-updater)가 쓰므로 릴리스에 함께 올린다.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REPO_SLUG = 'TJ-media/clawad-overlay';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^﻿/, ''));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`package.json version이 semver가 아닙니다: ${version}`);

// 파일명은 build.win.artifactName 템플릿에서 나온다. 템플릿을 바꾸면 여기도 깨지도록
// 실제 파일 존재를 확인한다 — 이름을 추측해 조용히 빈 매니페스트를 쓰지 않는다.
const arch = process.argv[2] || 'x64';
const installerName = `Claw-Ad-Setup-${version}-${arch}.exe`;
const installerPath = path.join(DIST, installerName);
if (!fs.existsSync(installerPath)) {
  fail(`인스톨러가 없습니다: ${installerPath}\n먼저 npm run build:win:${arch} 를 실행하세요.`);
}

const bytes = fs.readFileSync(installerPath);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

// 버전 고정 태그 경로여야 게시 후에도 내용이 바뀌지 않는다. latest 경로를 쓰면
// 매니페스트의 체크섬과 실제 내려받는 파일이 어긋날 수 있다.
const installerUrl = `https://github.com/${REPO_SLUG}/releases/download/v${version}/${installerName}`;

const manifest = {
  version,
  installerUrl,
  sha256,
  bytes: bytes.length,
  platform: 'win32',
  arch,
  // 통합 설치가 무인 실행할 때 쓰는 인수. NSIS perMachine:false라 관리자 권한이 필요 없다.
  silentArgs: ['/S'],
  // AGPL: 우리가 이 바이너리를 사용자에게 전달하므로 대응 소스 위치를 함께 알린다.
  sourceUrl: `https://github.com/${REPO_SLUG}`,
  license: 'AGPL-3.0-only',
};

const out = path.join(DIST, 'overlay-manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

console.log(out);
console.log(`  version   ${version}`);
console.log(`  installer ${installerName} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  sha256    ${sha256}`);
console.log('\n게시할 자산: ' + [installerName, `${installerName}.blockmap`, 'latest.yml', 'overlay-manifest.json'].join(', '));
