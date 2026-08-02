"use strict";

// ── 플랫폼별 셸 인용 헬퍼 ──
//
// 터미널 명령 문자열에 인자를 안전하게 끼워 넣는 순수 함수들. 시스템 터미널을
// 띄우는 경로(launch-claude.js의 "터미널로 이동")가 쓴다 — 자식 프로세스로
// 직접 실행하는 것과 달리, OS 터미널에 문자열 하나를 넘기면 그쪽이 다시
// 해석하기 때문이다.
//
// 원격 SSH 제거(CLAW-140) 전에는 remote-ssh-quote.js였다. 인용 로직 자체는
// SSH와 무관한 범용 유틸이라 이름만 바꿔 남긴다.
//
// Three helpers, three layers:
//
//   quoteForCmd(arg)               — Windows cmd.exe quoting (cmd /k uses cmd.exe)
//   quoteForPosixShellArg(arg)     — POSIX shell single-arg quoting (sh / bash / zsh)
//   escapeAppleScriptString(str)   — AppleScript double-quoted string escape
//
// macOS Authenticate / Open Terminal nests two layers:
//   1. Build the ssh command by joining args quoted with quoteForPosixShellArg.
//   2. Embed the whole command string in `do script "..."` via
//      escapeAppleScriptString.
//
// Don't pull in shell-quote — it only covers POSIX shell and would mask
// the gap on cmd / AppleScript layers.

// Windows cmd.exe quoting for command strings passed to `cmd.exe /k`.
// This is a two-stage escape:
//   1. Quote for the child process argv parser (backslashes before `"`).
//   2. Caret-escape cmd.exe's own parser chars, including `%` expansion.
// Callers should run cmd.exe with `/v:off`; `!` is still caret-escaped here
// so it stays literal when delayed expansion is disabled.
function quoteForCmd(arg) {
  if (typeof arg !== "string") {
    throw new TypeError("quoteForCmd: arg must be a string");
  }
  let out = "";
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
      out += ch;
      continue;
    }
    if (ch === '"') {
      // Per CommandLineToArgvW, each backslash before a `"` doubles, plus one to escape `"`.
      out += "\\".repeat(backslashes) + "\\\"";
      backslashes = 0;
      continue;
    }
    backslashes = 0;
    out += ch;
  }
  // Closing quote sees `backslashes` trailing backslashes; double them.
  const quoted = '"' + out + "\\".repeat(backslashes) + '"';
  let escaped = "";
  for (const ch of quoted) {
    if (ch === '"') {
      escaped += '^"';
    } else if (ch === "^" || ch === "%" || ch === "!" || ch === "&" || ch === "|" || ch === "<" || ch === ">") {
      escaped += "^" + ch;
    } else {
      escaped += ch;
    }
  }
  return escaped;
}

// POSIX shell single-quote quoting: '...''...'...' style.
// Single quotes are absolute in POSIX sh — only `'` itself can't appear
// inside, so we close-quote, escape with `\'`, re-open. Always wraps
// even safe args; predictable beats clever.
function quoteForPosixShellArg(arg) {
  if (typeof arg !== "string") {
    throw new TypeError("quoteForPosixShellArg: arg must be a string");
  }
  if (arg === "") return "''";
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

// AppleScript double-quoted string escape.
// AppleScript strings only need `\` and `"` escaped; everything else is
// literal. The result must be embedded inside `"..."` by the caller.
//
// Why a separate helper from POSIX quoting: AppleScript runs the
// resulting string through its own parser before handing it to a shell
// (`do script` execs in Terminal.app's login shell). So the macOS
// Authenticate path is two-layer:
//
//   const cmd = ["ssh", "-i", path, host].map(quoteForPosixShellArg).join(" ");
//   const applied = `do script "${escapeAppleScriptString(cmd)}"`;
//   spawn("osascript", ["-e", applied]);
function escapeAppleScriptString(str) {
  if (typeof str !== "string") {
    throw new TypeError("escapeAppleScriptString: str must be a string");
  }
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

module.exports = {
  quoteForCmd,
  quoteForPosixShellArg,
  escapeAppleScriptString,
};
