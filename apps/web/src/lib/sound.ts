/** Tiny WebAudio UI sounds (OFF by default). No audio files needed. */

let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundsEnabled(on: boolean): void {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain = 0.05): void {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + dur + 0.02);
}

export const sounds = {
  click: () => tone(880, 0, 0.05, 'square', 0.03),
  pop: () => tone(520, 0, 0.08, 'triangle', 0.05),
  chime: () => {
    tone(523, 0, 0.12, 'square', 0.03);
    tone(659, 0.1, 0.12, 'square', 0.03);
    tone(784, 0.2, 0.22, 'square', 0.035);
  },
};
