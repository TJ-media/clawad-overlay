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
 * 실제로 쓸 논리 폭. 측정값이 없으면(첫 표시·구 렌더러) 상한을 그대로 쓴다 —
 * 좁아지지 않을 뿐 표시가 깨지지는 않는다.
 */
function clampWidth(contentWidthPx, maxWidthPx) {
  const cap = Math.min(maxWidthPx, 720);
  if (!Number.isFinite(contentWidthPx) || contentWidthPx <= 0) return cap;
  return Math.min(cap, Math.max(MIN_AD_WIDTH, Math.ceil(contentWidthPx)));
}

/**
 * 새로 잰 폭을 채택할지. 첫 측정은 항상 채택하고, 이후에는 임계값을 넘을 때만 바꾼다.
 * 하한 이하로 내려가는 변화는 임계값과 무관하게 채택한다 — 하한에 붙여야 더 흔들리지 않는다.
 */
function shouldAdopt(nextPx, currentPx) {
  if (!Number.isFinite(nextPx) || nextPx <= 0) return false;
  if (!Number.isFinite(currentPx)) return true;
  if (nextPx <= MIN_AD_WIDTH) return currentPx > MIN_AD_WIDTH;
  return Math.abs(nextPx - currentPx) >= AD_WIDTH_STEP_PX;
}

/**
 * 패널 높이(논리 픽셀). 실측값이다 — 1행 17 + 행간 2 + 2행 14 + 패널 상하 패딩 10 +
 * body 상하 여백 10 = 53에 여유 2 (CLAW-138). 줄 높이는 폰트 스택에 달려 있어 줄이면 2행이 잘린다.
 */
const NOTICE_STRIP_HEIGHT = 55;
/** 문구 한 줄 높이. clawad-ad.html의 `#text { line-height }`와 같은 값이어야 한다. */
const TEXT_LINE_HEIGHT = 17;
/** 광고만 문구를 두 줄까지 쓴다 (CLAW-162). 늘어난 줄 하나만큼만 더 잡는다. */
const AD_STRIP_HEIGHT = NOTICE_STRIP_HEIGHT + TEXT_LINE_HEIGHT;

/**
 * 표시 종류별 패널 높이 (CLAW-162).
 *
 * 광고는 두 줄이다 — 정책 상한(420px)이 운영 소재보다 좁아 한 줄로는 짧은 문구까지 전부
 * 말줄임됐다. 폭을 키워 화면을 더 차지하는 대신 세로를 한 줄 내준다.
 * 안내·로그인은 광고가 아니라 자리 채움이므로 한 줄을 유지한다.
 *
 * `kind`를 모르면(구 payload) 광고로 보지 않는다 — 높이를 과하게 잡아 빈 칸을 만들기보다
 * 기존 높이를 쓰는 쪽이 안전하다. 표기(`[광고]`) 판단과 달리 여기서는 보수적으로 간다.
 */
function stripHeight(kind) {
  return kind === "ad" ? AD_STRIP_HEIGHT : NOTICE_STRIP_HEIGHT;
}

module.exports = {
  MIN_AD_WIDTH,
  AD_WIDTH_STEP_PX,
  NOTICE_STRIP_HEIGHT,
  AD_STRIP_HEIGHT,
  TEXT_LINE_HEIGHT,
  clampWidth,
  shouldAdopt,
  stripHeight,
};
