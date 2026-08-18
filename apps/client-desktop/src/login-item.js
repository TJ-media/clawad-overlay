"use strict";

// ── OS login item helpers ──
//
// Cross-platform "open at login" / "start on boot" plumbing.
//
//   - macOS / Windows: Electron's app.setLoginItemSettings handles it; we just
//     compute the right shape via getLoginItemSettings().
//   - Linux: Electron has no API, so we drop a .desktop file into
//     ~/.config/autostart/ ourselves (linuxGetOpenAtLogin / linuxSetOpenAtLogin).
//
// Both menu.js and main.js's settings effect/hydration paths used to inline
// these helpers. They were extracted so the new settings-actions effect for
// `openAtLogin` and `hydrateSystemBackedSettings()` in main.js can share one
// implementation. test/menu-autostart.test.js imports getLoginItemSettings
// from here.

const fs = require("fs");
const os = require("os");
const path = require("path");

const AUTOSTART_DIR = path.join(os.homedir(), ".config", "autostart");
const AUTOSTART_FILE = path.join(AUTOSTART_DIR, "clawd-on-desk.desktop");

function getLoginItemSettings({ isPackaged, openAtLogin, execPath, appPath }) {
  if (isPackaged) return { openAtLogin };
  return {
    openAtLogin,
    path: execPath,
    args: [appPath],
  };
}

/**
 * First-run decision for "open at login" (CLAW-228).
 *
 * The overlay is the only surface that shows ads, so an overlay that never
 * starts means no ads and no rewards — one reboot silently ends the service.
 * A fresh install therefore starts with login-startup ON.
 *
 * An UPGRADING user is a different case: their OS value is the truth and may be
 * a deliberate "off". Copy it rather than turning it back on. That was the
 * original reason hydration reads the system in the first place.
 *
 * Returns `enable: true` only when the caller still has to write to the OS.
 */
function firstRunOpenAtLogin({ systemValue, freshInstall }) {
  if (systemValue) return { openAtLogin: true, enable: false };
  if (freshInstall) return { openAtLogin: true, enable: true };
  return { openAtLogin: false, enable: false };
}

function linuxGetOpenAtLogin() {
  try {
    return fs.existsSync(AUTOSTART_FILE);
  } catch {
    return false;
  }
}

function linuxSetOpenAtLogin(enable, { execCmd } = {}) {
  if (enable) {
    if (!execCmd) {
      throw new Error("linuxSetOpenAtLogin: execCmd is required when enabling");
    }
    const desktop =
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=Claw-Ad",
        `Exec=${execCmd}`,
        "Hidden=false",
        "NoDisplay=false",
        "X-GNOME-Autostart-enabled=true",
      ].join("\n") + "\n";
    fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
    fs.writeFileSync(AUTOSTART_FILE, desktop);
  } else {
    try {
      fs.unlinkSync(AUTOSTART_FILE);
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err;
    }
  }
}

module.exports = {
  AUTOSTART_FILE,
  firstRunOpenAtLogin,
  getLoginItemSettings,
  linuxGetOpenAtLogin,
  linuxSetOpenAtLogin,
};
