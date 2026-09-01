#!/usr/bin/env node
'use strict';

// CLAW-161: 경량 업데이트용 app.asar를 릴리스 자산으로 꺼낸다.
//
// 오버레이 한 벌은 358MB인데 그중 우리 코드는 app.asar 6.8MB뿐이다. 나머지는 Electron
// 프레임워크(263MB)와 네이티브 모듈(87MB)이고, 우리가 Electron·의존성을 올릴 때만 바뀐다.
// 코드만 바뀐 릴리스에서 사용자가 123MB를 다시 받을 이유가 없다.
//
// **아키텍처별로 따로 꺼낸다.** arm64와 x64의 asar가 같을 것 같지만, 같다고 가정하는 대신
// 각자 게시한다 — 자산 하나가 6.8MB라 비용이 없고, 가정이 틀렸을 때 잘못된 코드를 넣는
// 사고를 원천적으로 막는다.
//
// macOS 러너에서 빌드 직후 돈다. 여기서만 .app 번들이 손에 있다 — CI가 릴리스에 올리는 것은
// zip·dmg뿐이라 매니페스트를 만드는 publish 잡은 번들을 보지 못한다.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = process.env.CLAWAD_OVERLAY_DIST || path.join(ROOT, 'dist');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^﻿/, ''));
const version = pkg.version;
const productName = pkg.build && pkg.build.productName;
if (!productName) fail('package.json의 build.productName이 없습니다.');

/** electron-builder의 macOS 출력 폴더. arch마다 다르고 버전에 따라 이름이 바뀐 적이 있어 훑는다. */
function findAppBundles(dist) {
  if (!fs.existsSync(dist)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const asar = path.join(dist, entry.name, `${productName}.app`, 'Contents', 'Resources', 'app.asar');
    if (!fs.existsSync(asar)) continue;
    // dist/mac-arm64 → arm64, dist/mac → x64 (electron-builder 기본 규약)
    const suffix = entry.name.replace(/^mac-?/, '');
    found.push({ arch: suffix || 'x64', asar, resources: path.dirname(asar) });
  }
  return found;
}

const bundles = findAppBundles(DIST);
if (!bundles.length) fail(`dist/에서 ${productName}.app을 찾지 못했습니다: ${DIST}`);

// CLAW-283: unpacked 트리도 함께 꺼낸다.
//
// asar만 갈면 asarUnpack 대상은 옛것으로 남는다. 번들 테마가 거기 있어서, 마스코트 에셋을
// 바꾼 릴리스가 경량 경로를 탄 macOS 사용자에게 닿지 않았다 (0.2.12에서 실제로 발생).
//
// app.asar.unpacked는 87MB지만 그중 우리 것은 2MB(gzip 0.63MB)뿐이다. 나머지는 koffi
// 네이티브 바이너리이고 의존성이 바뀔 때만 바뀌므로 runtimeId가 이미 지킨다. node_modules만
// 빼면 경량 경로가 테마·훅까지 실어 나른다.
//
// 담을 목록을 박지 않고 node_modules만 제외한다 — asarUnpack에 새 항목이 생겨도 자동으로
// 실린다. 목록을 박으면 다음 사람이 여기를 갱신하는 것을 잊는다.
const UNPACKED_EXCLUDE = new Set(['node_modules']);

function collectUnpacked(bundle) {
  const dir = path.join(bundle.resources, 'app.asar.unpacked');
  if (!fs.existsSync(dir)) fail(`app.asar.unpacked가 없습니다: ${dir}`);
  const entries = fs.readdirSync(dir).filter((name) => !UNPACKED_EXCLUDE.has(name)).sort();
  if (!entries.length) fail(`app.asar.unpacked에 담을 것이 없습니다: ${dir}`);

  const out = path.join(DIST, `app-${version}-${bundle.arch}.unpacked.tar.gz`);
  // tar에 절대 경로를 넘기지 않는다. GNU tar는 `C:\...`를 원격 호스트 명세로 읽어
  // "Cannot connect to C"로 죽는다 — CI는 macOS(bsdtar)라 안 겪지만, 로컬에서 이 스크립트를
  // 돌려 볼 수 없으면 검증이 CI에서만 되는 코드가 된다. cwd를 옮기고 stdout으로 받는다.
  // COPYFILE_DISABLE: macOS tar가 확장 속성을 ._* AppleDouble 항목으로 끼워 넣는 것을 막는다.
  const result = spawnSync('tar', ['-czf', '-', ...entries], {
    cwd: dir,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) fail(`tar 실행 실패: ${result.error.message}`);
  if (result.status !== 0) fail(`unpacked 묶음을 만들지 못했습니다: ${String(result.stderr || '').trim()}`);
  fs.writeFileSync(out, result.stdout);
  return { out, entries };
}

for (const bundle of bundles) {
  const out = path.join(DIST, `app-${version}-${bundle.arch}.asar`);
  fs.copyFileSync(bundle.asar, out);
  const bytes = fs.readFileSync(out);
  console.log(`  ${bundle.arch.padEnd(6)} ${path.basename(out)} (${(bytes.length / 1024 / 1024).toFixed(1)} MB) ${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12)}…`);

  const unpacked = collectUnpacked(bundle);
  const unpackedBytes = fs.readFileSync(unpacked.out);
  console.log(`  ${bundle.arch.padEnd(6)} ${path.basename(unpacked.out)} (${(unpackedBytes.length / 1024 / 1024).toFixed(2)} MB) ${crypto.createHash('sha256').update(unpackedBytes).digest('hex').slice(0, 12)}… [${unpacked.entries.join(' ')}]`);
}
