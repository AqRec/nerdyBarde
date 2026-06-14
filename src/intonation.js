// Intonation systems and violin-native intonation feedback.
//
// Why this module exists
// ----------------------
// A tuner that scores you against 12-tone equal temperament (12-TET) is, for a
// violinist, scoring you against the *piano*. The violin has no frets: you tune
// by ear, and the instrument itself tells you when a note is in tune through
//   (1) sympathetic resonance — an open string (G3 D4 A4 E5) rings when you play
//       a note that forms a low-whole-number frequency ratio with it, and
//   (2) beatless double stops — two notes a pure interval apart stop "beating".
// Both of those reward *pure* (just / Pythagorean) intervals, not 12-TET ones.
//
// So this module provides:
//   • the pure open-string frequencies (a 3:2 chain, how a violin is really tuned),
//   • selectable target intonation (Equal / Pythagorean / Just) relative to a tonic,
//   • a sympathetic-resonance analysis you can show live while the user plays.
//
// It is intentionally dependency-free and DOM-free so it can be unit-tested with
// plain Node and reasoned about in isolation.

/* ----------------------------- small helpers ----------------------------- */

/** Cents from frequency `f` to frequency `ref` (positive = f is sharp of ref). */
export function centsBetween(f, ref) {
  return 1200 * Math.log2(f / ref);
}

/** Equal-tempered frequency of a MIDI note for a given A4 reference. */
export function etFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/* --------------------------- the open strings ---------------------------- */
//
// A violin is tuned in PERFECT (beatless, 3:2) fifths, not 700-cent ones. With
// A4 as the anchor, the four strings come out as a chain of 3:2s:
//     G3 = A4 · (2/3)²   D4 = A4 · (2/3)   A4 = A4   E5 = A4 · (3/2)
// Note these differ from 12-TET (e.g. pure E5 = 660 Hz vs 12-TET 659.26 Hz) —
// the open strings themselves are already not equal-tempered.

export const OPEN_STRINGS = Object.freeze([
  { name: "G", midi: 55, ratio: 4 / 9 }, // two pure fifths below A
  { name: "D", midi: 62, ratio: 2 / 3 }, // one pure fifth below A
  { name: "A", midi: 69, ratio: 1 },     // the anchor
  { name: "E", midi: 76, ratio: 3 / 2 }, // one pure fifth above A
]);

/** Pure (3:2-chain) frequency of an open string given by its MIDI number. */
export function openStringFreq(midi, a4 = 440) {
  const s = OPEN_STRINGS.find((x) => x.midi === midi);
  return s ? a4 * s.ratio : etFreq(midi, a4);
}

/** All four pure open-string frequencies, keyed by letter. */
export function openStringFreqs(a4 = 440) {
  const out = {};
  for (const s of OPEN_STRINGS) out[s.name] = a4 * s.ratio;
  return out;
}

/* -------------------------- intonation systems --------------------------- */
//
// Each table gives the cents OFFSET FROM 12-TET for a chromatic scale degree
// 0..11 measured from the tonic. Add the offset to the equal-tempered target to
// get the pure target. (Degree = ((midi - tonicPitchClass) mod 12).)
//
// Pythagorean = a chain of pure 3:2 fifths from the tonic. It keeps fifths and
// fourths pure and pushes the "active" notes outward: the leading tone (deg 11)
// sits HIGH and major thirds are wide (+7.8¢). This is the classic *melodic*
// soloist's intonation — high leading tones pull toward resolution.
const PYTHAGOREAN = Object.freeze([
  0,        // 0  unison      1/1
  -9.775,   // 1  m2          256/243
  +3.910,   // 2  M2          9/8
  -5.865,   // 3  m3          32/27
  +7.820,   // 4  M3          81/64   (wide third)
  -1.955,   // 5  P4          4/3
  +11.730,  // 6  A4          729/512 (sharp tritone)
  +1.955,   // 7  P5          3/2
  -7.820,   // 8  m6          128/81
  +5.865,   // 9  M6          27/16
  -3.910,   // 10 m7          16/9
  +9.775,   // 11 M7          243/128 (high leading tone)
]);

// Just intonation = low-whole-number ratios to the tonic. It makes the triad
// consonances lock in: the major third is LOW (5/4, -13.7¢) and the minor third
// HIGH (6/5, +15.6¢), so chords stop beating. This is *harmonic* / ensemble
// intonation. Note the leading tone (15/8) is now LOW — opposite of Pythagorean.
const JUST = Object.freeze([
  0,        // 0  unison      1/1
  +11.731,  // 1  m2          16/15
  +3.910,   // 2  M2          9/8
  +15.641,  // 3  m3          6/5     (high minor third)
  -13.686,  // 4  M3          5/4     (low major third)
  -1.955,   // 5  P4          4/3
  -9.776,   // 6  TT          45/32
  +1.955,   // 7  P5          3/2
  +13.686,  // 8  m6          8/5
  -15.641,  // 9  M6          5/3
  -3.910,   // 10 m7          16/9
  -11.731,  // 11 M7          15/8    (low leading tone)
]);

const EQUAL = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

export const SYSTEMS = Object.freeze({
  equal: { id: "equal", label: "Equal temperament", table: EQUAL, needsTonic: false },
  pythagorean: { id: "pythagorean", label: "Pythagorean (melodic)", table: PYTHAGOREAN, needsTonic: true },
  just: { id: "just", label: "Just (harmonic)", table: JUST, needsTonic: true },
});

/**
 * Cents offset from 12-TET for a note under a given system, relative to a tonic.
 * Returns 0 for equal temperament or when no tonic is known.
 *
 * @param {number} midi        MIDI note number of the target
 * @param {number|null} tonicPc Tonic pitch class 0..11 (C=0). null => no shift.
 * @param {string} systemId    "equal" | "pythagorean" | "just"
 */
export function systemCentsOffset(midi, tonicPc, systemId = "equal") {
  const sys = SYSTEMS[systemId];
  if (!sys || !sys.needsTonic || tonicPc == null) return 0;
  const degree = (((midi - tonicPc) % 12) + 12) % 12;
  return sys.table[degree];
}

/**
 * Target frequency of a note under a tuning system.
 *
 * @param {number} midi
 * @param {{a4?:number, tonicPc?:number|null, system?:string}} opts
 */
export function systemTargetFreq(midi, { a4 = 440, tonicPc = null, system = "equal" } = {}) {
  const base = etFreq(midi, a4);
  const offset = systemCentsOffset(midi, tonicPc, system);
  return offset ? base * Math.pow(2, offset / 1200) : base;
}

/** Map a key signature (fifths: +sharps / -flats) to its MAJOR tonic pitch class. */
export function fifthsToTonicPc(fifths) {
  if (fifths == null || Number.isNaN(fifths)) return null;
  return (((fifths * 7) % 12) + 12) % 12;
}

const PITCH_CLASS_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function pitchClassName(pc) {
  return PITCH_CLASS_NAMES[(((pc % 12) + 12) % 12)];
}

/* ----------------------- sympathetic resonance --------------------------- */
//
// The intervals (played / open-string) that actually make a violin's open
// strings ring, with a rough audibility weight. Lower-order ratios ring harder.
// We include sub-unison ratios (the played note is below the string) because the
// open string still resonates when its harmonics line up.
const RESONANT_INTERVALS = Object.freeze([
  { ratio: 1 / 2, label: "octave below", weight: 0.70 },
  { ratio: 2 / 3, label: "fifth below", weight: 0.45 },
  { ratio: 3 / 4, label: "fourth below", weight: 0.30 },
  { ratio: 1 / 1, label: "unison", weight: 1.00 },
  { ratio: 5 / 4, label: "major 3rd", weight: 0.40 },
  { ratio: 4 / 3, label: "fourth", weight: 0.50 },
  { ratio: 3 / 2, label: "fifth", weight: 0.80 },
  { ratio: 5 / 3, label: "major 6th", weight: 0.35 },
  { ratio: 2 / 1, label: "octave", weight: 0.85 },
  { ratio: 5 / 2, label: "octave + 3rd", weight: 0.28 },
  { ratio: 3 / 1, label: "twelfth", weight: 0.60 },
  { ratio: 4 / 1, label: "two octaves", weight: 0.45 },
]);

// Beyond this many cents from a pure node, the string does not meaningfully ring.
const RING_WINDOW_CENTS = 35;
// Within this many cents we call it locked-in / beatless.
export const RING_LOCK_CENTS = 6;

/**
 * Analyse how strongly a played frequency rings the open strings.
 *
 * For every open string and every resonant interval we compute the nearest pure
 * "node" frequency and how far (in cents) the played pitch is from it, then keep
 * the strongest candidate. The returned `cents` is signed: positive means the
 * played note is sharp of the pure node (so the player should lower slightly).
 *
 * @param {number} freq    detected fundamental frequency (Hz)
 * @param {number} a4      A4 reference (Hz)
 * @returns {null | {
 *   string: string,        // "G" | "D" | "A" | "E"
 *   stringMidi: number,
 *   interval: string,      // human label, e.g. "fifth"
 *   cents: number,         // signed cents from the pure node
 *   strength: number,      // 0..1 ring strength (1 = strongest possible)
 *   locked: boolean        // within RING_LOCK_CENTS of beatless
 * }}
 */
export function analyzeResonance(freq, a4 = 440) {
  if (!(freq > 0)) return null;
  let best = null;
  for (const s of OPEN_STRINGS) {
    const stringFreq = a4 * s.ratio;
    for (const iv of RESONANT_INTERVALS) {
      const node = stringFreq * iv.ratio;
      const cents = centsBetween(freq, node);
      if (Math.abs(cents) > RING_WINDOW_CENTS) continue;
      const proximity = 1 - Math.abs(cents) / RING_WINDOW_CENTS; // 0..1
      const strength = iv.weight * proximity;
      if (!best || strength > best.strength) {
        best = {
          string: s.name,
          stringMidi: s.midi,
          interval: iv.label,
          cents,
          strength,
          locked: Math.abs(cents) <= RING_LOCK_CENTS,
        };
      }
    }
  }
  return best;
}
