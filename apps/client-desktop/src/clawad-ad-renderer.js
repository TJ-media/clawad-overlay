"use strict";
// 클로애드 광고 2행 렌더러 (CLAW-90, 2행 확장 CLAW-138).
// 문구는 반드시 textContent로만 넣는다 — 서버가 준 문자열을 마크업으로 해석하지 않는다.
// [광고] 표기는 HTML에 고정돼 있어 이 파일이 지우거나 바꾸지 않는다.

(() => {
  const strip = document.getElementById("strip");
  const text = document.getElementById("text");
  const brand = document.getElementById("brand");
  const reward = document.getElementById("reward");
  let linked = false;

  // 예상 포인트가 1 오를 때 숫자가 툭 튀지 않게 0.1씩 굴려 올린다 (CLAW-138 후속).
  //
  // **표시 전용 보간이다.** 값을 만들어내지 않는다 — 시작점도 끝점도 서버가 준 정수이고,
  // 애니메이션이 끝나면 화면에는 항상 서버 값이 정확히 그대로 남는다 (CLAUDE.md §2 [CRITICAL]).
  // 적립 판정·금액은 전부 서버가 하고, 여기서 지나가는 소수점은 화면에만 있는 중간 프레임이다.
  // 부동소수 오차로 407.9999가 남지 않게 내부는 1/10 단위 정수로만 센다.
  const TWEEN_TICK_MS = 100;
  const TENTHS_PER_STEP = 1;
  /** 이 폭을 넘는 변화는 굴리지 않고 바로 맞춘다 — 첫 표시나 밀린 sync를 몇 분씩 기어오르지 않게. */
  const TWEEN_MAX_TENTHS = 10;
  let shownTenths = null;
  let targetTenths = null;
  let tweenTimer = null;

  function stopTween() {
    if (tweenTimer === null) return;
    clearInterval(tweenTimer);
    tweenTimer = null;
  }

  /** 굴러가는 중에는 소수점 한 자리, 서버 값에 도달하면 정수로 보여준다. */
  function formatTenths(tenths) {
    return tenths % 10 === 0
      ? (tenths / 10).toLocaleString("ko-KR")
      : (tenths / 10).toFixed(1);
  }

  function paintReward(confirmed) {
    if (shownTenths === null) {
      reward.textContent = "";
      return;
    }
    reward.textContent = `예상 ${formatTenths(shownTenths)}P · 확정 ${confirmed.toLocaleString("ko-KR")}P`;
  }

  /**
   * 적립 현황 한 줄. 확정 포인트는 굴리지 않는다 — 이미 확정된 값이라 굴릴 "예상"이 아니다.
   * 확정 전 금액은 "예상"으로 명시한다 (CLAUDE.md §2).
   */
  function renderReward(value) {
    if (!value || !Number.isInteger(value.verifying) || !Number.isInteger(value.confirmed)) {
      stopTween();
      shownTenths = null;
      targetTenths = null;
      reward.textContent = "";
      return;
    }
    const confirmed = value.confirmed;
    targetTenths = value.verifying * 10;
    // 첫 표시, 감소(정산으로 확정에 넘어간 경우), 큰 점프는 굴리지 않고 바로 맞춘다.
    if (shownTenths === null || targetTenths < shownTenths || targetTenths - shownTenths > TWEEN_MAX_TENTHS) {
      stopTween();
      shownTenths = targetTenths;
      paintReward(confirmed);
      return;
    }
    paintReward(confirmed);
    if (shownTenths === targetTenths || tweenTimer !== null) return;
    tweenTimer = setInterval(() => {
      shownTenths = Math.min(shownTenths + TENTHS_PER_STEP, targetTenths);
      paintReward(confirmed);
      if (shownTenths >= targetTenths) stopTween();
    }, TWEEN_TICK_MS);
  }

  function render(ad) {
    if (!ad || typeof ad.text !== "string" || ad.text.length === 0) {
      strip.classList.remove("visible", "linked", "notice");
      text.textContent = "";
      brand.textContent = "";
      renderReward(null);
      linked = false;
      return;
    }
    text.textContent = ad.text;
    brand.textContent = typeof ad.brand === "string" && ad.brand ? ad.brand : "";
    renderReward(ad.reward);
    // 광고일 때만 [광고]를 단다. kind가 빠져 있으면 광고로 본다 — 표기가 빠지는 쪽이 아니라
    // 붙는 쪽으로 기울여야 안전하다 (CLAUDE.md §4).
    strip.classList.toggle("notice", ad.kind === "login" || ad.kind === "notice");
    // 링크 여부는 메인이 검증해서 내려준다(https만). 렌더러는 URL 자체를 다루지 않는다.
    linked = ad.linked === true;
    strip.classList.toggle("linked", linked);
    strip.classList.add("visible");
  }

  // 클릭은 "지금 표시 중인 광고를 열어달라"는 신호만 보낸다. URL은 메인이 갖고 있다.
  strip.addEventListener("click", () => {
    if (!linked || !window.clawadAdAPI || typeof window.clawadAdAPI.openAd !== "function") return;
    window.clawadAdAPI.openAd();
  });

  if (window.clawadAdAPI && typeof window.clawadAdAPI.onAd === "function") {
    window.clawadAdAPI.onAd(render);
  }
})();
