"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "advertiser-preview-pages.yml");
const LANDING_PATH = path.join(REPO_ROOT, ".github", "pages", "index.html");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

test("광고주 미리보기 Pages 워크플로는 main의 정적 파일만 배포한다", () => {
  const workflow = readText(WORKFLOW_PATH);

  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /apps\/client-desktop\/assets\/icon\.png/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path:\s*_site/);
  assert.equal((workflow.match(/if:\s*github\.ref == 'refs\/heads\/main'/g) || []).length, 2);
  assert.match(workflow, /needs:\s*build/);
  assert.match(workflow, /name:\s*github-pages/);
  assert.match(workflow, /url:\s*\$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
  assert.deepEqual(
    workflow.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("cp ")),
    [
      "cp .github/pages/index.html _site/index.html",
      "cp apps/client-desktop/assets/icon.png _site/assets/icon.png",
      "cp -R apps/client-desktop/advertiser-preview/. _site/advertiser-preview/",
      "cp -R apps/client-desktop/themes/clawad/assets _site/themes/clawad/assets",
      "cp apps/client-desktop/themes/clawad/LICENSE _site/themes/clawad/LICENSE",
    ],
  );
  assert.doesNotMatch(workflow, /npm\s+(?:ci|install)/);
  assert.doesNotMatch(workflow, /\.nojekyll/);
});

test("Pages 루트는 광고주 미리보기 경로로 안내한다", () => {
  const landing = readText(LANDING_PATH);

  assert.match(landing, /url=advertiser-preview\//);
  assert.match(landing, /href="advertiser-preview\/"/);
  assert.match(landing, /클로애드 소재 미리보기/);
});
