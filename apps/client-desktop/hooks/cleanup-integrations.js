#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { unregisterHooks: unregisterClaudeHooks, unregisterClaudeStatusline } = require("./install");
const { unregisterGeminiHooks } = require("./gemini-install");
const { unregisterAntigravityHooks, unregisterAntigravityStatusline } = require("./antigravity-install");
const { unregisterCursorHooks } = require("./cursor-install");
const { unregisterCopilotHooks } = require("./copilot-install");
const { unregisterCodeBuddyHooks } = require("./codebuddy-install");
const { unregisterKiroHooks } = require("./kiro-install");
const { unregisterKimiHooks } = require("./kimi-install");
const { unregisterQwenCodeHooks } = require("./qwen-code-install");
const { unregisterCodewhaleHooks } = require("./codewhale-install");
const { unregisterCodexCommandHooks } = require("./codex-install-utils");
const { unregisterOpencodePlugin } = require("./opencode-install");
const { unregisterMimocodePlugin } = require("./mimocode-install");
const { unregisterPiExtension } = require("./pi-install");
const { unregisterOpenClawPlugin } = require("./openclaw-install");
const { resolveHermesHome, unregisterHermesPlugin } = require("./hermes-install");
const { unregisterQoderHooks } = require("./qoder-install");
const { resolveReasonixConfigTargets, unregisterReasonixHooks } = require("./reasonix-install");
const { unregisterQoderWorkHooks } = require("./qoderwork-install");
const { unregisterWorkBuddyHooks } = require("./workbuddy-install");

const CODEX_MARKERS = ["codex-hook.js", "codex-debug-hook.js"];

const MANAGED_AGENT_IDS = Object.freeze([
  "claude-code",
  "gemini-cli",
  "antigravity-cli",
  "cursor-agent",
  "copilot-cli",
  "codebuddy",
  "kiro-cli",
  "kimi-cli",
  "qwen-code",
  "codewhale",
  "codex",
  "opencode",
  "mimocode",
  "pi",
  "openclaw",
  "hermes",
  "qoder",
  "reasonix",
  "qoderwork",
  "workbuddy",
]);

const AGENT_DISPLAY_NAMES = Object.freeze({
  "claude-code": "Claude Code",
  "gemini-cli": "Gemini CLI",
  "antigravity-cli": "Antigravity CLI",
  "cursor-agent": "Cursor Agent",
  "copilot-cli": "GitHub Copilot CLI",
  codebuddy: "CodeBuddy",
  workbuddy: "WorkBuddy",
  "kiro-cli": "Kiro CLI",
  "kimi-cli": "Kimi Code",
  "qwen-code": "Qwen Code",
  codewhale: "CodeWhale",
  codex: "Codex CLI",
  opencode: "opencode",
  mimocode: "MiMo Code",
  pi: "Pi",
  openclaw: "OpenClaw",
  hermes: "Hermes Agent",
  qoder: "Qoder",
  reasonix: "Reasonix",
  qoderwork: "QoderWork",
});

function normalizeHomeDir(value) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : os.homedir();
  return path.resolve(raw);
}

function buildTargetEnv(homeDir, options = {}) {
  const env = { ...((options.env && typeof options.env === "object") ? options.env : process.env) };
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  if (typeof options.hermesHome === "string" && options.hermesHome.trim()) {
    env.HERMES_HOME = path.resolve(options.hermesHome);
  } else if (options.ignoreInheritedHermesHome) {
    delete env.HERMES_HOME;
  }
  if (typeof options.reasonixHome === "string" && options.reasonixHome.trim()) {
    env.REASONIX_HOME = path.resolve(options.reasonixHome);
  } else if (options.ignoreInheritedReasonixHome) {
    delete env.REASONIX_HOME;
  }
  if ((options.platform || process.platform) === "win32") {
    env.LOCALAPPDATA = options.localAppData || path.join(homeDir, "AppData", "Local");
    env.APPDATA = options.appData || path.join(homeDir, "AppData", "Roaming");
  }
  return env;
}

function resolveCopilotHomeForCleanup(homeDir, env, options = {}) {
  if (typeof options.copilotHome === "string" && options.copilotHome.trim()) {
    return options.copilotHome.trim();
  }
  if (env && typeof env.COPILOT_HOME === "string" && env.COPILOT_HOME.trim()) {
    return env.COPILOT_HOME.trim();
  }
  return path.join(homeDir, ".copilot");
}

function buildCleanupOptionsForHome(homeDirInput, options = {}) {
  const explicitHomeDir = Boolean(homeDirInput || options.homeDir || options.userHome);
  const homeDir = normalizeHomeDir(homeDirInput || options.homeDir || options.userHome);
  const env = buildTargetEnv(homeDir, {
    ...options,
    ignoreInheritedHermesHome: explicitHomeDir && !options.hermesHome,
    ignoreInheritedReasonixHome: explicitHomeDir && !options.reasonixHome,
  });
  const backup = options.backup !== false;
  const silent = options.silent !== false;
  const common = { backup, silent };
  const copilotHome = resolveCopilotHomeForCleanup(homeDir, env, options);
  const openClawStateDir = options.openClawStateDir
    || env.OPENCLAW_STATE_DIR
    || path.join(homeDir, ".openclaw");
  const openClawConfigPath = options.openClawConfigPath
    || env.OPENCLAW_CONFIG_PATH
    || path.join(openClawStateDir, "openclaw.json");
  const hermesHome = options.hermesHome
    || resolveHermesHome({ homeDir, env, platform: options.platform || process.platform });

  return {
    homeDir,
    env,
    common,
    byAgent: {
      "claude-code": {
        ...common,
        settingsPath: path.join(homeDir, ".claude", "settings.json"),
      },
      "gemini-cli": {
        ...common,
        settingsPath: path.join(homeDir, ".gemini", "settings.json"),
      },
      "antigravity-cli": {
        ...common,
        configPath: path.join(homeDir, ".gemini", "config", "hooks.json"),
        settingsPath: path.join(homeDir, ".gemini", "antigravity-cli", "settings.json"),
      },
      "cursor-agent": {
        ...common,
        hooksPath: path.join(homeDir, ".cursor", "hooks.json"),
      },
      "copilot-cli": {
        ...common,
        copilotHome,
        env,
        hooksPath: path.join(copilotHome, "hooks", "hooks.json"),
      },
      codebuddy: {
        ...common,
        settingsPath: path.join(homeDir, ".codebuddy", "settings.json"),
      },
      "kiro-cli": {
        ...common,
        agentsDir: path.join(homeDir, ".kiro", "agents"),
      },
      "kimi-cli": {
        ...common,
        // #563: clean both generations — legacy Kimi CLI and Kimi Code.
        settingsPaths: [
          path.join(homeDir, ".kimi", "config.toml"),
          path.join(homeDir, ".kimi-code", "config.toml"),
        ],
      },
      "qwen-code": {
        ...common,
        settingsPath: path.join(homeDir, ".qwen", "settings.json"),
      },
      codewhale: {
        ...common,
        configPath: path.join(homeDir, ".codewhale", "config.toml"),
      },
      codex: {
        ...common,
        homeDir,
        hooksPath: path.join(homeDir, ".codex", "hooks.json"),
        markers: CODEX_MARKERS,
      },
      opencode: {
        ...common,
        configPath: path.join(homeDir, ".config", "opencode", "opencode.json"),
      },
      mimocode: {
        ...common,
        configPath: path.join(homeDir, ".config", "mimocode", "mimocode.jsonc"),
      },
      pi: {
        ...common,
        parentDir: path.join(homeDir, ".pi", "agent"),
      },
      openclaw: {
        ...common,
        env,
        stateDir: openClawStateDir,
        configPath: openClawConfigPath,
        useCliFallback: false,
      },
      hermes: {
        ...common,
        env,
        homeDir,
        hermesHome,
        hermesCommand: options.hermesCommand,
      },
      qoder: {
        ...common,
        settingsPath: path.join(homeDir, ".qoder", "settings.json"),
      },
      reasonix: {
        ...common,
        settingsPaths: resolveReasonixConfigTargets({
          env,
          platform: options.platform || process.platform,
          userHomeDir: homeDir,
        }).map((target) => target.configPath),
      },
      qoderwork: {
        ...common,
        settingsPath: path.join(homeDir, ".qoderwork", "settings.json"),
      },
      workbuddy: {
        ...common,
        settingsPaths: [
          path.join(homeDir, ".workbuddy-ai", "settings.json"),
          path.join(homeDir, ".workbuddy", "settings.json"),
        ],
      },
    },
  };
}

function unregisterAntigravityIntegration(options = {}) {
  const hooks = unregisterAntigravityHooks(options);
  const statusline = unregisterAntigravityStatusline(options);
  return {
    removed: removedCountFromResult(hooks) + removedCountFromResult(statusline),
    changed: changedFromResult(hooks) || changedFromResult(statusline),
    backupPaths: [...backupPathsFromResult(hooks), ...backupPathsFromResult(statusline)],
    hooks,
    statusline,
  };
}

function unregisterClaudeIntegration(options = {}) {
  const hooks = unregisterClaudeHooks(options);
  const statusline = unregisterClaudeStatusline(options);
  return {
    removed: removedCountFromResult(hooks) + removedCountFromResult(statusline),
    changed: changedFromResult(hooks) || changedFromResult(statusline),
    backupPaths: [...backupPathsFromResult(hooks), ...backupPathsFromResult(statusline)],
    hooks,
    statusline,
  };
}

const AGENT_CLEANERS = Object.freeze({
  "claude-code": unregisterClaudeIntegration,
  "gemini-cli": unregisterGeminiHooks,
  "antigravity-cli": unregisterAntigravityIntegration,
  "cursor-agent": unregisterCursorHooks,
  "copilot-cli": unregisterCopilotHooks,
  codebuddy: unregisterCodeBuddyHooks,
  "kiro-cli": unregisterKiroHooks,
  "kimi-cli": unregisterKimiHooks,
  "qwen-code": unregisterQwenCodeHooks,
  codewhale: unregisterCodewhaleHooks,
  codex: unregisterCodexCommandHooks,
  opencode: unregisterOpencodePlugin,
  mimocode: unregisterMimocodePlugin,
  pi: unregisterPiExtension,
  openclaw: unregisterOpenClawPlugin,
  hermes: unregisterHermesPlugin,
  qoder: unregisterQoderHooks,
  reasonix: unregisterReasonixHooks,
  qoderwork: unregisterQoderWorkHooks,
  workbuddy: unregisterWorkBuddyHooks,
});

function removedCountFromResult(result) {
  if (!result || typeof result !== "object") return 0;
  if (typeof result.removed === "number") return result.removed;
  if (result.removed === true) return 1;
  return 0;
}

function changedFromResult(result) {
  if (!result || typeof result !== "object") return false;
  if (result.changed === true || result.updated === true || result.removed === true) return true;
  return removedCountFromResult(result) > 0;
}

function backupPathsFromResult(result) {
  if (!result || typeof result !== "object") return [];
  const paths = [];
  if (typeof result.backupPath === "string" && result.backupPath) paths.push(result.backupPath);
  if (Array.isArray(result.backupPaths)) {
    for (const backupPath of result.backupPaths) {
      if (typeof backupPath === "string" && backupPath) paths.push(backupPath);
    }
  }
  return paths;
}

function warningsFromResult(agentId, result) {
  const warnings = [];
  if (result && Array.isArray(result.warnings)) warnings.push(...result.warnings);
  return warnings;
}

function notesFromResult(agentId, result) {
  const notes = [];
  if (agentId === "kiro-cli" && result && result.retainedClawdAgent) {
    notes.push("Kiro clawd.json was retained; only Clawd hook entries were removed.");
  }
  return notes;
}

// 설치가 등록한 "로그인 시 자동 실행"을 되돌린다 (CLAW-228, 규칙 §8 — 제거는 설치가 바꾼 것을
// 전부 되돌린다). 이 스크립트는 Electron API 없이 도는 순수 Node 진입점이라
// app.setLoginItemSettings를 쓸 수 없다. OS가 실제로 쓰는 저장소를 직접 지운다.
//
// 경로·이름은 src/login-item.js와 Electron이 쓰는 것과 같아야 한다 —
// test/menu-autostart.test.js가 그 일치를 강제한다.
const AUTOSTART_FILE = path.join(os.homedir(), ".config", "autostart", "clawd-on-desk.desktop");
const WINDOWS_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
// Electron은 app.getName()을 값 이름으로 쓴다 — package.json의 productName이 먼저다.
// 옛 빌드의 name도 함께 지운다. 없으면 reg가 1로 끝나고, 그건 실패가 아니다.
const WINDOWS_RUN_VALUES = ["Claw-Ad", "clawd-on-desk"];

function removeLoginItem(options = {}) {
  const platform = options.platform || process.platform;
  const run = options.spawnSync || spawnSync;
  const removed = [];
  try {
    if (platform === "win32") {
      for (const name of WINDOWS_RUN_VALUES) {
        const result = run("reg", ["delete", WINDOWS_RUN_KEY, "/v", name, "/f"], {
          stdio: "ignore", windowsHide: true, shell: false,
        });
        if (result && !result.error && result.status === 0) removed.push(name);
      }
    } else if (platform !== "darwin") {
      // macOS는 번들이 사라지면 로그인 항목도 함께 정리된다 — 지울 파일이 없다.
      const file = options.autostartFile || AUTOSTART_FILE;
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        removed.push(file);
      }
    }
    return { status: "ok", removed };
  } catch (err) {
    return { status: "error", removed, message: err && err.message ? err.message : String(err) };
  }
}

function cleanupIntegrations(options = {}) {
  const plan = buildCleanupOptionsForHome(options.homeDir || options.userHome, options);
  const agents = [];
  let entriesRemoved = 0;
  let agentsAffected = 0;
  let skipped = 0;
  let failed = 0;

  for (const agentId of MANAGED_AGENT_IDS) {
    const clean = AGENT_CLEANERS[agentId];
    const cleanOptions = plan.byAgent && plan.byAgent[agentId];
    const agent = {
      agentId,
      displayName: AGENT_DISPLAY_NAMES[agentId] || agentId,
      status: "pending",
      removed: 0,
      changed: false,
      backupPaths: [],
      warnings: [],
      notes: [],
      error: null,
      result: null,
    };

    try {
      // Claude hooks + statusline may already have been unregistered through
      // the server-owned operation queue (see main.js's cleanupIntegrations
      // wrapper for #657) before this function runs. When that precomputed
      // result is provided, record it instead of unregistering Claude a
      // second time here, outside the queue.
      if (agentId === "claude-code" && Object.prototype.hasOwnProperty.call(options, "claudeCleanupResult")) {
        const result = options.claudeCleanupResult;
        if (result && result.status === "error") {
          agent.status = "failed";
          agent.error = result.message || "Claude hook queue cleanup failed";
          failed++;
        } else {
          const removed = removedCountFromResult(result);
          const changed = changedFromResult(result);
          agent.removed = removed;
          agent.changed = changed;
          agent.backupPaths = backupPathsFromResult(result);
          agent.result = result;
          if (changed || removed > 0) {
            agent.status = "applied";
            agentsAffected++;
          } else {
            agent.status = "skipped";
            skipped++;
          }
          entriesRemoved += removed;
        }
      } else if (!cleanOptions) {
        agent.status = "failed";
        agent.error = "Missing cleanup path overrides";
        failed++;
      } else if (typeof clean !== "function") {
        agent.status = "skipped";
        agent.error = "No cleaner registered";
        skipped++;
      } else {
        const result = clean(cleanOptions);
        const removed = removedCountFromResult(result);
        const changed = changedFromResult(result);
        agent.removed = removed;
        agent.changed = changed;
        agent.backupPaths = backupPathsFromResult(result);
        agent.warnings = warningsFromResult(agentId, result);
        agent.notes = notesFromResult(agentId, result);
        agent.result = result;
        if (result && result.status === "error") {
          agent.status = "failed";
          agent.error = result.message || `Failed to clean ${agent.displayName} integration`;
          failed++;
          if (changed || removed > 0) agentsAffected++;
        } else if (changed || removed > 0) {
          agent.status = "applied";
          agentsAffected++;
        } else {
          agent.status = "skipped";
          skipped++;
        }
        entriesRemoved += removed;
      }
    } catch (err) {
      agent.status = "failed";
      agent.error = err && err.message ? err.message : String(err);
      failed++;
    }
    agents.push(agent);
  }

  const loginItem = removeLoginItem(options);
  if (loginItem.status === "error") failed++;
  entriesRemoved += loginItem.removed.length;

  return {
    mode: "apply",
    homeDir: plan.homeDir,
    agents,
    loginItem,
    summary: {
      agentsChecked: agents.length,
      agentsAffected,
      entriesRemoved,
      skipped,
      failed,
    },
  };
}

function parseArgs(argv) {
  const options = { backup: true, silent: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") continue;
    if (arg === "--no-backup") {
      options.backup = false;
      continue;
    }
    if (arg === "--silent") {
      options.silent = true;
      continue;
    }
    if (arg === "--fail-open") {
      options.failOpen = true;
      continue;
    }
    if (arg === "--source") {
      options.source = argv[++i];
      continue;
    }
    if (arg === "--user-home" || arg === "--home" || arg === "--home-dir") {
      options.homeDir = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printResult(result) {
  console.log(`Clawd integration cleanup -> ${result.homeDir}`);
  for (const agent of result.agents) {
    const suffix = agent.error ? ` (${agent.error})` : "";
    console.log(`  ${agent.displayName}: ${agent.status}, removed=${agent.removed}${suffix}`);
    for (const warning of agent.warnings || []) {
      console.log(`    warning: ${warning}`);
    }
  }
  const summary = result.summary;
  console.log(
    `Summary: affected=${summary.agentsAffected}, removed=${summary.entriesRemoved}, skipped=${summary.skipped}, failed=${summary.failed}`
  );
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const result = cleanupIntegrations(options);
    if (!options.silent) printResult(result);
    if (result.summary.failed > 0 && !options.failOpen) process.exitCode = 1;
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    if (!options || !options.failOpen) process.exitCode = 1;
  }
}

module.exports = {
  AGENT_CLEANERS,
  AGENT_DISPLAY_NAMES,
  CODEX_MARKERS,
  MANAGED_AGENT_IDS,
  buildCleanupOptionsForHome,
  cleanupIntegrations,
  removeLoginItem,
  parseArgs,
};
