# 광고주 소재·마스코트 실시간 미리보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 광고 문구·광고주명과 전체 애드워드 상태를 조합해 즉시 확인하는 저장 없는 정적 미리보기 페이지를 `clawad-overlay`에 추가한다.

**Architecture:** `apps/client-desktop/advertiser-preview/` 아래에 독립 정적 HTML/CSS와 두 개의 UMD CommonJS 호환 모듈을 둔다. 순수 모델이 입력 정화·길이 제한·마스코트 manifest를 소유하고, DOM 컨트롤러는 `input` 이벤트와 선택 버튼만 연결한다. 운영 광고판 소스는 변경하거나 import하지 않고 테스트에서 사용자 가시 계약만 비교한다.

**Tech Stack:** HTML5, CSS, JavaScript CommonJS/UMD, Node.js 내장 `node:test`, 기존 Claw-Ad SVG/PNG 테마 에셋

**Spec:** `docs/superpowers/specs/2026-08-19-advertiser-preview-design.md`

## Global Constraints

- 대상 저장소는 공개 `clawad-overlay` 하나다.
- 운영 광고판 `src/clawad-ad.html`과 `src/clawad-ad-renderer.js`를 수정·복사·import하지 않는다.
- 새 외부 패키지를 추가하지 않는다.
- 입력값은 네트워크·쿠키·`localStorage`·`sessionStorage`로 저장하거나 전송하지 않는다.
- `[광고]`는 사용자 입력과 분리된 고정 마크업으로 유지한다.
- 광고 문구는 120자, 광고주명은 60자로 제한한다.
- 마스코트는 `themes/clawad/assets/`의 기존 파일만 참조한다.
- 기존 `origin/develop`의 Windows 전체 테스트 실패 기준선은 41건이며 새 실패를 추가하지 않는다.
- 커밋은 사용자가 별도로 요청한 경우에만 수행한다.

---

### Task 1: 입력 모델과 마스코트 manifest

**Files:**
- Create: `apps/client-desktop/advertiser-preview/preview-model.js`
- Create: `apps/client-desktop/test/advertiser-preview.test.js`

**Interfaces:**
- Consumes: `themes/clawad/theme.json`의 `states`, `workingTiers`, `jugglingTiers`, `reactions`, `miniMode.states`
- Produces: `sanitizeField(value, maxLength): string`, `buildPreviewState({ text, brand }): { text, brand, textLength, brandLength, textEmpty }`, `MASCOTS: readonly Mascot[]`, `findMascot(id): Mascot`
- `Mascot`: `{ id: string, nameKo: string, categoryKo: string, file: string, compact: boolean }`

- [x] **Step 1: 입력 정화와 길이 제한 실패 테스트 작성**

```js
test("광고 문구는 제어문자와 연속 공백을 정리하고 120자로 제한한다", () => {
  const raw = `  첫줄\n\u001b[31m둘째줄  ${"가".repeat(140)}`;
  const state = model.buildPreviewState({ text: raw, brand: " 브랜드\t이름 " });
  assert.equal(state.text.includes("\n"), false);
  assert.equal(state.text.includes("\u001b"), false);
  assert.equal([...state.text].length, 120);
  assert.equal(state.brand, "브랜드 이름");
});
```

- [x] **Step 2: 새 테스트가 모듈 부재로 실패하는지 확인**

Run: `node --test test/advertiser-preview.test.js`

Expected: FAIL with `Cannot find module '../advertiser-preview/preview-model'`.

- [x] **Step 3: 최소 UMD 모델 구현**

```js
"use strict";

(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClawAdPreviewModel = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  function sanitizeField(value, maxLength) {
    const text = typeof value === "string" ? value : "";
    const normalized = text
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return [...normalized].slice(0, maxLength).join("");
  }

  function buildPreviewState(input = {}) {
    const text = sanitizeField(input.text, 120);
    const brand = sanitizeField(input.brand, 60);
    return {
      text,
      brand,
      textLength: [...text].length,
      brandLength: [...brand].length,
      textEmpty: text.length === 0,
    };
  }

  return { sanitizeField, buildPreviewState, MASCOTS, findMascot };
});
```

`MASCOTS`에는 설계 문서의 기본 5개, 작업 4개, 휴식 5개, 반응 3개, 미니 8개를 모두 명시한다. `findMascot`은 모르는 ID에서 첫 번째 항목을 반환한다.

- [x] **Step 4: 모델 테스트 통과 확인**

Run: `node --test test/advertiser-preview.test.js`

Expected: input-model tests PASS.

- [x] **Step 5: 테마 전체 상태 커버리지 실패 테스트 작성**

테스트에서 `theme.json`의 다섯 상태 원본을 순회해 고유 파일 집합을 만들고, `MASCOTS.map(({ file }) => file)`과 `deepStrictEqual`로 비교한다. 각 항목의 `nameKo`가 한글을 포함하고 실제 에셋 파일이 존재하는지도 확인한다.

- [x] **Step 6: 누락된 manifest 항목을 채워 테스트 통과**

Run: `node --test test/advertiser-preview.test.js`

Expected: all model and manifest tests PASS.

---

### Task 2: 실시간 DOM 컨트롤러

**Files:**
- Create: `apps/client-desktop/advertiser-preview/preview.js`
- Modify: `apps/client-desktop/test/advertiser-preview.test.js`

**Interfaces:**
- Consumes: `window.ClawAdPreviewModel` 또는 Node 테스트가 전달하는 Task 1 모델
- Produces: `createPreviewController(documentRef, model): { start(): void, render(): PreviewState, selectMascot(id): Mascot }`
- Required element IDs: `creativeText`, `creativeBrand`, `creativeCopy`, `creativeBrandOutput`, `textCount`, `brandCount`, `validationMessage`, `mascotImage`, `mascotName`, `mascotChoices`

- [x] **Step 1: 입력 이벤트가 실제 출력 노드를 갱신하는 실패 테스트 작성**

```js
test("입력 이벤트마다 정화된 문구와 광고주명이 출력된다", () => {
  const fake = createFakePreviewDocument();
  const controller = createPreviewController(fake.document, model);
  controller.start();
  fake.nodes.creativeText.value = "첫줄\n둘째줄";
  fake.nodes.creativeBrand.value = "테스트 광고주";
  fake.nodes.creativeText.dispatch("input");
  assert.equal(fake.nodes.creativeCopy.textContent, "첫줄 둘째줄");
  assert.equal(fake.nodes.creativeBrandOutput.textContent, "테스트 광고주");
  assert.equal(fake.nodes.textCount.textContent, "6 / 120");
});
```

The production change caught: removing the `input` listener or assigning raw values makes the assertion fail.

- [x] **Step 2: 컨트롤러 부재로 실패 확인**

Run: `node --test test/advertiser-preview.test.js`

Expected: FAIL because `preview.js` or `createPreviewController` is missing.

- [x] **Step 3: 최소 컨트롤러 구현**

```js
function createPreviewController(documentRef, model) {
  const nodes = Object.fromEntries(REQUIRED_IDS.map((id) => [id, documentRef.getElementById(id)]));

  function render() {
    const state = model.buildPreviewState({
      text: nodes.creativeText.value,
      brand: nodes.creativeBrand.value,
    });
    nodes.creativeCopy.textContent = state.text;
    nodes.creativeBrandOutput.textContent = state.brand;
    nodes.textCount.textContent = `${state.textLength} / 120`;
    nodes.brandCount.textContent = `${state.brandLength} / 60`;
    nodes.validationMessage.textContent = state.textEmpty ? "광고 문구를 입력해 주세요." : "";
    return state;
  }

  function start() {
    nodes.creativeText.addEventListener("input", render);
    nodes.creativeBrand.addEventListener("input", render);
    render();
  }

  return { start, render, selectMascot };
}
```

모듈은 Task 1과 같은 UMD 형태로 내보내고, 브라우저에서는 `DOMContentLoaded` 후 자동 `start()`한다. 출력에는 `textContent`만 사용한다.

- [x] **Step 4: 입력 이벤트 테스트 통과 확인**

Run: `node --test test/advertiser-preview.test.js`

Expected: controller input tests PASS.

- [x] **Step 5: 마스코트 선택 실패 테스트 작성**

선택 함수가 기존 `themes/clawad/assets/<file>` 상대 경로, 한국어 alt/name, `aria-pressed`를 갱신하는지 실제 fake nodes로 검사한다. 이미지 `error` 이벤트에서는 `validationMessage`가 한국어 로드 실패 안내가 되는지도 검사한다.

- [x] **Step 6: 마스코트 버튼 생성·선택 구현 후 테스트 통과**

`document.createElement("button")`, `textContent`, `dataset.mascotId`, `setAttribute("aria-pressed", ...)`만 사용한다. 선택 시 URL에 `?preview=<counter>`를 붙여 SVG 애니메이션을 다시 시작한다.

Run: `node --test test/advertiser-preview.test.js`

Expected: all controller tests PASS.

---

### Task 3: Windows XP 페이지와 광고판 미리보기

**Files:**
- Create: `apps/client-desktop/advertiser-preview/index.html`
- Create: `apps/client-desktop/advertiser-preview/preview.css`
- Modify: `apps/client-desktop/test/advertiser-preview.test.js`

**Interfaces:**
- Consumes: Task 1 `preview-model.js`, Task 2 `preview.js`, `../themes/clawad/assets/*`
- Produces: 직접 열 수 있는 `advertiser-preview/index.html`

- [x] **Step 1: 의미 구조와 고정 광고 표기 실패 테스트 작성**

`htmlparser2`로 HTML을 파싱해 연결된 `<label for>`, `maxlength="120"`, `maxlength="60"`, 고정 `[광고]`, `aria-live`, 광고판 출력 IDs, 로컬 script/style 링크가 존재하는지 검사한다. 입력값을 HTML 문자열에 삽입하는 템플릿 경로가 없어야 한다.

- [x] **Step 2: HTML 부재로 실패 확인**

Run: `node --test test/advertiser-preview.test.js`

Expected: FAIL with `ENOENT` for `advertiser-preview/index.html`.

- [x] **Step 3: 최소 의미 HTML 구현**

```html
<label for="creativeText">광고 문구</label>
<textarea id="creativeText" maxlength="120"></textarea>
<label for="creativeBrand">광고주명</label>
<input id="creativeBrand" maxlength="60" />
<div class="creative-strip" aria-label="광고판 미리보기">
  <span class="creative-label">[광고]</span>
  <span id="creativeCopy" class="creative-copy"></span>
  <div class="creative-meta">
    <span id="creativeBrandOutput"></span>
    <span class="creative-reward">예상 적립 985.3P</span>
    <span aria-hidden="true">↗</span>
  </div>
</div>
```

모든 DOM class/id 토큰은 광고 차단기의 범용 `ad` 토큰을 피하고 `creative-*`를 사용한다.

- [x] **Step 4: HTML 계약 테스트 통과 확인**

Run: `node --test test/advertiser-preview.test.js`

Expected: semantic markup tests PASS.

- [x] **Step 5: 광고판 레이아웃 계약 실패 테스트 작성**

미리보기 CSS를 실제 CSS parser 없이도 테스트 가능한 소비자 계약으로 확인한다. 브라우저에서 계산되는 스타일을 작은 로컬 probe HTML로 실행할 수 없으므로, 이 테스트만은 운영 `clawad-ad.html`과 두 CSS의 선언 블록을 추출해 다음 literal을 비교한다: `grid-template-columns: auto minmax(0, 1fr) auto`, `grid-template-rows: repeat(2, 17px)`, 본문 `line-height: 17px`, `max-height: 34px`, metadata `grid-row: 2`, 브랜드 `text-overflow: ellipsis`, reward `white-space: nowrap`.

- [x] **Step 6: XP chrome과 실제 광고판 치수 CSS 구현**

Luna 파란 제목 표시줄, 회색 대화상자 면, 흰 입력 필드, 고전 버튼, 작업표시줄을 새 CSS로 작성한다. 광고판 계약은 Step 5의 literal을 사용하고, `@media (prefers-color-scheme: dark)`, `@media (max-width: 760px)`, `@media (prefers-reduced-motion: reduce)`를 포함한다.

- [x] **Step 7: 전체 미리보기 테스트 통과 확인**

Run: `node --test test/advertiser-preview.test.js`

Expected: all advertiser preview tests PASS.

---

### Task 4: 추적 허용, 문서, 시각 검증과 전체 회귀

**Files:**
- Modify: `apps/client-desktop/.gitignore`
- Modify: `apps/client-desktop/README.md`
- Test: `apps/client-desktop/test/advertiser-preview.test.js`

**Interfaces:**
- Consumes: Tasks 1–3의 완성된 정적 페이지
- Produces: 저장소에서 추적되는 페이지와 사용 안내

- [x] **Step 1: gitignore 추적 실패를 먼저 확인**

Run: `git check-ignore -v apps/client-desktop/advertiser-preview/index.html`

Expected: 현재 allowlist 규칙에 의해 ignored.

- [x] **Step 2: 최소 allowlist 예외 추가**

```gitignore
!advertiser-preview/
!advertiser-preview/**
```

Run: `git status --short`

Expected: 네 정적 페이지 파일과 테스트가 추적 대상으로 보인다.

- [x] **Step 3: README에 실행 방법 추가**

광고주 미리보기 절에 `advertiser-preview/index.html`을 직접 열 수 있고 입력이 저장·전송되지 않으며 적립 값은 레이아웃 예시라는 세 문장을 추가한다.

- [x] **Step 4: 관련 테스트 실행**

Run: `node --test test/advertiser-preview.test.js test/clawad-ad-markup.test.js test/clawad-ad-renderer.test.js`

Expected: 0 failures.

- [x] **Step 5: 로컬 브라우저 시각 검증**

Node 내장 `http` 모듈로 `apps/client-desktop`을 정적 제공하고 브라우저에서 `/advertiser-preview/`를 연다. 데스크톱·760px 이하 레이아웃, 한 글자 입력 갱신, 120/60자 상한, 25개 마스코트 선택, 이미지 로드, XP chrome, 밝은/어두운 광고판을 확인하고 스크린샷을 남긴다.

- [x] **Step 6: 전체 회귀 기준 확인**

Run: `npm test`

Expected: 새 `advertiser-preview` 테스트는 전부 통과하며 전체 실패 수가 기준선 41건보다 늘지 않는다.

- [x] **Step 7: 변경 범위 검토**

Run: `git status --short && git diff --stat && git diff --check`

Expected: CLAW-244 관련 파일만 있고 whitespace 오류가 없다. 커밋은 사용자 요청이 없으므로 수행하지 않는다.
