const assert = require("node:assert");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { minimatch } = require("minimatch");

const pkg = require("../package.json");
const ROOT = path.join(__dirname, "..");

function matchedByAnyGlob(globs, target) {
  return globs.some((g) => minimatch(target, g));
}

describe("package build config", () => {
  it("ships project window icons in packaged builds", () => {
    assert.ok(
      pkg.build.files.includes("assets/icons/**/*"),
      "build.files should include assets/icons/**/*"
    );
  });

  it("ships agent session icons in packaged builds", () => {
    assert.ok(
      pkg.build.files.includes("assets/icons/agents/**/*"),
      "build.files should include assets/icons/agents/**/*"
    );
  });

  it("ships third-party notices in packaged builds", () => {
    assert.ok(
      pkg.build.files.includes("NOTICE.md"),
      "build.files should include NOTICE.md"
    );
  });

  it("unpacks built-in theme assets so the folder can be opened from settings", () => {
    assert.ok(
      pkg.build.asarUnpack.includes("assets/svg/**/*"),
      "asarUnpack should include assets/svg/**/*"
    );
    assert.ok(
      pkg.build.files.includes("assets/accessories/**/*"),
      "build.files should include assets/accessories/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("assets/accessories/**/*"),
      "asarUnpack should include assets/accessories/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("themes/**/*"),
      "asarUnpack should include themes/**/*"
    );
  });

  it("ships and unpacks runtime files required by external hook scripts", () => {
    assert.ok(
      pkg.build.files.includes("hooks/**/*"),
      "build.files should include hooks/**/*"
    );
    assert.ok(
      pkg.build.files.includes("extensions/**/*"),
      "build.files should include extensions/**/*"
    );
    assert.ok(
      pkg.build.files.includes("agents/**/*"),
      "build.files should include agents/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("agents/**/*"),
      "asarUnpack should include agents/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("hooks/**/*"),
      "asarUnpack should include hooks/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("extensions/**/*"),
      "asarUnpack should include extensions/**/*"
    );
  });

  it("unpacks jsonc-parser for NSIS cleanup scripts executed outside app.asar", () => {
    assert.ok(
      pkg.build.asarUnpack.includes("node_modules/jsonc-parser/**/*"),
      "NSIS runs cleanup-integrations.js from app.asar.unpacked, so MiMo JSONC cleanup needs an unpacked dependency"
    );
  });

  describe("Windows architecture targets", () => {
    function getWindowsNsisTarget() {
      const targets = pkg.build.win && pkg.build.win.target;
      return Array.isArray(targets) ? targets.find((target) => target && target.target === "nsis") : null;
    }

    it("builds native Windows installers for x64 and arm64", () => {
      const target = getWindowsNsisTarget();
      assert.ok(target, "build.win.target should include an nsis target");
      assert.deepStrictEqual(
        target.arch.slice().sort(),
        ["x64", "arm64"].slice().sort(),
        "Windows NSIS builds should publish both x64 and ARM64 installers"
      );
    });

    it("uses architecture-specific Windows installer names", () => {
      const artifactName = pkg.build.win && pkg.build.win.artifactName;
      assert.strictEqual(
        typeof artifactName,
        "string",
        "build.win.artifactName should be a string"
      );
      assert.match(
        artifactName,
        /\$\{arch\}/,
        "Windows artifactName must include ${arch} so x64 and ARM64 installers cannot collide"
      );
    });

    it("exposes explicit Windows architecture build scripts", () => {
      assert.strictEqual(pkg.scripts["build:win:x64"], "electron-builder --win nsis:x64");
      assert.strictEqual(pkg.scripts["build:win:arm64"], "electron-builder --win nsis:arm64");
      assert.strictEqual(pkg.scripts["build:win:all"], "electron-builder --win nsis:x64 nsis:arm64");
    });

    it("does not emit a redundant universal Windows installer", () => {
      assert.strictEqual(
        pkg.build.nsis && pkg.build.nsis.buildUniversalInstaller,
        false,
        "Windows releases should publish explicit x64/ARM64 installers, not an extra universal NSIS installer"
      );
    });
  });

  // 사용자가 내려받는 파일명은 제품명과 같아야 한다. artifactName이 템플릿이 아니라
  // 하드코딩 문자열이라 CLAW-126 브랜딩 교체에서 빠져 있었다 (CLAW-131).
  describe("배포 산출물 이름 브랜딩", () => {
    it("productName과 appId가 클로애드 것이다", () => {
      assert.strictEqual(pkg.build.productName, "Claw-Ad");
      assert.strictEqual(pkg.build.appId, "ai.clawad.overlay");
    });

    it("모든 플랫폼 artifactName에 포크 원본 제품명이 남아 있지 않다", () => {
      for (const platform of ["win", "mac", "linux"]) {
        const name = pkg.build[platform] && pkg.build[platform].artifactName;
        assert.strictEqual(typeof name, "string", `build.${platform}.artifactName이 없다`);
        assert.doesNotMatch(
          name,
          /clawd/i,
          `build.${platform}.artifactName에 원본 제품명이 남아 있다: ${name}`
        );
        assert.match(name, /^Claw-Ad/, `build.${platform}.artifactName은 Claw-Ad로 시작해야 한다: ${name}`);
      }
    });
  });

  describe("macOS architecture targets", () => {
    function getMacDmgTarget() {
      const targets = pkg.build.mac && pkg.build.mac.target;
      return Array.isArray(targets) ? targets.find((target) => target && target.target === "dmg") : null;
    }

    it("builds native macOS DMGs for x64 and arm64", () => {
      const target = getMacDmgTarget();
      assert.ok(target, "build.mac.target should include a dmg target");
      assert.deepStrictEqual(
        target.arch.slice().sort(),
        ["x64", "arm64"].slice().sort(),
        "macOS builds should publish both x64 and ARM64 DMGs"
      );
    });

    it("uses architecture-specific macOS DMG names without spaces", () => {
      const artifactName = pkg.build.mac && pkg.build.mac.artifactName;
      assert.strictEqual(
        typeof artifactName,
        "string",
        "build.mac.artifactName should be a string"
      );
      assert.match(
        artifactName,
        /\$\{arch\}/,
        "macOS artifactName must include ${arch} so x64 and ARM64 DMGs cannot collide"
      );
      assert.doesNotMatch(
        artifactName,
        /\s/,
        "macOS artifactName should not contain spaces so latest-mac.yml URLs match uploaded DMG assets"
      );
    });
  });

  describe("Linux artifact targets", () => {
    it("uses Linux artifact names without spaces so latest-linux.yml URLs match uploaded assets", () => {
      const artifactName = pkg.build.linux && pkg.build.linux.artifactName;
      assert.strictEqual(
        typeof artifactName,
        "string",
        "build.linux.artifactName should be a string"
      );
      assert.match(
        artifactName,
        /\$\{arch\}/,
        "Linux artifactName should include ${arch} so architecture-specific assets stay explicit"
      );
      assert.doesNotMatch(
        artifactName,
        /\s/,
        "Linux artifactName should not contain spaces so latest-linux.yml URLs match uploaded assets"
      );
    });
  });

  // getWindowsShellIconPath has a three-step fallback:
  //   1. resourcesPath/icon.ico            ← extraResources copy
  //   2. resourcesPath/app.asar.unpacked/assets/icon.ico
  //   3. resourcesPath/app.asar/assets/icon.ico
  // Fallback 1 only works if extraResources actually copies icon.ico, and
  // fallback 3 only works if icon.ico is inside build.files. Guard both so a
  // future refactor to either array can't silently drop the shell icon.
  describe("Windows shell icon fallback chain", () => {
    it("has the source icon.ico on disk", () => {
      const src = path.join(ROOT, "assets", "icon.ico");
      assert.ok(fs.existsSync(src), "assets/icon.ico must exist for build.win.icon + extraResources");
    });

    it("copies icon.ico into resourcesPath via extraResources", () => {
      const extra = pkg.build.extraResources || [];
      const copied = extra.some(
        (e) => e && e.from === "assets/icon.ico" && e.to === "icon.ico"
      );
      assert.ok(copied, "build.extraResources must copy assets/icon.ico → icon.ico (shell fallback 1)");
    });

    it("wires win.icon to the same source file", () => {
      assert.strictEqual(
        pkg.build.win && pkg.build.win.icon,
        "assets/icon.ico",
        "build.win.icon should point at the same file the shell icon chain expects"
      );
    });

    it("packs icon.ico into the asar so fallback 3 resolves", () => {
      // getWindowsShellIconPath's third fallback reads
      // resourcesPath/app.asar/assets/icon.ico — which only exists if the
      // file survives the build.files glob filter. Earlier versions listed
      // only assets/icons/**/* (subdir), which does NOT match assets/icon.ico
      // at the root, so fallback 3 was dead. Guard against that regression.
      assert.ok(
        matchedByAnyGlob(pkg.build.files, "assets/icon.ico"),
        "build.files must include a glob covering assets/icon.ico (fallback 3)"
      );
    });
  });

  // CLAW-89에서 사이드카 의존을, CLAW-129에서 원격 승인 기능 자체를 제거했다 (FORK.md §4).
  // 아래 단정은 전부 "돌아오지 않는지"를 지키는 역방향 가드다.
  describe("원격 승인 사이드카 잔재 방지", () => {
    it("must not preflight sidecar binaries before source launches", () => {
      assert.doesNotMatch(
        pkg.scripts.start,
        /sidecar/i,
        "npm start must not fetch sidecar binaries from an external release"
      );
    });

    it("must not copy sidecars into packaged resources", () => {
      const extra = pkg.build.extraResources || [];
      const copied = extra.some(
        (e) => e && typeof e.from === "string" && /sidecar|cc-connect/i.test(e.from)
      );
      assert.ok(
        !copied,
        "build.extraResources must not ship sidecar binaries — packaging stays free of unsigned third-party executables"
      );
    });

    it("keeps no sidecar fetch/verify scripts in package.json", () => {
      const names = Object.keys(pkg.scripts || {}).filter((k) => /sidecar/i.test(k));
      assert.deepEqual(names, [], `사이드카 스크립트가 남아 있다: ${names.join(", ")}`);
    });

    it("keeps release workflows free of sidecar steps", () => {
      for (const name of ["build.yml", "wayland-smoke.yml"]) {
        const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", name), "utf8");
        assert.doesNotMatch(workflow, /sidecar/i, `${name}에 사이드카 단계가 남아 있다`);
      }
    });
  });

  // electron-builder는 서명 자격이 없으면 조용히 건너뛰고 빌드를 성공으로 끝낸다.
  // 그래서 (1) 태그 릴리스는 산출물 검사를 강제하고 (2) 서명 경로는 forceCodeSigning으로
  // 실패를 드러낸다. 이 두 가드가 사라지면 미서명 산출물이 조용히 게시된다 (CLAW-95).
  describe("코드서명 파이프라인 가드", () => {
    const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build.yml"), "utf8");

    it("서명 검증 스크립트가 package.json에 있다", () => {
      assert.strictEqual(pkg.scripts["verify:signature"], "node scripts/verify-signature.js");
      assert.strictEqual(pkg.scripts["verify:signature:require"], "node scripts/verify-signature.js --require");
      assert.ok(fs.existsSync(path.join(ROOT, "scripts", "verify-signature.js")), "검증 스크립트 파일이 없다");
    });

    it("태그 릴리스는 미서명 산출물을 통과시키지 않는다", () => {
      const gated = workflow.split("\n").some((line, index, lines) => {
        if (!line.includes("verify:signature:require")) return false;
        // 바로 위 줄의 조건이 태그 릴리스여야 한다.
        return (lines[index - 1] || "").includes("refs/tags/v");
      });
      assert.ok(gated, "verify:signature:require가 태그 릴리스 조건 아래에 있어야 한다");
    });

    it("서명 빌드는 실패를 숨기지 않는다", () => {
      assert.match(
        pkg.scripts["build:win:x64:signed"] || "",
        /--config\.forceCodeSigning=true/,
        "서명 빌드에 forceCodeSigning이 없으면 서명 실패가 조용히 넘어간다"
      );
      assert.match(workflow, /--config\.forceCodeSigning=true/, "CI 서명 경로에 forceCodeSigning이 없다");
    });

    it("서명 자격을 레포에 담지 않는다", () => {
      // 값은 GitHub 시크릿·환경변수로만 들어온다 (규칙 [SECURITY]).
      const signed = pkg.scripts["build:win:x64:signed"] || "";
      for (const name of ["AZURE_SIGN_ENDPOINT", "AZURE_SIGN_ACCOUNT", "AZURE_SIGN_PROFILE", "AZURE_SIGN_PUBLISHER"]) {
        assert.match(signed, new RegExp(`\\$\\{env\\.${name}\\}`), `${name}을 환경변수로 받지 않는다`);
      }
      assert.doesNotMatch(signed, /-----BEGIN|\.pfx|\.p12/, "인증서 파일 경로나 키가 스크립트에 박혀 있다");
      assert.strictEqual(pkg.build.win.certificateFile, undefined, "인증서 파일을 빌드 설정에 박지 않는다");
      assert.strictEqual(pkg.build.win.certificatePassword, undefined, "인증서 비밀번호를 빌드 설정에 박지 않는다");
    });

    it("publishes GitHub releases only for version tags", () => {
      const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build.yml"), "utf8");
      const releaseIndex = findWorkflowJobIndex(workflow, "release");
      assert.ok(releaseIndex >= 0, "workflow should define a release job");
      const releaseGateIndex = workflow.indexOf("if: startsWith(github.ref, 'refs/tags/v')", releaseIndex);
      const bodyPathIndex = workflow.indexOf("body_path: docs/releases/release-${{ github.ref_name }}.md", releaseIndex);
      assert.ok(releaseGateIndex >= 0, "release job should be gated to v* tags");
      assert.ok(bodyPathIndex >= 0, "release job should still use tag-specific release notes");
      assert.ok(releaseGateIndex < bodyPathIndex, "release job gate should run before release publication");
    });

    it("creates tag releases as drafts for final asset inspection", () => {
      const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build.yml"), "utf8");
      const releaseIndex = findWorkflowJobIndex(workflow, "release");
      assert.ok(releaseIndex >= 0, "workflow should define a release job");
      const actionIndex = workflow.indexOf("softprops/action-gh-release@v2", releaseIndex);
      const draftIndex = workflow.indexOf("draft: true", actionIndex);
      const prereleaseIndex = workflow.indexOf("prerelease: ${{ contains(github.ref_name, '-') }}", actionIndex);
      assert.ok(actionIndex >= 0, "release job should use the GitHub release action");
      assert.ok(draftIndex > actionIndex, "tag releases should be created as drafts first");
      assert.ok(prereleaseIndex > actionIndex, "hyphenated tags should be marked prerelease");
    });
  });

  // CLAW-155 — 사용자에게 보이는 경로에 포크 원본 이름이 돌아오지 못하게 하는 가드.
  // Electron은 app.getName()을 최상위 productName → name 순으로 정하고, userData 디렉터리
  // 이름이 거기서 파생된다. build.productName은 번들 이름에만 반영되므로 이것을 대신하지 못한다.
  describe("app name derived paths", () => {
    it("derives the runtime app name from a top-level productName", () => {
      assert.strictEqual(
        pkg.productName,
        pkg.build.productName,
        "top-level productName should match build.productName so the bundle and userData agree"
      );
    });

    it("keeps the fork's original name out of the userData directory name", () => {
      assert.ok(
        !String(pkg.productName || "").includes("clawd-on-desk"),
        "userData directory name must not expose the fork's original name"
      );
    });
  });
});

function findWorkflowJobIndex(workflow, jobName) {
  const match = String(workflow || "").match(new RegExp(`(?:^|\\r?\\n)  ${jobName}:\\r?\\n`));
  return match ? match.index : -1;
}
