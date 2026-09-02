# Claw-Ad Overlay v0.2.15

## 변경 사항
- 오버레이 자체의 변경은 없습니다. clawad 클라이언트 0.2.15와 번호를 맞추기 위한 릴리스입니다 (CLAW-214).
- clawad 0.2.15는 Windows에서 Codex 활동 감지 훅이 실행되지 않던 문제를 고쳤습니다 (CLAW-285). Codex는 Windows에서 `commandWindows`를 PowerShell로 실행하는데, 등록된 명령에 호출 연산자 `&`가 없어 ParserError로 죽고 있었습니다. Codex만 켜고 작업한 구간은 광고가 표시돼도 활동 구간이 없어 전부 미인정됐습니다.
- Windows에서 Codex를 쓰는 기존 사용자는 clawad 0.2.15로 갱신한 뒤 `clawad install`을 다시 실행해야 `~/.codex/hooks.json`의 명령이 고쳐집니다.

## 검증
- Electron·네이티브 의존성을 올리지 않았으므로 `runtimeId`는 0.2.14와 같습니다 — 기존 사용자는 전체 번들이 아니라 경량 경로를 탑니다 (CLAW-161).
- 매니페스트에 `codeUpdate.unpacked` 블록이 실려 나가는지 릴리스 산출물에서 확인합니다 (CLAW-283).

## 알려진 제한
- 코드서명·공증이 아직 없는 알파 빌드입니다. 첫 실행 시 SmartScreen / Gatekeeper 경고가 표시됩니다. (CLAW-95)
- 실기기 스모크 체크리스트(`docs/project/release-process.md`)는 이번 릴리스에서 돌리지 않았습니다. 오버레이 코드 변경이 없어 자동 테스트와 산출물 구성만 확인했습니다.
