# CLAUDE.md — clawad-overlay

이 문서는 코딩 에이전트가 **clawad-overlay** 저장소에서 작업할 때 따르는 규칙이다.
저장소 전체에 적용한다.

> **이 저장소는 공개(public)다.** 여기에 쓰는 모든 것은 외부에 공개된다고 가정한다.
> 서버 내부 설계(정산·원장·부정방지 판정 로직), 정책 수치, 내부 인프라 식별자는
> 코드·주석·문서·커밋 메시지 어디에도 쓰지 않는다. 그것들은 비공개 `clawad` 저장소에 있다.

---

## 0. 이 저장소가 뭔가

클로애드의 **데스크탑 오버레이 클라이언트**다. 화면에 떠 있는 마스코트와 그 아래 텍스트 광고
한 줄을 렌더링한다. 광고·정산 로직은 여기 없다 — **렌더링 표면만** 담당한다.

`apps/client-desktop/`은 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)(AGPL-3.0)
포크다. 유래·제외한 아트워크·변경 내역은 [`apps/client-desktop/FORK.md`](apps/client-desktop/FORK.md)에 있다.

## 1. 라이선스 경계 [CRITICAL]

상세는 [`docs/BOUNDARY.md`](docs/BOUNDARY.md). 요약:

1. 이 클라이언트와 클로애드 서버는 **HTTP API로만** 통신한다. 어느 쪽도 상대 소스를
   `import`/`require`/링크하지 않는다. 코드 결합이 생기면 "하나의 프로그램"으로 간주돼
   AGPL이 서버로 번진다.
2. 비공개 `clawad` 저장소의 코드를 이 저장소로 복사하지 않는다. 반대 방향도 금지 —
   **AGPL 코드는 여기에만 있어야 한다.**
3. upstream의 **아트워크·번들 테마 에셋은 반입 금지**다. AGPL 대상이 아니라
   All Rights Reserved이며, Clawd 캐릭터는 상업적 사용이 금지돼 있다.
   캐릭터는 클로애드 자체 마스코트(픽셀 랍스터)만 쓴다.
4. upstream 코드를 추가로 가져올 때는 코드만 추출해 적용하고, `FORK.md` §4에 변경을 기록한다.
   `git remote add upstream` + merge/subtree는 **쓰지 않는다** (upstream 히스토리에
   ARR 아트워크가 들어 있어 공개 재배포가 된다).

## 2. 클라이언트 보안 경계 [CRITICAL]

클라이언트는 사용자가 완전히 통제하는 환경이다. 다음은 **클라이언트가 결정·계산·전송하지 않는다**:

- 노출 단가, 배분율, 리워드 금액, 광고주 차감액
- 캠페인 활성 여부, 적립 상한, 부정 여부, 회원 잔액

클라이언트는 **사실만** 보고한다. 금액과 노출 인정 여부는 전부 서버가 판단한다.
**클라이언트는 HMAC이나 서비스 비밀 키를 갖지 않는다.**
화면에 수익을 표시할 때는 "예상"임을 명시한다.

## 3. 프라이버시 [CRITICAL]

클라이언트가 서버로 보내는 필드는 **다음 8개뿐**이다:

`serveToken` · `sequence` · `machineId` · `startedAt` · `endedAt` · `renderStarted` · `userId` · `clientVersion`

- `startedAt`/`endedAt`는 **광고 표시 구간**이다. 세션 시작·종료 시각이 아니다.
- `machineId`는 로컬 생성 랜덤 가명값이다. **하드웨어 식별자(MAC·시리얼·UUID) 수집 금지.**
- `campaignId`는 클라이언트가 보내지 않는다. 서버가 토큰에서 추출한다.

**수집 자체가 금지**(코드가 접근조차 하지 않아야 함): 프롬프트 본문, AI 응답, 코드 내용,
파일명·경로, Git 레포명, 터미널 명령어, 환경변수, 클립보드, 접속 IP, OS 종류, 오류 로그.

오버레이는 펫 상태를 알아야 하지만, **상태 구분은 훅을 어떤 이름으로 등록했는지(argv)로만**
얻는다. 훅 stdin 본문(`tool_name`·`tool_input` 등)을 열어보지 않는다.
새 필드가 필요하면 프라이버시 문서 갱신이 선행돼야 한다.

## 4. 표시 규칙 [CRITICAL]

- 광고 문구에 **`[광고]` 표기 필수**(표시광고법). 제거·변경 금지.
- **"Claude 공식 서비스"로 오인될 표현·아이콘 금지.** 이 프로젝트는 Anthropic과 무관하다.
- Claude Code의 공식 메시지·오류 메시지로 오인될 문구를 렌더링하지 않는다.
- 사용자에게 **일시중지·빈도 제어**를 제공한다. 서버 킬스위치를 유지한다.

## 5. 견고성 [HIGH]

- 상태 파일 부재·손상 → idle로 렌더하고 크래시하지 않는다. JSON 파싱 전 **BOM(U+FEFF) 제거.**
- 모니터 해제로 창이 화면 밖에 놓이면 주 모니터로 복귀한다.
- 최상단 표시가 불가능한 환경(Wayland 등)은 기동 시 안내 후 종료한다 (v1은 Linux 미지원).

## 6. 작업 방식

```bash
cd apps/client-desktop
npm install
npm test
npm run build:mac
```

### 브랜치 전략 (2026-07-30 정리)

**기능 브랜치 → `develop` → (운영 배포 시) `main`.** 비공개 `clawad` 저장소와 같은 흐름을 쓴다.

- `main` — 운영 배포 기준. 릴리스를 자르는 브랜치다. `develop`에서만 머지한다
- `develop` — 통합 브랜치. 기능 브랜치의 PR 대상이다
- `{feat|fix|chore|docs}/{이슈키 소문자}-{영문-슬러그}` — `develop`에서 분기, `develop`으로 머지
- **두 브랜치 모두 직접 푸시 금지.** PR로만 올린다
- 릴리스는 `develop` → `main` PR을 머지한 뒤 **main에서** 태그를 만든다. 태그를 develop에 달면 배포된 것과 태그가 어긋난다
- `clawad`와 걸친 변경은 **같은 브랜치명**으로 각각 PR을 만들고 본문에서 서로 링크한다

### 검증 기준

- `npm test`는 `apps/client-desktop`에서 돌린다. 약 22초. **lint 스크립트는 없다**
- **기존 실패 33건이 기준선이다** (`remote-ssh-*`·`state`·`theme` 계열). 0건을 기대하면 정상 상태를 실패로 오판한다. **이 수가 늘지 않았는지**로 판정한다
- Electron 앱을 띄우는 검증은 하지 않는다. 표시 로직은 `createAdRuntime({ dataDir })`을 별도 프로세스로 호출하고, 판정 함수는 실제 `work-state`를 임시 디렉터리로 복사해 비교한다

### 이 저장소의 함정

- `apps/client-desktop/.gitignore`는 **허용목록 방식**이다. `docs/**`·`scripts/*`가 통째로 무시되고 `!경로` 예외만 추적된다. 새 파일을 추가하면 예외를 함께 넣어야 커밋된다 — `git status`로 추적 여부를 반드시 확인한다
- electron-builder는 **서명 자격이 없으면 조용히 건너뛰고 빌드를 성공으로 끝낸다.** 빌드 로그를 믿지 말고 `npm run verify:signature`로 산출물을 검사한다
- 설치 경로는 productName 기준이다: `%LOCALAPPDATA%\Programs\Claw-Ad\Claw-Ad.exe`
- 새 정책 키를 정책 캐시에서 읽을 때는 **선택 항목으로 둔다.** 이 앱은 자동 업데이트되고 CLI는 수동 업데이트(`clawad update`)라 "새 오버레이 + 구 CLI" 조합이 실제로 생긴다. 키가 없다고 광고를 꺼버리면 적립이 영구히 0이 된다. 없으면 기존 동작 유지, 있는데 형식이 틀리면 거절 (전례: CLAW-135 `adGapMs`, CLAW-142 `staleActiveMs`)

### 그 밖

- 커밋 메시지: `{feat|fix|chore}: {한 줄 요약} ({CLAW-이슈키})`
- **커밋 메시지와 PR에 AI 활용 문구나 `Co-Authored-By`를 넣지 않는다.**
- git author는 `TJmedia <oganesson12@hufs.ac.kr>`만 쓴다.
- 최소 변경만 한다. 기존 코드 스타일을 따른다.
- 커밋·푸시·PR 생성은 사용자가 요청하거나 승인한 범위에서만 한다.
- PR은 교차 리뷰한다 (지식 공유 + 라이선스 경계 감시).
- 릴리스 절차 전문: `apps/client-desktop/docs/project/release-process.md`

## 7. 금지 사항 요약

- [CRITICAL] 클라이언트가 금액을 계산·전송 / 비밀 키 보유
- [CRITICAL] upstream 아트워크 반입 / upstream git 히스토리 병합
- [CRITICAL] 비공개 `clawad` 저장소 코드를 여기로 복사
- [CRITICAL] 전송 8필드 외 데이터 수집 / 훅 stdin 본문 열람 / 하드웨어 식별자 수집
- [CRITICAL] 서버 정책 수치·부정방지 판정 로직을 이 저장소에 기술
- [HIGH] `[광고]` 표기 제거 / Anthropic 공식으로 오인될 표현
