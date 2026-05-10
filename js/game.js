/* ============================================================
   game.js - 3D ball-rolling maze game (Three.js + Cannon-es)
   ============================================================ */
window.BDR = window.BDR || {};

BDR.game = (function() {
  const cfg = {
    cellSize: 6,
    mazeW: 13,
    mazeH: 13,
    ballRadius: 0.55,
    ballMass: 1.0,
    moveForce: 5.5,        // tuned for "small" gyro feel
    maxSpeed: 8.5,
    airControl: 0.4,
    cameraDist: 4.5,
    cameraHeight: 1.8,
    fov: 75
  };

  let renderer, scene, camera;
  let physWorld;
  let mazeMesh, mazeData, maze;
  let players = [];     // { id, name, color, isCPU, mesh, body, label, finished, finishTime, place, bot? }
  let myId = '';
  let isHost = true;
  let running = false;
  let startTime = 0;
  let lastFrame = 0;
  let countdownActive = false;
  let raceStartedAt = 0;
  let finishedCount = 0;
  let onResult = null;
  let onTick = null;       // host tick (for broadcasting state)
  let networkInputs = {};  // host: {playerId: input}
  let lastNetSnap = null;  // client: latest snapshot
  let snapInterp = { from: null, to: null, atFromMs: 0, atToMs: 0 };
  let resetCallback = null;
  let powerups = [];
  let projectiles = [];     // active projectiles (host only)
  let lastShotAt = {};      // playerId -> timestamp of last projectile shot
  let lastDashAt = {};      // playerId -> timestamp of last dash

  function init(container) {
    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcef0ff);
    scene.fog = new THREE.Fog(0xcef0ff, 25, 90);

    camera = new THREE.PerspectiveCamera(cfg.fov, window.innerWidth / window.innerHeight, 0.1, 300);
    camera.position.set(0, 8, 12);

    // lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb0d4ff, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1c8, 1.05);
    sun.position.set(40, 60, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc7e6ff, 0.35);
    fill.position.set(-30, 40, -20);
    scene.add(fill);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  function buildPhysics() {
    physWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    physWorld.broadphase = new CANNON.SAPBroadphase(physWorld);
    physWorld.allowSleep = false;
    physWorld.defaultContactMaterial.friction = 0.25;
    physWorld.defaultContactMaterial.restitution = 0.15;

    const groundMat = new CANNON.Material('ground');
    const ballMat = new CANNON.Material('ball');
    const wallMat = new CANNON.Material('wall');

    physWorld.addContactMaterial(new CANNON.ContactMaterial(groundMat, ballMat, {
      friction: 0.35, restitution: 0.05
    }));
    physWorld.addContactMaterial(new CANNON.ContactMaterial(wallMat, ballMat, {
      friction: 0.0, restitution: 0.55
    }));
    physWorld.addContactMaterial(new CANNON.ContactMaterial(ballMat, ballMat, {
      friction: 0.05, restitution: 0.85
    }));

    // Ground: large flat box
    const totalW = cfg.mazeW * cfg.cellSize;
    const totalH = cfg.mazeH * cfg.cellSize;
    const groundShape = new CANNON.Box(new CANNON.Vec3(totalW, 0.2, totalH));
    const groundBody = new CANNON.Body({ mass: 0, material: groundMat });
    groundBody.addShape(groundShape);
    groundBody.position.set(totalW / 2 - cfg.cellSize / 2, -0.2, totalH / 2 - cfg.cellSize / 2);
    physWorld.addBody(groundBody);

    // Walls from mazeData
    const wallH = mazeData.wallH;
    for (const w of mazeData.wallSpecs) {
      const shape = new CANNON.Box(new CANNON.Vec3(w.sx / 2, wallH / 2, w.sz / 2));
      const body = new CANNON.Body({ mass: 0, material: wallMat });
      body.addShape(shape);
      body.position.set(w.cx, wallH / 2, w.cz);
      physWorld.addBody(body);
    }

    physWorld._mats = { groundMat, ballMat, wallMat };

    // Goal sensor (we just check distance in JS)
  }

  function createBall(player, startCell) {
    const geo = new THREE.SphereGeometry(cfg.ballRadius, 32, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: player.color,
      roughness: 0.35,
      metalness: 0.15,
      emissive: BDR.darken(player.color, 0.35),
      emissiveIntensity: 0.18
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // little face / smile decal as a child
    const faceCanvas = document.createElement('canvas');
    faceCanvas.width = faceCanvas.height = 128;
    const fctx = faceCanvas.getContext('2d');
    fctx.clearRect(0, 0, 128, 128);
    fctx.fillStyle = '#000';
    fctx.beginPath(); fctx.arc(40, 50, 8, 0, Math.PI*2); fctx.fill();
    fctx.beginPath(); fctx.arc(88, 50, 8, 0, Math.PI*2); fctx.fill();
    fctx.strokeStyle = '#000'; fctx.lineWidth = 6; fctx.lineCap = 'round';
    fctx.beginPath(); fctx.arc(64, 78, 16, 0, Math.PI); fctx.stroke();
    const faceTex = new THREE.CanvasTexture(faceCanvas);
    faceTex.colorSpace = THREE.SRGBColorSpace;
    const faceGeo = new THREE.PlaneGeometry(cfg.ballRadius * 1.6, cfg.ballRadius * 1.6);
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false });
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.set(0, 0, cfg.ballRadius + 0.001);
    mesh.add(face);

    // Name label sprite
    const lc = document.createElement('canvas');
    lc.width = 256; lc.height = 64;
    const lctx = lc.getContext('2d');
    function drawLabel(name) {
      lctx.clearRect(0, 0, 256, 64);
      lctx.font = 'bold 36px "Hiragino Maru Gothic ProN","Noto Sans JP",sans-serif';
      lctx.textAlign = 'center';
      lctx.textBaseline = 'middle';
      lctx.lineWidth = 8;
      lctx.strokeStyle = 'rgba(0,0,0,0.55)';
      lctx.strokeText(name, 128, 32);
      lctx.fillStyle = '#fff';
      lctx.fillText(name, 128, 32);
    }
    drawLabel(player.name || 'Player');
    const labelTex = new THREE.CanvasTexture(lc);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const labelMat = new THREE.SpriteMaterial({ map: labelTex, depthTest: false, depthWrite: false });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(2.5, 0.625, 1);
    label.position.set(0, cfg.ballRadius + 0.9, 0);
    mesh.add(label);
    label.renderOrder = 999;

    scene.add(mesh);

    // Physics body
    const shape = new CANNON.Sphere(cfg.ballRadius);
    const body = new CANNON.Body({
      mass: cfg.ballMass,
      shape,
      material: physWorld._mats.ballMat,
      linearDamping: 0.18,
      angularDamping: 0.05
    });
    const sx = startCell.x * cfg.cellSize;
    const sz = startCell.y * cfg.cellSize;
    body.position.set(sx, cfg.ballRadius + 0.5, sz);
    physWorld.addBody(body);

    return { mesh, body, label };
  }

  function placePlayers(playerList) {
    players = [];
    const startCells = maze.startCells.slice();
    // shuffle deterministic-ish but stable order
    for (let i = 0; i < playerList.length; i++) {
      const p = playerList[i];
      const sc = startCells[i % startCells.length];
      const { mesh, body, label } = createBall(p, sc);
      players.push({
        id: p.id,
        name: p.name,
        color: p.color,
        isCPU: !!p.isCPU,
        isMe: p.id === myId,
        mesh, body, label,
        finished: false,
        finishTime: 0,
        place: 0,
        startCell: sc,
        bot: p.isCPU ? BDR.ai.makeBot(p, p.skill || 0.7) : null,
        boostUntil: 0,
        respawnTimer: 0
      });
    }
  }

  function spawnPowerups() {
    powerups.forEach(pu => scene.remove(pu.mesh));
    powerups = [];
    // Place a few boost pads in random open cells
    const tried = new Set();
    const N = 8;
    for (let i = 0; i < N; i++) {
      let attempts = 0, x, y;
      do {
        x = Math.floor(Math.random() * maze.width);
        y = Math.floor(Math.random() * maze.height);
        attempts++;
      } while ((tried.has(x + ',' + y) || (x === maze.goalCell.x && y === maze.goalCell.y)) && attempts < 20);
      tried.add(x + ',' + y);
      const geo = new THREE.TorusGeometry(0.55, 0.18, 12, 24);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffd166, emissive: 0xffae00, emissiveIntensity: 0.6, roughness: 0.3
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x * cfg.cellSize, 0.6, y * cfg.cellSize);
      mesh.rotation.x = Math.PI / 2;
      scene.add(mesh);
      powerups.push({ mesh, cellX: x, cellY: y, taken: false, type: 'boost' });
    }
  }

  // ----- Public API -----
  function setup(opts) {
    const { mazeSeed, playerList, selfId, hostFlag } = opts;
    myId = selfId;
    isHost = !!hostFlag;
    onResult = opts.onResult || null;
    onTick = opts.onTick || null;
    resetCallback = opts.resetCallback || null;
    networkInputs = {};
    lastNetSnap = null;
    snapInterp = { from: null, to: null, atFromMs: 0, atToMs: 0 };

    // Clear previous scene contents
    if (mazeMesh) {
      scene.remove(mazeMesh.group);
    }
    if (players.length) {
      for (const p of players) {
        scene.remove(p.mesh);
        if (p.body) physWorld.removeBody(p.body);
      }
    }
    players = [];
    // Clear projectiles
    for (const pj of projectiles) {
      scene.remove(pj.mesh);
      if (pj.trail) scene.remove(pj.trail);
      if (physWorld) physWorld.removeBody(pj.body);
    }
    projectiles = [];
    lastShotAt = {};
    lastDashAt = {};

    // Build maze
    maze = BDR.generateMaze(mazeSeed, cfg.mazeW, cfg.mazeH);
    mazeData = BDR.buildMazeMeshes(maze, { cellSize: cfg.cellSize });
    scene.add(mazeData.group);
    mazeMesh = mazeData;

    // Build physics
    buildPhysics();

    // Players
    placePlayers(playerList);

    // Powerups
    spawnPowerups();

    finishedCount = 0;
    raceStartedAt = 0;
    lastFrame = performance.now();
  }

  function startCountdown(startAtMs) {
    countdownActive = true;
    const cdEl = document.getElementById('countdown');
    cdEl.classList.remove('hidden');
    const tick = () => {
      const now = Date.now();
      const remain = startAtMs - now;
      if (remain > 0) {
        const num = Math.ceil(remain / 1000);
        cdEl.innerHTML = `<div class="countdown-num">${num}</div>`;
        requestAnimationFrame(tick);
      } else {
        cdEl.innerHTML = `<div class="countdown-num">GO!</div>`;
        running = true;
        raceStartedAt = now;
        startTime = now;
        countdownActive = false;
        setTimeout(() => cdEl.classList.add('hidden'), 700);
      }
    };
    tick();
  }

  // ----- Per-frame update -----
  function applyInputToBody(body, input, dt, isOnGround) {
    const force = isOnGround ? cfg.moveForce : cfg.moveForce * cfg.airControl;
    // Camera-aligned for local player; world-aligned ok since camera follows roughly
    body.applyForce(new CANNON.Vec3(input.x * force, 0, input.z * force), body.position);
    // soft cap horizontal speed
    const v = body.velocity;
    const hsp = Math.hypot(v.x, v.z);
    if (hsp > cfg.maxSpeed) {
      const k = cfg.maxSpeed / hsp;
      body.velocity.x *= k;
      body.velocity.z *= k;
    }
  }

  function isBodyOnGround(body) {
    return body.position.y < cfg.ballRadius + 0.5;
  }

  // CPU tries to shoot at the nearest opponent within range
  function tryCPUShoot(cpu) {
    if (!BDR.items) return;
    const now = performance.now();
    const last = lastShotAt[cpu.id] || 0;
    const cooldown = BDR.items.cfg.projCooldownMs * (1.6 - cpu.bot.skill * 0.6); // skilled CPUs fire faster
    if (now - last < cooldown) return;
    const range = BDR.items.cfg.projRangeCells * cfg.cellSize;
    let target = null, bestD = Infinity;
    for (const o of players) {
      if (o.id === cpu.id || o.finished) continue;
      const dx = o.body.position.x - cpu.body.position.x;
      const dz = o.body.position.z - cpu.body.position.z;
      const d = Math.hypot(dx, dz);
      if (d < range && d < bestD) { bestD = d; target = o; }
    }
    if (!target) return;
    // Predict target position based on velocity
    const lead = 0.25;
    const px = target.body.position.x + target.body.velocity.x * lead;
    const pz = target.body.position.z + target.body.velocity.z * lead;
    const dx = px - cpu.body.position.x;
    const dz = pz - cpu.body.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / d, z: dz / d };
    const fromPos = new THREE.Vector3(
      cpu.body.position.x + dir.x * (cfg.ballRadius + BDR.items.cfg.projRadius + 0.1),
      cpu.body.position.y + 0.1,
      cpu.body.position.z + dir.z * (cfg.ballRadius + BDR.items.cfg.projRadius + 0.1)
    );
    const colorInt = parseInt((cpu.color || '#ffaa00').slice(1), 16);
    const pj = BDR.items.makeProjectile(scene, physWorld, physWorld._mats.ballMat, cpu, fromPos, dir, colorInt);
    projectiles.push(pj);
    lastShotAt[cpu.id] = now;
  }

  // Local player dash (bumps in current move direction)
  function tryLocalDash() {
    const me = players.find(pp => pp.isMe);
    if (!me || me.finished) return false;
    const now = performance.now();
    const last = lastDashAt[me.id] || 0;
    if (now - last < BDR.items.cfg.dashCooldownMs) return false;
    const inp = BDR.controls.state.input;
    let dx = inp.x, dz = inp.z;
    if (dx*dx + dz*dz < 0.04) {
      // Use current velocity as direction if input is small
      const v = me.body.velocity;
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0.4) { dx = v.x / sp; dz = v.z / sp; }
      else if (me._smoothDir) { dx = me._smoothDir.x; dz = me._smoothDir.z; }
      else { dx = 0; dz = -1; }
    } else {
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
    }
    const imp = BDR.items.cfg.dashImpulse;
    me.body.velocity.x += dx * imp;
    me.body.velocity.z += dz * imp;
    me.body.velocity.y += 1.5;
    lastDashAt[me.id] = now;
    // Visual: brief scale flash
    me.mesh.scale.setScalar(1.25);
    setTimeout(() => { try { me.mesh.scale.setScalar(1); } catch(e){} }, 180);
    return true;
  }

  function getDashCooldownRatio() {
    const me = players.find(pp => pp.isMe);
    if (!me) return 0;
    const last = lastDashAt[me.id] || 0;
    const elapsed = performance.now() - last;
    if (!BDR.items) return 1;
    return Math.min(1, elapsed / BDR.items.cfg.dashCooldownMs);
  }

  function tick(dt) {
    if (!running && !countdownActive) {
      // Even before start, allow physics for a little settle
    }

    // Inputs per player
    if (isHost) {
      // CPU inputs
      for (const p of players) {
        if (p.finished) continue;
        if (p.isCPU) {
          const inp = BDR.ai.tick(p.bot, maze, cfg.cellSize, p.body, maze.goalCell, dt);
          if (running) applyInputToBody(p.body, inp, dt, isBodyOnGround(p.body));
          // CPUs may shoot projectiles at nearby opponents
          if (running) tryCPUShoot(p);
        } else if (p.isMe) {
          const inp = { x: BDR.controls.state.input.x, z: BDR.controls.state.input.z };
          if (running) applyInputToBody(p.body, inp, dt, isBodyOnGround(p.body));
        } else {
          const inp = networkInputs[p.id] || { x: 0, z: 0 };
          if (running) applyInputToBody(p.body, inp, dt, isBodyOnGround(p.body));
        }
      }
      // Update projectiles
      if (BDR.items) BDR.items.update(scene, physWorld, players, projectiles, dt);
    } else {
      // Client: only push our local input to network. Visuals come from snapshots.
      const inp = { x: BDR.controls.state.input.x, z: BDR.controls.state.input.z };
      BDR.network.sendInput(inp);
    }

    // Physics step (host runs full sim; client also runs but will be corrected by snapshots)
    physWorld.step(1/60, dt, 3);

    // Powerup pickups (host authoritative; client also visual)
    for (const p of players) {
      if (p.finished) continue;
      const cx = Math.round(p.body.position.x / cfg.cellSize);
      const cy = Math.round(p.body.position.z / cfg.cellSize);
      for (const pu of powerups) {
        if (pu.taken) continue;
        if (pu.cellX === cx && pu.cellY === cy) {
          const dxp = p.body.position.x - pu.mesh.position.x;
          const dzp = p.body.position.z - pu.mesh.position.z;
          if (dxp*dxp + dzp*dzp < 1.4*1.4) {
            pu.taken = true;
            pu.mesh.visible = false;
            p.boostUntil = performance.now() + 2200;
          }
        }
      }
      if (p.boostUntil && performance.now() < p.boostUntil) {
        // Apply gentle forward boost in current motion direction
        const v = p.body.velocity;
        const sp = Math.hypot(v.x, v.z);
        if (sp > 0.4) {
          p.body.applyForce(new CANNON.Vec3(v.x/sp * 9, 0, v.z/sp * 9), p.body.position);
        }
      }
    }

    // Animate powerup spin
    const t = performance.now() * 0.003;
    for (const pu of powerups) {
      if (!pu.taken) {
        pu.mesh.rotation.z = t;
        pu.mesh.position.y = 0.6 + Math.sin(t * 2) * 0.15;
      }
    }
    // Animate goal flag wave (simple)
    // (skipped for perf)

    // Sync visuals from physics
    for (const p of players) {
      if (!p.body) continue;
      p.mesh.position.copy(p.body.position);
      p.mesh.quaternion.copy(p.body.quaternion);
      // Keep label upright
      p.label.position.set(0, cfg.ballRadius + 0.9, 0);
    }

    // Client snapshot interpolation
    if (!isHost && lastNetSnap) {
      applySnapshot(lastNetSnap);
    }

    // Goal detection
    if (running) {
      const goal = mazeData.goalPos;
      for (const p of players) {
        if (p.finished) continue;
        const dx = p.body.position.x - goal.x;
        const dz = p.body.position.z - goal.z;
        const d2 = dx*dx + dz*dz;
        if (d2 < (cfg.cellSize * 0.32) * (cfg.cellSize * 0.32) && p.body.position.y < cfg.ballRadius + 0.6) {
          // Falls into the hole
          p.finished = true;
          finishedCount++;
          p.place = finishedCount;
          p.finishTime = Date.now() - raceStartedAt;
          // Sink animation
          p.mesh.visible = false;
        }
      }
      if (finishedCount >= players.length || (finishedCount >= 1 && Date.now() - (raceStartedAt + (players[0]?.finishTime||0)) > 30000 && finishedCount >= Math.min(3, players.length))) {
        // End condition: everyone done, or 30s after first finish & at least min players
        if (finishedCount >= players.length) endRace();
      }
    }

    // Camera follow (local player)
    const me = players.find(pp => pp.isMe);
    if (me) {
      // Direction: derived from velocity if moving, else last camera dir
      const v = me.body.velocity;
      const sp = Math.hypot(v.x, v.z);
      let dir;
      if (sp > 0.6) {
        dir = new THREE.Vector3(v.x, 0, v.z).normalize();
        me._lastDir = dir.clone();
      } else if (me._lastDir) {
        dir = me._lastDir;
      } else {
        // Initial: face from start toward goal
        const g = mazeData.goalPos;
        dir = new THREE.Vector3(g.x - me.body.position.x, 0, g.z - me.body.position.z);
        if (dir.lengthSq() > 0.001) dir.normalize();
        else dir = new THREE.Vector3(0, 0, -1);
        me._lastDir = dir.clone();
      }
      // Smooth dir
      if (!me._smoothDir) me._smoothDir = dir.clone();
      me._smoothDir.lerp(dir, 0.06).normalize();

      const target = new THREE.Vector3(me.body.position.x, me.body.position.y, me.body.position.z);
      const camPos = new THREE.Vector3(
        target.x - me._smoothDir.x * cfg.cameraDist,
        target.y + cfg.cameraHeight,
        target.z - me._smoothDir.z * cfg.cameraDist
      );
      camera.position.lerp(camPos, 0.15);
      const lookAt = new THREE.Vector3(
        target.x + me._smoothDir.x * 1.5,
        target.y + 0.4,
        target.z + me._smoothDir.z * 1.5
      );
      camera.lookAt(lookAt);
    }

    // Host broadcast snapshot
    if (isHost && onTick) onTick(makeSnapshot());

    renderer.render(scene, camera);
  }

  function makeSnapshot() {
    return {
      ts: Date.now(),
      raceStartedAt,
      running,
      players: players.map(p => ({
        id: p.id,
        x: p.body.position.x, y: p.body.position.y, z: p.body.position.z,
        vx: p.body.velocity.x, vy: p.body.velocity.y, vz: p.body.velocity.z,
        finished: p.finished,
        place: p.place,
        finishTime: p.finishTime
      })),
      powerups: powerups.map(pu => pu.taken ? 1 : 0)
    };
  }

  function applySnapshot(snap) {
    if (!snap || !snap.players) return;
    for (const sp of snap.players) {
      const p = players.find(pp => pp.id === sp.id);
      if (!p) continue;
      if (p.isMe) {
        // Apply correction lightly to avoid overriding local feel
        const dx = sp.x - p.body.position.x;
        const dz = sp.z - p.body.position.z;
        const dy = sp.y - p.body.position.y;
        const err = Math.hypot(dx, dy, dz);
        if (err > 2.5) {
          p.body.position.set(sp.x, sp.y, sp.z);
          p.body.velocity.set(sp.vx, sp.vy, sp.vz);
        } else {
          p.body.position.x += dx * 0.18;
          p.body.position.y += dy * 0.18;
          p.body.position.z += dz * 0.18;
        }
      } else {
        // Snap remote toward target
        p.body.position.x = BDR.lerp(p.body.position.x, sp.x, 0.4);
        p.body.position.y = BDR.lerp(p.body.position.y, sp.y, 0.4);
        p.body.position.z = BDR.lerp(p.body.position.z, sp.z, 0.4);
        p.body.velocity.set(sp.vx, sp.vy, sp.vz);
      }
      if (sp.finished && !p.finished) {
        p.finished = true;
        p.place = sp.place;
        p.finishTime = sp.finishTime;
        p.mesh.visible = false;
      }
    }
    if (snap.powerups) {
      for (let i = 0; i < powerups.length && i < snap.powerups.length; i++) {
        if (snap.powerups[i] && !powerups[i].taken) {
          powerups[i].taken = true;
          powerups[i].mesh.visible = false;
        }
      }
    }
    if (snap.running && !running) {
      running = true;
      raceStartedAt = snap.raceStartedAt;
    }
  }

  function setNetworkInput(playerId, input) { networkInputs[playerId] = input; }
  function applyNetworkSnapshot(snap) { lastNetSnap = snap; }

  function endRace() {
    running = false;
    // Append finish for not-yet-finished
    for (const p of players) {
      if (!p.finished) {
        p.finished = true;
        finishedCount++;
        p.place = finishedCount;
        p.finishTime = Date.now() - raceStartedAt;
      }
    }
    const ranking = players.slice().sort((a, b) => a.place - b.place);
    if (onResult) onResult(ranking);
  }

  function getRanking() {
    // Sort: finished first by place; rest by distance to goal
    const goal = mazeData ? mazeData.goalPos : new THREE.Vector3();
    const finished = players.filter(p => p.finished).sort((a, b) => a.place - b.place);
    const ongoing = players.filter(p => !p.finished).map(p => ({
      p, d: Math.hypot(p.body.position.x - goal.x, p.body.position.z - goal.z)
    })).sort((a, b) => a.d - b.d).map(x => x.p);
    return [...finished, ...ongoing];
  }

  function getMyRank() {
    const r = getRanking();
    const idx = r.findIndex(p => p.isMe);
    return { rank: idx + 1, total: r.length };
  }

  function getElapsed() {
    if (!raceStartedAt) return 0;
    return Date.now() - raceStartedAt;
  }

  function loop() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    tick(dt);
    requestAnimationFrame(loop);
  }

  function startLoop() {
    lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

  function manualEnd() { endRace(); }

  return {
    cfg, init, setup, startCountdown, startLoop,
    setNetworkInput, applyNetworkSnapshot,
    getRanking, getMyRank, getElapsed, getPlayers: () => players,
    tryLocalDash, getDashCooldownRatio,
    manualEnd
  };
})();

console.log('[BDR] game loaded');
