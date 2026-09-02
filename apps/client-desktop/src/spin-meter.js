"use strict";

// src/spin-meter.js — cursor circling meter that drives the dizzy state.
//
// Extracted from tick.js so the accumulation rule is testable on its own: the tick loop
// needs a live cursor, a pet window and a theme, none of which a unit test can supply.
// The meter is pure — feed it (angle, distance, timestamp) and it answers "that was a
// circle". Everything about where the angle came from stays in tick.js.
//
// Signed accumulation is the whole trick. Circling one way keeps one sign and builds toward
// the threshold; wiggling back and forth cancels itself out. So there is no separate
// "same direction" check to get wrong.
//
// Samples live in a sliding window rather than a running total. A running total lets a slow
// drift over a minute add up to a full turn, which is not a gesture anyone performed on
// purpose — the window is what makes "1.5 turns *within 2 seconds*" mean what it says.

const DEFAULTS = {
  thresholdRad: Math.PI * 3,  // 1.5 turns
  windowMs: 2000,
  // A pause longer than this breaks the chain. Without it, the angle from before a long
  // pause is compared against the angle after it and the jump counts as travel the cursor
  // never made.
  idleResetMs: 500,
  // Near the centre the angle swings wildly on sub-pixel movement, so those samples are
  // noise, not gesture.
  minRadius: 24,
  cooldownMs: 12000,
};

function createSpinMeter(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let samples = [];       // { t, d } inside the window
  let lastAngle = null;
  let lastFedAt = 0;
  let cooldownUntil = 0;

  function reset() {
    samples = [];
    lastAngle = null;
    lastFedAt = 0;
  }

  /**
   * @param {number} angle    cursor angle around the pet, radians (atan2)
   * @param {number} distance cursor distance from the pet, px
   * @param {number} now      timestamp, ms
   * @returns {boolean} true exactly once per completed gesture
   */
  function feed(angle, distance, now) {
    if (!(distance >= cfg.minRadius)) {
      reset();
      return false;
    }
    const stalled = lastFedAt > 0 && (now - lastFedAt) > cfg.idleResetMs;
    if (lastAngle === null || stalled) {
      samples = [];
      lastAngle = angle;
      lastFedAt = now;
      return false;
    }

    let delta = angle - lastAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    lastAngle = angle;
    lastFedAt = now;

    samples.push({ t: now, d: delta });
    while (samples.length && now - samples[0].t > cfg.windowMs) samples.shift();

    let sum = 0;
    for (const s of samples) sum += s.d;
    if (Math.abs(sum) < cfg.thresholdRad || now < cooldownUntil) return false;

    cooldownUntil = now + cfg.cooldownMs;
    reset();
    return true;
  }

  function clear() {
    reset();
    cooldownUntil = 0;
  }

  // reset() drops the gesture in progress but keeps the cooldown — re-entering idle must not
  // hand back an early re-trigger. clear() also drops the cooldown, for a full teardown.
  return { feed, reset, clear, config: cfg };
}

module.exports = { createSpinMeter, SPIN_METER_DEFAULTS: DEFAULTS };
