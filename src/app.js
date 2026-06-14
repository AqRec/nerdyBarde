// Main application wiring: UI <-> score <-> pitch tracker.

import { Score } from "./score.js";
import { PitchTracker, freqToNoteInfo, centsFromTarget, freqToMidi, midiToFreq, midiToNoteName } from "./pitch.js";
import {
  SYSTEMS, systemTargetFreq, systemCentsOffset, fifthsToTonicPc, pitchClassName,
  openStringFreq, analyzeResonance, etFreq, centsBetween,
} from "./intonation.js";

const $ = (id) => document.getElementById(id);

const els = {
  fileInput: $("file-input"),
  micBtn: $("mic-btn"),
  // Tuner UI
  tunerPanel: document.querySelector(".tuner-panel"),
  tunerMeta: $("tuner-meta"),
  targetNote: $("target-note"),
  targetFreq: $("target-freq"),
  detectedNote: $("detected-note"),           // hidden, kept for compatibility
  detectedLetter: $("detected-note-letter"),
  detectedOctave: $("detected-note-octave"),
  detectedFreq: $("detected-freq"),
  deviationCents: $("deviation-cents"),
  deviationStatus: $("deviation-status"),
  needle: $("pitch-needle"),
  toleranceZone: $("tolerance-zone"),
  // Settings
  tolerance: $("tolerance"),
  holdTime: $("hold-time"),
  a4Ref: $("a4-ref"),
  resetDefaults: $("reset-defaults"),
  // Intonation system + drone
  intonationSystem: $("intonation-system"),
  intonationTonic: $("intonation-tonic"),
  droneBtn: $("drone-btn"),
  // Sympathetic-resonance readout
  tunerRing: $("tuner-ring"),
  ringLed: $("ring-led"),
  ringText: $("ring-text"),
  ringMeterFill: $("ring-meter-fill"),
  // Section + navigation
  sectionStart: $("section-start"),
  sectionEnd: $("section-end"),
  applySection: $("apply-section"),
  clearSection: $("clear-section"),
  resetBtn: $("reset-btn"),
  prevBtn: $("prev-btn"),
  nextBtn: $("next-btn"),
  skipBtn: $("skip-btn"),
  // Score area + status
  scorePlaceholder: $("score-placeholder"),
  scoreContainer: $("score-container"),
  status: $("status-msg"),
};

/**
 * Default values for the user-configurable practice parameters.
 * The Reset Defaults button restores all of these in one click.
 */
const DEFAULTS = Object.freeze({
  tolerance: 10,        // ±cents
  holdTime: 150,        // ms
  a4Ref: 440,           // Hz
  // Pythagorean is the default because a violin's open strings are a chain of
  // pure fifths — the Pythagorean skeleton — so it's the intonation that aligns
  // with the instrument's own sympathetic resonance and the standard choice for
  // melodic / scale practice (which is what this app is for). Switch to Just for
  // double stops / ensemble, or Equal when playing along with a piano.
  intonationSystem: "pythagorean",
  intonationTonic: "auto",
});

const state = {
  score: null,
  tracker: new PitchTracker(),
  inTuneSince: null, // timestamp when current target first became "in tune"
  lastTarget: null,
  overlay: null, // detected-pitch overlay element (sibling of the OSMD cursor)
  tuningString: null, // MIDI number when a string-pick is active, else null
  lastValidAt: 0, // performance.now() of the last valid pitch sample
  drone: null, // { ctx, gain, oscillators:[], pc } while a reference drone sounds
  pendingDroneFromUrl: false, // ?drone=1 seen, waiting for a user gesture to start
};

/**
 * How long to keep showing the last valid reading after the signal disappears,
 * before the tuner falls back to the "Listening…" idle state. Smooths over
 * short dropouts (bow changes, string crossings) so the readout doesn't flash.
 */
const VALID_PERSIST_MS = 500;

function setStatus(msg) { els.status.textContent = msg; }

/* -------------------- intonation system, tonic & resonance -------------------- */

function currentSystem() {
  return (els.intonationSystem && els.intonationSystem.value) || "equal";
}

/**
 * The tonic pitch class (0..11) that pure intonation is measured from, or null
 * when unknown (which makes Pythagorean / just fall back to equal temperament).
 * "Auto" reads the current score step's key signature; otherwise the user's pick.
 */
function currentTonicPc(step) {
  const sel = els.intonationTonic ? els.intonationTonic.value : "auto";
  if (sel !== "auto") {
    const pc = parseInt(sel, 10);
    return Number.isFinite(pc) ? pc : null;
  }
  const fifths = step && typeof step.keyFifths === "number" ? step.keyFifths : null;
  return fifths == null ? null : fifthsToTonicPc(fifths);
}

/** Short tag describing the active system + tonic, e.g. "Just · A", or "" for ET. */
function systemTag(tonicPc) {
  const sys = SYSTEMS[currentSystem()];
  if (!sys || !sys.needsTonic) return "";
  if (tonicPc == null) return `${sys.label} (no key)`;
  const shortLabel = currentSystem() === "pythagorean" ? "Pyth" : "Just";
  return `${shortLabel} · ${pitchClassName(tonicPc)}`;
}

/* ---- Sympathetic-resonance readout (the violin checking itself) ---- */

function clearRing() {
  if (!els.tunerRing) return;
  els.tunerRing.classList.remove("ringing", "locked");
  els.ringText.textContent = "Open strings: —";
  els.ringMeterFill.style.width = "0%";
}

function updateRing(pitch, a4) {
  if (!els.tunerRing) return;
  const r = analyzeResonance(pitch, a4);
  if (!r || r.strength < 0.04) {
    els.tunerRing.classList.remove("ringing", "locked");
    els.ringText.textContent = "Open strings: (none nearby)";
    els.ringMeterFill.style.width = "0%";
    return;
  }
  const cents = Math.round(r.cents);
  els.ringText.textContent = r.locked
    ? `${r.string} string rings — ${r.interval}, locked`
    : `${r.string} string · ${r.interval} · ${cents > 0 ? "+" : ""}${cents}¢ ${cents > 0 ? "(lower)" : "(raise)"}`;
  els.ringMeterFill.style.width = `${Math.round(r.strength * 100)}%`;
  els.tunerRing.classList.toggle("locked", r.locked);
  els.tunerRing.classList.add("ringing");
}

/* ---- Reference drone: a built-in 'double stop' against the tonic ---- */

/**
 * MIDI note for the drone root: the active tonic realized in the violin's low
 * range (G3..F#4). Falls back to A when no tonic is known, so the drone is still
 * a usable open-string reference during free play.
 */
function droneRootMidi() {
  const tonicPc = currentTonicPc(state.score && state.score.currentStep());
  const pc = tonicPc == null ? 9 /* A */ : tonicPc;
  let midi = 48 + pc; // octave 3
  if (midi < 55) midi += 12; // keep it at/above the open G string
  return midi;
}

function toggleDrone() {
  if (state.drone) stopDrone(); else startDrone();
}

function startDrone() {
  if (state.drone) return;
  let ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    setStatus("Drone unavailable: this browser has no Web Audio.");
    return;
  }
  // Some browsers create the context suspended until a user gesture; the drone
  // is started from a click, so resuming here guarantees it actually sounds.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const gain = ctx.createGain();
  gain.gain.value = 0.0;
  gain.connect(ctx.destination);
  state.drone = { ctx, gain, oscillators: [], rootMidi: null };
  updateDroneFrequency(true);
  // Fade in to avoid a click.
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0, now);
  gain.gain.linearRampToValueAtTime(0.13, now + 0.08);
  syncDroneButton();
  updateUrl();
}

function stopDrone() {
  const d = state.drone;
  if (!d) return;
  state.drone = null;
  try {
    const now = d.ctx.currentTime;
    d.gain.gain.cancelScheduledValues(now);
    d.gain.gain.setValueAtTime(d.gain.gain.value, now);
    d.gain.gain.linearRampToValueAtTime(0.0, now + 0.1);
    d.oscillators.forEach(o => { try { o.stop(now + 0.14); } catch { /* ignore */ } });
    setTimeout(() => { try { d.ctx.close(); } catch { /* ignore */ } }, 250);
  } catch { /* ignore */ }
  syncDroneButton();
  updateUrl();
}

/**
 * Build / rebuild the drone for the current tonic: a low tonic plus its octave
 * and a pure 3:2 fifth — an open-string-style fiddle drone to tune against.
 * No-op if the root hasn't changed (unless `force`, e.g. after an A4 change).
 */
function updateDroneFrequency(force = false) {
  const d = state.drone;
  if (!d) return;
  const a4 = parseFloat(els.a4Ref.value) || 440;
  const midi = droneRootMidi();
  if (!force && d.rootMidi === midi) return;
  d.rootMidi = midi;
  const root = etFreq(midi, a4);
  const partials = [
    { f: root, gain: 1.0 },          // tonic
    { f: root * 2, gain: 0.45 },     // octave (adds body)
    { f: root * 3 / 2, gain: 0.55 }, // pure fifth (the drone fifth)
  ];
  d.oscillators.forEach(o => { try { o.stop(); } catch { /* ignore */ } });
  d.oscillators = [];
  const now = d.ctx.currentTime;
  for (const p of partials) {
    const osc = d.ctx.createOscillator();
    const g = d.ctx.createGain();
    osc.type = "sawtooth"; // rich harmonics make beats easy to hear
    osc.frequency.value = p.f;
    g.gain.value = p.gain;
    osc.connect(g);
    g.connect(d.gain);
    osc.start(now);
    d.oscillators.push(osc);
  }
}

function syncDroneButton() {
  if (!els.droneBtn) return;
  const on = !!state.drone;
  // "Armed": ?drone=1 was in the URL but audio can't start until the user
  // interacts (browser autoplay policy). Show this on the button itself so the
  // cue survives the async score-load status message overwriting the footer.
  const armed = !on && state.pendingDroneFromUrl;
  els.droneBtn.classList.toggle("active", on);
  els.droneBtn.classList.toggle("armed", armed);
  els.droneBtn.setAttribute("aria-pressed", on ? "true" : "false");
  let label = "Drone: off";
  let shortLabel = "Drone";
  if (on) {
    const tonicPc = currentTonicPc(state.score && state.score.currentStep());
    label = `Drone: ${pitchClassName(tonicPc == null ? 9 : tonicPc)}`;
  } else if (armed) {
    label = "Drone: tap to start";
    shortLabel = "Drone \u25B6";
  }
  const long = els.droneBtn.querySelector(".label-long");
  if (long) long.textContent = label;
  const short = els.droneBtn.querySelector(".label-short");
  if (short) short.textContent = shortLabel;
}

/* -------------------- detected-pitch overlay on the score -------------------- */

function ensureOverlay() {
  const cursorEl = state.score && state.score.getCursorElement();
  if (!cursorEl) return null;
  // The cursor's offset coordinates are relative to its own offsetParent
  // (an inner OSMD <div>, not #score-container). To share that coordinate
  // space, attach our overlay to the same parent and ensure that parent is
  // a positioning context.
  const parent = cursorEl.parentElement;
  if (!parent) return null;
  // Make sure the parent is a containing block for absolute positioning.
  const cs = getComputedStyle(parent);
  if (cs.position === "static") parent.style.position = "relative";

  if (state.overlay && state.overlay.parentElement === parent) return state.overlay;
  if (state.overlay && state.overlay.parentNode) state.overlay.parentNode.removeChild(state.overlay);

  const root = document.createElement("div");
  root.className = "detected-overlay";
  root.innerHTML = `
    <div class="ghost-guide"></div>
    <div class="ghost-note"></div>
    <div class="ghost-label">—</div>
  `;
  parent.appendChild(root);
  state.overlay = root;
  return root;
}

function hideOverlay() {
  if (state.overlay) state.overlay.classList.remove("visible");
}

/**
 * Position the overlay relative to the OSMD cursor and update its content.
 *
 * Coordinate model
 * ----------------
 * The OSMD cursor is a vertical bar that exactly spans the 5-line staff:
 *   cursor top    = top staff line     (F5 in treble clef)
 *   cursor bottom = bottom staff line  (E4 in treble clef)
 *   cursor center = middle staff line  (B4 in treble clef)
 * So 1 line-spacing = cursorH / 4, and 1 diatonic step (line→space or space→line)
 * = cursorH / 8.
 *
 * Anchoring
 * ---------
 * The TARGET note's vertical position is its engraved diatonic position on the
 * staff (the OSMD Pitch tells us the letter+octave, independent of accidentals).
 * When the user plays the target exactly, the ghost note sits on top of the
 * engraved notehead. When they're off-pitch, the ghost moves continuously by
 * `semitonesFromTarget * (7/12) * diatonicHalfStepPx` — i.e. an octave's worth
 * of semitone deviation visually corresponds to one octave on the staff
 * (7 diatonic steps).
 */
function paintOverlay({ semitonesFromTarget, labelText, tone }) {
  const overlay = ensureOverlay();
  if (!overlay) return;
  const cursorEl = state.score && state.score.getCursorElement();
  const step = state.score && state.score.currentStep();
  if (!cursorEl || !step) { hideOverlay(); return; }

  const cursorTop = cursorEl.offsetTop;
  const cursorLeft = cursorEl.offsetLeft;
  const cursorW = cursorEl.offsetWidth || parseFloat(cursorEl.style.width) || 30;
  const cursorH = cursorEl.offsetHeight || parseFloat(cursorEl.style.height) || 40;

  // Treble clef middle line = B4; diatonic step = 4*7 + 6 = 34 (ISO octaves, C0 = 0).
  // Violin parts are always treble; fall back to this for unusual scores.
  const TREBLE_CENTER_DIATONIC = 34;
  const halfStepPx = cursorH / 8; // pixels per diatonic step (line ↔ adjacent space)

  // Engraved y of the target note inside the cursor box. Higher diatonic step
  // (e.g. F5) -> smaller y (toward top of cursor).
  const targetDiatonic = (typeof step.diatonicStep === "number")
    ? step.diatonicStep
    : TREBLE_CENTER_DIATONIC;
  const targetY = cursorH / 2 - (targetDiatonic - TREBLE_CENTER_DIATONIC) * halfStepPx;

  // Continuous chromatic-to-staff scale: one octave (12 semitones) = 7 diatonic
  // steps. So 1 semitone ≈ (7/12) of a diatonic step. Sharp -> up -> smaller y.
  const pxPerSemitone = halfStepPx * (7 / 12);
  const ghostY = targetY - semitonesFromTarget * pxPerSemitone;

  // Overlay box: slightly wider than the cursor; vertical extent generous so the
  // ghost can sit up to an octave above/below the staff before being clipped.
  const overlayW = Math.max(cursorW + 16, 40);
  const overlayLeft = cursorLeft + cursorW / 2 - overlayW / 2;
  const extraVert = 8 * halfStepPx; // ~1 octave of headroom on each side
  overlay.style.left = `${overlayLeft}px`;
  overlay.style.top = `${cursorTop - extraVert}px`;
  overlay.style.width = `${overlayW}px`;
  overlay.style.height = `${cursorH + 2 * extraVert}px`;

  // Inner coordinates are relative to the overlay's top, so rebase.
  const ghostYInOverlay = ghostY + extraVert;
  const targetYInOverlay = targetY + extraVert;

  const ghost = overlay.querySelector(".ghost-note");
  ghost.style.top = `${ghostYInOverlay}px`;

  // Guide line: vertical segment between the engraved target position and the ghost.
  const guide = overlay.querySelector(".ghost-guide");
  const guideTop = Math.min(targetYInOverlay, ghostYInOverlay);
  const guideH = Math.abs(ghostYInOverlay - targetYInOverlay);
  guide.style.top = `${guideTop}px`;
  guide.style.height = `${guideH}px`;

  // Label: above the ghost when sharp/in-tune, below when flat — never overlapping.
  const label = overlay.querySelector(".ghost-label");
  label.textContent = labelText;
  if (semitonesFromTarget >= 0) {
    label.style.top = `${ghostYInOverlay - 22}px`;
  } else {
    label.style.top = `${ghostYInOverlay + 12}px`;
  }
  label.style.bottom = "auto";

  overlay.classList.remove("in-tune", "sharp", "flat", "error-high", "error-low");
  if (tone) overlay.classList.add(tone);
  overlay.classList.add("visible");
}

/* ---------------------------- pitch bar (top) ---------------------------- */

function updateToleranceZone() {
  const tol = clamp(parseFloat(els.tolerance.value) || 10, 1, 50);
  // Map ±50¢ to 0..100% (center at 50%). Tolerance band width:
  const halfPct = (tol / 50) * 50; // 50% half-range = 50 cents
  els.toleranceZone.style.left = `${50 - halfPct}%`;
  els.toleranceZone.style.width = `${halfPct * 2}%`;
}

function setNeedle(cents) {
  const clamped = clamp(cents, -50, 50);
  const pct = 50 + (clamped / 50) * 50;
  els.needle.style.left = `${pct}%`;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ------------------------------- Tuner UI ------------------------------- */

/**
 * Split a sharp-style note name like "A#4" into a pretty letter ("A♯") and
 * its octave ("4"). Returns { letter: "—", octave: "" } for the empty state.
 */
function splitNoteName(name) {
  if (!name || name === "—") return { letter: "—", octave: "" };
  const m = /^([A-G])(#?)(-?\d+)$/.exec(name);
  if (!m) return { letter: name, octave: "" };
  const letter = m[2] === "#" ? `${m[1]}\u266F` : m[1];   // ♯
  return { letter, octave: m[3] };
}

function setTunerTone(tone) {
  // tone ∈ "in-tune" | "sharp" | "flat" | "error-high" | "error-low" | "listening" | null
  els.tunerPanel.classList.remove("in-tune", "sharp", "flat", "error-high", "error-low", "listening");
  if (tone) els.tunerPanel.classList.add(tone);
}

function setTunerNote(name) {
  const { letter, octave } = splitNoteName(name);
  els.detectedLetter.textContent = letter;
  els.detectedOctave.textContent = octave;
  els.detectedNote.textContent = name || "—";
}

function setTunerIdle(message) {
  setTunerNote("—");
  els.detectedFreq.textContent = "— Hz";
  els.deviationCents.textContent = "— ¢";
  els.deviationStatus.textContent = message;
  setTunerTone(message === "Listening…" ? "listening" : null);
  els.needle.classList.remove("in-tune");
  setNeedle(0);
}

function refreshTargetDisplay() {
  const hasScore = !!state.score && state.score.steps.length > 0;
  const a4 = parseFloat(els.a4Ref.value) || 440;
  const metaLabel = document.getElementById("tuner-meta-label");

  // Tuning a string takes precedence over score practice when both are
  // available, so the user can interrupt a score with the string picker
  // and resume by long-pressing a note (which clears tuningString). The
  // string buttons stay enabled either way so the user can switch modes
  // at any time.
  if (state.tuningString != null) {
    // String tuning: target the PURE (3:2-chain) open-string frequency, not the
    // equal-tempered one — beatless fifths are how a violin is actually tuned.
    els.tunerMeta.hidden = false;
    metaLabel.textContent = "Tune string";
    const name = midiToNoteName(state.tuningString);
    const split = splitNoteName(name);
    const f = openStringFreq(state.tuningString, a4);
    els.targetNote.textContent = split.letter + split.octave;
    els.targetFreq.textContent = `${f.toFixed(2)} Hz · pure 5th`;
    // While tuning, hide the on-score "ghost notehead" — it would otherwise
    // linger from the last sample painted by practice mode.
    hideOverlay();
  } else if (hasScore) {
    els.tunerMeta.hidden = false;
    metaLabel.textContent = "Target";
    const step = state.score.currentStep();
    if (step) {
      const tonicPc = currentTonicPc(step);
      const system = currentSystem();
      const f = systemTargetFreq(step.midi, { a4, tonicPc, system });
      const split = splitNoteName(step.name);
      els.targetNote.textContent = split.letter + split.octave;
      const tag = systemTag(tonicPc);
      els.targetFreq.textContent = tag ? `${f.toFixed(2)} Hz · ${tag}` : `${f.toFixed(2)} Hz`;
      if (state.lastTarget !== step.stepIndex) {
        state.inTuneSince = null;
        state.lastTarget = step.stepIndex;
      }
    } else {
      els.targetNote.textContent = "—";
      els.targetFreq.textContent = "— Hz";
    }
  } else {
    // No score, no string: free-running tuner — hide the reference row.
    els.tunerMeta.hidden = true;
  }

  // Keep the reference drone (and its button label) in sync with the active tonic.
  if (state.drone) updateDroneFrequency();
  syncDroneButton();
}

function selectTuningString(midi) {
  // Toggle: clicking the active button clears the selection (returning to
  // either score-practice mode or free-tuner mode, depending on whether
  // a score is loaded).
  if (state.tuningString === midi) {
    state.tuningString = null;
  } else {
    state.tuningString = midi;
  }
  document.querySelectorAll(".string-btn").forEach(b => {
    const m = parseInt(b.dataset.midi, 10);
    b.classList.toggle("active", m === state.tuningString);
  });
  // Reset the hold timer so a still-bowed pitch doesn't accidentally trip
  // a stale practice-mode advancement on the very next sample.
  state.inTuneSince = null;
  refreshTargetDisplay();
}

/* ----------------------------- Pitch sample ----------------------------- */

function onPitchSample({ pitch, valid }) {
  const a4 = parseFloat(els.a4Ref.value) || 440;
  const tol = clamp(parseFloat(els.tolerance.value) || 10, 1, 50);
  const holdMs = clamp(parseFloat(els.holdTime.value) || 150, 0, 5000);
  const step = state.score && state.score.currentStep();

  if (!valid) {
    // Persistence: don't immediately wipe the display on a short dropout —
    // keep the last reading visible for a moment so brief bow changes /
    // string crossings don't make the tuner flash.
    const sinceValid = performance.now() - state.lastValidAt;
    if (sinceValid < VALID_PERSIST_MS) return;
    setTunerIdle("Listening…");
    clearRing();
    state.inTuneSince = null;
    hideOverlay();
    return;
  }

  state.lastValidAt = performance.now();

  const info = freqToNoteInfo(pitch, a4);
  setTunerNote(info.name);
  els.detectedFreq.textContent = `${pitch.toFixed(2)} Hz`;
  // The violin-native check: which open string this pitch is ringing. Shown in
  // every mode, independent of the chosen target system.
  updateRing(pitch, a4);

  if (state.tuningString != null) {
    // String-tuning mode (takes precedence over score practice). Cents are
    // measured from the chosen open-string target. The on-score ghost is
    // suppressed because we're not comparing against the score's target.
    hideOverlay();
    const targetMidi = state.tuningString;
    // Measure against the PURE open-string frequency so a beatless 3:2 reads 0¢.
    const cents = centsBetween(pitch, openStringFreq(targetMidi, a4));
    const semitones = freqToMidi(pitch, a4) - targetMidi;
    const nearby = Math.abs(cents) <= 50;
    setNeedle(cents);
    els.deviationCents.textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(0)} ¢`;
    if (info.midi !== targetMidi) {
      els.deviationStatus.textContent = `Wrong note (${info.name})`;
      // Split the wrong-note state by direction: too-high = red, too-low = gray.
      setTunerTone(semitones > 0 ? "error-high" : "error-low");
      els.needle.classList.remove("in-tune");
    } else if (Math.abs(cents) <= tol) {
      els.deviationStatus.textContent = "In tune";
      setTunerTone("in-tune");
      els.needle.classList.add("in-tune");
    } else if (cents > 0) {
      els.deviationStatus.textContent = nearby ? "Sharp" : "Sharp (far)";
      setTunerTone("sharp");
      els.needle.classList.remove("in-tune");
    } else {
      els.deviationStatus.textContent = nearby ? "Flat" : "Flat (far)";
      setTunerTone("flat");
      els.needle.classList.remove("in-tune");
    }
    return;
  }

  if (!step) {
    // Pure tuner mode: cents from the nearest note. If a manual tonic + a pure
    // system are set, measure from that note's pure version instead of 12-TET.
    const offset = systemCentsOffset(info.midi, currentTonicPc(null), currentSystem());
    const cents = info.cents - offset;
    setNeedle(cents);
    els.deviationCents.textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(0)} ¢`;
    if (Math.abs(cents) <= tol) {
      els.deviationStatus.textContent = "In tune";
      setTunerTone("in-tune");
      els.needle.classList.add("in-tune");
    } else if (cents > 0) {
      els.deviationStatus.textContent = "Sharp";
      setTunerTone("sharp");
      els.needle.classList.remove("in-tune");
    } else {
      els.deviationStatus.textContent = "Flat";
      setTunerTone("flat");
      els.needle.classList.remove("in-tune");
    }
    return;
  }

  // Practice mode: cents from the current target (not nearest), so the user
  // sees how far they are from what the score asks for. The target is shifted by
  // the active intonation system (Pythagorean / just) relative to the tonic, so
  // a pure-intonation note reads 0¢ and "in tune" lands on the pure pitch.
  const tonicPc = currentTonicPc(step);
  const offsetCents = systemCentsOffset(step.midi, tonicPc, currentSystem());
  const cents = centsFromTarget(pitch, step.midi, a4) - offsetCents;
  const semitones = freqToMidi(pitch, a4) - step.midi - offsetCents / 100;
  const nearby = Math.abs(cents) <= 50;
  setNeedle(cents);
  els.deviationCents.textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(0)} ¢`;

  // ---- Paint the on-score ghost note ----
  let tone;
  let labelText;
  if (info.midi !== step.midi) {
    // Split the wrong-note state by direction: too-high = red, too-low = gray.
    tone = semitones > 0 ? "error-high" : "error-low";
    labelText = `${info.name} (${semitones > 0 ? "+" : ""}${semitones.toFixed(1)} st)`;
  } else if (Math.abs(cents) <= tol) {
    tone = "in-tune";
    labelText = `${info.name} \u2713`;
  } else {
    tone = cents > 0 ? "sharp" : "flat";
    labelText = `${info.name} ${cents > 0 ? "+" : ""}${cents.toFixed(0)}\u00A2`;
  }
  paintOverlay({ semitonesFromTarget: semitones, labelText, tone });

  // ---- Update tuner readout + advancement logic ----
  if (info.midi !== step.midi) {
    els.deviationStatus.textContent = `Wrong note (${info.name})`;
    setTunerTone(semitones > 0 ? "error-high" : "error-low");
    els.needle.classList.remove("in-tune");
    state.inTuneSince = null;
    return;
  }

  if (Math.abs(cents) <= tol) {
    els.deviationStatus.textContent = "In tune";
    setTunerTone("in-tune");
    els.needle.classList.add("in-tune");
    const now = performance.now();
    if (state.inTuneSince == null) state.inTuneSince = now;
    if (now - state.inTuneSince >= holdMs) {
      state.score.advance();
      state.inTuneSince = null;
      refreshTargetDisplay();
    }
  } else {
    els.needle.classList.remove("in-tune");
    state.inTuneSince = null;
    if (cents > 0) {
      els.deviationStatus.textContent = nearby ? "Sharp" : "Sharp (far)";
      setTunerTone("sharp");
    } else {
      els.deviationStatus.textContent = nearby ? "Flat" : "Flat (far)";
      setTunerTone("flat");
    }
  }
}

async function handleFileLoad(file) {
  if (!file) return;
  setStatus(`Loading ${file.name}…`);
  els.scorePlaceholder.style.display = "none";
  els.scoreContainer.classList.add("has-score");
  // OSMD may rebuild the score container on render — drop any stale overlay.
  if (state.overlay && state.overlay.parentNode) state.overlay.parentNode.removeChild(state.overlay);
  state.overlay = null;
  try {
    if (!state.score) {
      state.score = new Score(els.scoreContainer);
    }
    await state.score.loadFile(file);
    const total = state.score.measureCount;
    els.sectionStart.max = total;
    els.sectionEnd.max = total;
    // Respect a section given in the URL (?from/?to) so a bookmarked or shared
    // range survives loading (or reloading) a score. Only fall back to the whole
    // score when the URL doesn't specify one.
    if (!applyUrlSection()) {
      els.sectionStart.value = 1;
      els.sectionEnd.value = total;
    }
    refreshTargetDisplay();
    setStatus(`Loaded ${file.name} (${state.score.steps.length} notes, ${total} measures).`);
  } catch (err) {
    console.error(err);
    setStatus(`Failed to load: ${err.message || err}`);
    els.scorePlaceholder.style.display = "";
    els.scoreContainer.classList.remove("has-score");
  }
}

async function toggleMic() {
  if (state.tracker.isActive) {
    state.tracker.stop();
    els.micBtn.textContent = "Enable Microphone";
    els.micBtn.classList.remove("active");
    hideOverlay();
    setTunerIdle("Idle");
    clearRing();
    state.lastValidAt = 0;
    setStatus("Microphone stopped.");
    return;
  }
  try {
    if (!window.isSecureContext) {
      const host = location.hostname;
      throw new Error(
        `This page is not a secure context (host="${host}"). ` +
        `Browsers only allow microphone access on https://, http://localhost, or http://127.0.0.1. ` +
        `Open this app at http://localhost:${location.port || 80} instead.`
      );
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This browser does not expose getUserMedia. Try a recent Chrome / Edge / Firefox.");
    }
    await state.tracker.start(onPitchSample);
    els.micBtn.textContent = "Microphone On";
    els.micBtn.classList.add("active");
    setStatus("Microphone live. Play a note.");
  } catch (err) {
    console.error(err);
    let hint = err.message || String(err);
    if (err && err.name === "NotAllowedError") {
      hint = "Microphone permission denied. Click the lock icon in the address bar → Microphone → Allow, then reload.";
    } else if (err && err.name === "NotFoundError") {
      hint = "No microphone was found by the browser.";
    }
    setStatus(`Microphone error: ${hint}`);
  }
}

function wireEvents() {
  els.fileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFileLoad(f);
    // Reset so selecting the same file again still fires `change`.
    e.target.value = "";
  });
  els.micBtn.addEventListener("click", toggleMic);
  els.tolerance.addEventListener("input", () => { updateToleranceZone(); updateUrl(); });
  els.holdTime.addEventListener("input", updateUrl);
  els.a4Ref.addEventListener("input", () => {
    if (state.drone) updateDroneFrequency(true);
    refreshTargetDisplay();
    updateUrl();
  });

  // Intonation system + tonic + reference drone.
  els.intonationSystem.addEventListener("change", () => {
    state.inTuneSince = null;
    refreshTargetDisplay();
    updateUrl();
    setStatus(`Intonation: ${SYSTEMS[currentSystem()].label}.`);
  });
  els.intonationTonic.addEventListener("change", () => {
    state.inTuneSince = null;
    if (state.drone) updateDroneFrequency(true);
    refreshTargetDisplay();
    updateUrl();
  });
  els.droneBtn.addEventListener("click", toggleDrone);

  // String-tuner quick-pick buttons.
  document.querySelectorAll(".string-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const midi = parseInt(btn.dataset.midi, 10);
      if (Number.isFinite(midi)) selectTuningString(midi);
    });
  });

  els.resetDefaults.addEventListener("click", () => {
    els.tolerance.value = DEFAULTS.tolerance;
    els.holdTime.value = DEFAULTS.holdTime;
    els.a4Ref.value = DEFAULTS.a4Ref;
    els.intonationSystem.value = DEFAULTS.intonationSystem;
    els.intonationTonic.value = DEFAULTS.intonationTonic;
    if (state.drone) stopDrone();
    state.pendingDroneFromUrl = false;
    updateToleranceZone();
    refreshTargetDisplay();
    state.inTuneSince = null;
    updateUrl();
    setStatus(`Defaults restored: tolerance ±${DEFAULTS.tolerance}¢, hold ${DEFAULTS.holdTime} ms, A4 ${DEFAULTS.a4Ref} Hz, ${SYSTEMS[DEFAULTS.intonationSystem].label}.`);
  });

  els.applySection.addEventListener("click", () => {
    if (!state.score) return;
    const s = parseInt(els.sectionStart.value, 10) || 1;
    const e = parseInt(els.sectionEnd.value, 10) || s;
    const applied = state.score.setSection(s, e);
    els.sectionStart.value = applied.startMeasure;
    els.sectionEnd.value = applied.endMeasure;
    refreshTargetDisplay();
    updateUrl();
    setStatus(`Section set: measures ${applied.startMeasure}–${applied.endMeasure}.`);
  });
  els.clearSection.addEventListener("click", () => {
    if (!state.score) return;
    state.score.clearSection();
    els.sectionStart.value = 1;
    els.sectionEnd.value = state.score.measureCount;
    refreshTargetDisplay();
    updateUrl();
    setStatus("Section cleared (full score).");
  });

  els.resetBtn.addEventListener("click", () => {
    if (!state.score) return;
    state.score.resetToSectionStart();
    state.inTuneSince = null;
    refreshTargetDisplay();
  });
  els.prevBtn.addEventListener("click", () => {
    if (!state.score) return;
    state.score.prev();
    state.inTuneSince = null;
    refreshTargetDisplay();
  });
  els.nextBtn.addEventListener("click", () => {
    if (!state.score) return;
    state.score.advance();
    state.inTuneSince = null;
    refreshTargetDisplay();
  });
  els.skipBtn.addEventListener("click", () => {
    if (!state.score) return;
    state.score.advance();
    state.inTuneSince = null;
    refreshTargetDisplay();
  });

  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "ArrowRight") { els.nextBtn.click(); }
    else if (e.key === "ArrowLeft") { els.prevBtn.click(); }
    else if (e.key === "r" || e.key === "R") { els.resetBtn.click(); }
    else if (e.key === "m" || e.key === "M") { els.micBtn.click(); }
    else if (e.key === "d" || e.key === "D") { toggleDrone(); }
  });

  wireLongPressJump();
}

/* ------------------------- Long-press jump-to-note ------------------------- */

/**
 * Long-press (≈450 ms) anywhere on the score to jump the cursor to the nearest
 * pitched note. Works with mouse, touch, and pen (Pointer Events).
 */
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_SLOP_PX = 8;

function wireLongPressJump() {
  let timerId = null;
  let startX = 0, startY = 0;
  let startedAt = 0;

  const cancel = () => {
    if (timerId) { clearTimeout(timerId); timerId = null; }
    els.scoreContainer.classList.remove("long-pressing");
  };

  els.scoreContainer.addEventListener("pointerdown", (e) => {
    if (!state.score || state.score.steps.length === 0) return;
    // Ignore non-primary buttons (right-click etc.) on mouse devices.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancel();
    startX = e.clientX;
    startY = e.clientY;
    startedAt = performance.now();
    els.scoreContainer.classList.add("long-pressing");
    timerId = setTimeout(() => {
      timerId = null;
      els.scoreContainer.classList.remove("long-pressing");
      jumpToPointerEvent(e);
    }, LONG_PRESS_MS);
  });

  els.scoreContainer.addEventListener("pointermove", (e) => {
    if (timerId == null) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_MOVE_SLOP_PX) cancel();
  });
  els.scoreContainer.addEventListener("pointerup", cancel);
  els.scoreContainer.addEventListener("pointercancel", cancel);
  els.scoreContainer.addEventListener("pointerleave", cancel);
}

function jumpToPointerEvent(e) {
  if (!state.score) return;
  const cursorEl = state.score.getCursorElement();
  const offsetParent = cursorEl && cursorEl.parentElement;
  if (!offsetParent) return;
  // Convert clientX/Y into the cursor's offsetParent coordinate space — the
  // same space the steps' recorded x/y live in.
  const r = offsetParent.getBoundingClientRect();
  const localX = e.clientX - r.left;
  const localY = e.clientY - r.top;
  const idx = state.score.findStepIndexNearPoint(localX, localY);
  if (idx < 0) {
    setStatus("Long-press: no note found near that point.");
    return;
  }
  state.score.goToStep(idx);
  state.inTuneSince = null;
  // Long-pressing a note also returns the user from string-tuning mode back
  // to score practice. Clear any active string pick and refresh button state.
  if (state.tuningString != null) {
    state.tuningString = null;
    document.querySelectorAll(".string-btn").forEach(b => b.classList.remove("active"));
  }
  refreshTargetDisplay();
  const step = state.score.currentStep();
  if (step) setStatus(`Jumped to ${step.name} (measure ${step.measureNumber}).`);
}

/* ----------------------- URL <-> settings sync ----------------------- */
//
// Reflect the toolbar settings in the query string as they change, and restore
// them when the page opens with those params, so a configured setup can be
// bookmarked or shared. Only NON-default values are written, so a fresh setup
// keeps a clean URL. The `score` param (handled separately) and any unrelated
// params are preserved.

const URL_DEFAULTS = {
  system: DEFAULTS.intonationSystem,
  tonic: DEFAULTS.intonationTonic,
  tol: String(DEFAULTS.tolerance),
  hold: String(DEFAULTS.holdTime),
  a4: String(DEFAULTS.a4Ref),
};

/** Apply ?system / ?tonic / ?tol / ?hold / ?a4 to the controls (called on load). */
function applySettingsFromUrl() {
  const p = new URLSearchParams(location.search);

  const system = p.get("system");
  if (system && SYSTEMS[system]) els.intonationSystem.value = system;

  const tonic = p.get("tonic");
  if (tonic === "auto" || (tonic != null && /^\d+$/.test(tonic) && +tonic >= 0 && +tonic <= 11)) {
    els.intonationTonic.value = tonic;
  }

  const tol = p.get("tol");
  if (tol != null && Number.isFinite(parseFloat(tol))) els.tolerance.value = clamp(parseFloat(tol), 1, 50);

  const hold = p.get("hold");
  if (hold != null && Number.isFinite(parseFloat(hold))) els.holdTime.value = clamp(parseFloat(hold), 0, 5000);

  const a4 = p.get("a4");
  if (a4 != null && Number.isFinite(parseFloat(a4))) els.a4Ref.value = clamp(parseFloat(a4), 415, 466);
}

/** Write the current settings back into the URL (replaceState, no reload). */
function updateUrl() {
  const p = new URLSearchParams(location.search);
  const setOrClear = (key, value, def) => {
    if (value == null || value === "" || String(value) === String(def)) p.delete(key);
    else p.set(key, String(value));
  };

  setOrClear("system", els.intonationSystem.value, URL_DEFAULTS.system);
  setOrClear("tonic", els.intonationTonic.value, URL_DEFAULTS.tonic);
  setOrClear("tol", els.tolerance.value, URL_DEFAULTS.tol);
  setOrClear("hold", els.holdTime.value, URL_DEFAULTS.hold);
  setOrClear("a4", els.a4Ref.value, URL_DEFAULTS.a4);

  if (state.drone || state.pendingDroneFromUrl) p.set("drone", "1"); else p.delete("drone");

  // Section: only when narrower than the whole score (else it's the default).
  const total = state.score ? state.score.measureCount : 0;
  const from = parseInt(els.sectionStart.value, 10);
  const to = parseInt(els.sectionEnd.value, 10);
  if (total > 0 && Number.isFinite(from) && Number.isFinite(to) && (from > 1 || to < total)) {
    p.set("from", String(from));
    p.set("to", String(to));
  } else {
    p.delete("from");
    p.delete("to");
  }

  const qs = p.toString();
  history.replaceState(null, "", `${location.pathname}${qs ? "?" + qs : ""}${location.hash}`);
}

/** Apply ?from / ?to once a score is loaded (measure numbers are score-specific).
 *  Returns true if the URL specified a section that was applied, false otherwise. */
function applyUrlSection() {
  if (!state.score) return false;
  const p = new URLSearchParams(location.search);
  const fromRaw = p.get("from");
  const toRaw = p.get("to");
  if (fromRaw == null && toRaw == null) return false;
  const total = state.score.measureCount;
  const from = parseInt(fromRaw, 10);
  const to = parseInt(toRaw, 10);
  const s = Number.isFinite(from) ? from : 1;
  const e = Number.isFinite(to) ? to : total;
  const applied = state.score.setSection(s, e);
  els.sectionStart.value = applied.startMeasure;
  els.sectionEnd.value = applied.endMeasure;
  refreshTargetDisplay();
  updateUrl(); // normalize to the actually-applied (clamped) values
  return true;
}

/** Arm the drone if ?drone=1; actual audio waits for the first user gesture
 *  (browsers block audio until the user interacts with the page). */
function applyUrlDrone() {
  const p = new URLSearchParams(location.search);
  if (p.get("drone") !== "1" || state.drone) return;
  state.pendingDroneFromUrl = true;
  syncDroneButton(); // show the "armed / tap to start" cue on the button
  const start = (e) => {
    // If the first gesture is itself a drone toggle (button or 'D'), let that
    // handler start it instead of double-triggering.
    const isDroneToggle =
      (e.target && e.target.closest && e.target.closest("#drone-btn")) ||
      (e.type === "keydown" && (e.key === "d" || e.key === "D"));
    window.removeEventListener("pointerdown", start, true);
    window.removeEventListener("keydown", start, true);
    if (!isDroneToggle && !state.drone) startDrone();
    state.pendingDroneFromUrl = false;
    syncDroneButton(); // clear the armed cue once resolved
  };
  window.addEventListener("pointerdown", start, true);
  window.addEventListener("keydown", start, true);
  setStatus("Drone armed from your URL. Click anywhere (or press D) to start it.");
}

applySettingsFromUrl();
updateToleranceZone();
wireEvents();
wireDonationCopy();
syncDroneButton();
setStatus("Load a score, enable the microphone, then play.");
applyUrlDrone();

/* ----------------------------- Default score ----------------------------- */

/**
 * URL of the score that loads automatically on first visit. Relative to the
 * page so it works on both `python3 -m http.server` and GitHub Pages
 * (where the repo is served at `<user>.github.io/<repo>/`).
 *
 * Override via `?score=<path>` to demo a different file without rebuilding.
 */
const DEFAULT_SCORE_URL = "./test-files/all-major-scales/violin-all-major-scales.musicxml";

async function autoLoadDefaultScore() {
  // Don't auto-load if the user has already opened the page with a score
  // explicitly suppressed (`?score=none`).
  const params = new URLSearchParams(location.search);
  const override = params.get("score");
  if (override === "none") return;
  const url = override || DEFAULT_SCORE_URL;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    // Derive a filename from the URL so handleFileLoad's status message and
    // OSMD's MXL-vs-XML branching (which keys off the .mxl extension) both
    // work without changes.
    const name = url.split("/").pop() || "score.musicxml";
    const file = new File([blob], name, { type: blob.type });
    await handleFileLoad(file);
  } catch (err) {
    // Soft-fail: just leave the placeholder visible. Don't spam the status bar
    // with an error on the local file:// case or on first-time visitors who
    // haven't deployed the test-files yet.
    console.info(`Default score not auto-loaded (${err.message || err}).`);
  }
}

// Kick off the default-score fetch *after* DEFAULT_SCORE_URL and
// autoLoadDefaultScore are both defined (avoids a TDZ ReferenceError).
autoLoadDefaultScore();

/* --------------------------- Donation copy-to-clipboard --------------------------- */

/**
 * Wire up the donation panel: clicking an address copies it to the clipboard
 * and briefly flashes a "Copied!" label on the button.
 */
function wireDonationCopy() {
  document.querySelectorAll(".donation-addr").forEach(btn => {
    btn.addEventListener("click", async () => {
      const addr = btn.dataset.copy || btn.textContent.trim();
      try {
        await navigator.clipboard.writeText(addr);
        flashCopied(btn);
      } catch {
        // Fallback for non-secure contexts or older browsers.
        const ta = document.createElement("textarea");
        ta.value = addr;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); flashCopied(btn); }
        catch { setStatus("Could not copy address; please copy manually."); }
        ta.remove();
      }
    });
  });
}

function flashCopied(btn) {
  const original = btn.textContent;
  btn.textContent = "Copied!";
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("copied");
  }, 1200);
}

// Test hook: lets us drive the pitch handler from outside (without a mic).
//   window.__feedPitch(440)           -> plays A4
//   window.__feedPitch(0, false)      -> "no signal"
window.__feedPitch = (hz, valid = true) => onPitchSample({ pitch: hz, valid });
