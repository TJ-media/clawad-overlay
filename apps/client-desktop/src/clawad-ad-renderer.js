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

  /**
   * 적립 현황 한 줄 (CLAW-138). 서버가 내려준 정수를 자릿수만 끊어 그대로 쓴다 —
   * 여기서 포인트를 더하거나 환산하지 않는다 (CLAUDE.md §2 [CRITICAL]).
   * 확정 전 금액은 "예상"으로 명시한다.
   */
  function rewardText(value) {
    if (!value || !Number.isInteger(value.verifying) || !Number.isInteger(value.confirmed)) return "";
    return `예상 ${value.verifying.toLocaleString("ko-KR")}P · 확정 ${value.confirmed.toLocaleString("ko-KR")}P`;
  }

  function render(ad) {
    if (!ad || typeof ad.text !== "string" || ad.text.length === 0) {
      strip.classList.remove("visible", "linked");
      text.textContent = "";
      brand.textContent = "";
      reward.textContent = "";
      linked = false;
      return;
    }
    text.textContent = ad.text;
    brand.textContent = typeof ad.brand === "string" && ad.brand ? ad.brand : "";
    reward.textContent = rewardText(ad.reward);
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
