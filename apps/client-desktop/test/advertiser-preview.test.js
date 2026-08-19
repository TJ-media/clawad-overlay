"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseDocument } = require("htmlparser2");

const model = require("../advertiser-preview/preview-model");
const { createPreviewController } = require("../advertiser-preview/preview");

const THEME_PATH = path.join(__dirname, "..", "themes", "clawad", "theme.json");
const ASSET_DIR = path.join(__dirname, "..", "themes", "clawad", "assets");
const PREVIEW_DIR = path.join(__dirname, "..", "advertiser-preview");

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function findElements(node, predicate, found = []) {
  if (node && node.name && predicate(node)) found.push(node);
  for (const child of (node && node.children) || []) findElements(child, predicate, found);
  return found;
}

function nodeText(node) {
  return ((node && node.children) || []).map((child) => {
    if (child.type === "text") return child.data;
    return nodeText(child);
  }).join("");
}

function attribute(node, name) {
  return node && node.attribs ? node.attribs[name] : undefined;
}

function declaration(source, selector, property) {
  const selectorPattern = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = source.match(new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\}`));
  if (!block) return undefined;
  const propertyPattern = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block[1].match(new RegExp(`${propertyPattern}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : undefined;
}

function declarationBlocks(source, selector) {
  const selectorPattern = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\}`, "g"))].map((match) => match[1]);
}

function parseThemeJson(raw) {
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

function createFakePreviewDocument() {
  const viewListeners = new Map();
  let animationFrame = null;
  const ids = [
    "creativeText", "creativeBrand", "creativeCopy", "creativeBrandOutput",
    "creativeStrip", "creativeMeta", "textCount", "brandCount", "validationMessage",
    "mascotObject", "mascotChoices", "mascotMessage",
  ];
  const makeNode = (id) => {
    const listeners = new Map();
    const customStyles = new Map();
    return {
      id,
      value: "",
      textContent: "",
      data: "",
      measuredWidth: id === "creativeMeta" ? 180 : 320,
      dataset: {},
      children: [],
      attributes: {},
      style: {
        width: "",
        setProperty(name, value) { customStyles.set(name, value); },
        getPropertyValue(name) { return customStyles.get(name) || ""; },
        removeProperty(name) { customStyles.delete(name); },
      },
      appendChild(child) {
        this.children.push(child);
      },
      getBoundingClientRect() {
        return { width: this.measuredWidth };
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      dispatch(type) {
        const listener = listeners.get(type);
        if (listener) listener({ type, target: this });
      },
    };
  };
  const nodes = Object.fromEntries(ids.map((id) => [id, makeNode(id)]));
  return {
    nodes,
    document: {
      getElementById: (id) => nodes[id],
      defaultView: {
        getComputedStyle: () => ({ columnGap: "8px" }),
        addEventListener(type, listener) {
          viewListeners.set(type, listener);
        },
        dispatch(type) {
          const listener = viewListeners.get(type);
          if (listener) listener({ type, target: this });
        },
        requestAnimationFrame(callback) {
          animationFrame = callback;
          return 1;
        },
        flushAnimationFrame() {
          const callback = animationFrame;
          animationFrame = null;
          if (callback) callback();
        },
      },
      createElement: (tagName) => {
        const node = makeNode(tagName);
        node.tagName = tagName.toUpperCase();
        return node;
      },
    },
  };
}

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

test("입력 문구의 자연 폭을 실제 광고판 범위로 제한해 즉시 반영한다", () => {
  const fake = createFakePreviewDocument();
  const controller = createPreviewController(fake.document, model);
  controller.start();
  assert.equal(fake.nodes.creativeStrip.style.width, "320px");
  assert.equal(fake.nodes.creativeStrip.style.getPropertyValue("--creative-cutout-width"), "188px");

  fake.nodes.creativeStrip.measuredWidth = 389.2;
  fake.nodes.creativeText.value = "내용이 길어지면 광고판도 넓어집니다";
  fake.nodes.creativeText.dispatch("input");
  assert.equal(fake.nodes.creativeStrip.style.width, "390px");
});

test("빈 입력으로 시작하면 문구 검증 안내를 표시한다", () => {
  const fake = createFakePreviewDocument();
  const controller = createPreviewController(fake.document, model);
  controller.start();
  assert.equal(fake.nodes.validationMessage.textContent, "광고 문구를 입력해 주세요.");
});

test("마스코트 선택은 object 채널의 에셋 경로와 한국어 이름을 갱신한다", () => {
  const fake = createFakePreviewDocument();
  const controller = createPreviewController(fake.document, model);
  controller.start();
  const mascot = controller.selectMascot("thinking");
  assert.equal(mascot, model.findMascot("thinking"));
  assert.match(fake.nodes.mascotObject.data, /^\.\.\/themes\/clawad\/assets\/clawad-thinking\.svg\?preview=\d+$/);
  assert.equal(fake.nodes.mascotObject.attributes["aria-label"], "생각 중");
  assert.equal(fake.nodes.mascotObject.textContent, "생각 중 마스코트");
  const selected = fake.nodes.mascotChoices.children.find((button) => button.dataset.mascotId === "thinking");
  assert.equal(selected.textContent, "생각 중");
  assert.equal(selected.attributes["aria-pressed"], "true");
});

test("마스코트 object 로드 오류는 한국어 안내를 표시한다", () => {
  const fake = createFakePreviewDocument();
  const controller = createPreviewController(fake.document, model);
  controller.start();
  fake.nodes.mascotObject.dispatch("error");
  assert.equal(fake.nodes.mascotMessage.textContent, "마스코트 이미지를 불러오지 못했습니다.");
  assert.equal(fake.nodes.validationMessage.textContent, "광고 문구를 입력해 주세요.");
  fake.nodes.mascotObject.dispatch("load");
  assert.equal(fake.nodes.mascotMessage.textContent, "");
  fake.nodes.mascotObject.dispatch("error");
  controller.selectMascot("thinking");
  assert.equal(fake.nodes.mascotMessage.textContent, "");
});

test("광고 문구는 제어문자와 연속 공백을 정리하고 120자로 제한한다", () => {
  const raw = `  첫줄\n\u001b[31m둘째줄  ${"가".repeat(140)}`;
  const state = model.buildPreviewState({ text: raw, brand: " 브랜드\t이름 " });
  assert.equal(state.text.includes("\n"), false);
  assert.equal(state.text.includes("\u001b"), false);
  assert.equal([...state.text].length, 120);
  assert.equal(state.brand, "브랜드 이름");
  assert.equal(state.textLength, 120);
  assert.equal(state.brandLength, 6);
  assert.equal(state.textEmpty, false);
});

test("입력 모델은 문자열이 아닌 값과 빈 문구를 안전하게 처리한다", () => {
  assert.equal(model.sanitizeField(null, 10), "");
  assert.deepEqual(model.buildPreviewState({ text: null, brand: 42 }), {
    text: "",
    brand: "",
    textLength: 0,
    brandLength: 0,
    textEmpty: true,
  });
});

test("마스코트 manifest는 테마의 모든 고유 에셋을 한국어 항목으로 제공한다", () => {
  const theme = parseThemeJson(readTextFile(THEME_PATH));
  const files = new Set();
  for (const values of Object.values(theme.states)) {
    for (const file of values) files.add(file);
  }
  for (const tier of [...theme.workingTiers, ...theme.jugglingTiers]) files.add(tier.file);
  for (const reaction of Object.values(theme.reactions)) {
    if (reaction.file) files.add(reaction.file);
    for (const file of reaction.files || []) files.add(file);
  }
  for (const values of Object.values(theme.miniMode.states)) {
    for (const file of values) files.add(file);
  }

  assert.equal(model.MASCOTS.length, 25);
  assert.deepEqual(model.MASCOTS.map(({ file }) => file).sort(), [...files].sort());
  for (const mascot of model.MASCOTS) {
    assert.match(mascot.nameKo, /[가-힣]/);
    assert.match(mascot.categoryKo, /[가-힣]/);
    assert.equal(typeof mascot.id, "string");
    assert.equal(typeof mascot.compact, "boolean");
    assert.equal(fs.existsSync(path.join(ASSET_DIR, mascot.file)), true);
  }
});

test("테마 manifest 파서는 선행 BOM을 제거한다", () => {
  assert.deepEqual(parseThemeJson('\uFEFF{"states":{}}'), { states: {} });
});

test("텍스트 파일 helper는 선행 BOM을 제거한다", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawad-preview-bom-"));
  const tempFile = path.join(tempDir, "fixture.txt");
  try {
    fs.writeFileSync(tempFile, "\uFEFF미리보기", "utf8");
    assert.equal(readTextFile(tempFile), "미리보기");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("기본 마스코트와 알 수 없는 ID의 fallback은 크런치 모드다", () => {
  assert.equal(model.DEFAULT_MASCOT_ID, "building");
  assert.equal(model.findMascot("does-not-exist").id, "building");
  assert.equal(model.findMascot(model.MASCOTS[3].id), model.MASCOTS[3]);
});

test("광고판 폭은 운영 렌더러와 같은 240~420px 범위를 쓴다", () => {
  assert.equal(model.clampCreativeWidth(1), 240);
  assert.equal(model.clampCreativeWidth(239.8), 240);
  assert.equal(model.clampCreativeWidth(287.2), 288);
  assert.equal(model.clampCreativeWidth(420), 420);
  assert.equal(model.clampCreativeWidth(900), 420);
});

test("독립 미리보기 페이지는 입력 접근성, 고정 표기, 로컬 리소스 계약을 제공한다", () => {
  const html = readTextFile(path.join(PREVIEW_DIR, "index.html"));
  const document = parseDocument(html);
  const elements = findElements(document, () => true);
  const findById = (id) => elements.find((element) => attribute(element, "id") === id);
  const labels = findElements(document, (element) => element.name === "label");

  for (const [id, maxLength] of [["creativeText", "120"], ["creativeBrand", "60"]]) {
    assert.ok(findById(id), `${id} 입력이 있어야 합니다.`);
    assert.equal(attribute(findById(id), "maxlength"), maxLength);
    assert.ok(labels.some((label) => attribute(label, "for") === id), `${id}에 연결된 label이 있어야 합니다.`);
  }

  for (const id of [
    "creativeCopy", "creativeBrandOutput", "textCount", "brandCount", "validationMessage",
    "creativeStrip", "creativeMeta", "mascotObject", "mascotChoices", "mascotMessage",
  ]) assert.ok(findById(id), `${id} 출력 요소가 있어야 합니다.`);

  const mascotObject = findById("mascotObject");
  assert.equal(mascotObject.name, "object");
  assert.equal(attribute(mascotObject, "type"), "image/svg+xml");
  assert.equal(attribute(mascotObject, "data"), "../themes/clawad/assets/clawad-building.svg");
  assert.equal(attribute(mascotObject, "aria-label"), "크런치 모드");

  assert.ok(elements.some((element) => attribute(element, "aria-live") && attribute(element, "id") === "validationMessage"));
  assert.ok(elements.some((element) => attribute(element, "aria-live") && attribute(element, "id") === "mascotMessage"));
  assert.ok(elements.some((element) => nodeText(element).includes("[광고]")), "[광고] 표기는 정적 마크업이어야 합니다.");
  assert.equal(elements.some((element) => nodeText(element).includes("상태의 마스코트")), false);
  assert.equal(elements.some((element) => nodeText(element).includes("레이아웃 예시")), false);

  const links = findElements(document, (element) => element.name === "link");
  assert.ok(links.some((link) => attribute(link, "rel") === "stylesheet" && attribute(link, "href") === "preview.css"));
  const scripts = findElements(document, (element) => element.name === "script");
  assert.deepEqual(scripts.map((script) => attribute(script, "src")), ["preview-model.js", "preview.js"]);
  assert.ok(scripts.every((script) => nodeText(script).trim() === ""), "입력값을 HTML 문자열로 삽입하는 인라인 템플릿을 두지 않습니다.");
});

test("미리보기 광고판은 운영 오버레이의 두 줄 Grid와 잘림 우선순위를 유지한다", () => {
  const runtimeCss = readTextFile(path.join(__dirname, "..", "src", "clawad-ad.html"));
  const previewCss = readTextFile(path.join(PREVIEW_DIR, "preview.css"));
  const contracts = [
    ["#strip", ".creative-strip", "grid-template-columns", "auto minmax(0, 1fr) auto"],
    ["#strip", ".creative-strip", "grid-template-rows", "repeat(2, 17px)"],
    ["#text", ".creative-copy", "line-height", "17px"],
    ["#text", ".creative-copy", "max-height", "34px"],
    ["#meta", ".creative-meta", "grid-row", "2"],
    ["#brand", ".creative-brand-output", "text-overflow", "ellipsis"],
    ["#reward", ".creative-reward", "white-space", "nowrap"],
  ];

  for (const [runtimeSelector, previewSelector, property, expected] of contracts) {
    assert.equal(declaration(runtimeCss, runtimeSelector, property), expected, `${runtimeSelector}의 ${property} 기준이 바뀌었습니다.`);
    assert.equal(declaration(previewCss, previewSelector, property), expected, `${previewSelector}가 운영 광고판 ${property} 계약을 지켜야 합니다.`);
  }
});

test("좁은 화면에서도 고정 리워드 예시는 자르지 않고 광고주명만 줄일 수 있다", () => {
  const previewCss = readTextFile(path.join(PREVIEW_DIR, "preview.css"));
  const rewardBlocks = declarationBlocks(previewCss, ".creative-reward");

  assert.ok(rewardBlocks.length > 0, "리워드 표기 스타일이 있어야 합니다.");
  for (const block of rewardBlocks) {
    assert.doesNotMatch(block, /(?:max-width|overflow|text-overflow)\s*:/, "리워드 예시를 반응형에서 자르면 안 됩니다.");
  }
  assert.ok(declarationBlocks(previewCss, ".creative-brand-output").some((block) => /text-overflow\s*:\s*ellipsis/.test(block)), "공간이 부족하면 광고주명이 먼저 말줄임되어야 합니다.");
  for (const block of declarationBlocks(previewCss, ".creative-brand-output")) {
    assert.doesNotMatch(block, /max-width\s*:/, "광고주명의 자연 폭이 광고판 가변 폭 계산에 반영되어야 합니다.");
  }
});

test("창 크기가 바뀌면 광고판 자연 폭과 메타데이터 cutout을 다시 계산한다", () => {
  const fake = createFakePreviewDocument();
  fake.nodes.creativeMeta.getBoundingClientRect = () => ({
    width: fake.nodes.creativeStrip.style.width === "410px" ? 200 : 120,
  });
  const controller = createPreviewController(fake.document, model);
  controller.start();

  fake.nodes.creativeStrip.measuredWidth = 260;
  fake.document.defaultView.dispatch("resize");
  fake.document.defaultView.flushAnimationFrame();
  assert.equal(fake.nodes.creativeStrip.style.width, "260px");
  assert.equal(fake.nodes.creativeStrip.style.getPropertyValue("--creative-cutout-width"), "128px");

  fake.nodes.creativeStrip.measuredWidth = 410;
  fake.document.defaultView.dispatch("resize");
  fake.document.defaultView.flushAnimationFrame();
  assert.equal(fake.nodes.creativeStrip.style.width, "410px");
  assert.equal(fake.nodes.creativeStrip.style.getPropertyValue("--creative-cutout-width"), "208px");
});

test("두 번째 줄 문구는 미리보기 전용 메타데이터 cutout을 피한다", () => {
  const previewCss = readTextFile(path.join(PREVIEW_DIR, "preview.css"));
  const cutoutBlocks = declarationBlocks(previewCss, ".creative-copy::before");

  assert.ok(cutoutBlocks.length > 0, "두 번째 줄 cutout 의사 요소가 있어야 합니다.");
  const cutout = cutoutBlocks[0];
  assert.match(cutout, /content\s*:\s*""/);
  assert.match(cutout, /float\s*:\s*right/);
  assert.match(cutout, /width\s*:\s*var\(--creative-cutout-width\)/);
  assert.match(cutout, /height\s*:\s*34px/);
  assert.match(cutout, /shape-outside\s*:/);
  assert.equal(declaration(previewCss, ":root", "--creative-cutout-width"), "96px");
});

test("좁은 화면에서도 리워드 값과 화살표를 보존한다", () => {
  const html = readTextFile(path.join(PREVIEW_DIR, "index.html"));
  const previewCss = readTextFile(path.join(PREVIEW_DIR, "preview.css"));
  const document = parseDocument(html);
  const elements = findElements(document, () => true);
  const value = elements.find((element) => attribute(element, "class") === "creative-reward-value");

  assert.equal(nodeText(value), "예상 적립 985.3P");
  for (const block of declarationBlocks(previewCss, ".creative-strip")) {
    assert.doesNotMatch(block, /overflow\s*:\s*hidden/, "좁은 화면에서도 광고판 부모가 리워드를 자르면 안 됩니다.");
  }
  assert.ok(elements.some((element) => nodeText(element) === "↗"), "고정 리워드 옆 화살표가 있어야 합니다.");
});

test("정적 미리보기는 네트워크·저장소·HTML 주입 API와 차단기 위험 토큰을 쓰지 않는다", () => {
  const files = ["index.html", "preview.css", "preview-model.js", "preview.js"];
  const source = files.map((file) => readTextFile(path.join(PREVIEW_DIR, file))).join("\n");
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|innerHTML|outerHTML|insertAdjacentHTML)\b/);
  assert.doesNotMatch(source, /document\s*\.\s*cookie/);

  const document = parseDocument(readTextFile(path.join(PREVIEW_DIR, "index.html")));
  for (const element of findElements(document, () => true)) {
    for (const token of [attribute(element, "class"), attribute(element, "id")].filter(Boolean).flatMap((value) => value.split(/\s+/))) {
      assert.doesNotMatch(token, /(^|[-_])ad(?:[-_]|$)/i, `${token}은 차단기 위험 토큰입니다.`);
    }
  }
});

test("선택한 마스코트 버튼에는 색상 외의 보이는 체크 표식이 있다", () => {
  const previewCss = readTextFile(path.join(PREVIEW_DIR, "preview.css"));
  const selectedBlocks = declarationBlocks(previewCss, ".mascot-choices button[aria-pressed=\"true\"]::before");
  assert.ok(selectedBlocks.some((block) => /content\s*:\s*["']✓\s*["']/.test(block)), "선택 상태에는 체크 표식이 있어야 합니다.");
});

test("페이지는 클로애드 홈페이지의 XP 디자인 시스템을 따른다", () => {
  const previewCss = readTextFile(path.join(PREVIEW_DIR, "preview.css"));
  assert.match(declaration(previewCss, "body", "background"), /^radial-gradient\(/);
  assert.equal(declaration(previewCss, "body", "font-size"), "12px");
  assert.equal(declaration(previewCss, ".xp-window", "width"), "min(920px, 100%)");
  assert.equal(declaration(previewCss, ".xp-window", "background"), "#ece9d8");
  assert.equal(declaration(previewCss, ".xp-window", "border"), "3px solid #0831d9");
  assert.equal(declaration(previewCss, ":root", "--strip"), "rgba(255, 255, 255, 0.88)");
  assert.equal(declaration(previewCss, ":root", "--strip-ink"), "#242427");
  assert.doesNotMatch(previewCss, /prefers-color-scheme:\s*dark/);
});

test("미리보기 무대는 홈페이지와 같은 하늘색 단색 배경이다", () => {
  const previewCss = readTextFile(path.join(PREVIEW_DIR, "preview.css"));
  assert.equal(declaration(previewCss, ".preview-stage", "background"), "#d7edff");
});

test("밝은 광고판의 문구 밑줄은 패널 위에서 대비되는 색을 쓴다", () => {
  const previewCss = readTextFile(path.join(PREVIEW_DIR, "preview.css"));
  assert.equal(declaration(previewCss, ".creative-copy", "text-decoration-color"), "var(--strip-muted)");
});
