const { spawnSync } = require("node:child_process");
const { readdirSync } = require("node:fs");
const path = require("node:path");

const testDir = __dirname;
const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join(testDir, name));

if (files.length === 0) {
  console.error("No test/*.test.js files found.");
  process.exit(1);
}

// --test-force-exit: 테스트가 끝나면 남은 핸들을 기다리지 않고 종료한다 (CLAW-122).
//
// 이게 없으면 스위트가 test/mobile-preview-server.test.js에서 멎는다 — 그 파일이 테스트 종료
// 후에도 리스너·WebSocket을 붙잡아 프로세스가 끝나지 않는다. 알파벳 순서상 그 지점 이후 파일은
// 아예 실행되지 않아, 실패가 있어도 CI가 볼 수 없었다.
// 누수 자체(after 훅의 정리 누락)는 별개로 고쳐야 한다. 이 플래그는 한 파일의 누수가 전체
// 스위트를 무력화하지 못하게 막는 안전장치다.
//
// --test-timeout: 개별 테스트가 무한 대기하면 그 테스트만 실패로 끊는다. 정상적으로 느린 파일이
// 20초대까지 있어(focus-mac-extras·gemini-log-monitor) 넉넉히 60초로 둔다.
const result = spawnSync(process.execPath, ["--test", "--test-force-exit", "--test-timeout=60000", ...files], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
