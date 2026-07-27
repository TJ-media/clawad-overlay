"use strict";
// 오버레이 광고 한 줄 렌더러 (CLAW-90).
// 문구는 반드시 textContent로만 넣는다 — 서버가 준 문자열을 마크업으로 해석하지 않는다.
// [광고] 표기는 HTML에 고정돼 있어 이 파일이 지우거나 바꾸지 않는다.

(() => {
  const strip = document.getElementById("strip");
  const text = document.getElementById("text");
  const brand = document.getElementById("brand");

  function render(ad) {
    if (!ad || typeof ad.text !== "string" || ad.text.length === 0) {
      strip.classList.remove("visible");
      text.textContent = "";
      brand.textContent = "";
      return;
    }
    text.textContent = ad.text;
    brand.textContent = typeof ad.brand === "string" && ad.brand ? `· ${ad.brand}` : "";
    strip.classList.add("visible");
  }

  if (window.clawadAdAPI && typeof window.clawadAdAPI.onAd === "function") {
    window.clawadAdAPI.onAd(render);
  }
})();
