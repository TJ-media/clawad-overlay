"use strict";
// 클로애드 광고 창 preload (CLAW-90).
// 메인 → 렌더러 광고 전달과, 렌더러 → 메인 "지금 광고 열기" 신호만 노출한다.
// URL은 렌더러에 주지 않는다 — 메인이 갖고 있고 https만 열어준다.

const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();

ipcRenderer.on("clawad-ad:update", (_event, ad) => {
  for (const cb of listeners) {
    try { cb(ad); } catch (err) { console.warn("clawad ad listener threw:", err); }
  }
});

contextBridge.exposeInMainWorld("clawadAdAPI", {
  onAd: (cb) => {
    if (typeof cb !== "function") return () => {};
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  openAd: () => ipcRenderer.send("clawad-ad:open"),
  dismissNotice: () => ipcRenderer.send("clawad-ad:dismiss-notice"),
  // 내용에 맞는 자연 폭(CSS px)을 메인에 알린다. 창이 곧 패널이라 폭 결정은 메인이 한다 —
  // 정책 상한·최소 폭·작업영역 클램프가 전부 메인에 있다 (CLAW-156).
  reportWidth: (px) => ipcRenderer.send("clawad-ad:width", px),
});
