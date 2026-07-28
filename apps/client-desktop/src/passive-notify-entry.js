"use strict";

// Shared predicate for "passive" notification bubbles — Codex/Kimi cues that
// carry no HTTP decision channel and must never be treated as an actionable
// permission (Allow/Deny), a 원격 승인 대상 request, or an auto-approve
// target. Extracted so permission.js와 main.js가
// can't drift by hand-rolling their own exclusion list per passive type.
function isPassiveNotifyEntry(permEntry) {
  return !!(permEntry && (
    permEntry.isCodexNotify
    || permEntry.isCodexUserInputNotify
    || permEntry.isKimiNotify
  ));
}

module.exports = { isPassiveNotifyEntry };
