"use strict";
// 클로애드 광고 2행 렌더러 (CLAW-90, 2행 확장 CLAW-138).
// 문구는 반드시 textContent로만 넣는다 — 서버가 준 문자열을 마크업으로 해석하지 않는다.
// [광고] 표기는 HTML에 고정돼 있어 이 파일이 지우거나 바꾸지 않는다.

(() => {
  const strip = document.getElementById("strip");
  const text = document.getElementById("text");
  const brand = document.getElementById("brand");
  const reward = document.getElementById("reward");
  const meta = document.getElementById("meta");
  const noticeDismiss = document.getElementById("notice-dismiss");
  let linked = false;

  // 예상 포인트가 1 오를 때 숫자가 툭 튀지 않게 0.1씩 굴려 올린다 (CLAW-138 후속).
  //
  // **표시 전용 보간이다.** 값을 만들어내지 않는다 — 시작점도 끝점도 서버가 준 정수이고,
  // 애니메이션이 끝나면 화면에는 항상 서버 값이 정확히 그대로 남는다 (CLAUDE.md §2 [CRITICAL]).
  // 적립 판정·금액은 전부 서버가 하고, 여기서 지나가는 소수점은 화면에만 있는 중간 프레임이다.
  // 부동소수 오차로 407.9999가 남지 않게 내부는 1/10 단위 정수로만 센다.
  //
  // 페이싱은 **직전 갱신 간격에 맞춰 편다.** 예전에는 0.1을 100ms마다 몰아 굴리고 다음 갱신까지
  // 멈춰 있었다 — 노출 주기가 18초쯤이라 0.3초 움직이고 17초 정지하는 꼴이었다. 갱신 간격을
  // 재서 그 시간에 걸쳐 굴리면 거의 항상 움직인다. sync 주기를 상수로 박지 않으므로 주기가
  // 바뀌어도 따라간다 (CLAW-157).
  /**
   * 한 번에 0.1씩만 올리고 **간격**을 거리로 나눠 정한다 (CLAW-165). 이 값은 그 간격의 하한이다.
   * 거리가 아주 멀 때(밀린 sync·교환 직후)만 여기에 걸리고, 그때는 증분을 키워 따라잡는다.
   */
  const TWEEN_MIN_STEP_MS = 120;
  /** 굴리는 데 쓸 시간의 하한·상한. 직전 갱신 간격을 이 범위로 자른다. */
  const TWEEN_MIN_SPAN_MS = 1000;
  const TWEEN_MAX_SPAN_MS = 240000;
  /** 갱신 간격을 아직 모를 때(첫 변화) 쓰는 기본 시간. */
  const TWEEN_DEFAULT_SPAN_MS = 6000;
  let shownTenths = null;
  let targetTenths = null;
  let tweenTimer = null;
  let lastTargetAt = null;
  let lastSpanMs = TWEEN_DEFAULT_SPAN_MS;

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

  /**
   * `accrued`가 true면 굴러가는 값이 확정분을 **포함한** 적립 총액이다. 그때는 확정을 따로 쓰지
   * 않는다 (CLAW-165) — 적립이 거의 바로 확정으로 넘어가 두 수가 갈릴 때가 드물고, 나란히 쓰면
   * `예상 33.6P · 확정 33P`가 66.6P로 오독된다. 총액 하나만 보여주는 쪽이 정확하고 짧다.
   *
   * 구 CLI(총액 없음)에서는 기존 표기를 유지한다. 그 조합의 굴러가는 값은 **검증 중**이라
   * 그것만 띄우면 확정 잔액이 화면에서 사라진다 — 대개 0P라 오히려 오해를 만든다.
   *
   * 표기는 규칙 §9의 표준 용어 `예상 적립`을 쓴다. 화면 수익 표시가 "예상"임이 드러나야 한다(규칙 §2).
   */
  function paintReward(confirmed, accrued) {
    if (shownTenths === null) {
      reward.textContent = "";
      syncMetaCutout();
      return;
    }
    const shown = formatTenths(shownTenths);
    if (accrued) {
      reward.textContent = `예상 적립 ${shown}P`;
    } else {
      reward.textContent = `예상 적립 ${shown}P · 확정 ${confirmed.toLocaleString("ko-KR")}P`;
    }
    // 굴러가는 동안 소수점 한 자리가 붙었다 떨어지며 폭이 바뀐다. 문구 둘째 줄이 비켜 갈
    // 폭도 같이 따라가야 적립 현황에 겹치거나 사이가 벌어지지 않는다 (CLAW-169).
    syncMetaCutout();
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
      lastTargetAt = null;
      reward.textContent = "";
      return;
    }
    const confirmed = value.confirmed;
    // 캐리까지 담은 적립 총액이 있으면 그걸 굴린다. 없으면(구 CLI) 예전대로 검증 중 값을 쓴다.
    // 어느 쪽이든 **서버가 준 값**이다 — 렌더러는 두 서버 값 사이를 지나갈 뿐이다.
    const accrued = Number.isInteger(value.accruedTenths);
    const next = accrued ? value.accruedTenths : value.verifying * 10;

    if (next !== targetTenths) {
      const now = Date.now();
      if (lastTargetAt !== null) lastSpanMs = now - lastTargetAt;
      lastTargetAt = now;
      targetTenths = next;
      // 새 목표가 오면 페이싱을 다시 잡는다. 옛 간격으로 굴리던 타이머를 그대로 두면
      // 빨리 끝내고 멈춰 서서, 고치려던 "굴렀다가 정지" 패턴이 그대로 남는다.
      stopTween();
    }

    // 첫 표시와 감소(교환·회수)는 굴리지 않고 바로 맞춘다. 거꾸로 굴리지 않는다.
    if (shownTenths === null || targetTenths < shownTenths) {
      stopTween();
      shownTenths = targetTenths;
      paintReward(confirmed, accrued);
      return;
    }
    paintReward(confirmed, accrued);
    if (shownTenths === targetTenths || tweenTimer !== null) return;
    // 남은 거리를 직전 갱신 간격에 걸쳐 나눈다. 다음 갱신 전에 끝나도록 살짝 짧게 잡는다.
    const span = Math.min(TWEEN_MAX_SPAN_MS, Math.max(TWEEN_MIN_SPAN_MS, Math.floor(lastSpanMs * 0.9)));
    const distance = targetTenths - shownTenths;
    // 주유소 계기판처럼 0.1씩 고르게 올린다 (CLAW-165).
    //
    // 예전에는 **간격을 200ms로 고정**하고 증분만 거리에 맞춰 키웠다. 그런데 증분의 하한이 1이라
    // 거리가 짧으면 간격이 늘어나지 않았다 — 노출당 0.3P = 3틱이면 600ms 만에 끝나고 다음 갱신까지
    // 몇 분을 멈춰 있었다. CLAW-157이 고치려던 "굴렀다가 정지"가 짧은 거리에 그대로 남아 있었다.
    //
    // 그래서 반대로 잡는다: **증분을 0.1로 두고 간격을 거리로 나눈다.** 그러면 다음 갱신까지의
    // 시간에 걸쳐 고르게 오른다. 느린 것은 상관없다 — 멈춰 보이지 않는 것이 목적이다.
    const stepMs = Math.max(TWEEN_MIN_STEP_MS, Math.floor(span / distance));
    // 간격이 하한에 걸릴 만큼 거리가 멀 때(밀린 sync·교환 직후)만 증분을 키워 span 안에 끝낸다.
    // 이걸 빼면 100P 점프가 몇 시간씩 기어오른다.
    const perStep = Math.max(1, Math.ceil(distance / Math.max(1, Math.floor(span / stepMs))));
    tweenTimer = setInterval(() => {
      shownTenths = Math.min(shownTenths + perStep, targetTenths);
      paintReward(confirmed, accrued);
      if (shownTenths >= targetTenths) stopTween();
    }, stepMs);
  }

  /**
   * 내용에 맞는 자연 폭(CSS px). 창이 곧 패널이라 짧은 광고에도 창이 최대 폭으로 뜨던 것을
   * 줄이기 위해 잰다 (CLAW-156).
   *
   * 스트립을 잠깐 `max-content`로 두고 재는데, **읽고 바로 되돌리므로 화면에 반영되지
   * 않는다** — 같은 프레임 안에서 레이아웃만 계산되고 그 상태로 페인트되지 않는다.
   * 세로는 그대로다: 행 수가 고정이라 높이는 메인의 STRIP_HEIGHT가 계속 맞다.
   */
  function measureNaturalWidth() {
    const stripWidth = strip.style.width;
    // 컷아웃 float을 재는 동안만 지운다 (CLAW-219).
    //
    // **고유 폭 계산에는 float의 박스 폭이 더해지고 `shape-outside`는 반영되지 않는다.**
    // 그래서 컷아웃을 켜 둔 채 `max-content`로 재면 `문구 한 줄 폭 + 컷아웃 폭`이 나오는데,
    // 실제 배치에서는 shape가 1행을 통과시키므로 문구는 그 폭을 쓰지 않는다 — 문구 오른쪽에
    // 컷아웃 폭만큼 빈칸이 남는다(macOS 실측: 55~74px).
    //
    // Windows에서 안 보였던 이유는 한글이 더 넓게 렌더돼 자연 폭이 정책 상한을 넘고, 문구가
    // 두 줄로 감기면서 2행이 컷아웃 자리를 실제로 썼기 때문이다. 증상이 플랫폼별로 다를 뿐
    // 측정이 틀린 것은 양쪽 같다.
    //
    // **레이아웃 시점의 컷아웃은 그대로 둔다.** 두 줄로 감기는 문구는 여기서 잰 한 줄 폭이
    // 상한을 넘어 메인이 자르고, 그 뒤 배치에서는 원래 컷아웃이 2행을 비켜 가게 한다.
    const cutout = strip.style.getPropertyValue("--meta-cutout");
    strip.style.setProperty("--meta-cutout", "0px");
    strip.style.width = "max-content";
    const measured = strip.getBoundingClientRect().width;
    strip.style.width = stripWidth;
    if (cutout) strip.style.setProperty("--meta-cutout", cutout);
    else strip.style.removeProperty("--meta-cutout");
    // 메인은 이 값을 **창 폭**으로 쓴다. 그런데 스트립은 body 안에 있고 body에는 좌우 여백이
    // 있으므로(세션 HUD와 맞춘 padding), 여백을 더하지 않으면 창이 스트립보다 그만큼 좁게 떠서
    // 스트립이 눌리고 **문구가 길이와 무관하게 항상 말줄임된다.**
    // 상수로 박지 않고 계산값에서 읽는다 — CSS가 유일한 출처여야 둘이 어긋나지 않는다.
    const bodyStyle = window.getComputedStyle(document.body);
    const sidePadding = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);
    return Math.ceil(measured + (Number.isFinite(sidePadding) ? sidePadding : 0));
  }

  /**
   * 문구 둘째 줄이 비켜 갈 폭(CLAW-169). 문구는 2·3열에 걸쳐 흐르고 2행 오른쪽만 적립 현황에
   * 내주는데, 그 폭이 금액·광고주 길이에 따라 바뀌므로 CSS 상수로 둘 수 없다. 여기서 재서
   * `--meta-cutout`으로 넘긴다 — 도려낼 모양 자체는 CSS가 정하고 폭만 알려주는 것이다.
   *
   * 열 간격을 더하는 이유: 적립 현황 열 폭만 비우면 문구 둘째 줄이 적립 현황에 딱 붙는다.
   * 값은 CSS에서 읽는다 — 간격을 상수로 박으면 CSS와 어긋난다.
   */
  function syncMetaCutout() {
    if (!meta) return;
    const gap = parseFloat(window.getComputedStyle(strip).columnGap);
    const width = meta.getBoundingClientRect().width + (Number.isFinite(gap) ? gap : 0);
    strip.style.setProperty("--meta-cutout", `${Math.ceil(width)}px`);
  }

  function reportWidth() {
    if (!window.clawadAdAPI || typeof window.clawadAdAPI.reportWidth !== "function") return;
    const width = measureNaturalWidth();
    if (Number.isFinite(width) && width > 0) window.clawadAdAPI.reportWidth(width);
  }

  function render(ad) {
    if (!ad || typeof ad.text !== "string" || ad.text.length === 0) {
      strip.classList.remove("visible", "linked", "notice");
      text.textContent = "";
      brand.textContent = "";
      noticeDismiss.hidden = true;
      renderReward(null);
      linked = false;
      return;
    }
    text.textContent = ad.text;
    brand.textContent = typeof ad.brand === "string" && ad.brand ? ad.brand : "";
    const canDismiss = ad.kind === "notice" && ad.dismissible === true
      && typeof ad.dismissLabel === "string" && ad.dismissLabel.length > 0;
    noticeDismiss.textContent = canDismiss ? ad.dismissLabel : "";
    noticeDismiss.hidden = !canDismiss;
    renderReward(ad.reward);
    // 광고일 때만 [광고]를 단다. kind가 빠져 있으면 광고로 본다 — 표기가 빠지는 쪽이 아니라
    // 붙는 쪽으로 기울여야 안전하다 (CLAUDE.md §4).
    strip.classList.toggle("notice", ad.kind === "login" || ad.kind === "notice");
    // 링크 여부는 메인이 검증해서 내려준다(https만). 렌더러는 URL 자체를 다루지 않는다.
    linked = ad.linked === true;
    strip.classList.toggle("linked", linked);
    strip.classList.add("visible");
    // 적립 현황을 다 그린 뒤에 컷아웃을 맞춘다 — 금액이 바뀌면 비켜 갈 폭도 바뀐다.
    // 폭 측정보다 먼저 해야 한다: 컷아웃이 문구가 흐르는 모양을 바꾸므로 자연 폭에도 반영된다.
    syncMetaCutout();
    // 클래스까지 다 붙인 뒤에 잰다 — notice/linked가 [광고]↔[안내] 표기와 밑줄을 바꿔 폭이 달라진다.
    reportWidth();
  }

  // 클릭은 "지금 표시 중인 광고를 열어달라"는 신호만 보낸다. URL은 메인이 갖고 있다.
  strip.addEventListener("click", () => {
    if (!linked || !window.clawadAdAPI || typeof window.clawadAdAPI.openAd !== "function") return;
    window.clawadAdAPI.openAd();
  });

  noticeDismiss.addEventListener("click", (event) => {
    event.stopPropagation();
    if (noticeDismiss.hidden || !window.clawadAdAPI || typeof window.clawadAdAPI.dismissNotice !== "function") return;
    window.clawadAdAPI.dismissNotice();
  });

  if (window.clawadAdAPI && typeof window.clawadAdAPI.onAd === "function") {
    window.clawadAdAPI.onAd(render);
  }
})();
