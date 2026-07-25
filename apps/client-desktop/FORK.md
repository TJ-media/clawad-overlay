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

이후 변경은 이 목록에 계속 추가한다.

## 4b. 배포 전 반드시 처리할 것

- **자동 업데이트가 upstream을 바라본다.** `src/updater.js`가
  `rullerzhou-afk/clawd-on-desk`의 releases/latest를 확인하고,
  `package.json`의 `build.publish`도 같은 저장소를 가리킨다.
  이대로 배포하면 클로애드 클라이언트가 upstream 앱으로 자가 업데이트된다. (CLAW-92)
- **미사용 기능 정리 검토**: 텔레그램/페이슈 원격 승인 브리지는 Claude Code의 권한
  프롬프트를 외부에서 승인하는 경로다. 광고 클라이언트에 불필요한 공격면이므로
  오버레이 범위 확정(CLAW-86) 시 제거 여부를 결정한다.

## 5. 경계

이 클라이언트는 클로애드 서버와 **HTTP API로만** 통신한다.
서버 코드를 `import`/`require`/링크하지 않는다. 상세는 [`docs/BOUNDARY.md`](../../docs/BOUNDARY.md).
