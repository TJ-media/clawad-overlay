// test/userdata-migration.test.js — src/userdata-migration.js 단위 테스트 (CLAW-155)
const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  LEGACY_DIR_NAME,
  planUserDataMigration,
  migrateUserDataDir,
} = require("../src/userdata-migration");

const CURRENT = "Claw-Ad";

// 실제 임시 디렉터리로 확인한다 — 이 코드의 값어치는 파일이 정말 옮겨지는지에 있다.
function makeAppData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claw155-"));
}

function seedLegacy(appDataDir, files = { "clawd-prefs.json": '{"lang":"ko"}' }) {
  const dir = path.join(appDataDir, LEGACY_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return dir;
}

describe("planUserDataMigration()", () => {
  const exists = () => true;
  const isEmptyDir = () => false;

  it("이름이 아직 포크 원본이면 자기 자신으로 옮기지 않는다", () => {
    assert.strictEqual(
      planUserDataMigration({ appDataDir: "/tmp", currentDirName: LEGACY_DIR_NAME, exists, isEmptyDir }),
      null
    );
  });

  it("인자가 비면 아무 계획도 세우지 않는다", () => {
    assert.strictEqual(planUserDataMigration({ appDataDir: "", currentDirName: CURRENT, exists, isEmptyDir }), null);
    assert.strictEqual(planUserDataMigration({ appDataDir: "/tmp", currentDirName: "", exists, isEmptyDir }), null);
  });

  it("구 디렉터리가 없으면(신규 설치) 옮길 것이 없다", () => {
    assert.strictEqual(
      planUserDataMigration({ appDataDir: "/tmp", currentDirName: CURRENT, exists: () => false, isEmptyDir }),
      null
    );
  });

  it("새 디렉터리에 내용이 있으면 이미 이전된 것으로 보고 건드리지 않는다", () => {
    assert.strictEqual(planUserDataMigration({ appDataDir: "/tmp", currentDirName: CURRENT, exists, isEmptyDir }), null);
  });

  it("새 디렉터리가 비어 있으면 치우고 옮기도록 계획한다", () => {
    const plan = planUserDataMigration({
      appDataDir: "/tmp",
      currentDirName: CURRENT,
      exists,
      isEmptyDir: () => true,
    });
    assert.strictEqual(plan.removeEmptyTarget, true);
  });
});

describe("migrateUserDataDir()", () => {
  it("구 디렉터리를 통째로 옮기고 내용을 보존한다", () => {
    const appDataDir = makeAppData();
    seedLegacy(appDataDir, {
      "clawd-prefs.json": '{"lang":"ko"}',
      ".updaterId": "abc",
      "themes/my-theme/theme.json": "{}", // 사용자가 설치한 테마도 같이 따라와야 한다
    });

    const plan = migrateUserDataDir({ appDataDir, currentDirName: CURRENT });

    assert.ok(plan, "이전 계획이 수행돼야 한다");
    const moved = path.join(appDataDir, CURRENT);
    assert.strictEqual(fs.readFileSync(path.join(moved, "clawd-prefs.json"), "utf8"), '{"lang":"ko"}');
    assert.strictEqual(fs.readFileSync(path.join(moved, ".updaterId"), "utf8"), "abc");
    assert.ok(fs.existsSync(path.join(moved, "themes", "my-theme", "theme.json")));
    assert.ok(!fs.existsSync(path.join(appDataDir, LEGACY_DIR_NAME)), "구 디렉터리는 남지 않는다");
  });

  it("Electron이 새 이름의 빈 디렉터리를 선점해도 이전한다", () => {
    const appDataDir = makeAppData();
    seedLegacy(appDataDir);
    fs.mkdirSync(path.join(appDataDir, CURRENT)); // 빈 채로 선점

    assert.ok(migrateUserDataDir({ appDataDir, currentDirName: CURRENT }));
    assert.strictEqual(
      fs.readFileSync(path.join(appDataDir, CURRENT, "clawd-prefs.json"), "utf8"),
      '{"lang":"ko"}'
    );
  });

  it("새 디렉터리에 이미 설정이 있으면 덮어쓰지 않는다", () => {
    const appDataDir = makeAppData();
    seedLegacy(appDataDir, { "clawd-prefs.json": '{"lang":"ko"}' });
    fs.mkdirSync(path.join(appDataDir, CURRENT));
    fs.writeFileSync(path.join(appDataDir, CURRENT, "clawd-prefs.json"), '{"lang":"en"}');

    assert.strictEqual(migrateUserDataDir({ appDataDir, currentDirName: CURRENT }), null);
    assert.strictEqual(
      fs.readFileSync(path.join(appDataDir, CURRENT, "clawd-prefs.json"), "utf8"),
      '{"lang":"en"}',
      "쓰이고 있는 설정을 구 설정으로 덮으면 안 된다"
    );
  });

  it("신규 설치에서는 아무 디렉터리도 만들지 않는다", () => {
    const appDataDir = makeAppData();
    assert.strictEqual(migrateUserDataDir({ appDataDir, currentDirName: CURRENT }), null);
    assert.deepStrictEqual(fs.readdirSync(appDataDir), []);
  });

  it("이전에 실패해도 예외를 던지지 않는다 — 앱은 떠야 한다", () => {
    const appDataDir = makeAppData();
    seedLegacy(appDataDir);
    const logged = [];
    const fsImpl = {
      existsSync: (target) => fs.existsSync(target),
      readdirSync: (target) => fs.readdirSync(target),
      rmdirSync: () => {},
      renameSync: () => {
        throw new Error("EPERM: 실행 중인 인스턴스가 파일을 잡고 있다");
      },
    };

    assert.strictEqual(
      migrateUserDataDir({ appDataDir, currentDirName: CURRENT, fsImpl, log: (m) => logged.push(m) }),
      null
    );
    assert.match(logged.join("\n"), /CLAW-155/);
    assert.ok(fs.existsSync(path.join(appDataDir, LEGACY_DIR_NAME)), "실패 시 구 디렉터리는 남아 복구할 수 있다");
  });

  it("두 번 호출해도 안전하다(멱등)", () => {
    const appDataDir = makeAppData();
    seedLegacy(appDataDir);

    assert.ok(migrateUserDataDir({ appDataDir, currentDirName: CURRENT }));
    assert.strictEqual(migrateUserDataDir({ appDataDir, currentDirName: CURRENT }), null);
    assert.strictEqual(
      fs.readFileSync(path.join(appDataDir, CURRENT, "clawd-prefs.json"), "utf8"),
      '{"lang":"ko"}'
    );
  });
});
