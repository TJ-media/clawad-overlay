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

module.exports = { MIN_AD_WIDTH, AD_WIDTH_STEP_PX, clampWidth, shouldAdopt };
