# 포크 고지 (Fork Notice)

이 디렉터리(`apps/client-desktop/`)의 코드는 **clawd-on-desk**를 포크한 것이다.
AGPL-3.0 §5(a)(b)의 변경 고지 의무와 `docs/BOUNDARY.md` §3을 충족하기 위해 아래를 기록한다.

## 1. 원본 (upstream)

| 항목 | 값 |
|---|---|
| 프로젝트 | [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) |
| 저작자 | 鹿鹿 ([@rullerzhou-afk](https://github.com/rullerzhou-afk)) 및 기여자 |
| 라이선스 | **AGPL-3.0** (소스코드) |
| 포크 기준 버전 | `v0.13.0` |
| 포크 기준 커밋 | `960f6f0f7d4bb262b58cd99b9100f4958c02d494` (2026-07-25) |
| 반입일 | 2026-07-25 |

원본의 `LICENSE`(AGPL-3.0 전문)와 `NOTICE.md`(OpenClaw 픽셀 랍스터 아이콘 MIT 고지)는
이 디렉터리에 **그대로 보존**한다. 삭제·수정하지 않는다.

## 2. 반입하지 않은 것 — 아트워크 전량

원본의 아트워크는 **AGPL 대상이 아니며 All Rights Reserved**다
(원본 `assets/LICENSE`, `README.md` §License).

특히 원본 아트의 사용 조건은 다음과 같다:

> Clawd 캐릭터는 Anthropic의 자산이며, 이 픽셀아트는 팬 창작물로
> **상업적 목적에 사용할 수 없다**(may not be used for commercial purposes).

클로애드는 광고 매체 = 상업 서비스이므로 **사용할 수 없다.**
따라서 다음을 전량 제외했다:

| 제외 대상 | 사유 |
|---|---|
| `assets/` 전체 | ARR. Clawd(Anthropic)·삼화묘·Cloudling 캐릭터 아트, 트레이 아이콘, 사운드, 영상 |
| `themes/calico/`, `themes/cloudling/`, `themes/clawd/` | 캐릭터별 테마 정의 및 아트 |
| `themes/template/assets/` | 템플릿 동봉 아트 (`theme.json`만 반입) |
| `tools/calico-final.svg`, `tools/calico-test.html` | 삼화묘 아트 — `assets/` **밖**에 있어 별도 제외 필요 |
| `pwa/icons/icon-256.png`, `pwa/icons/icon-512.png` | 앱 아이콘 아트 |
| `test/fixtures/codex-pets/tiny-atlas-png/spritesheet.png` | 캐릭터 스프라이트시트 |

**upstream의 git 히스토리도 잇지 않았다.** `assets/`를 건드린 커밋이 96개 존재하여,
히스토리를 그대로 가져오면 ARR 아트워크를 공개 저장소로 재배포하게 된다.
따라서 히스토리 없는 **단일 커밋(squash)으로 코드만** 반입했다.
AGPL이 요구하는 저작권 표시·변경 고지는 이 문서와 보존된 `LICENSE`/`NOTICE.md`로 충족한다.

향후 upstream 변경분을 반영할 때도 같은 방식(코드만 추출 후 차분 적용)을 쓰고,
`git remote add upstream` + merge/subtree는 **사용하지 않는다.**

## 3. 캐릭터

펫 캐릭터는 클로애드 자체 제작 마스코트(픽셀 랍스터)만 사용한다.
테마는 `clawad` 저장소의 `mascot/theme-out/clawad/`에서 빌드한 산출물을 쓴다.
마스코트 아트워크는 © ClawAd, All rights reserved이며 AGPL 대상이 아니다
(코드는 열되 캐릭터 IP는 보유 — 원본의 "코드 AGPL / 아트 별도" 구분과 동일한 방식).

## 4. 변경 내역

- 2026-07-25 — upstream `v0.13.0` (`960f6f0`) 코드 반입. 위 §2 아트워크 전량 제외. (CLAW-89)
- 2026-07-25 — `cc-connect-clawd` Go 사이드카 의존 제거. (CLAW-89)
  - `package.json`: `prebuild*` 훅 7개 삭제, `start`에서 `ensure-sidecar-binaries.js` 제거,
    `build.extraResources`의 `bin/cc-connect-clawd` 항목 삭제
  - 사유: 사이드카는 텔레그램 승인 기능 전용이고 해당 기능은 기본 비활성(`enabled: false`)이다.
    오버레이(펫 + 광고 렌더)와 무관한데도 빌드가 외부 GitHub 릴리스의 서명 없는
    실행 바이너리 다운로드를 강제하고 있었다. 기능 코드 자체는 아직 남아 있다.

- 2026-07-25 — 에이전트 지침 정비. (CLAW-89)
  - `CLAUDE.md`를 저장소 루트 `CLAUDE.md`를 가리키도록 교체 (원본은 `AGENTS.md` 한 줄 포인터였다)
  - `AGENTS.md` 상단에 upstream 문서임을 알리는 배너 추가 — 내용은 보존

- 2026-07-25 — 기본 테마를 클로애드 마스코트로 교체. (CLAW-89)
  - `themes/clawad/` 추가 (에셋 44개, v1.6.0). 아트 라이선스는 `themes/clawad/LICENSE`에
    ARR로 분리 표기 — upstream이 `assets/LICENSE`로 하던 방식과 동일하다
  - `src/theme-loader.js`에 `DEFAULT_THEME_ID` 상수 신설(`"clawad"`)하고 폴백 경로에 적용
  - 기본 테마 id 폴백 9곳(`prefs.js`·`main.js`·`codex-pet-main.js`·`settings-ipc.js`·
    `settings-tab-anim-map.js`)과 표시명 폴백 1곳을 교체
  - `test/fixtures/codex-pets/tiny-atlas-png/spritesheet.png` 복원 — 캐릭터 아트가 아니라
    절차적 생성 색상 견본 격자다(픽스처 README가 "generated test art"로 명시). 최초 반입 때
    과잉 제외했던 것을 되돌린다

- 2026-07-25 — 앱·트레이 아이콘을 클로애드 마스코트로 자체 제작. (CLAW-120)
  - `scripts/export-app-icons.js` 신설 (`npm run export-app-icons`).
    `themes/clawad/assets/clawad-idle.svg`에서 7종을 생성한다 —
    `icon.png`·`dock-icon.png`(1024, Apple 그리드 80.5%), `icon.ico`(16~256 6단계),
    `tray-icon.png`(32px), `tray-iconTemplate.png`·`@2x`(macOS 템플릿),
    `source/dock-icon-fullbleed.png`(재프레이밍용 원본)
  - 손으로 만든 PNG를 커밋하는 대신 스크립트로 둔 이유: 테마 아트가 바뀔 때
    아이콘이 조용히 낡는 것을 막는다
  - 소스가 합성 SVG(파츠를 외부 PNG로 참조)라 `nativeImage`·`sips`로는 래스터화할 수 없다.
    Electron 오프스크린 창으로 렌더하며, 렌더용 HTML은 에셋 디렉터리 안에 써서
    `file://` origin으로 로드해야 참조가 풀린다 (`data:` URL은 origin이 불투명해 실패)

- 2026-07-25 — **에이전트 아이콘은 반입하지 않는다** (결정). (CLAW-120 / CLAW-94)
  - upstream `assets/icons/agents/*.png`는 Anthropic·OpenAI·Google 등 20개 벤더 로고다.
  - upstream 저작권 문제는 **아니다** — upstream도 소유를 주장하지 않는다
    (`assets/LICENSE`: "Copyright is retained by the respective artists").
  - 걸리는 것은 **제3자 상표**다. 오버레이의 펫이 광고 표시면이라 유료 광고 옆에
    벤더 로고가 놓이는 구도가 되고, 이는 규칙 §7의 "공식 서비스 오인 금지"와 충돌한다.
    변형 로고 사용을 금지하는 벤더 브랜드 가이드라인도 있다.
  - 팬 프로젝트(upstream)와 상업 광고 매체(클로애드)는 같은 사용이라도 판단이 다르다.
    리스크를 감수할 이유가 없어 사용하지 않는다.
  - 예외: `openclaw.svg`는 MIT이므로 필요해지면 저작자 표시만으로 사용 가능하다
    (`NOTICE.md` 참조).

이후 변경은 이 목록에 계속 추가한다.

- 2026-07-28 — 사용자 노출 문자열을 클로애드 브랜드로 교체. (CLAW-126)
  - `src/i18n.js`·`src/settings-i18n.js`의 로케일 사전 5종(en·zh·zh-TW·ko·ja) 안에서
    `Clawd`/`Clawd on Desk` **497건**을 `Claw-Ad`(한국어는 `클로애드`)로 교체
  - `build.productName` → `Claw-Ad`, `build.appId` → `ai.clawad.overlay`
    (Windows AppUserModelID도 같은 값으로 맞춤 — `src/settings-window-icon.js`)
  - 창 제목: 펫 `Claw-Ad`, 설정 `Claw-Ad Settings`, 광고 스트립 `Claw-Ad Strip`. 트레이 툴팁 `Claw-Ad`
  - **바꾸지 않은 것**: 소문자 기능 식별자(`clawd-on-desk` 플러그인 id, `clawd://` 프로토콜,
    훅 마커 `managed by clawd-on-desk`, `clawd-prefs.json`·`clawd.json` 파일명), 전역 심볼
    `root.ClawdSettingsI18n`, upstream 저작권·기여자 고지, `package.json`의 `author`·`linux.maintainer`
    (연락처 확정 필요 — 아래 4b 참조), 콘솔 로그 접두사

## 4b. 배포 전 반드시 처리할 것

- **`package.json`의 `author`·`linux.maintainer`가 upstream 저작자로 남아 있다.** 브랜딩 교체
  대상이지만 공개 저장소에 넣을 연락처(이름·이메일)를 정해야 해서 미뤘다. deb 빌드는
  `maintainer` 형식을 요구하므로 Linux 지원을 켜기 전에는 반드시 채워야 한다. (CLAW-126)

- ~~**자동 업데이트가 upstream을 바라본다.**~~ **해결 (2026-07-28, CLAW-92)** —
  `src/updater.js`의 조회 대상을 `UPDATE_REPO_SLUG = "TJ-media/clawad-overlay"` 한 곳으로 모으고
  `package.json`의 `build.publish`도 같은 저장소로 바꿨다. User-Agent도 `Claw-Ad`로 교체했다.
  아직 릴리스가 없으므로 조회는 실패하고 업데이터는 조용히 지나간다 — 배포 채널 구성은 CLAW-92 본편.
- **미사용 기능 정리 검토**: 텔레그램/페이슈 원격 승인 브리지는 Claude Code의 권한
  프롬프트를 외부에서 승인하는 경로다. 광고 클라이언트에 불필요한 공격면이므로
  오버레이 범위 확정(CLAW-86) 시 제거 여부를 결정한다.

## 5. 경계

이 클라이언트는 클로애드 서버와 **HTTP API로만** 통신한다.
서버 코드를 `import`/`require`/링크하지 않는다. 상세는 [`docs/BOUNDARY.md`](../../docs/BOUNDARY.md).
