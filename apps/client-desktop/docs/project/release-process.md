# Release Process

Use this flow when preparing a Clawd app release.

## Before Tagging

1. Update `package.json` to the release version.
2. Add `docs/releases/release-vX.Y.Z.md`.
3. Run the local tests that match the change scope. For full release prep, run:

```bash
npm test
```

4. Run the `Build & Release` workflow manually on `main`.

Manual workflow dispatch builds Windows, macOS, and Linux artifacts and uploads
them. It does not publish a GitHub Release.

## Draft Release

After the manual build artifacts look good, create and push the final version
tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Pushing a `v*` tag runs the same build workflow again and creates a draft GitHub
Release with the generated installers and release notes. Draft releases are not
visible to normal users and are not consumed by the updater.

Download and smoke-test the draft release assets before publishing the draft.
If the draft is wrong, fix the issue before publishing; do not publish a known
bad draft release.

### Draft Smoke Checklist

Use the draft release installer or package artifact, not `npm start`. Windows
required items are the primary publish gate. If macOS or Linux hardware is not
available, record that platform as not real-machine validated in the release
notes.

Before launching:

- Download the draft release asset for the platform being tested.
- Confirm the packaged app metadata matches the version being released.
- Confirm packaged resources include `app.asar.unpacked/hooks`,
  `app.asar.unpacked/agents`, `app.asar.unpacked/extensions`,
  and `app.asar.unpacked/themes`.
- Confirm Windows artifacts are architecture-specific x64 / ARM64 installers,
  not a universal NSIS installer.
- For migration smoke, install v0.12.0 first and save a copy of the old
  `clawd-prefs.json` before upgrading.
- For Reasonix smoke, prepare a machine with Reasonix initialized so
  `<Reasonix home>/` exists (`%APPDATA%\reasonix` on Windows,
  `~/.reasonix` on macOS/Linux). A skipped install because Reasonix is missing
  does not validate the packaged hook path.
- For Remote SSH smoke, prepare at least one saved profile that can connect
  through an SSH reverse tunnel.

Required all-platform checks:

- Fresh install, launch, pet appears, no error dialog.
- Upgrade install over the previous release, launch, pet appears, no error dialog. Existing
  agent installation/enabled flags and user theme/animation choices remain intact.
- Settings -> About shows the released version, sourced from `app.getVersion()`.
- First-run tutorial opens once for a fresh profile; Finish, Skip, and OS close
  each persist `tutorialSeen=true` and do not reopen on restart.
- Upgrade profile with no `tutorialSeen` sees the tutorial once; an already-seen
  profile does not reopen it.
- Existing macOS users keep their previous Dock setting after upgrade; fresh
  macOS installs default to pet + menu-bar accessory with no Dock tile.
- Settings -> General / Agents / Animation & Sound render correctly in all five
  languages, including sidebar SVG icons and the folded Animation Map subtab.
- Settings -> About 하단 "원본 프로젝트" 절에 상류 유지보수자·기여자 목록이 렌더된다
  (CLAW-131). 상단 정보는 우리 저장소·저작권이어야 한다.
- Reinstall one existing hook-based agent, such as Codex, and confirm the
  packaged hook script can `require()` its dependencies.
- Run one real Claude Code or Codex session and confirm the pet reacts to state
  changes and still plays completion happy on Stop.
- Trigger a long CJK Claude or Codex completion and confirm the Stop event reaches
  Clawd without a 413 and the happy animation is not dropped.
- Codex official hook health: disable hooks / leave hooks unreviewed, confirm
  Agents badge or startup nudge reports attention, then repair/review and
  confirm it returns healthy.
- Claude hook health: delete one managed hook script and atomically replace
  `settings.json`; confirm the watcher/periodic audit repairs supported damage,
  while a still-missing declared core event is never reported as a successful Fix.
- Register two custom HTTP agents and send the same raw `session_id` from both;
  confirm Dashboard keeps separate sessions, then disable/delete one and confirm
  the other remains intact. Forged/stale `custom-` ids must be rejected.
- Install WorkBuddy against the current `~/.workbuddy-ai/settings.json` path and
  confirm state + Notification events arrive without Clawd taking over approval.
- Install MiMo Code into a commented/trailing-comma JSONC config, exercise
  Allow/Always/Deny and DND fallback, then uninstall and confirm user config is preserved.
- Settings -> Agents -> Install Reasonix succeeds on Windows when paths contain
  spaces, and the written command uses the EncodedCommand path when needed.
- Remote SSH profile with connect-on-launch connects after startup; repeat with
  local port 23333 occupied so the server binds a later port and the tunnel still
  targets the real bound port.

Recommended all-platform checks:

- Free roam: enable it, wait idle, confirm the pet moves, keeps hitbox/HUD/bubble
  alignment, and cancels on mouse move, state change, drag, mini mode, and DND.
- Dizzy spin: on the Clawd theme, circle the cursor rapidly and confirm dizzy
  triggers; repeat on Calico/Cloudling and confirm no unsupported-state glitch.
- Low-power idle mode: verify sleeping/Cloudling static sleep behavior and that
  the HUD can be reclaimed/reopened without a blank surface.
- Right-click Hide pet / Show pet still works; while hidden, a newly arriving
  permission request still shows a bubble, by design.
- Settings -> About -> Check for updates completes without an error.
- Update labels never show a duplicated prefix such as `vv0.1.0`.

Windows checks:

- Required: cold-start the packaged app twice with a saved upgrade position;
  the first rendered pet visual must appear at that position without using
  "Bring Pet to Primary Display" / "将桌宠拉回主屏".
- Required: fullscreen/borderless game or video app smoke. The pet should float
  over the fullscreen app when overlay mode is on; clicking or dragging the pet
  must not kick the app out of fullscreen.
- Required: lock/sleep/resume or display wake smoke with low-power idle enabled;
  eye tracking should recover after the renderer reports wake recovery.
- Required: drag a folder onto the pet and confirm a terminal opens in that
  directory.
- Required: right-click New Session starts Claude Code without `0x800700c1`.
- Required: prompt submission under Windows Terminal produces no visible
  PowerShell flash; cloak/sleep/display-wake recovery restores the pet and tray
  icon without a transient size jump.
- Recommended: focus jump targets the correct terminal.
- Recommended: after restart, the pet restores its saved position and Keep size
  across displays does not grow after DPI/display-scale changes.

macOS checks:

- Required when macOS hardware is available: Ghostty cross-Space focus switches
  to the target Space without yanking the Ghostty window to the current desktop.
- Required when macOS hardware is available: answer a permission with
  Ctrl+Shift+Y or Ctrl+Shift+N and confirm focus is not stolen back to the agent
  terminal.
- Required when macOS hardware is available: while editing text in a permission
  or elicitation bubble, the pet drops behind the input surface and the IME
  candidate window remains visible; ending edit restores stationary behavior.
- Recommended: jumping back to a session restores a minimized terminal window.
- Recommended: dragging a folder onto the pet does not open a terminal and does
  not crash. This is intentionally disabled on macOS.

Linux checks:

- Required when Linux hardware is available: Wayland session launches
  successfully and relaunches under XWayland when available; pet transparency
  and positioning work.
- Required when Linux hardware is available: MiMo JSONC install/uninstall keeps
  executable modes and comment-preserving writes correct on a POSIX filesystem.
- Recommended for tmux users: focus jumps to the correct tmux pane.

All required Windows items must pass before publishing the draft. Required macOS
and Linux items must pass when those machines are available. If any required
item fails, fix it and create a new draft release; do not publish a known-bad
draft.

## Sidecar Dependency

없다. 원격 승인 브리지(`cc-connect-clawd` Go 사이드카)는 CLAW-129에서 기능과 함께
제거됐고, 릴리스 빌드는 외부 바이너리를 내려받지 않는다. 되돌아오지 않는지는
`test/package-build-config.test.js`의 "원격 승인 사이드카 잔재 방지"가 지킨다.
