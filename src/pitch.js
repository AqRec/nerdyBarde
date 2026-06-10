// Pitch detection utilities.
// Uses pitchy (autocorrelation) for fundamental frequency detection.

import { PitchDetector } from "https://esm.sh/pitchy@4.1.0";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function freqToMidi(freq, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4);
}

export function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi) {
  const m = Math.round(midi);
  const name = NOTE_NAMES[((m % 12) + 12) % 12];
  const octave = Math.floor(m / 12) - 1;
  return `${name}${octave}`;
}

/**
 * Given a detected frequency, returns the nearest MIDI note and cents deviation.
 */
export function freqToNoteInfo(freq, a4 = 440) {
  const midiFloat = freqToMidi(freq, a4);
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  return { midi, cents, name: midiToNoteName(midi) };
}

/**
 * Compute cents deviation between an observed frequency and a target MIDI note.
 */
export function centsFromTarget(freq, targetMidi, a4 = 440) {
  const midiFloat = freqToMidi(freq, a4);
  return (midiFloat - targetMidi) * 100;
}

export class PitchTracker {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.detector = null;
    this.buffer = null;
    this.rafId = null;
    this.onPitch = null;
    // Validity gates. Lower than the pitchy defaults because a bowed violin
    // dips below 0.85 clarity during string-crossing / bow changes; being too
    // strict makes the readout flash on/off and feel laggy.
    this.minClarity = 0.7;
    this.minRms = 0.003;
  }

  async start(onPitch) {
    if (this.audioCtx) return;
    this.onPitch = onPitch;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.sourceNode.connect(this.analyser);

    this.detector = PitchDetector.forFloat32Array(this.analyser.fftSize);
    // Tighten the lower bound of acceptable signal
    this.detector.minVolumeDecibels = -50;
    this.buffer = new Float32Array(this.detector.inputLength);

    const loop = () => {
      this.analyser.getFloatTimeDomainData(this.buffer);
      const rms = computeRms(this.buffer);
      const [pitch, clarity] = this.detector.findPitch(this.buffer, this.audioCtx.sampleRate);
      const valid = clarity >= this.minClarity && rms >= this.minRms && pitch > 50 && pitch < 4000;
      if (this.onPitch) {
        this.onPitch({ pitch, clarity, rms, valid });
      }
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.mediaStream) this.mediaStream.getTracks().forEach(t => t.stop());
    if (this.audioCtx) this.audioCtx.close();
    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.detector = null;
    this.buffer = null;
  }

  get isActive() {
    return !!this.audioCtx;
  }
}

function computeRms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}
