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
// 원래는 test/mobile-preview-server.test.js가 리스너·WebSocket을 붙잡아 스위트를 멈추게
// 했다. 그 기능(모바일 프리뷰)은 CLAW-129에서 제거됐지만, 한 파일의 핸들 누수가 전체
// 스위트를 무력화하지 못하게 막는 안전장치로 플래그는 유지한다.
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
