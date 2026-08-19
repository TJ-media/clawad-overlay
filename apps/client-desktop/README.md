<p align="center">
  <img src="../../docs/assets/clawad-overlay-demo.gif" width="900" alt="Claude Code와 Codex 작업 중 애드워드 아래에 광고와 예상 적립이 표시되는 Claw-Ad Desktop Overlay">
</p>

<h1 align="center">Claw-Ad Desktop Overlay</h1>

<p align="center">
  클로애드의 캐릭터·에이전트 상태·스폰서 메시지를 렌더링하는 Electron 데스크톱 앱
</p>

<p align="center">
  <a href="../../README.md">저장소 소개</a>
  · <a href="https://clawad.whatsup.house/install">사용자 설치 안내</a>
  · <a href="FORK.md">포크 변경 고지</a>
  · <a href="../../docs/BOUNDARY.md">AGPL 경계</a>
</p>

> [!IMPORTANT]
> 이 디렉터리는 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) 기반 코드를 **Claw-Ad용으로 커스터마이징한 앱**입니다. 현재 Claw-Ad 제품의 공식 설명과 지원 범위는 이 문서와 저장소 루트 [README](../../README.md)를 기준으로 합니다. [보존된 upstream 문서](UPSTREAM.md)의 기능 목록은 Claw-Ad의 지원 약속이 아닙니다.

## 현재 제품 범위

Claw-Ad Desktop Overlay는 Closed Alpha에서 실제 광고 표시 창구로 운영되고 있습니다.

- Claude Code와 Codex의 작업 상태에 반응하는 자체 마스코트 **애드워드**
- 캐릭터 아래 한 줄로 표시되는 `[광고]` 스폰서 메시지
- 작업 활성 구간과 로컬 광고 캐시를 이용한 오프라인 렌더링
- 표시 시작·종료 사실을 append-only 로컬 스풀에 기록
- 캐릭터·광고판 드래그, 크기 변경, 미니 모드와 트레이 메뉴
- Windows x64·ARM64, macOS x64·Apple Silicon 배포
- Claw-Ad CLI와 연동한 설치·로그인·업데이트·제거

저장소에 남아 있는 다른 AI 에이전트 통합 코드는 포크 기반의 내부 구현입니다. Claw-Ad 서비스에서 현재 광고 활동 감지 대상으로 지원하는 에이전트는 **Claude Code와 Codex**입니다.

## 광고 표시 계약

오버레이는 광고와 정산의 판정자가 아닙니다.

1. Claw-Ad 클라이언트가 서버에서 받은 광고·정책을 로컬 캐시에 저장합니다.
2. 오버레이가 작업 활성 신호와 캐시를 읽어 광고를 렌더링합니다. 이 경로에서는 네트워크를 호출하지 않습니다.
3. 표시가 끝나면 `serveToken`, 실제 렌더 시작 시각, 인정 구간 시작·종료 시각만 로컬 스풀에 기록합니다.
4. Claw-Ad 클라이언트가 스풀을 수거해 append-only 원장에 반영하고 서버로 전송합니다.
5. 서버가 최소 표시 시간·토큰·중복·동시 노출·계정 상한을 검증하고 과금과 리워드를 계산합니다.

오버레이 코드에서 금액·리워드·유효 노출 여부를 계산하거나 서비스 비밀 키를 보유해서는 안 됩니다. 로컬 파일 계약은 메인 저장소의 `docs/design/overlay-contract.md`, 저장소 간 결합 원칙은 [AGPL 경계 문서](../../docs/BOUNDARY.md)가 정의합니다.

## 로컬에서 실행하기

### 요구 환경

- Node.js 22.12 이상
- npm
- Windows 또는 macOS 권장

### 설치와 실행

```bash
npm ci
npm start
```

Claw-Ad 로컬 데이터가 기본 경로가 아니라면 `CLAWAD_DATA`로 디렉터리를 지정할 수 있습니다. 운영 계정이나 실제 사용자 데이터를 개발 환경에 복사하지 마세요.

일반 사용자는 소스에서 실행하지 않고 [Claw-Ad CLI 설치 명령](https://clawad.whatsup.house/install)을 사용합니다.

## 테스트

```bash
npm test
```

테스트는 Node.js 내장 test runner를 사용하며, 광고 렌더링·스풀·창 배치·훅·상태 머신·설정·업데이트·플랫폼별 설치 규약을 검증합니다.

플랫폼 UI는 자동화만으로 충분하지 않습니다. 투명 창, 트레이, 캐릭터와 광고판의 드래그 추종, 미니 모드, 다중 모니터, Windows 포커스와 macOS 앱 수명 주기는 해당 운영체제에서 수동 확인이 필요합니다.

## 빌드

Windows:

```bash
npm run build:win:x64
npm run build:win:arm64
```

macOS:

```bash
npm run build:mac:x64
npm run build:mac:arm64
```

릴리스 산출물은 Claw-Ad CLI가 읽는 오버레이 매니페스트와 체크섬 계약을 따라야 합니다. 일반 개발 빌드를 운영 릴리스로 게시하지 마세요.

## 주요 파일

| 경로 | 역할 |
|---|---|
| `src/main.js` | Electron 수명 주기와 창·IPC 조립 |
| `src/clawad-ad-runtime.js` | 로컬 정책·광고 캐시 읽기, 표시 구간과 스풀 기록 |
| `src/clawad-ad-window.js` | 캐릭터 아래 광고 창 생성·배치·상호작용 |
| `src/clawad-ad-renderer.js` | `[광고]` 소재와 안내 문구 렌더링 |
| `src/clawad-surface-lock.js` | 광고 표시 창구 단일 소유권 관리 |
| `src/clawad-auth-state.js` | 로그인 상태 확인과 Claw-Ad CLI 위임 |
| `src/state.js` | 다중 세션과 캐릭터 상태 결정 |
| `src/renderer.js` | 테마 애니메이션·눈동자·전환 렌더링 |
| `src/menu.js` | 트레이·우클릭 메뉴 |
| `src/mini.js` | 화면 가장자리 미니 모드 |
| `src/updater.js` | 오버레이 업데이트 |
| `themes/clawad/` | 자체 마스코트 테마와 아트워크 라이선스 |
| `test/` | Node.js 회귀 테스트 |

상세한 upstream 런타임 구조를 수정해야 할 때는 [AGENTS.md](AGENTS.md)의 파일별 책임과 고위험 주의사항을 먼저 확인하세요.

## 반드시 지켜야 할 원칙

- 모든 광고에 `[광고]`를 유지합니다.
- 광고 문자열의 개행·ANSI·OSC 등 제어문자를 제거하고 길이를 제한합니다.
- 표시 경로에서 네트워크를 호출하지 않습니다.
- 클라이언트에서 과금·리워드·유효 노출을 결정하지 않습니다.
- 프롬프트·모델 응답·소스코드·파일명·경로·터미널 명령·환경변수·클립보드를 수집하거나 전송하지 않습니다.
- Claw-Ad 서버 소스를 가져오거나 링크하지 않고 문서화된 로컬 파일·HTTP 계약만 사용합니다.
- 기존 에이전트 훅을 덮어쓰지 않으며, 제거 시 Claw-Ad가 추가한 항목만 정리합니다.
- 마스코트 아트워크와 앱 아이콘은 AGPL 코드와 라이선스가 다릅니다.

## upstream과의 관계

이 앱은 clawd-on-desk `v0.13.0`의 코드를 기준으로 시작했습니다. 원저작권 표시와 AGPL-3.0 라이선스는 보존하되, upstream의 아트워크는 라이선스와 상업적 사용 조건 때문에 반입하지 않았습니다.

Claw-Ad는 다음을 자체 구현하거나 교체했습니다.

- 픽셀 랍스터 마스코트·아이콘·테마
- 광고 한 줄 렌더링과 표시 사실 스풀
- Claw-Ad CLI·정책 캐시·업데이트 연동
- 제품명·사용자 노출 문자열과 배포 저장소
- 광고 서비스에 불필요하거나 외부 전송 위험이 있는 기능 제거

정확한 기준 커밋과 변경 내역은 [FORK.md](FORK.md), 포함된 제3자 자료는 [NOTICE.md](NOTICE.md)를 확인하세요.

## 라이선스

- 앱 소스코드: [AGPL-3.0](LICENSE)
- Claw-Ad 마스코트 테마: [© Claw-Ad, All rights reserved](themes/clawad/LICENSE)
- 앱·Dock·트레이·히어로 아트워크: [© Claw-Ad, All rights reserved](assets/LICENSE)

Claw-Ad 서버는 이 저장소에 포함되지 않은 별개의 독립 프로그램입니다. 자세한 경계는 [docs/BOUNDARY.md](../../docs/BOUNDARY.md)를 따릅니다.
