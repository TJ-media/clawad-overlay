const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("updateBubbleAPI", {
  onShow: (cb) => ipcRenderer.on("update-bubble-show", (_, data) => cb(data)),
  onHide: (cb) => ipcRenderer.on("update-bubble-hide", () => cb()),
  // 다운로드 진행률 전용 경량 채널 — 카드를 재렌더하지 않고 진행바만 갱신한다.
  onProgress: (cb) => ipcRenderer.on("update-bubble-progress", (_, percent) => cb(percent)),
  choose: (actionId) => ipcRenderer.send("update-bubble-action", actionId),
  reportHeight: (height) => ipcRenderer.send("update-bubble-height", height),
});
