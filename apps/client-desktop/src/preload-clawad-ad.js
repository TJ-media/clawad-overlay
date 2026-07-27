"use strict";
// 오버레이 광고 창 preload (CLAW-90). 메인 → 렌더러 단방향 전달만 노출한다.

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
});
