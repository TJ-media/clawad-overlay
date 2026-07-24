# clawad-overlay

ClawAd의 **데스크탑 오버레이 클라이언트**. 화면 최상단에 항상 떠 있는 캐릭터(데스크펫)와 그 아래 텍스트 광고 한 줄을 렌더링한다. 터미널 statusline과 달리 특정 앱에 종속되지 않으므로, 어떤 에디터/앱을 쓰는 동안에도 광고를 노출할 수 있다.

> 상태: 초기 스켈레톤 (WIP). 렌더링 표면만 담당하며, 광고·정산 로직은 포함하지 않는다.

## 라이선스

- **소스코드: AGPL-3.0** ([LICENSE](LICENSE)). 이 저장소의 코드로 파생물을 만들거나 네트워크로 서비스하면 AGPL-3.0 조건(소스 제공 의무 포함)이 적용된다.
- **ClawAd 마스코트 아트워크는 AGPL 대상이 아니다** — © ClawAd, All rights reserved. 코드는 열되 캐릭터 IP는 별도로 보유한다. (upstream clawd-on-desk의 "코드 AGPL / 아트 별도" 구분과 동일한 방식.)

## 유래 (attribution)

이 프로젝트는 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) (AGPL-3.0)의 코드를 포크·활용해 데스크펫 렌더링을 구현한다. upstream 코드를 포함할 때는 원저작권 표시와 변경 고지를 보존한다. clawd-on-desk는 Anthropic과 무관한 비공식 팬 프로젝트이며, 본 저장소 또한 Anthropic 공식 산출물이 아니다.

## 아키텍처 경계 (중요)

이 클라이언트는 **ClawAd 서버와 네트워크 API(HTTP)로만** 통신한다.

```
clawad-overlay (이 레포, AGPL-3.0)  ──HTTP──▶  ClawAd 서버 (별도 비공개 저장소)
  · 데스크펫/오버레이 렌더링                     · 광고 서버 / 4원장 / 리워드 / 정산
```

ClawAd 서버(광고·원장·리워드·정산)는 **별개의 독립 프로그램**이며 이 저장소에 포함되지 않고 AGPL 대상도 아니다. 카피레프트 경계는 이 클라이언트 안에 갇혀 있어야 한다. 상세 규칙은 [docs/BOUNDARY.md](docs/BOUNDARY.md).

## 개발

(추후 채움 — Electron 셸, 빌드, 실행 방법)
