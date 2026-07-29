# 코드서명·공증 (CLAW-95)

공개 배포 전에 반드시 끝내야 한다. **인증서 조달이 선행**이며 코드로는 대체할 수 없다.

## 현재 상태 (2026-07-29)

서명이 **전혀 없다.** 빌드 로그에 `signing with signtool.exe`가 찍히지만 산출물은 미서명이다 —
electron-builder는 서명 자격이 없으면 조용히 건너뛰고 빌드를 성공으로 끝낸다. 그래서 로그를
믿지 않고 산출물을 직접 검사한다.

```bash
npm run verify:signature          # 상태만 출력, 종료 코드 0
npm run verify:signature:require  # 하나라도 미서명이면 종료 코드 1
```

v0.1.0 기준 결과: `Claw-Ad-Setup-0.1.0-x64.exe — 미서명 (NotSigned)`.

미서명 배포의 실제 영향:

- **Windows** — SmartScreen이 "알 수 없는 게시자" 경고를 띄운다. 통합 설치(CLAW-133)가
  인스톨러를 무인 실행하므로 사용자가 이유를 알 수 없는 경고를 만난다. 일반 공개 전 필수.
- **macOS** — macOS 15(Sequoia)부터 미서명 앱의 우클릭→열기 우회가 제거됐다. 시스템 설정을
  거쳐야 실행되므로 사실상 배포 불가.

## Windows — 세 가지 선택지

| 방식 | 비용 | SmartScreen | 하드웨어 토큰 | 비고 |
|---|---|---|---|---|
| **Azure Artifact Signing** (구 Trusted Signing) | 월 $9.99 (Basic, 서명 5,000건) | 평판 축적 방식 | **불필요** | 개인 개발자도 가입 가능. HSM을 Microsoft가 운영 |
| OV 인증서 | 연 20~40만원 | 평판 축적 방식 | 필요 (FIPS 140-2) | 2023-06부터 하드웨어 보관 의무 |
| EV 인증서 | 연 40~70만원 | **즉시 획득** | 필요 (FIPS 140-2) | 가장 빠르지만 가장 비싸다 |

**Azure Artifact Signing을 권한다.** 연 비용이 한 자릿수 만원대(월 $9.99)이고, 하드웨어 토큰
조달·보관·CI 연동 문제가 사라진다. electron-builder 26.x가 `win.azureSignOptions`로 직접
지원한다. 단점은 EV처럼 SmartScreen 평판을 즉시 얻지는 못한다는 것 — 다운로드가 쌓이며 해제된다.

빌드 파이프라인은 이 방식 기준으로 준비해 뒀다. 인증서만 생기면 환경변수 4개로 켜진다.

## Windows 적용 절차

1. Azure 구독에서 **Artifact Signing** 계정과 인증서 프로필을 만든다. 개인 개발자는 신분 확인
   절차를 거친다(리드타임 있음).
2. 서명용 **앱 등록(App registration)** 을 만들고 Artifact Signing 계정에 서명 권한을 준다.
3. GitHub 저장소 시크릿에 다음을 넣는다. **값이 레포에 들어가지 않는다** (규칙 [SECURITY]).

   | 시크릿 | 내용 |
   |---|---|
   | `AZURE_TENANT_ID` · `AZURE_CLIENT_ID` · `AZURE_CLIENT_SECRET` | 앱 등록 자격 (Invoke-TrustedSigning 모듈이 직접 읽는다) |
   | `AZURE_SIGN_ENDPOINT` | 인증서 생성 시 고른 지역 엔드포인트 |
   | `AZURE_SIGN_ACCOUNT` | Artifact Signing 계정 이름 (앱 등록 이름이 아니다) |
   | `AZURE_SIGN_PROFILE` | 인증서 프로필 이름 |
   | `AZURE_SIGN_PUBLISHER` | 인증서의 CN과 **정확히** 일치해야 한다 |

4. 서명 빌드를 실행한다.

   ```bash
   npm run build:win:x64:signed
   npm run verify:signature:require
   ```

   `--config.forceCodeSigning=true`가 붙어 있어 **서명이 실패하면 빌드가 실패한다.** 조용히
   미서명 산출물이 나가는 경로를 없앤 것이다. 그래도 `verify:signature:require`를 게시 전에
   한 번 더 돌린다 — electron-builder를 믿지 않는다.

## macOS 적용 절차

1. Apple Developer Program 등록 (연 $99). 법인은 D-U-N-S 번호가 필요해 리드타임이 더 길다.
2. **Developer ID Application** 인증서를 발급해 `.p12`로 내보낸다.
3. GitHub 시크릿: `CSC_LINK`(p12 base64) · `CSC_KEY_PASSWORD` · `APPLE_ID` ·
   `APPLE_APP_SPECIFIC_PASSWORD` · `APPLE_TEAM_ID`.
4. `build.mac.notarize`를 켜고 빌드한다. 서명만으로는 부족하고 **공증까지** 통과해야 경고가
   사라진다. 공증 자체는 무료다.
5. `npm run verify:signature:require` — macOS에서는 `codesign` 검증과 `spctl` 공증 확인을
   함께 한다. 공증이 확인되지 않으면 그 사실을 출력한다.

## CI

`.github/workflows/build.yml`의 Windows 잡은 서명 시크릿이 **있을 때만** 서명 빌드를 하고,
없으면 기존 무서명 빌드를 그대로 한다. 폐쇄 알파를 막지 않으면서 시크릿이 채워지는 순간
자동으로 켜지게 하려는 것이다. 어느 경로든 `verify:signature`로 결과를 기록한다.

태그 릴리스(`refs/tags/v*`)는 `verify:signature:require`를 통과해야 게시된다.

## 조달이 늦어지면

폐쇄 알파는 무서명으로 계속한다. **공개 배포만 보류**한다 (CLAW-95 [예외]).
통합 설치(CLAW-133)의 무인 실행을 일반 공개로 넓히는 것도 이 조달 이후다.

## 검증 항목

- `npm run verify:signature:require`가 `SIGNATURE_CHECK_PASS`로 끝난다
- 서명자 CN이 우리 조직명과 일치한다 (`verify:signature` 출력에 Subject가 찍힌다)
- 깨끗한 Windows에서 인스톨러를 실행해 SmartScreen 경고가 없다
- macOS에서 `spctl --assess`가 `source=Notarized Developer ID`를 보고한다
- 서명 시크릿을 비운 상태로 `build:win:x64:signed`를 돌리면 **빌드가 실패한다**
  (조용히 미서명으로 넘어가지 않는지 확인)
