"use strict";

// 앱 아이콘·트레이 아이콘을 클로애드 마스코트 테마에서 생성한다 (CLAW-120).
//
// 왜 스크립트인가: 포크 반입 시 upstream 아이콘은 All Rights Reserved 아트라 전량
// 제외했다(FORK.md §2). 우리 마스코트로 다시 만들어야 하는데, 손으로 만든 PNG를
// 커밋해두면 테마 아트가 바뀔 때 아이콘이 조용히 낡는다. 테마에서 재생성 가능하게 둔다.
//
// 왜 Electron인가: 소스가 합성 SVG다 — 몸통·집게·더듬이를 별도 PNG로 참조한다.
// nativeImage는 SVG를 못 읽고, sips는 SVG 안의 상대경로 이미지 참조를 해석하지 못해
// placeholder만 그린다. Chromium으로 렌더하는 수밖에 없다.
// 렌더용 HTML은 반드시 에셋 디렉터리 안에 써서 페이지를 file:// 로 로드한다.
// data: URL은 origin이 불투명해서 참조된 PNG를 불러오지 못한다.
//
// 사용법:
//   node scripts/export-app-icons.js            전체 생성 (테마에서 렌더)
//   node scripts/export-app-icons.js --derive    파생물만 생성 (커밋된 아이콘·원본에서)
//   node scripts/export-app-icons.js --dry-run  생성물 목록만 출력
//
// --derive를 따로 둔 이유: Chromium 버전이 다르면 같은 SVG도 렌더 바이트가 미세하게 달라진다.
// 트레이 깜빡임 아이콘·About 히어로처럼 기존 산출물에서 파생 가능한 것은 재렌더 없이 만들어,
// 저장소에 이미 커밋된 아트와 어긋나지 않게 한다.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EXPORTER_ENV = "CLAWAD_APP_ICON_EXPORTER";

const ROOT = path.join(__dirname, "..");
const THEME_ASSETS = path.join(ROOT, "themes", "clawad", "assets");
const OUT_DIR = path.join(ROOT, "assets");
const SOURCE_DIR = path.join(OUT_DIR, "source");

// idle 포즈를 쓴다. 정면·전신이고 표정이 살아 있어 작은 크기에서도 형태가 읽힌다.
const SOURCE_SVG = "clawad-idle.svg";

const MASTER_SIZE = 1024;      // 크롭 전 전체 렌더 크기
const APP_ICON_SIZE = 1024;    // electron-builder가 여기서 .icns/.ico를 파생시킨다
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const TRAY_POINT_SIZE = 16;    // macOS 메뉴바는 pt 단위 (src/tray-flash-icon.js)
const TRAY_PIXEL_SIZE = 32;    // Windows/Linux 트레이는 px 단위
// macOS 앱 아이콘은 Apple 그리드에 맞춰 여백을 둔다. 꽉 채우면(full-bleed)
// Dock에서 다른 앱보다 크게 튀고, test/main-mac-dock-icon.test.js 가 이를 막는다.
const APP_ICON_CONTENT_RATIO = 824 / 1024;  // Apple 그리드 = 80.5%
const APP_ICON_MARGIN = (1 - APP_ICON_CONTENT_RATIO) / 2;

// 트레이는 이미 16pt로 작다. 앱 아이콘과 같은 여백을 주면 형태가 읽히지 않으므로
// 최소한만 남긴다.
const TRAY_MARGIN = 0.02;
/**
 * 트레이 깜빡임용 강조 점 (src/tray-flash-icon.js). 세션 HUD의 주의 색(#f59e0b)과 같은 값이라
 * 트레이·HUD가 같은 신호 색을 쓴다.
 */
const FLASH_DOT_RGB = { r: 245, g: 158, b: 11 };
const FLASH_DOT_DIAMETER_RATIO = 0.42;
/**
 * About·튜토리얼 히어로 SVG. 마스코트가 픽셀아트라 격자 사각형으로 옮겨도 손실이 없고,
 * 외부 파일·data URI 없이 자체 완결된 SVG가 된다(렌더러에 인라인으로 주입되므로 필수).
 */
const HERO_SVG_NAME = "clawad-about-hero.svg";
const HERO_GRID = 64;

const ALPHA_THRESHOLD = 8;     // 이 값 이하는 배경으로 본다

let nativeImage = null;
let app = null;
let BrowserWindow = null;
if (process.env[EXPORTER_ENV] === "1") {
  ({ nativeImage, app, BrowserWindow } = require("electron"));
}

// ── 픽셀 유틸 (nativeImage.toBitmap()은 BGRA 순서다) ──

function bitmapOf(image) {
  const size = image.getSize();
  return { data: image.toBitmap(), width: size.width, height: size.height };
}

function alphaAt(bmp, x, y) {
  return bmp.data[(y * bmp.width + x) * 4 + 3];
}

/** 불투명 픽셀의 경계 상자. 전부 투명하면 null. */
function contentBounds(bmp) {
  let minX = bmp.width, minY = bmp.height, maxX = -1, maxY = -1;
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      if (alphaAt(bmp, x, y) <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 내용을 정사각 캔버스 가운데에 놓는다. 종횡비는 유지한다. */
function squareCentered(image, outSize, marginRatio) {
  const bmp = bitmapOf(image);
  const bounds = contentBounds(bmp);
  if (!bounds) throw new Error("렌더 결과가 전부 투명하다 — SVG 참조가 풀리지 않았을 수 있다");

  const inner = Math.round(outSize * (1 - marginRatio * 2));
  const scale = Math.min(inner / bounds.width, inner / bounds.height);
  const drawW = Math.max(1, Math.round(bounds.width * scale));
  const drawH = Math.max(1, Math.round(bounds.height * scale));

  const cropped = image.crop(bounds).resize({ width: drawW, height: drawH, quality: "best" });
  const src = bitmapOf(cropped);

  const out = Buffer.alloc(outSize * outSize * 4, 0);
  const offsetX = Math.floor((outSize - drawW) / 2);
  const offsetY = Math.floor((outSize - drawH) / 2);
  for (let y = 0; y < drawH; y++) {
    const srcStart = y * src.width * 4;
    const dstStart = ((y + offsetY) * outSize + offsetX) * 4;
    src.data.copy(out, dstStart, srcStart, srcStart + drawW * 4);
  }
  return nativeImage.createFromBitmap(out, { width: outSize, height: outSize });
}

/**
 * 트레이 깜빡임 변형: 기본 트레이 아이콘 우하단에 강조 점을 찍는다.
 * 없으면 loadTrayFlashIcon이 null을 돌려 깜빡임만 비활성되므로, 파일이 있어야 기능이 산다.
 */
function withFlashDot(image) {
  const bmp = bitmapOf(image);
  const out = Buffer.from(bmp.data);
  const diameter = Math.max(3, Math.round(Math.min(bmp.width, bmp.height) * FLASH_DOT_DIAMETER_RATIO));
  const radius = diameter / 2;
  const centerX = bmp.width - radius - 1;
  const centerY = bmp.height - radius - 1;
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      if (distance > radius) continue;
      // 경계 1px만 알파로 눌러 32px에서도 계단이 두드러지지 않게 한다.
      const alpha = Math.round(255 * Math.min(1, radius - distance));
      if (alpha <= 0) continue;
      const index = (y * bmp.width + x) * 4;
      out[index] = FLASH_DOT_RGB.b;
      out[index + 1] = FLASH_DOT_RGB.g;
      out[index + 2] = FLASH_DOT_RGB.r;
      out[index + 3] = Math.max(out[index + 3], alpha);
    }
  }
  return nativeImage.createFromBitmap(out, { width: bmp.width, height: bmp.height });
}

function hex(value) {
  return value.toString(16).padStart(2, "0");
}

/**
 * 렌더 결과를 격자로 샘플링해 픽셀당 사각형 SVG를 만든다.
 * 가로 연속 구간은 하나의 rect로 합쳐 파일 크기를 줄이고, crispEdges로 이음새를 없앤다.
 * 외부 참조가 없어야 About 화면에 인라인으로 주입할 수 있다(테마 SVG는 외부 PNG를 참조해 쓸 수 없다).
 */
function pixelGridSvg(image, grid) {
  const bmp = bitmapOf(image);
  const bounds = contentBounds(bmp);
  if (!bounds) throw new Error("렌더 결과가 전부 투명하다 — SVG 참조가 풀리지 않았을 수 있다");
  const cell = Math.max(bounds.width, bounds.height) / grid;
  const originX = bounds.x + bounds.width / 2 - (cell * grid) / 2;
  const originY = bounds.y + bounds.height / 2 - (cell * grid) / 2;

  const sample = (gx, gy) => {
    const sx = Math.min(bmp.width - 1, Math.max(0, Math.round(originX + cell * (gx + 0.5))));
    const sy = Math.min(bmp.height - 1, Math.max(0, Math.round(originY + cell * (gy + 0.5))));
    const index = (sy * bmp.width + sx) * 4;
    if (bmp.data[index + 3] <= ALPHA_THRESHOLD) return null;
    return `#${hex(bmp.data[index + 2])}${hex(bmp.data[index + 1])}${hex(bmp.data[index])}`;
  };

  const rects = [];
  for (let gy = 0; gy < grid; gy++) {
    let runStart = 0;
    let runColor = null;
    for (let gx = 0; gx <= grid; gx++) {
      const color = gx < grid ? sample(gx, gy) : null;
      if (color === runColor) continue;
      if (runColor) rects.push(`<rect x="${runStart}" y="${gy}" width="${gx - runStart}" height="1" fill="${runColor}"/>`);
      runStart = gx;
      runColor = color;
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" shape-rendering="crispEdges" role="img" aria-label="클로애드 마스코트">`,
    ...rects.map((rect) => `  ${rect}`),
    "</svg>",
    "",
  ].join("\n");
}

/**
 * macOS 템플릿 이미지: RGB를 검정으로 눌러 알파만 형태로 남긴다.
 * 메뉴바가 다크/라이트에 맞춰 알파를 마스크로 써서 자동 반전한다.
 */
function toTemplate(image) {
  const bmp = bitmapOf(image);
  const out = Buffer.from(bmp.data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 0;      // B
    out[i + 1] = 0;  // G
    out[i + 2] = 0;  // R
  }
  return nativeImage.createFromBitmap(out, { width: bmp.width, height: bmp.height });
}

// ── ICO 인코더 ──
// Vista 이상은 ICO 안에 PNG를 그대로 넣을 수 있다. 외부 의존성 없이 컨테이너만 쓴다.
function encodeIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + count * 16;
  for (const { size, png } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);  // 0 은 256을 뜻한다
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);        // 팔레트 색 수 (트루컬러는 0)
    entry.writeUInt8(0, 3);        // reserved
    entry.writeUInt16LE(1, 4);     // color planes
    entry.writeUInt16LE(32, 6);    // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...pngBuffers.map((p) => p.png)]);
}

// ── 렌더 ──

async function renderMaster() {
  const svgPath = path.join(THEME_ASSETS, SOURCE_SVG);
  if (!fs.existsSync(svgPath)) {
    throw new Error(`마스코트 소스를 찾을 수 없다: ${path.relative(ROOT, svgPath)}`);
  }
  const svg = fs.readFileSync(svgPath, "utf8");
  const viewBox = (svg.match(/viewBox="([^"]+)"/) || [])[1];
  if (!viewBox) throw new Error(`${SOURCE_SVG} 에 viewBox가 없다`);

  const html = [
    "<!doctype html><meta charset=\"utf-8\">",
    "<style>",
    `  html,body{margin:0;padding:0;background:transparent;width:${MASTER_SIZE}px;height:${MASTER_SIZE}px;overflow:hidden}`,
    `  svg{display:block;width:${MASTER_SIZE}px;height:${MASTER_SIZE}px}`,
    "</style>",
    svg.replace(/<svg([^>]*)>/, `<svg$1 preserveAspectRatio="xMidYMid meet">`),
  ].join("\n");

  // 에셋 디렉터리 안에 써야 상대경로 PNG 참조가 풀린다 (파일 헤더 주석 참조).
  const htmlPath = path.join(THEME_ASSETS, ".__export-app-icon.html");
  fs.writeFileSync(htmlPath, html);

  const win = new BrowserWindow({
    width: MASTER_SIZE,
    height: MASTER_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });

  try {
    await win.loadFile(htmlPath);
    // 참조된 PNG 파츠가 모두 디코드될 시간을 준다. 이걸 생략하면
    // 반쯤 그려진 프레임이 잡혀 파츠가 빠진 아이콘이 나온다.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return await win.webContents.capturePage();
  } finally {
    win.destroy();
    fs.rmSync(htmlPath, { force: true });
  }
}

/** 이미 저장돼 있는 산출물을 읽는다. 없으면 null. */
function loadExisting(file) {
  if (!fs.existsSync(file)) return null;
  const image = nativeImage.createFromPath(file);
  return image && !image.isEmpty() ? image : null;
}

/**
 * 파생 산출물만 다시 만든다 (`--derive`).
 *
 * 렌더는 Electron·Chromium 버전에 따라 바이트가 미세하게 달라진다. 저장소에 이미 아이콘이
 * 있으면 그것을 입력으로 삼아, 커밋된 아트와 어긋나지 않게 한다 —
 * 깜빡임 아이콘은 기본 트레이 아이콘에서, 히어로 SVG는 풀블리드 원본에서 파생한다.
 */
function deriveOutputs() {
  const trayIcon = loadExisting(path.join(OUT_DIR, "tray-icon.png"));
  const fullBleed = loadExisting(path.join(SOURCE_DIR, "dock-icon-fullbleed.png"));
  if (!trayIcon || !fullBleed) {
    throw new Error("--derive는 assets/tray-icon.png과 assets/source/dock-icon-fullbleed.png이 있어야 한다");
  }
  return [
    [path.join(OUT_DIR, "tray-icon-flash.png"), withFlashDot(trayIcon).toPNG()],
    [path.join(OUT_DIR, "svg", HERO_SVG_NAME), Buffer.from(pixelGridSvg(fullBleed, HERO_GRID), "utf8")],
  ];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const written = [];

  if (process.argv.includes("--derive")) {
    for (const [target, buffer] of deriveOutputs()) {
      if (!dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, buffer);
      }
      written.push([path.relative(ROOT, target), buffer.length]);
    }
    for (const [rel, bytes] of written) console.log(`wrote ${rel} (${bytes} bytes)`);
    return;
  }

  const master = await renderMaster();
  const squared = squareCentered(master, APP_ICON_SIZE, APP_ICON_MARGIN);

  const trayTemplate = toTemplate(
    squareCentered(master, TRAY_POINT_SIZE, TRAY_MARGIN)
  );
  const trayTemplate2x = toTemplate(
    squareCentered(master, TRAY_POINT_SIZE * 2, TRAY_MARGIN)
  );

  const outputs = [
    // 크롭하지 않은 원본. 재프레이밍이 필요할 때의 기준이다.
    [path.join(SOURCE_DIR, "dock-icon-fullbleed.png"), master.toPNG()],
    [path.join(OUT_DIR, "icon.png"), squared.toPNG()],
    [path.join(OUT_DIR, "dock-icon.png"), squared.toPNG()],
    [
      path.join(OUT_DIR, "tray-icon.png"),
      squareCentered(master, TRAY_PIXEL_SIZE, TRAY_MARGIN).toPNG(),
    ],
    [
      path.join(OUT_DIR, "tray-icon-flash.png"),
      withFlashDot(squareCentered(master, TRAY_PIXEL_SIZE, TRAY_MARGIN)).toPNG(),
    ],
    [
      path.join(OUT_DIR, "svg", HERO_SVG_NAME),
      Buffer.from(pixelGridSvg(master, HERO_GRID), "utf8"),
    ],
    [path.join(OUT_DIR, "tray-iconTemplate.png"), trayTemplate.toPNG()],
    [path.join(OUT_DIR, "tray-iconTemplate@2x.png"), trayTemplate2x.toPNG()],
    [
      path.join(OUT_DIR, "icon.ico"),
      encodeIco(
        ICO_SIZES.map((size) => ({
          size,
          png: squareCentered(master, size, APP_ICON_MARGIN).toPNG(),
        }))
      ),
    ],
  ];

  for (const [target, buffer] of outputs) {
    if (!dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer);
    }
    written.push([path.relative(ROOT, target), buffer.length]);
  }

  for (const [rel, bytes] of written) {
    console.log(`${dryRun ? "would write" : "wrote"} ${rel} (${bytes} bytes)`);
  }
}

// ── 진입점 ──

function getElectronBinary() {
  try {
    const electronPath = require("electron");
    if (typeof electronPath === "string" && electronPath) return electronPath;
  } catch {}

  if (process.platform === "win32") {
    return path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
  }
  return path.join(ROOT, "node_modules", ".bin", "electron");
}

function runInElectron() {
  const electronBin = getElectronBinary();
  if (!fs.existsSync(electronBin)) {
    throw new Error("Electron이 설치되지 않았다. npm install 후 다시 실행한다.");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawad-app-icons-"));
  const entryPath = path.join(tempDir, "main.js");

  fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ main: "main.js" }));
  fs.writeFileSync(
    entryPath,
    [
      `"use strict";`,
      `process.env.${EXPORTER_ENV} = "1";`,
      `require(${JSON.stringify(__filename)});`,
      "",
    ].join("\n")
  );

  const result = spawnSync(electronBin, [tempDir, ...process.argv.slice(2)], {
    cwd: ROOT,
    env: { ...process.env, [EXPORTER_ENV]: "1" },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });

  fs.rmSync(tempDir, { recursive: true, force: true });
  if (result.error) throw result.error;
  process.exitCode = result.status == null ? 1 : result.status;
}

if (process.env[EXPORTER_ENV] === "1") {
  app.disableHardwareAcceleration();
  app.whenReady().then(async () => {
    try {
      await main();
    } catch (error) {
      console.error(error && error.message ? error.message : error);
      process.exitCode = 1;
    }
    app.quit();
  });
} else if (require.main === module) {
  try {
    runInElectron();
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { encodeIco, contentBounds, ALPHA_THRESHOLD };
