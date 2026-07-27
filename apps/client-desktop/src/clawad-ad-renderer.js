"use strict";
// 클로애드 광고 한 줄 렌더러 (CLAW-90).
// 문구는 반드시 textContent로만 넣는다 — 서버가 준 문자열을 마크업으로 해석하지 않는다.
// [광고] 표기는 HTML에 고정돼 있어 이 파일이 지우거나 바꾸지 않는다.

(() => {
  const strip = document.getElementById("strip");
  const text = document.getElementById("text");
  const brand = document.getElementById("brand");
  let linked = false;

  function render(ad) {
    if (!ad || typeof ad.text !== "string" || ad.text.length === 0) {
      strip.classList.remove("visible", "linked");
      text.textContent = "";
      brand.textContent = "";
      linked = false;
      return;
    }
    text.textContent = ad.text;
    brand.textContent = typeof ad.brand === "string" && ad.brand ? `· ${ad.brand}` : "";
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
