/* ============================================================
   sound.js - tiny WebAudio synth for SFX (no external assets)
   ============================================================ */
window.BDR = window.BDR || {};

BDR.sound = (function() {
  let ctx = null;
  let masterGain = null;
  let enabled = true;
  let lastPlayAt = {};

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.35;
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('[snd] no audio', e);
    }
    return ctx;
  }

  // Resume on first user gesture (required by browsers)
  function unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone({ freq = 440, dur = 0.12, type = 'sine', gain = 0.4, attack = 0.005, decay = 0.08, sweep = 0 }) {
    if (!enabled) return;
    ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * sweep), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(masterGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // Throttle a sound key so rapid events don't blast
  function throttled(key, ms, fn) {
    const now = performance.now();
    if ((lastPlayAt[key] || 0) + ms > now) return;
    lastPlayAt[key] = now;
    fn();
  }

  function bump() { throttled('bump', 60, () => tone({ freq: 220, dur: 0.10, type: 'square', gain: 0.18, sweep: 0.6 })); }
  function dash() { tone({ freq: 520, dur: 0.16, type: 'sawtooth', gain: 0.20, sweep: 0.4 }); }
  function pickup() { tone({ freq: 880, dur: 0.10, type: 'sine', gain: 0.22, sweep: 1.4 }); setTimeout(()=>tone({freq:1320,dur:0.08,type:'sine',gain:0.18,sweep:1.2}), 60); }
  function bounce() { throttled('bounce', 120, () => tone({ freq: 440, dur: 0.16, type: 'triangle', gain: 0.20, sweep: 1.6 })); }
  function hit() { throttled('hit', 80, () => tone({ freq: 320, dur: 0.18, type: 'square', gain: 0.22, sweep: 0.4 })); }
  function countdown() { tone({ freq: 660, dur: 0.10, type: 'square', gain: 0.18 }); }
  function go() { tone({ freq: 880, dur: 0.20, type: 'square', gain: 0.25 }); setTimeout(()=>tone({freq:1320,dur:0.25,type:'square',gain:0.25}), 90); }
  function goal() {
    [0,80,180,300].forEach((d, i) => setTimeout(() =>
      tone({ freq: [660, 880, 1100, 1480][i], dur: 0.18, type: 'triangle', gain: 0.22 }), d));
  }
  function setEnabled(v) { enabled = !!v; }

  // Auto-unlock on first interaction
  ['click','touchstart','keydown'].forEach(ev => {
    window.addEventListener(ev, unlock, { once: true, passive: true });
  });

  return {
    bump, dash, pickup, bounce, hit, countdown, go, goal,
    unlock, setEnabled
  };
})();

console.log('[BDR] sound loaded');
