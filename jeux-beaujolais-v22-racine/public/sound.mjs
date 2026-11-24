// Sons d'ambiance de l'écran organisateur, synthétisés avec Web Audio (aucun fichier à charger).
// Les téléphones restent silencieux. Le navigateur n'autorise le son qu'après un premier clic : on démarre au premier geste.
let ctx = null;
let muted = (() => { try { return localStorage.getItem('jb-muted') === '1'; } catch { return false; } })();

function audio() {
  if (muted) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}
addEventListener('pointerdown', () => { if (!muted) audio(); }, { once: true });

export const isMuted = () => muted;
export function setMuted(on) {
  muted = on;
  try { localStorage.setItem('jb-muted', on ? '1' : '0'); } catch { /* stockage indisponible */ }
  if (!on) audio();
}

// Une note : forme d'onde, fréquence, début (s), durée (s), volume.
function note(type, freq, at, dur, vol = 0.18, slideTo = null) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

// Bruit court (bois, tonneau) : un souffle filtré.
function knock(at = 0, vol = 0.35) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at, len = Math.floor(a.sampleRate * 0.08), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination); src.start(t);
}

export const sounds = {
  tick: () => note('square', 1200, 0, 0.05, 0.08),                     // trois dernières secondes
  go: () => { note('triangle', 660, 0, 0.12); note('triangle', 990, 0.12, 0.25); },
  reveal: () => { note('sine', 440, 0, 0.12, 0.15); note('sine', 660, 0.1, 0.25, 0.15); knock(0, 0.2); },
  wrongRight: () => note('sine', 880, 0, 0.35, 0.16, 1320),               // bonne réponse affichée
  whoosh: () => note('sawtooth', 300, 0, 0.35, 0.06, 1400),              // dépassement dans la course
  knock: () => knock(0, 0.35),
  jingle: () => [523, 659, 784, 1047].forEach((f, i) => note('triangle', f, i * 0.13, i === 3 ? 0.6 : 0.18, 0.2)),
};
