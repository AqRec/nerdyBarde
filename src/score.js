// Score wrapper around OpenSheetMusicDisplay.
// Provides: load(file), step list, cursor positioning, current target note.

// esm.sh wraps OSMD's CJS bundle into a `default` namespace, so we destructure it.
import OSMD from "https://esm.sh/opensheetmusicdisplay@1.9.0";
const { OpenSheetMusicDisplay } = OSMD;

// OSMD exposes a ready-to-use frequency on Pitch. Use it as the source of truth.
// (OSMD's internal `octave` uses an offset so middle C is octave 1, not 4 — don't
// recompute MIDI from raw fields; instead derive it from the frequency.)
function midiFromOsmdPitch(pitch) {
  if (!pitch) return null;
  const f = typeof pitch.frequency === "number" ? pitch.frequency : null;
  if (!f || f <= 0) return null;
  // Reference A4 = 440 Hz: midi = round(69 + 12*log2(f/440)).
  // (The user-configurable A4 in the UI only affects target *frequencies* shown
  //  to the user and cents math, not the discrete MIDI identity of a note.)
  return Math.round(69 + 12 * Math.log2(f / 440));
}
// OSMD `fundamentalNote` = semitone of the natural letter from C (C=0,D=2,E=4,F=5,G=7,A=9,B=11).
// We need the diatonic letter INDEX (0..6) for staff positioning.
const LETTER_INDEX_BY_SEMITONE = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };

// OSMD's `octave` is offset: OSMD octave 1 == ISO octave 4 (so add 3).
const OSMD_OCTAVE_OFFSET = 3;

/**
 * Return the absolute "diatonic step" of a Pitch — the engraved staff position,
 * ignoring accidentals (so D, D#, Db all share the same staff row).
 * Scale: each octave = 7 steps, C0 = 0. ISO octaves.
 */
function diatonicStepFromOsmdPitch(pitch) {
  if (!pitch || typeof pitch.fundamentalNote !== "number") return null;
  const letterIdx = LETTER_INDEX_BY_SEMITONE[pitch.fundamentalNote];
  if (letterIdx == null) return null;
  const isoOctave = (pitch.octave ?? 0) + OSMD_OCTAVE_OFFSET;
  return isoOctave * 7 + letterIdx;
}
const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiToName(midi) {
  const m = Math.round(midi);
  const name = NOTE_NAMES_SHARP[((m % 12) + 12) % 12];
  const octave = Math.floor(m / 12) - 1;
  return `${name}${octave}`;
}

export class Score {
  constructor(container) {
    this.osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      drawSubtitle: true,
      drawComposer: true,
      followCursor: true,
    });
    /** @type {Array<{midi:number,name:string,measureNumber:number,stepIndex:number}>} */
    this.steps = [];
    this.currentStepIndex = -1;
    this.sectionStart = 0;
    this.sectionEnd = 0;
  }

  async loadFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".mxl")) {
      const buf = await file.arrayBuffer();
      // OSMD expects a "binary string" for mxl content (each char = one byte).
      const bytes = new Uint8Array(buf);
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      await this.osmd.load(bin);
    } else {
      const text = await file.text();
      await this.osmd.load(text);
    }
    this.osmd.render();
    this.osmd.cursor.show();
    this._buildStepList();
    this.sectionStart = 0;
    this.sectionEnd = Math.max(0, this.steps.length - 1);
    if (this.steps.length > 0) {
      this.goToStep(0);
    }
  }

  /**
   * Walk the cursor from start to end and capture every step that has a pitched note.
   * Rests are skipped (we do not require the user to "play" a rest).
   */
  _buildStepList() {
    this.steps = [];
    const cursor = this.osmd.cursor;
    cursor.reset();
    let safety = 0;
    while (!cursor.iterator.EndReached && safety < 100000) {
      const notes = cursor.NotesUnderCursor();
      const pitched = notes.filter(n => n && n.Pitch);
      if (pitched.length > 0) {
        // Use the highest-pitched note as the target (typical for melodic single-line practice).
        let best = null;
        let bestMidi = -1;
        for (const n of pitched) {
          const m = midiFromOsmdPitch(n.Pitch);
          if (m != null && m > bestMidi) { best = n; bestMidi = m; }
        }
        if (best) {
          const measureNumber = this._getCurrentMeasureNumber(cursor);
          const diatonicStep = diatonicStepFromOsmdPitch(best.Pitch);
          // Snapshot the cursor's pixel position so we can later jump to the
          // nearest step from a long-press point. Coordinates are in the cursor's
          // own offsetParent space (the inner OSMD <div>), which is the same
          // space the on-score overlay uses.
          const cursorEl = this.osmd.cursor.cursorElement;
          const xy = cursorEl ? {
            x: cursorEl.offsetLeft + (cursorEl.offsetWidth || 0) / 2,
            y: cursorEl.offsetTop + (cursorEl.offsetHeight || 0) / 2,
          } : null;
          this.steps.push({
            midi: bestMidi,
            name: midiToName(bestMidi),
            measureNumber,
            stepIndex: this.steps.length,
            // Engraved staff position (letter+octave, ignores accidental).
            // Used to anchor the detected-pitch overlay on the actual notehead.
            diatonicStep,
            // Pixel center of the cursor when stopped on this step (offsetParent-relative).
            x: xy ? xy.x : null,
            y: xy ? xy.y : null,
          });
        }
      }
      cursor.next();
      safety++;
    }
    cursor.reset();
  }

  _getCurrentMeasureNumber(cursor) {
    try {
      // Try several known properties / APIs across OSMD versions.
      const it = cursor.iterator;
      if (it && it.CurrentMeasure && typeof it.CurrentMeasure.MeasureNumber === "number") {
        return it.CurrentMeasure.MeasureNumber;
      }
      if (it && typeof it.CurrentMeasureIndex === "number") {
        return it.CurrentMeasureIndex + 1;
      }
    } catch { /* ignore */ }
    return 1;
  }

  get measureCount() {
    try {
      return this.osmd.Sheet.SourceMeasures.length;
    } catch {
      return this.steps.length > 0 ? this.steps[this.steps.length - 1].measureNumber : 0;
    }
  }

  /** Move the OSMD cursor to a specific step index in our flattened list. */
  goToStep(idx) {
    if (this.steps.length === 0) return;
    idx = Math.max(0, Math.min(this.steps.length - 1, idx));
    const cursor = this.osmd.cursor;
    cursor.reset();
    // The cursor's reset puts it on the first event of the sheet (which we counted as step 0
    // only if it had pitched notes). To get to step idx, count pitched steps as we go.
    let pitchedSeen = 0;
    let safety = 0;
    while (!cursor.iterator.EndReached && safety < 100000) {
      const notes = cursor.NotesUnderCursor().filter(n => n && n.Pitch);
      if (notes.length > 0) {
        if (pitchedSeen === idx) {
          this.currentStepIndex = idx;
          cursor.show();
          return;
        }
        pitchedSeen++;
      }
      cursor.next();
      safety++;
    }
    this.currentStepIndex = idx;
    cursor.show();
  }

  currentStep() {
    if (this.currentStepIndex < 0 || this.currentStepIndex >= this.steps.length) return null;
    return this.steps[this.currentStepIndex];
  }

  advance() {
    if (this.steps.length === 0) return;
    let next = this.currentStepIndex + 1;
    if (next > this.sectionEnd) next = this.sectionStart;
    this.goToStep(next);
  }

  prev() {
    if (this.steps.length === 0) return;
    let next = this.currentStepIndex - 1;
    if (next < this.sectionStart) next = this.sectionEnd;
    this.goToStep(next);
  }

  resetToSectionStart() {
    this.goToStep(this.sectionStart);
  }

  /**
   * Restrict practice to a measure range [startMeasure, endMeasure] (inclusive, 1-based).
   * Both bounds are clamped to the available measures.
   */
  setSection(startMeasure, endMeasure) {
    if (this.steps.length === 0) {
      this.sectionStart = 0;
      this.sectionEnd = 0;
      return { startMeasure: 1, endMeasure: 1 };
    }
    const minMeas = this.steps[0].measureNumber;
    const maxMeas = this.steps[this.steps.length - 1].measureNumber;
    const sm = Math.max(minMeas, Math.min(maxMeas, startMeasure | 0));
    const em = Math.max(sm, Math.min(maxMeas, endMeasure | 0));
    let startIdx = this.steps.findIndex(s => s.measureNumber >= sm);
    if (startIdx === -1) startIdx = 0;
    let endIdx = -1;
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].measureNumber <= em) { endIdx = i; break; }
    }
    if (endIdx === -1) endIdx = this.steps.length - 1;
    this.sectionStart = startIdx;
    this.sectionEnd = endIdx;
    this.goToStep(startIdx);
    return { startMeasure: sm, endMeasure: em };
  }

  clearSection() {
    this.sectionStart = 0;
    this.sectionEnd = Math.max(0, this.steps.length - 1);
    this.goToStep(0);
  }

  hide() {
    try { this.osmd.cursor.hide(); } catch { /* ignore */ }
  }

  /**
   * Returns the OSMD cursor's <img> element (or null if not yet rendered).
   * The element is absolutely positioned inside the score container, so its
   * offsetTop / offsetLeft / offsetWidth / offsetHeight can be used directly
   * to anchor sibling overlays.
   */
  getCursorElement() {
    try { return this.osmd.cursor.cursorElement || null; }
    catch { return null; }
  }

  /**
   * Find the practice step whose engraved position is closest to a point in
   * the cursor's offsetParent coordinate space. Returns the step's index, or
   * -1 if no step is within `maxDistance` px of the point.
   *
   * Y distance is weighted lighter than X distance (yWeight < 1) because the
   * user usually long-presses the *measure* they want, not a specific staff
   * line — biasing toward horizontal proximity matches that intent.
   */
  findStepIndexNearPoint(x, y, { maxDistance = 200, yWeight = 0.35 } = {}) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const s of this.steps) {
      if (s.x == null || s.y == null) continue;
      const dx = s.x - x;
      const dy = (s.y - y) * yWeight;
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = s.stepIndex;
      }
    }
    return bestDist <= maxDistance ? bestIdx : -1;
  }
}
