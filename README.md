# Claw-Ad Desktop Overlay

<p align="center">
  <a href="https://github.com/TJ-media/clawad-overlay/releases/latest"><img src="https://img.shields.io/github/v/release/TJ-media/clawad-overlay?label=release&color=coral" alt="최신 릴리스" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-2563eb" alt="지원 플랫폼" />
  <img src="https://img.shields.io/badge/stage-Closed%20Alpha-f59e0b" alt="Closed Alpha" />
  <img src="https://img.shields.io/badge/code-AGPL--3.0-663399" alt="AGPL-3.0" />
</p>

<p align="center">
  <img src="docs/assets/clawad-overlay-demo.gif" alt="Claude Code와 Codex 작업 중 애드워드 아래에 광고와 예상 적립이 표시되는 Claw-Ad Desktop Overlay" width="900" />
</p>

Claw-Ad의 데스크톱 오버레이 클라이언트입니다.

Claude Code·Codex 사용 중 에이전트 상태를 시각화하고, Claw-Ad 서버에서 전달받은 스폰서 메시지를 캐릭터 아래에 `[광고]` 표기와 함께 표시합니다.

> [!IMPORTANT]
> Claw-Ad는 현재 Closed Alpha로 운영 중입니다. 전체 서비스 소개와 설치 방법은 [메인 저장소](https://github.com/TJ-media/clawad)를 참고하세요.

## 주요 기능

- AI 코딩 에이전트의 작업 상태에 반응하는 자체 마스코트 **애드워드**
- 캐릭터 아래 한 줄로 표시되는 `[광고]` 스폰서 메시지와 예상 적립
- 캐릭터·광고판 이동, 크기 조절, 미니 모드와 트레이 메뉴
- 프롬프트·소스코드·파일명·프로젝트 경로를 서버로 보내지 않는 최소 수집 설계
- Windows x64·ARM64, macOS x64·Apple Silicon 지원

일반 사용자는 저장소를 직접 빌드하지 않고 [공식 설치 안내](https://clawad.whatsup.house/install)의 Claw-Ad CLI를 사용합니다.

## 개발

Electron 앱은 [`apps/client-desktop`](apps/client-desktop)에 있습니다.

```bash
cd apps/client-desktop
npm ci
npm start
npm test
```

구조·빌드·테스트와 제품 불변식은 [한국어 개발 README](apps/client-desktop/README.md)를 확인하세요.

## AGPL과 upstream

이 앱은 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)의 AGPL-3.0 코드를 기반으로 Claw-Ad용으로 커스터마이징했습니다. upstream의 저작권·라이선스 고지는 보존하지만, upstream의 기능 목록은 Claw-Ad의 지원 약속이 아닙니다.

- 기준 커밋과 변경 내역: [FORK.md](apps/client-desktop/FORK.md)
- 제3자 고지: [NOTICE.md](apps/client-desktop/NOTICE.md)
- 저장소 간 경계: [docs/BOUNDARY.md](docs/BOUNDARY.md)
- 보존된 upstream README: [UPSTREAM.md](apps/client-desktop/UPSTREAM.md)

소스코드는 [AGPL-3.0](LICENSE), Claw-Ad 마스코트·아이콘·테마 아트워크는 각 자산 디렉터리의 별도 라이선스를 따릅니다. Claw-Ad 서버는 이 저장소에 포함되지 않은 독립 시스템입니다.

Claw-Ad는 Anthropic 또는 Claude와 제휴·후원 관계가 없는 독립 서비스입니다.
