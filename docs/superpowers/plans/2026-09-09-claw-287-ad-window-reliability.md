# CLAW-287 광고창 가시성·상태 동기화 구현 계획

> Jira: CLAW-287
> 설계: `docs/superpowers/specs/2026-09-09-claw-287-ad-window-reliability-design.md`

## Task 1: 실제 페인트 ACK 뒤에만 노출 구간 열기

**Files**

- Modify: `apps/client-desktop/test/clawad-ad-runtime.test.js`
- Modify: `apps/client-desktop/test/clawad-ad-renderer.test.js`
- Modify: `apps/client-desktop/test/clawad-ad-window.test.js`
- Modify: `apps/client-desktop/src/clawad-ad-runtime.js`
- Modify: `apps/client-desktop/src/preload-clawad-ad.js`
- Modify: `apps/client-desktop/src/clawad-ad-renderer.js`
- Modify: `apps/client-desktop/src/clawad-ad-window.js`

1. `tick()` 직후 `stop()`해도 스풀이 없고, `confirmRendered(renderId, paintedAt)` 뒤 충분히 표시된 경우에만 `paintedAt`부터 스풀이 생기는 실패 테스트를 추가한다.
2. 현재 후보와 다른 ID, 이미 취소된 ID, 다른 webContents sender의 ACK가 무시되는 실패 테스트를 추가한다.
3. 렌더러가 DOM 갱신 뒤 두 번의 `requestAnimationFrame`을 거쳐 `reportPainted(renderId)`를 한 번 호출하는 실패 테스트를 추가한다.
4. 대상 테스트가 기대한 이유로 실패하는지 실행한다.
5. 런타임에 단일 pending 후보와 `confirmRendered`/`cancelPending`을 구현한다. 표시 중 광고의 payload에는 같은 `renderId`를 유지하고 스풀에는 넣지 않는다.
6. preload IPC와 메인 IPC 검증, ACK timeout 복구를 최소 구현한다.
7. 대상 테스트를 다시 실행해 통과시킨다.

Command:

```powershell
node --test test/clawad-ad-runtime.test.js test/clawad-ad-renderer.test.js test/clawad-ad-window.test.js
```

## Task 2: 광고창 topmost 순서와 장애 복구

**Files**

- Modify: `apps/client-desktop/test/topmost-runtime.test.js`
- Modify: `apps/client-desktop/test/clawad-ad-window.test.js`
- Modify: `apps/client-desktop/src/topmost-runtime.js`
- Modify: `apps/client-desktop/src/clawad-ad-window.js`
- Modify: `apps/client-desktop/src/main.js`

1. watchdog 한 tick에서 `ad → pet → hit` 순서로 같은 topmost 레벨을 재적용하는 실패 테스트를 추가한다.
2. 전체화면 stand-down에서는 세 창 모두 topmost를 재적용하지 않고 광고 cloak 복구도 건너뛰는 실패 테스트를 추가한다.
3. renderer gone, unresponsive, load failure 뒤 광고창이 파기되고 다음 tick에 재생성되는 실패 테스트를 추가한다.
4. 대상 테스트가 실패하는지 실행한다.
5. topmost runtime에 광고 getter와 복구 콜백을 추가하고 순서를 구현한다.
6. 광고창의 Windows 레벨을 중앙 상수와 맞추고 장애 핸들러 및 `recoverIfCloaked()`를 구현한다.
7. `main.js`에서 광고 getter와 resume/unlock 복구를 연결한다.
8. 대상 테스트를 통과시킨다.

Command:

```powershell
node --test test/topmost-runtime.test.js test/clawad-ad-window.test.js
```

## Task 3: 작업 상태 즉시 동기화와 빈 캐시 보충

**Files**

- Modify: `apps/client-desktop/test/clawad-ad-runtime.test.js`
- Modify: `apps/client-desktop/test/clawad-ad-window.test.js`
- Modify: `apps/client-desktop/test/clawad-cli-bridge.test.js`
- Modify: `apps/client-desktop/src/clawad-ad-runtime.js`
- Modify: `apps/client-desktop/src/clawad-ad-window.js`
- Modify: `apps/client-desktop/src/clawad-cli-bridge.js`

1. 최근에 끝난 세션은 정책 유예 안이어도 화면상 비활성으로 판정하고, active 세션만 표시하는 실패 테스트를 추가한다.
2. work-state/bundles 변경 통지가 interval을 기다리지 않고 tick하는 실패 테스트를 추가한다.
3. 작업 중 번들이 비면 검증된 sibling sync 명령을 한 번만 요청하고, 진행 중에는 로컬 준비 안내를 표시하는 실패 테스트를 추가한다.
4. 실패 테스트를 실행한다.
5. `isWorkRunning()`을 추가하고 화면 표시 게이트에 적용한다. 기존 `isWorkActive()`는 호환용으로 유지한다.
6. 디렉터리 watcher와 debounce를 구현하고 1초 poll을 fallback으로 유지한다.
7. CLI bridge의 기존 경로 검증을 재사용해 cooldown/in-flight 동기화 요청을 구현한다.
8. 대상 테스트를 통과시킨다.

Command:

```powershell
node --test test/clawad-ad-runtime.test.js test/clawad-ad-window.test.js test/clawad-cli-bridge.test.js
```

## Task 4: 통합 및 회귀 검증

**Files**

- Review: all files changed above

1. 변경 파일에 비공개 정책값, 비밀, 새 텔레메트리 필드가 없는지 검토한다.
2. 관련 테스트를 실행한다.
3. 전체 테스트를 실행하고 기존 기준선보다 실패 수가 늘지 않았는지 확인한다.
4. JavaScript 변경 파일에 `node --check`를 실행한다.
5. `git diff --check`와 `git status --short`로 무관한 변경이 없는지 확인한다.

Commands:

```powershell
node --test test/clawad-ad-runtime.test.js test/clawad-ad-renderer.test.js test/clawad-ad-window.test.js test/topmost-runtime.test.js test/clawad-cli-bridge.test.js
npm.cmd test
node --check src/clawad-ad-runtime.js
node --check src/clawad-ad-window.js
node --check src/clawad-ad-renderer.js
node --check src/preload-clawad-ad.js
node --check src/topmost-runtime.js
node --check src/main.js
git diff --check
git status --short --branch
```
