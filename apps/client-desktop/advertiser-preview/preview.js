"use strict";

(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ClawAdPreview = api;

  if (root && root.document && root.ClawAdPreviewModel) {
    const start = () => {
      const controller = api.createPreviewController(root.document, root.ClawAdPreviewModel);
      controller.start();
    };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})(typeof globalThis === "object" ? globalThis : this, () => {
  const REQUIRED_IDS = [
    "creativeText", "creativeBrand", "creativeCopy", "creativeBrandOutput",
    "textCount", "brandCount", "validationMessage", "mascotImage", "mascotName",
    "mascotChoices", "mascotMessage",
  ];

  function createPreviewController(documentRef, model) {
    const nodes = Object.fromEntries(REQUIRED_IDS.map((id) => [
      id,
      documentRef && typeof documentRef.getElementById === "function"
        ? documentRef.getElementById(id)
        : null,
    ]));
    let previewCounter = 0;
    let selectedMascot = null;

    function render() {
      if (!nodes.creativeText || !nodes.creativeBrand || !model || typeof model.buildPreviewState !== "function") return null;
      const state = model.buildPreviewState({
        text: nodes.creativeText.value,
        brand: nodes.creativeBrand.value,
      });
      if (nodes.creativeCopy) nodes.creativeCopy.textContent = state.text;
      if (nodes.creativeBrandOutput) nodes.creativeBrandOutput.textContent = state.brand;
      if (nodes.textCount) nodes.textCount.textContent = `${state.textLength} / 120`;
      if (nodes.brandCount) nodes.brandCount.textContent = `${state.brandLength} / 60`;
      if (nodes.validationMessage) nodes.validationMessage.textContent = state.textEmpty ? "광고 문구를 입력해 주세요." : "";
      return state;
    }

    function selectMascot(id) {
      const mascot = model && typeof model.findMascot === "function" ? model.findMascot(id) : null;
      if (!mascot) return null;
      selectedMascot = mascot;
      previewCounter += 1;
      if (nodes.mascotMessage) nodes.mascotMessage.textContent = "";
      if (nodes.mascotImage) {
        nodes.mascotImage.src = `../themes/clawad/assets/${mascot.file}?preview=${previewCounter}`;
        nodes.mascotImage.alt = mascot.nameKo;
      }
      if (nodes.mascotName) nodes.mascotName.textContent = mascot.nameKo;
      if (nodes.mascotChoices && nodes.mascotChoices.children) {
        for (const button of nodes.mascotChoices.children) {
          if (button && typeof button.setAttribute === "function") {
            button.setAttribute("aria-pressed", button.dataset && button.dataset.mascotId === mascot.id ? "true" : "false");
          }
        }
      }
      return mascot;
    }

    function createMascotChoices() {
      if (!nodes.mascotChoices || !documentRef || typeof documentRef.createElement !== "function" || !model.MASCOTS) return;
      for (const mascot of model.MASCOTS) {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.textContent = mascot.nameKo;
        button.dataset.mascotId = mascot.id;
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => selectMascot(mascot.id));
        if (typeof nodes.mascotChoices.appendChild === "function") nodes.mascotChoices.appendChild(button);
      }
    }

    function start() {
      if (nodes.creativeText && typeof nodes.creativeText.addEventListener === "function") nodes.creativeText.addEventListener("input", render);
      if (nodes.creativeBrand && typeof nodes.creativeBrand.addEventListener === "function") nodes.creativeBrand.addEventListener("input", render);
      if (nodes.mascotImage && typeof nodes.mascotImage.addEventListener === "function") {
        nodes.mascotImage.addEventListener("error", () => {
          if (nodes.mascotMessage) nodes.mascotMessage.textContent = "마스코트 이미지를 불러오지 못했습니다.";
        });
        nodes.mascotImage.addEventListener("load", () => {
          if (nodes.mascotMessage) nodes.mascotMessage.textContent = "";
        });
      }
      createMascotChoices();
      render();
      if (!selectedMascot && model.MASCOTS && model.MASCOTS[0]) selectMascot(model.MASCOTS[0].id);
    }

    return { start, render, selectMascot };
  }

  return { createPreviewController, REQUIRED_IDS };
});
