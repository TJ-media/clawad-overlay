"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { getAllAgents } = require("../agents/registry");
const {
  getElectronBinary,
  hashSvgSource,
  readSourceManifest,
  normalizeTextLineEndings,
  updateSvgSourceHashes,
} = require("../scripts/export-agent-icons");
const {
  getAgentIcon,
  getAgentIconUrl,
} = require("../src/state-agent-icons");

function shouldCheckRuntimeIconEntry(entry) {
  return entry.isFile() && !entry.name.startsWith(".");
}

describe("state agent icons", () => {
  it("returns undefined for BrowserWindow menu icons when nativeImage is unavailable", () => {
    assert.strictEqual(getAgentIcon("claude-code"), undefined);
  });

  it("returns null for missing agent ids and icons", () => {
    assert.strictEqual(getAgentIconUrl(null), null);
    assert.strictEqual(getAgentIconUrl(""), null);
    assert.strictEqual(getAgentIconUrl("missing-agent"), null);
    assert.strictEqual(getAgentIconUrl("../claude-code"), null);
  });

  // 번들 에이전트 아이콘(assets/icons/agents/*.png)을 실제로 읽어야 하는 테스트 5건은
  // CLAW-122에서 제거했다.
  //
  // 이유는 upstream 저작권이 아니다 — 그 아이콘은 upstream 소유가 아니고, upstream도
  // `assets/LICENSE`에서 "Copyright is retained by the respective artists"라고 밝힌다.
  // 걸리는 것은 **제3자 상표**다. Anthropic·OpenAI·Google 등 20개 벤더의 로고를
  // 변형한 PNG이며, 오버레이의 펫이 광고 표시면이라 유료 광고 옆에 벤더 로고가 붙는
  // 구도가 된다. 규칙 §7의 "공식 서비스 오인 금지"와 정면으로 만나므로 사용하지 않는다.
  //
  // 아이콘 디렉터리에 의존하지 않는 아래 순수 로직 테스트만 유지한다.
  // (예외: `openclaw.svg`는 MIT라 저작자 표시만으로 사용 가능하다 — NOTICE.md 참조.)

  it("ignores local dotfiles and directories when checking runtime icon dimensions", () => {
    const entries = [
      { name: ".DS_Store", isFile: () => true },
      { name: "scratch", isFile: () => false },
      { name: "codex.png", isFile: () => true },
    ];

    assert.deepStrictEqual(
      entries
        .filter(shouldCheckRuntimeIconEntry)
        .map((entry) => entry.name),
      ["codex.png"]
    );
  });

  it("keeps source SVG hashes aligned with the source manifest", () => {
    const expectedManifest = updateSvgSourceHashes({ svgSources: {} }, getAllAgents());
    assert.deepStrictEqual(readSourceManifest(), expectedManifest);
  });

  it("normalizes SVG source line endings before hashing", () => {
    assert.strictEqual(
      normalizeTextLineEndings("<svg>\r\n  <path />\r\n</svg>\r"),
      "<svg>\n  <path />\n</svg>\n"
    );

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-svg-hash-"));
    try {
      const lfPath = path.join(tempDir, "lf.svg");
      const crlfPath = path.join(tempDir, "crlf.svg");
      fs.writeFileSync(lfPath, "<svg>\n  <path />\n</svg>\n");
      fs.writeFileSync(crlfPath, "<svg>\r\n  <path />\r\n</svg>\r\n");
      assert.strictEqual(hashSvgSource(crlfPath), hashSvgSource(lfPath));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves the real Electron binary for the exporter entrypoint", () => {
    const electronBinary = getElectronBinary();
    assert.ok(path.isAbsolute(electronBinary), "Electron binary path should be absolute");
    if (process.platform === "win32") {
      assert.strictEqual(path.basename(electronBinary).toLowerCase(), "electron.exe");
    }
  });

  it("returns the cached URL value for repeated lookups", () => {
    const first = getAgentIconUrl("codex");
    const second = getAgentIconUrl("codex");

    assert.strictEqual(second, first);
  });
});
