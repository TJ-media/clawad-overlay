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
    found.push({ arch: suffix || 'x64', asar });
  }
  return found;
}

const bundles = findAppBundles(DIST);
if (!bundles.length) fail(`dist/에서 ${productName}.app을 찾지 못했습니다: ${DIST}`);

for (const bundle of bundles) {
  const out = path.join(DIST, `app-${version}-${bundle.arch}.asar`);
  fs.copyFileSync(bundle.asar, out);
  const bytes = fs.readFileSync(out);
  console.log(`  ${bundle.arch.padEnd(6)} ${path.basename(out)} (${(bytes.length / 1024 / 1024).toFixed(1)} MB) ${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12)}…`);
}
