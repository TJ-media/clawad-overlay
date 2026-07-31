"use strict";
// 광고가 아닌 안내 문구 (CLAW-138 후속).
//
// 이 파일의 문구는 **전부 로컬 상수**다. 서버에서 온 문자열은 여기에 들어오지 않는다 —
// 그래야 `[광고]` 표기 없이 화면에 나가는 문자열이 광고일 수 없다 (CLAUDE.md §4).
// 광고 문구는 clawad-ad-runtime.js가 다루고, 그쪽 payload에는 항상 [광고]가 붙는다.
//
// Anthropic·Claude Code 공식 메시지로 오인될 문구를 쓰지 않는다 (§4). 주체는 클로애드다.

/**
 * 안내 문구 회전 간격. 정책값이 아니라 UI 리듬이다 — 안내는 광고가 아니라서 노출 정책·
 * 과금과 무관하고, 정책 캐시가 없는 미로그인 상태에서도 돌아야 한다.
 */
const NOTICE_ROTATE_MS = 15000;

/** 광고 재고가 없을 때 돌려 보여주는 문구. */
const IDLE_NOTICES = [
  "지금은 표시할 광고가 없어요. 잠시 후 다시 준비돼요",
  "작업하는 동안 광고가 표시되면 리워드가 적립돼요",
  "적립 현황은 클로애드 설정에서 확인할 수 있어요",
];

/** 미로그인 안내. 누르면 로그인 흐름이 시작된다. */
const LOGIN_NOTICE = "로그인하면 광고가 표시되고 리워드가 적립돼요!";

/**
 * 오늘 광고를 다 본 상태. 2행 왼쪽(광고주 자리)에 들어가고 오른쪽에는 적립 현황이 붙는다.
 * "재고가 잠깐 없음"과 다른 상태라서 clawad가 신호를 줄 때만 쓴다 — 오버레이가 추정하지 않는다.
 */
const ADS_EXHAUSTED_NOTICE = "오늘 광고를 다 소진했어요!";

/**
 * 지금 보여줄 안내 문구. 타이머 상태를 두지 않고 시각에서 바로 계산한다 —
 * 창이 떴다 사라져도 회전이 이어지고, 재시작해도 같은 리듬을 탄다.
 */
function rotatingNotice(now = Date.now()) {
  const index = Math.floor(now / NOTICE_ROTATE_MS) % IDLE_NOTICES.length;
  return IDLE_NOTICES[index];
}

module.exports = {
  ADS_EXHAUSTED_NOTICE,
  IDLE_NOTICES,
  LOGIN_NOTICE,
  NOTICE_ROTATE_MS,
  rotatingNotice,
};
