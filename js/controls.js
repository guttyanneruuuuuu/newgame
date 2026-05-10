/* ============================================================
   controls.js - input: gyro / keyboard / touch joystick
   Output: BDR.controls.input = { x: -1..1, z: -1..1, jump: bool }
   ============================================================ */
window.BDR = window.BDR || {};

BDR.controls = (function() {
  const state = {
    input: { x: 0, z: 0, jump: false },
    gyro: { enabled: false, calibrated: false, baseBeta: 0, baseGamma: 0 },
    keys: {},
    joystick: { active: false, x: 0, y: 0 },
    mode: 'auto' // 'gyro' | 'touch' | 'keyboard'
  };

  // ---------------- Keyboard ----------------
  window.addEventListener('keydown', (e) => {
    state.keys[e.key.toLowerCase()] = true;
    if (e.code === 'Space') state.input.jump = true;
  });
  window.addEventListener('keyup', (e) => {
    state.keys[e.key.toLowerCase()] = false;
  });

  function computeKeyboard() {
    let x = 0, z = 0;
    if (state.keys['arrowleft'] || state.keys['a']) x -= 1;
    if (state.keys['arrowright'] || state.keys['d']) x += 1;
    if (state.keys['arrowup'] || state.keys['w']) z -= 1;
    if (state.keys['arrowdown'] || state.keys['s']) z += 1;
    return { x, z };
  }

  // ---------------- Gyro ----------------
  // User-requested intuitive mapping (re-fixed):
  //   * Tilt the FAR edge of the phone DOWN  => ball goes UP on screen.
  //   * Tilt the right edge DOWN              => ball goes RIGHT on screen.
  //   * Larger dead-zone & response curve so small jitters don't drift.
  //   * Exponential response curve so small tilts give precise control,
  //     while larger tilts produce strong push for nimble dodging.
  //
  // Convention (portrait):
  //   beta  > 0 = top of phone tilts AWAY (far edge down).
  //   gamma > 0 = right side of phone tilts down.
  // Camera looks toward -Z (so "up on screen" = -Z world).
  const GYRO = {
    deadZone: 2.5,         // bigger so resting hand doesn't drift
    maxAngle: 18.0,        // tilt angle that maps to full input (smaller = quicker response)
    smooth: 0.32,          // higher = snappier (was 0.22)
    sensitivity: 1.25,     // overall multiplier (gain)
    curve: 1.6,            // response curve exponent (>1 = gentler near 0, faster at extremes)
    invertForwardBack: false, // tilting far edge DOWN should move UP on screen
    invertLeftRight: false
  };
  let smoothedX = 0, smoothedZ = 0;
  let lastRawBeta = 0, lastRawGamma = 0;

  function applyCurve(v, exp) {
    // signed exponent curve: keeps sign, eases small inputs
    const s = Math.sign(v);
    const a = Math.min(1, Math.abs(v));
    return s * Math.pow(a, exp);
  }

  function onDeviceOrientation(e) {
    if (!state.gyro.enabled) return;
    let beta = e.beta || 0;    // -180..180 (front-back tilt, portrait)
    let gamma = e.gamma || 0;  // -90..90 (left-right tilt)
    lastRawBeta = beta; lastRawGamma = gamma;

    // Auto-calibrate on first frame after enabling
    if (!state.gyro.calibrated) {
      state.gyro.baseBeta = beta;
      state.gyro.baseGamma = gamma;
      state.gyro.calibrated = true;
    }

    let dBeta = beta - state.gyro.baseBeta;
    let dGamma = gamma - state.gyro.baseGamma;

    // dead zone
    const dz = GYRO.deadZone;
    if (Math.abs(dBeta) < dz) dBeta = 0; else dBeta = dBeta - Math.sign(dBeta) * dz;
    if (Math.abs(dGamma) < dz) dGamma = 0; else dGamma = dGamma - Math.sign(dGamma) * dz;

    let nxRaw = BDR.clamp(dGamma / GYRO.maxAngle, -1, 1);
    let nzRaw = BDR.clamp(dBeta  / GYRO.maxAngle, -1, 1);

    // Curve so tiny tilts feel gentle and natural
    let nx = applyCurve(nxRaw, GYRO.curve) * GYRO.sensitivity;
    let nz = applyCurve(nzRaw, GYRO.curve) * GYRO.sensitivity;
    nx = BDR.clamp(nx, -1, 1);
    nz = BDR.clamp(nz, -1, 1);

    if (GYRO.invertLeftRight) nx = -nx;
    // === Forward/back mapping (user requested fix) ===
    // beta > 0 = far edge down. We want this to mean +Z world (forward into the screen).
    // Camera looks toward -Z, so "up on screen" = -Z. To make far-edge-down translate to
    // moving "up on screen", we need beta>0 -> -Z, i.e. invert nz. The previous build
    // already inverted; users reported it still felt reversed because of phone orientation
    // detection differences. We expose `invertForwardBack` and default to NOT inverting now.
    if (GYRO.invertForwardBack) nz = -nz;

    // Smooth
    smoothedX = BDR.lerp(smoothedX, nx, GYRO.smooth);
    smoothedZ = BDR.lerp(smoothedZ, nz, GYRO.smooth);
  }

  function setupGyro() {
    window.addEventListener('deviceorientation', onDeviceOrientation, true);
  }

  async function requestGyroPermission() {
    // iOS 13+ requires explicit permission
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res === 'granted') {
          state.gyro.enabled = true;
          state.gyro.calibrated = false;
          state.mode = 'gyro';
          setupGyro();
          return true;
        }
        return false;
      } catch (e) {
        console.warn('[gyro] perm err', e);
        return false;
      }
    } else {
      // Android / desktop: just enable
      state.gyro.enabled = true;
      state.gyro.calibrated = false;
      state.mode = 'gyro';
      setupGyro();
      return true;
    }
  }

  function recalibrate() {
    state.gyro.calibrated = false;
    smoothedX = 0;
    smoothedZ = 0;
  }

  // ---------------- Touch joystick ----------------
  function setupJoystick(el) {
    const stick = el.querySelector('#joy-stick');
    const base = el.querySelector('.joy-base');
    let activeId = null;
    let cx = 0, cy = 0;
    const RADIUS = 50;

    function start(e) {
      const t = e.changedTouches ? e.changedTouches[0] : e;
      activeId = t.identifier ?? 'mouse';
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      state.joystick.active = true;
      move(e);
      e.preventDefault();
    }
    function move(e) {
      if (!state.joystick.active) return;
      let t;
      if (e.changedTouches) {
        for (const ct of e.changedTouches) if (ct.identifier === activeId) { t = ct; break; }
      } else { t = e; }
      if (!t) return;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) { dx = dx * RADIUS / d; dy = dy * RADIUS / d; }
      stick.style.transform = `translate(${dx}px, ${dy}px)`;
      state.joystick.x = dx / RADIUS;
      state.joystick.y = dy / RADIUS;
      e.preventDefault();
    }
    function end(e) {
      if (!state.joystick.active) return;
      state.joystick.active = false;
      stick.style.transform = 'translate(0, 0)';
      state.joystick.x = 0;
      state.joystick.y = 0;
    }
    base.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    base.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
  }

  // ---------------- Update loop ----------------
  function update() {
    let ix = 0, iz = 0;

    // Gyro takes priority on mobile if enabled
    if (state.gyro.enabled) {
      ix = smoothedX;
      iz = smoothedZ;
    }

    // Keyboard always overrides if pressed
    const kb = computeKeyboard();
    if (kb.x !== 0 || kb.z !== 0) { ix = kb.x; iz = kb.z; }

    // Joystick overrides if active
    if (state.joystick.active) { ix = state.joystick.x; iz = state.joystick.y; }

    state.input.x = ix;
    state.input.z = iz;
  }

  // Allow runtime toggling of forward/back inversion (user fine-tune button)
  function toggleForwardBackInvert() {
    GYRO.invertForwardBack = !GYRO.invertForwardBack;
    smoothedX = 0; smoothedZ = 0;
    return GYRO.invertForwardBack;
  }

  return {
    state,
    update,
    requestGyroPermission,
    setupJoystick,
    recalibrate,
    toggleForwardBackInvert,
    GYRO
  };
})();

console.log('[BDR] controls loaded');
