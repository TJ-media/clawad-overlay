"use strict";

// clawad CLI에 일을 넘기는 공용 다리 (CLAW-160).
//
// 오버레이가 직접 하지 않고 CLI에 맡기는 일이 둘이다 — 로그인(CLAW-137)과 갱신(CLAW-160).
// 둘 다 계약 §3.3의 트리거 포인터에서 **같은 디렉터리의 다른 스크립트**를 끌어내는 방식이고,
// 같은 보안 성질을 지켜야 한다: `script`의 파일명이 `overlay-events.js`가 아니면 실행하지
// 않는다. 검사가 두 곳에 흩어지면 한쪽만 고쳐질 수 있어 여기 한 번만 둔다.

const fs = require("fs");
const path = require("path");

const { clawadDataDir } = require("./clawad-surface-lock");

/** 트리거 파일이 가리켜야 하는 스크립트 파일명. 이 이름이 아니면 실행하지 않는다 (계약 §3.3). */
const TRIGGER_SCRIPT_NAME = "overlay-events.js";
const TRIGGER_FILE_NAME = "overlay-trigger.json";

function readJsonFile(file) {
  try {
    // BOM이 붙어 오면 JSON.parse가 죽는다 (규칙 §8).
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

/**
 * 트리거 포인터가 가리키는 설치본에서 형제 스크립트를 끌어낸다.
 * 조건을 하나라도 못 채우면 null — 호출부는 그때 자기 대체 경로로 간다.
 */
function resolveSiblingCommand(scriptName, options = {}) {
  const dataDir = options.dataDir || clawadDataDir(options.env || process.env);
  const fsImpl = options.fsImpl || fs;
  const pointer = (options.readJson || readJsonFile)(path.join(dataDir, TRIGGER_FILE_NAME));
  if (!pointer || pointer.version !== 1) return null;
  if (typeof pointer.node !== "string" || typeof pointer.script !== "string") return null;
  if (path.basename(pointer.script) !== TRIGGER_SCRIPT_NAME) return null;

  const script = path.join(path.dirname(pointer.script), scriptName);
  if (!fsImpl.existsSync(pointer.node) || !fsImpl.existsSync(script)) return null;
  return { node: pointer.node, script };
}

module.exports = { TRIGGER_FILE_NAME, TRIGGER_SCRIPT_NAME, readJsonFile, resolveSiblingCommand };
