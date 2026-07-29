#!/usr/bin/env node
'use strict';

// CLAW-95: 배포 산출물이 실제로 서명됐는지 확인한다.
//
// electron-builder는 서명 자격이 없으면 조용히 건너뛰고 빌드를 성공으로 끝낸다
// (실제로 그랬다 — 로그에 "signing with signtool.exe"가 찍혔는데 산출물은 NotSigned였다).
// 그래서 빌드 로그를 믿지 않고 산출물 자체를 검사한다.
//
//   node scripts/verify-signature.js            dist의 배포 산출물을 검사한다
//   node scripts/verify-signature.js --require  하나라도 미서명이면 종료 코드 1
//
// --require 없이 실행하면 상태만 출력하고 0으로 끝난다(미서명 알파 배포를 막지 않는다).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const require_ = process.argv.includes('--require');

// 검사 대상은 사용자가 실행하는 것들이다. blockmap·yml은 서명 대상이 아니다.
const SIGNABLE_EXTENSIONS = new Set(['.exe', '.dmg', '.pkg', '.appx', '.msix']);

function listArtifacts() {
  let names = [];
  try { names = fs.readdirSync(DIST); } catch { return []; }
  return names
    .filter((name) => SIGNABLE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    // NSIS가 만드는 중간 산출물은 배포하지 않는다.
    .filter((name) => !name.includes('.__uninstaller'))
    .map((name) => path.join(DIST, name));
}

/** Windows: Get-AuthenticodeSignature. Valid 외의 상태는 모두 미서명으로 본다. */
function checkWindows(file) {
  const script = `$s = Get-AuthenticodeSignature -LiteralPath ${JSON.stringify(file)};`
    + ' $subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { "" };'
    + ' Write-Output ("$($s.Status)|$subject")';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return { signed: false, detail: `검사 실패: ${(result.error && result.error.message) || result.stderr || 'unknown'}` };
  }
  const [status, subject] = String(result.stdout || '').trim().split('|');
  return { signed: status === 'Valid', detail: subject ? `${status} — ${subject}` : status || 'unknown' };
}

/** macOS: codesign으로 서명을, spctl로 공증(Notarized)까지 본다. */
function checkMac(file) {
  const codesign = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', file], { encoding: 'utf8' });
  if (codesign.status !== 0) {
    return { signed: false, detail: `codesign: ${(codesign.stderr || '').trim().split('\n')[0] || 'not signed'}` };
  }
  const spctl = spawnSync('spctl', ['--assess', '--type', 'install', '--verbose=2', file], { encoding: 'utf8' });
  const notarized = /source=Notarized Developer ID/.test(`${spctl.stdout || ''}${spctl.stderr || ''}`);
  return {
    signed: true,
    notarized,
    detail: notarized ? 'signed + notarized' : 'signed (공증 확인 안 됨 — 공개 배포에는 공증이 필요하다)',
  };
}

function check(file) {
  if (process.platform === 'win32') return checkWindows(file);
  if (process.platform === 'darwin') return checkMac(file);
  return { signed: false, detail: `이 플랫폼(${process.platform})에서는 검사할 수 없습니다.`, skipped: true };
}

const artifacts = listArtifacts();
if (artifacts.length === 0) {
  console.log('검사할 산출물이 dist에 없습니다. 먼저 빌드하세요.');
  process.exit(require_ ? 1 : 0);
}

let unsigned = 0;
let skipped = 0;
for (const file of artifacts) {
  const result = check(file);
  if (result.skipped) { skipped += 1; console.log(`  ?  ${path.basename(file)} — ${result.detail}`); continue; }
  if (result.signed) console.log(`  OK ${path.basename(file)} — ${result.detail}`);
  else { unsigned += 1; console.log(`  !! ${path.basename(file)} — 미서명 (${result.detail})`); }
}

console.log(`\n산출물 ${artifacts.length}건 · 미서명 ${unsigned}건${skipped ? ` · 검사 불가 ${skipped}건` : ''}`);

if (unsigned === 0 && skipped === 0) {
  console.log('SIGNATURE_CHECK_PASS');
  process.exit(0);
}
if (require_) {
  console.error('\n서명이 필요한 배포입니다. 인증서 설정을 확인하세요 — docs/project/code-signing.md');
  process.exit(1);
}
console.log('경고: 미서명 산출물이 있습니다. 폐쇄 알파에서만 허용됩니다 (CLAW-95).');
process.exit(0);
