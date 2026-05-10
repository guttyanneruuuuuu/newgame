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
  // Sensitivity: small movement on phone -> small movement on ball.
  // Inverted forward/back: tipping the *back* of the phone DOWN -> ball moves UP-screen.
  // beta: device tilted forward/back. When user tilts the back of the phone down,
  //       the phone is tilted forward (beta > 0 for typical iOS portrait).
  //       That means screen-top "looks down" -> we want ball to move forward (-z in world).
  const GYRO = {
    deadZone: 2.0,         // degrees of dead zone after calibration
    maxAngle: 18.0,        // degrees that map to full input (smaller = less travel)
    smooth: 0.18,          // smoothing factor (0=no smoothing, 1=instant)
    invertForwardBack: true, // requested: tilting back of phone DOWN => up on screen
    invertLeftRight: false
  };
  let smoothedX = 0, smoothedZ = 0;

  function onDeviceOrientation(e) {
    if (!state.gyro.enabled) return;
    let beta = e.beta || 0;    // -180..180 (front-back tilt, portrait)
    let gamma = e.gamma || 0;  // -90..90 (left-right tilt)

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

    let nx = BDR.clamp(dGamma / GYRO.maxAngle, -1, 1);
    let nz = BDR.clamp(dBeta / GYRO.maxAngle, -1, 1);

    if (GYRO.invertLeftRight) nx = -nx;
    // For "phone back DOWN -> screen UP": when user tilts the top edge of phone DOWN
    //   (so they can see screen better), beta typically DECREASES (becomes more negative).
    //   We want ball to move "up screen" => -z in world.
    // After testing across devices, the requested behavior is: tilting the BACK of the
    //   phone DOWN should move the ball UP on screen. "Back down" means the bottom edge
    //   of the phone goes down / top edge goes up -> beta increases.
    //   So increasing beta should produce -z (move toward screen-up = away).
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

  return {
    state,
    update,
    requestGyroPermission,
    setupJoystick,
    recalibrate,
    GYRO
  };
})();

console.log('[BDR] controls loaded');
