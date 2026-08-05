"use strict";
// 광고 패널 폭 결정 (CLAW-156).
//
// 창이 곧 패널이라 짧은 광고에도 창이 정책 상한(maxWidthPx)으로 떠서 2행만 오른쪽 끝에
// 붙어 있었다. 렌더러가 잰 내용 폭을 받아 창을 좁힌다.
//
// 순수 함수로 뺀 이유: clawad-ad-window.js는 BrowserWindow·ipcMain에 묶여 있어 단위 테스트가
// 어렵다. 실제 판단은 전부 여기 있으므로 여기만 검증하면 된다.

/**
 * 내용이 짧아도 이 아래로는 줄이지 않는다. 2행(광고주 + 적립 현황)이 실제로 자리를 차지하므로
 * 광고 문구가 아무리 짧아도 여기가 바닥이다. 측정이 이보다 작으면 2행이 잘린 것이라 믿지 않는다.
 */
const MIN_AD_WIDTH = 240;
/**
 * 이 폭 미만의 변화는 무시한다. 광고가 adRotateMs(15초)마다 바뀌는데 몇 px씩 따라 움직이면
 * 창이 흔들려 보인다.
 */
const AD_WIDTH_STEP_PX = 16;

/**
 * 안내 문구를 띄울 때의 창 폭 상한. 정책값 maxWidthPx는 광고 표시 폭이고, 미로그인 상태에는
 * 정책 캐시 자체가 없다(정책은 sync가 받아오는데 sync는 로그인이 필요하다) — 안내에까지
 * 정책값을 요구하면 로그인 안내를 영영 못 띄운다.
 *
 * **우리 안내 문구가 필요로 하는 폭보다 좁으면 안 된다.** 320px이던 동안
 * "로그인하면 광고가 표시되고 리워드가 적립돼요!"(자연 폭 329px)가 항상 잘렸다 —
 * 미로그인 사용자가 처음 보는 문구다. 실제 폭은 렌더러 실측값이 정하고 이 값은 상한일 뿐이라
 * 광고 정책 기본값과 같은 자리에 둔다. clawad-ad-notices.test.js가 문구 길이를 여기에 맞춰 검사한다.
 */
const NOTICE_MAX_WIDTH = 420;

/**
 * 실제로 쓸 논리 폭. 측정값이 없으면(첫 표시·구 렌더러) 상한을 그대로 쓴다 —
 * 좁아지지 않을 뿐 표시가 깨지지는 않는다.
 */
function clampWidth(contentWidthPx, maxWidthPx) {
  const cap = Math.min(maxWidthPx, 720);
  if (!Number.isFinite(contentWidthPx) || contentWidthPx <= 0) return cap;
  return Math.min(cap, Math.max(MIN_AD_WIDTH, Math.ceil(contentWidthPx)));
}

/**
 * 새로 잰 폭을 채택할지. 첫 측정은 항상 채택한다.
 * 하한 이하로 내려가는 변화는 임계값과 무관하게 채택한다 — 하한에 붙여야 더 흔들리지 않는다.
 *
 * **임계값은 좁히는 변화에만 건다.** 넓히는 변화까지 막으면 창이 좁은 채로 남고, 창이 곧
 * 패널이라 그만큼 문구가 말줄임된다 — 흔들림을 막으려다 글자를 잘라 먹는다. 실제로 안내 문구
 * 회전(350 → 365px)이 임계값 16px에 1px 모자란 15px이라 거절돼, "작업하는 동안에만 광고가
 * 표시되며 리워드가 적립돼요"가 회전마다 잘렸다. 문구 길이가 조금만 바뀌어도 재발하는 자리다.
 *
 * 좁히는 쪽만 남겨도 목적은 지켜진다: 넓힐 때는 어차피 내용이 그만큼 필요해서 넓히는 것이고,
 * 좁힐 때는 안 좁혀도 표시가 깨지지 않으므로 참을 수 있다.
 */
function shouldAdopt(nextPx, currentPx) {
  if (!Number.isFinite(nextPx) || nextPx <= 0) return false;
  if (!Number.isFinite(currentPx)) return true;
  if (nextPx <= MIN_AD_WIDTH) return currentPx > MIN_AD_WIDTH;
  if (nextPx > currentPx) return true;
  return currentPx - nextPx >= AD_WIDTH_STEP_PX;
}

/**
 * 패널 높이(논리 픽셀). 실측값이다 — 본문 두 번째 줄과 metadata가 둘째 행을 공유하고,
 * 패널 상하 패딩과 body 상하 여백까지 포함한다 (CLAW-169).
 */
const NOTICE_STRIP_HEIGHT = 55;
/** 문구 한 줄 높이. clawad-ad.html의 `#text { line-height }`와 같은 값이어야 한다. */
const TEXT_LINE_HEIGHT = 17;
/** 기존 소비자 호환용 이름. 모든 표시 종류가 같은 두 행 높이를 쓴다. */
const AD_STRIP_HEIGHT = NOTICE_STRIP_HEIGHT;

/**
 * 표시 종류와 무관한 공통 두 행 패널 높이 (CLAW-169).
 * `kind` 인자는 구 호출자와의 호환을 위해 받지만 높이 결정에는 쓰지 않는다.
 */
function stripHeight() {
  return NOTICE_STRIP_HEIGHT;
}

module.exports = {
  MIN_AD_WIDTH,
  AD_WIDTH_STEP_PX,
  NOTICE_MAX_WIDTH,
  NOTICE_STRIP_HEIGHT,
  AD_STRIP_HEIGHT,
  TEXT_LINE_HEIGHT,
  clampWidth,
  shouldAdopt,
  stripHeight,
};
