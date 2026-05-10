/* ============================================================
   game.js - 3D ball-rolling maze game (Three.js + Cannon-es)
   ============================================================
   Major fixes (PDCA iteration):
   - Camera is FIXED orientation (looks toward -Z); never spins.
   - Name labels are placed in the SCENE (not on ball mesh) so they
     don't rotate with ball or clip into walls.
   - Walls fully opaque, depthTest enabled (no see-through).
   - Bigger 17x17 maze with arenas / hazards / pushers / mud.
   - Player-vs-player physical collisions with bonus knockback.
   - Mini-map / radar overlay.
   ============================================================ */
window.BDR = window.BDR || {};

BDR.game = (function() {
  const cfg = {
    cellSize: 6,
    mazeW: 17,
    mazeH: 17,
    ballRadius: 0.55,
    ballMass: 1.0,
    moveForce: 9.0,        // higher = more responsive
    maxSpeed: 10.5,
    airControl: 0.4,
    cameraDist: 5.2,
    cameraHeight: 3.4,    // raised so player can see ahead over walls
    cameraLookAhead: 0.0,  // fixed camera; no look-ahead
    fov: 78,
    pvpKnockback: 6.5
  };

  let renderer, scene, camera;
  let physWorld;
  let mazeMesh, mazeData, maze;
  let players = [];
  let labelGroup = null;     // shared THREE.Group of label sprites in scene
  let myId = '';
  let isHost = true;
  let running = false;
  let startTime = 0;
  let lastFrame = 0;
  let countdownActive = false;
  let raceStartedAt = 0;
  let finishedCount = 0;
  let onResult = null;
  let onTick = null;
  let networkInputs = {};
  let lastNetSnap = null;
  let snapInterp = { from: null, to: null, atFromMs: 0, atToMs: 0 };
  let resetCallback = null;
  let powerups = [];
  let projectiles = [];
  let lastShotAt = {};
  let lastDashAt = {};
  // Mini-map (2D radar) canvas
  let miniCanvas = null, miniCtx = null;

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
    scene.fog = new THREE.Fog(0xcef0ff, 35, 120);

    camera = new THREE.PerspectiveCamera(cfg.fov, window.innerWidth / window.innerHeight, 0.1, 400);
    camera.position.set(0, 8, 12);

    // lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb0d4ff, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1c8, 1.05);
    sun.position.set(40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 250;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc7e6ff, 0.35);
    fill.position.set(-30, 40, -20);
    scene.add(fill);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Init mini-map
    miniCanvas = document.getElementById('mini-canvas');
    if (miniCanvas) {
      miniCanvas.width = 220;
      miniCanvas.height = 220;
      miniCtx = miniCanvas.getContext('2d');
    }
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
    // Ball-ball collisions: less friction, more bounce -> better bumping action
    physWorld.addContactMaterial(new CANNON.ContactMaterial(ballMat, ballMat, {
      friction: 0.02, restitution: 0.92
    }));

    // Ground
    const totalW = cfg.mazeW * cfg.cellSize;
    const totalH = cfg.mazeH * cfg.cellSize;
    const groundShape = new CANNON.Box(new CANNON.Vec3(totalW, 0.2, totalH));
    const groundBody = new CANNON.Body({ mass: 0, material: groundMat });
    groundBody.addShape(groundShape);
    groundBody.position.set(totalW / 2 - cfg.cellSize / 2, -0.2, totalH / 2 - cfg.cellSize / 2);
    physWorld.addBody(groundBody);

    // Walls
    const wallH = mazeData.wallH;
    for (const w of mazeData.wallSpecs) {
      const shape = new CANNON.Box(new CANNON.Vec3(w.sx / 2, wallH / 2, w.sz / 2));
      const body = new CANNON.Body({ mass: 0, material: wallMat });
      body.addShape(shape);
      body.position.set(w.cx, wallH / 2, w.cz);
      physWorld.addBody(body);
    }

    physWorld._mats = { groundMat, ballMat, wallMat };
  }

  function makeNameLabel(name) {
    // High-resolution label drawn in CSS px units; sprite is in scene (not on ball)
    const lc = document.createElement('canvas');
    lc.width = 384; lc.height = 96;
    const lctx = lc.getContext('2d');
    lctx.clearRect(0, 0, lc.width, lc.height);
    lctx.font = 'bold 48px "Hiragino Maru Gothic ProN","Noto Sans JP",sans-serif';
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';
    lctx.lineWidth = 10;
    lctx.strokeStyle = 'rgba(0,0,0,0.65)';
    lctx.strokeText(name, lc.width/2, lc.height/2);
    lctx.fillStyle = '#ffffff';
    lctx.fillText(name, lc.width/2, lc.height/2);
    const tex = new THREE.CanvasTexture(lc);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      depthTest: true,    // important: respect walls
      depthWrite: false,
      transparent: true
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(2.6, 0.65, 1);
    return sp;
  }

  function createBall(player, startCell) {
    const geo = new THREE.SphereGeometry(cfg.ballRadius, 32, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: player.color,
      roughness: 0.32,
      metalness: 0.10,
      emissive: BDR.darken(player.color, 0.5),
      emissiveIntensity: 0.15
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Pattern decals so rotation is visible (multiple stripes)
    // Build a checker/stripe texture for the ball
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx2 = cv.getContext('2d');
    ctx2.fillStyle = player.color;
    ctx2.fillRect(0, 0, 256, 256);
    ctx2.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 256; i += 64) {
      ctx2.fillRect(i, 0, 32, 256);
    }
    // Tiny face on one pole
    ctx2.fillStyle = '#000';
    ctx2.beginPath(); ctx2.arc(96, 96, 9, 0, Math.PI*2); ctx2.fill();
    ctx2.beginPath(); ctx2.arc(160, 96, 9, 0, Math.PI*2); ctx2.fill();
    ctx2.strokeStyle = '#000'; ctx2.lineWidth = 6; ctx2.lineCap = 'round';
    ctx2.beginPath(); ctx2.arc(128, 130, 18, 0, Math.PI); ctx2.stroke();

    const ballTex = new THREE.CanvasTexture(cv);
    ballTex.colorSpace = THREE.SRGBColorSpace;
    mat.map = ballTex;
    mat.needsUpdate = true;

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

    // Label sprite — added DIRECTLY to scene, follows body in tick().
    const label = makeNameLabel(player.name || 'Player');
    scene.add(label);

    return { mesh, body, label };
  }

  function placePlayers(playerList) {
    players = [];
    const startCells = maze.startCells.slice();
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
        respawnTimer: 0,
        lastBumpAt: 0
      });
    }
  }

  function spawnPowerups() {
    powerups.forEach(pu => scene.remove(pu.mesh));
    powerups = [];
    const tried = new Set();
    const N = 12; // more pickups in larger map
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

  // ---------- Public API ----------
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
        if (p.label) scene.remove(p.label);
        if (p.body) physWorld.removeBody(p.body);
      }
    }
    players = [];
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

    // Position camera initially behind local player (fixed orientation looking -Z)
    const me = players.find(pp => pp.isMe);
    if (me) {
      camera.position.set(me.body.position.x, me.body.position.y + cfg.cameraHeight, me.body.position.z + cfg.cameraDist);
    }
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
        if (cdEl.dataset.lastNum !== String(num)) {
          cdEl.dataset.lastNum = String(num);
          if (BDR.sound) BDR.sound.countdown();
        }
        cdEl.innerHTML = `<div class="countdown-num">${num}</div>`;
        requestAnimationFrame(tick);
      } else {
        cdEl.innerHTML = `<div class="countdown-num">GO!</div>`;
        running = true;
        raceStartedAt = now;
        startTime = now;
        countdownActive = false;
        if (BDR.sound) BDR.sound.go();
        setTimeout(() => cdEl.classList.add('hidden'), 700);
      }
    };
    tick();
  }

  // ---------- Per-frame update ----------
  function applyInputToBody(body, input, dt, isOnGround) {
    // World-space input. Camera is fixed (looks -Z) so input.x = +x world,
    // input.z = +z world. Player sees: tilt right -> ball goes right; tilt
    // far edge down -> ball goes "up screen" = -z.
    const force = isOnGround ? cfg.moveForce : cfg.moveForce * cfg.airControl;
    body.applyForce(new CANNON.Vec3(input.x * force, 0, input.z * force), body.position);
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

  function tryCPUShoot(cpu) {
    if (!BDR.items) return;
    const now = performance.now();
    const last = lastShotAt[cpu.id] || 0;
    const cooldown = BDR.items.cfg.projCooldownMs * (1.6 - cpu.bot.skill * 0.6);
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

  function tryLocalDash() {
    const me = players.find(pp => pp.isMe);
    if (!me || me.finished) return false;
    const now = performance.now();
    const last = lastDashAt[me.id] || 0;
    if (now - last < BDR.items.cfg.dashCooldownMs) return false;
    const inp = BDR.controls.state.input;
    let dx = inp.x, dz = inp.z;
    if (dx*dx + dz*dz < 0.04) {
      const v = me.body.velocity;
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0.4) { dx = v.x / sp; dz = v.z / sp; }
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
    me.mesh.scale.setScalar(1.25);
    setTimeout(() => { try { me.mesh.scale.setScalar(1); } catch(e){} }, 180);
    if (BDR.sound) BDR.sound.dash();
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

  // PvP collision boost: when two balls collide hard, add extra knockback so
  // bumping feels strong. This runs on host only (or solo) for fairness.
  function applyPvPKnockback(dt) {
    const r2 = (cfg.ballRadius * 2 + 0.05);
    const r2sq = r2 * r2;
    const now = performance.now();
    for (let i = 0; i < players.length; i++) {
      const a = players[i];
      if (a.finished) continue;
      for (let j = i+1; j < players.length; j++) {
        const b = players[j];
        if (b.finished) continue;
        const dx = a.body.position.x - b.body.position.x;
        const dz = a.body.position.z - b.body.position.z;
        const dy = a.body.position.y - b.body.position.y;
        const d2 = dx*dx + dz*dz + dy*dy;
        if (d2 < r2sq * 1.05) {
          // Compute relative speed along separation axis
          const d = Math.sqrt(d2) || 0.0001;
          const nx = dx/d, ny = dy/d, nz = dz/d;
          const rvx = a.body.velocity.x - b.body.velocity.x;
          const rvy = a.body.velocity.y - b.body.velocity.y;
          const rvz = a.body.velocity.z - b.body.velocity.z;
          const approach = rvx*nx + rvy*ny + rvz*nz;
          // a moving INTO b => approach < 0
          if (approach < -0.5) {
            // Stronger bump for the faster mover
            const aSpd = Math.hypot(a.body.velocity.x, a.body.velocity.z);
            const bSpd = Math.hypot(b.body.velocity.x, b.body.velocity.z);
            const power = cfg.pvpKnockback * (1 + Math.min(0.7, Math.max(aSpd, bSpd)/12));
            // Push them apart along n
            a.body.velocity.x += nx * power * 0.6;
            a.body.velocity.z += nz * power * 0.6;
            a.body.velocity.y += 1.0;
            b.body.velocity.x -= nx * power * 0.6;
            b.body.velocity.z -= nz * power * 0.6;
            b.body.velocity.y += 1.0;
            a.lastBumpAt = now; b.lastBumpAt = now;
            // Visual flash
            if (BDR.items && (now - (a._lastFlash||0)) > 200) {
              BDR.items.spawnHitFlash(scene,
                { x: (a.body.position.x+b.body.position.x)/2, y: a.body.position.y+0.3, z: (a.body.position.z+b.body.position.z)/2 },
                0xffffff);
              a._lastFlash = now; b._lastFlash = now;
              if (BDR.sound && (a.isMe || b.isMe)) BDR.sound.bump();
            }
          }
        }
      }
    }
  }

  // Hazards: spinners, bouncers, mud, pushers
  function applyHazards(dt) {
    const cs = cfg.cellSize;
    if (!mazeData.hazardMeshes) return;
    const t = performance.now() * 0.001;
    for (const hz of mazeData.hazardMeshes) {
      if (hz.type === 'spinner') {
        hz.angle += hz.speed * dt;
        hz.mesh.rotation.y = hz.angle;
        // Sweep collision: bar covers ~cellSize*0.85 long, 0.45 wide
        const cx = hz.x * cs, cz = hz.y * cs;
        const cosA = Math.cos(hz.angle);
        const sinA = Math.sin(hz.angle);
        const halfL = cs * 0.42;
        const halfW = 0.40;
        for (const p of players) {
          if (p.finished) continue;
          // Transform player position into bar local space
          const lx = (p.body.position.x - cx) * cosA + (p.body.position.z - cz) * sinA;
          const lz = -(p.body.position.x - cx) * sinA + (p.body.position.z - cz) * cosA;
          if (Math.abs(lx) < halfL + cfg.ballRadius && Math.abs(lz) < halfW + cfg.ballRadius && p.body.position.y < 1.6) {
            // Knockback perpendicular to bar (along local z)
            const dirSign = lz > 0 ? 1 : -1;
            const wx = -sinA * dirSign;
            const wz = cosA * dirSign;
            p.body.velocity.x += wx * 11;
            p.body.velocity.z += wz * 11;
            p.body.velocity.y += 2.0;
          }
        }
      } else if (hz.type === 'bounce') {
        const cx = hz.x * cs, cz = hz.y * cs;
        // Visual pulse
        hz.mesh.scale.y = 1 + Math.sin(t * 5) * 0.12;
        for (const p of players) {
          if (p.finished) continue;
          const dx = p.body.position.x - cx;
          const dz = p.body.position.z - cz;
          if (dx*dx + dz*dz < (cs*0.42)*(cs*0.42) && p.body.position.y < 1.0) {
            if (performance.now() - (p._lastBouncedAt||0) > 400) {
              p.body.velocity.y = Math.max(p.body.velocity.y, 11);
              p._lastBouncedAt = performance.now();
              if (p.isMe && BDR.sound) BDR.sound.bounce();
            }
          }
        }
      } else if (hz.type === 'mud') {
        const cx = hz.x * cs, cz = hz.y * cs;
        for (const p of players) {
          if (p.finished) continue;
          const dx = p.body.position.x - cx;
          const dz = p.body.position.z - cz;
          if (dx*dx + dz*dz < (cs*0.42)*(cs*0.42) && p.body.position.y < 1.0) {
            // Heavy damping for one frame
            p.body.velocity.x *= 0.88;
            p.body.velocity.z *= 0.88;
          }
        }
      } else if (hz.type === 'pusher') {
        const cx = hz.x * cs, cz = hz.y * cs;
        const dirVecs = [{x:0,z:-1},{x:1,z:0},{x:0,z:1},{x:-1,z:0}];
        const dv = dirVecs[hz.dir];
        for (const p of players) {
          if (p.finished) continue;
          const dx = p.body.position.x - cx;
          const dz = p.body.position.z - cz;
          if (dx*dx + dz*dz < (cs*0.42)*(cs*0.42) && p.body.position.y < 1.0) {
            p.body.velocity.x += dv.x * 0.9;
            p.body.velocity.z += dv.z * 0.9;
          }
        }
      }
    }
    // Goal flag wave
    if (mazeData.flag) {
      mazeData.flag.position.y = 4.4 + Math.sin(t * 2.5) * 0.06;
      mazeData.flag.rotation.y = Math.sin(t * 1.6) * 0.18;
    }
    if (mazeData.pillar) {
      mazeData.pillar.material.opacity = 0.25 + (Math.sin(t * 2.2) * 0.5 + 0.5) * 0.2;
    }
    if (mazeData.ring) {
      mazeData.ring.material.opacity = 0.6 + (Math.sin(t * 3.2) * 0.5 + 0.5) * 0.3;
    }
  }

  function tick(dt) {
    // Inputs per player
    if (isHost) {
      for (const p of players) {
        if (p.finished) continue;
        if (p.isCPU) {
          const inp = BDR.ai.tick(p.bot, maze, cfg.cellSize, p.body, maze.goalCell, dt, players, p.id);
          if (running) applyInputToBody(p.body, inp, dt, isBodyOnGround(p.body));
          if (running) tryCPUShoot(p);
          // CPU dash when ramming and within close range to target
          if (running && inp.ramming && BDR.items) {
            const last = lastDashAt[p.id] || 0;
            if (performance.now() - last > BDR.items.cfg.dashCooldownMs * 1.2) {
              const target = players.find(pp => pp.id === p.bot.ramTargetId);
              if (target && !target.finished) {
                const ddx = target.body.position.x - p.body.position.x;
                const ddz = target.body.position.z - p.body.position.z;
                const dd = Math.hypot(ddx, ddz);
                if (dd < cfg.cellSize * 1.6) {
                  // Dash toward target
                  const nrm = dd || 1;
                  const dx = ddx / nrm, dz = ddz / nrm;
                  p.body.velocity.x += dx * BDR.items.cfg.dashImpulse * 0.85;
                  p.body.velocity.z += dz * BDR.items.cfg.dashImpulse * 0.85;
                  p.body.velocity.y += 1.0;
                  lastDashAt[p.id] = performance.now();
                  p.mesh.scale.setScalar(1.2);
                  setTimeout(() => { try { p.mesh.scale.setScalar(1); } catch(e){} }, 180);
                }
              }
            }
          }
        } else if (p.isMe) {
          const inp = { x: BDR.controls.state.input.x, z: BDR.controls.state.input.z };
          if (running) applyInputToBody(p.body, inp, dt, isBodyOnGround(p.body));
        } else {
          const inp = networkInputs[p.id] || { x: 0, z: 0 };
          if (running) applyInputToBody(p.body, inp, dt, isBodyOnGround(p.body));
        }
      }
      if (BDR.items) BDR.items.update(scene, physWorld, players, projectiles, dt);
    } else {
      const inp = { x: BDR.controls.state.input.x, z: BDR.controls.state.input.z };
      BDR.network.sendInput(inp);
    }

    // Apply hazards (host = authoritative; client also applies for visual flow)
    applyHazards(dt);

    // PvP knockback (host authoritative)
    if (isHost) applyPvPKnockback(dt);

    // Physics step
    physWorld.step(1/60, dt, 3);

    // Powerup pickups
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
            p.boostUntil = performance.now() + 2400;
            if (p.isMe && BDR.sound) BDR.sound.pickup();
          }
        }
      }
      if (p.boostUntil && performance.now() < p.boostUntil) {
        const v = p.body.velocity;
        const sp = Math.hypot(v.x, v.z);
        if (sp > 0.4) {
          p.body.applyForce(new CANNON.Vec3(v.x/sp * 11, 0, v.z/sp * 11), p.body.position);
        }
      }
    }

    // Animate powerup spin
    const tt = performance.now() * 0.003;
    for (const pu of powerups) {
      if (!pu.taken) {
        pu.mesh.rotation.z = tt;
        pu.mesh.position.y = 0.6 + Math.sin(tt * 2) * 0.15;
      }
    }

    // Sync visuals from physics + label position (label lives in scene)
    for (const p of players) {
      if (!p.body) continue;
      p.mesh.position.copy(p.body.position);
      p.mesh.quaternion.copy(p.body.quaternion);
      // Label tracks ball but doesn't inherit rotation
      if (p.label) {
        p.label.position.set(p.body.position.x, p.body.position.y + cfg.ballRadius + 0.95, p.body.position.z);
        // Hide label if finished
        p.label.visible = !p.finished;
      }
    }

    if (!isHost && lastNetSnap) applySnapshot(lastNetSnap);

    // Goal detection
    if (running) {
      const goal = mazeData.goalPos;
      for (const p of players) {
        if (p.finished) continue;
        const dx = p.body.position.x - goal.x;
        const dz = p.body.position.z - goal.z;
        const d2 = dx*dx + dz*dz;
        if (d2 < (cfg.cellSize * 0.32) * (cfg.cellSize * 0.32) && p.body.position.y < cfg.ballRadius + 0.6) {
          p.finished = true;
          finishedCount++;
          p.place = finishedCount;
          p.finishTime = Date.now() - raceStartedAt;
          p.mesh.visible = false;
          if (p.label) p.label.visible = false;
          if (p.isMe && BDR.sound) BDR.sound.goal();
        }
      }
      if (finishedCount >= players.length) endRace();
    }

    // ---- Camera: FIXED orientation, follows local player ----
    // Camera is positioned BEHIND the player along +Z, looking -Z. No yaw/spin.
    const me = players.find(pp => pp.isMe);
    if (me) {
      const target = new THREE.Vector3(me.body.position.x, me.body.position.y, me.body.position.z);
      // If player is falling (y<0), pull camera down with them so they stay in view.
      const fallOffset = Math.min(0, me.body.position.y) * 0.6;
      const desired = new THREE.Vector3(
        target.x,
        Math.max(target.y + cfg.cameraHeight + fallOffset, -2),
        target.z + cfg.cameraDist
      );
      camera.position.lerp(desired, 0.18);
      camera.lookAt(new THREE.Vector3(target.x, target.y + 0.4, target.z));

      // Look-ahead "see-through" effect: walls very close in front of camera
      // (between camera and player) get pushed downward visually so player sees
      // ahead without losing the ball. We do this lightly by raycasting.
      // Performance: only the few walls overlapping the camera-player segment.
      // Simpler approach: dim walls within near-camera frustum band by adjusting
      // their material dynamically — skipped for now to avoid GC churn.
    }

    // Mini-map render
    drawMiniMap();

    // Host broadcast snapshot
    if (isHost && onTick) onTick(makeSnapshot());

    renderer.render(scene, camera);
  }

  function drawMiniMap() {
    if (!miniCtx || !maze) return;
    const W = miniCanvas.width, H = miniCanvas.height;
    miniCtx.clearRect(0, 0, W, H);
    // Background
    miniCtx.fillStyle = 'rgba(255,255,255,0.0)';
    miniCtx.fillRect(0, 0, W, H);
    const totalW = maze.width * cfg.cellSize;
    const totalH = maze.height * cfg.cellSize;
    const pad = 6;
    const sx = (W - pad*2) / totalW;
    const sz = (H - pad*2) / totalH;
    const offX = pad - cfg.cellSize/2 * sx;
    const offZ = pad - cfg.cellSize/2 * sz;

    // Walls (dim lines)
    miniCtx.strokeStyle = 'rgba(40,60,90,0.55)';
    miniCtx.lineWidth = 1.2;
    const cs = cfg.cellSize;
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        const c = maze.cells[y][x];
        const x0 = (x*cs - cs/2) * sx + offX;
        const y0 = (y*cs - cs/2) * sz + offZ;
        const x1 = (x*cs + cs/2) * sx + offX;
        const y1 = (y*cs + cs/2) * sz + offZ;
        if (c.walls.N) { miniCtx.beginPath(); miniCtx.moveTo(x0,y0); miniCtx.lineTo(x1,y0); miniCtx.stroke(); }
        if (c.walls.W) { miniCtx.beginPath(); miniCtx.moveTo(x0,y0); miniCtx.lineTo(x0,y1); miniCtx.stroke(); }
        if (y === maze.height-1 && c.walls.S) { miniCtx.beginPath(); miniCtx.moveTo(x0,y1); miniCtx.lineTo(x1,y1); miniCtx.stroke(); }
        if (x === maze.width-1 && c.walls.E) { miniCtx.beginPath(); miniCtx.moveTo(x1,y0); miniCtx.lineTo(x1,y1); miniCtx.stroke(); }
      }
    }
    // Goal
    const gx = maze.goalCell.x*cs * sx + offX;
    const gy = maze.goalCell.y*cs * sz + offZ;
    miniCtx.fillStyle = '#ffd166';
    miniCtx.beginPath();
    miniCtx.arc(gx, gy, 5.5, 0, Math.PI*2);
    miniCtx.fill();
    miniCtx.strokeStyle = '#fff'; miniCtx.lineWidth = 2;
    miniCtx.stroke();

    // Players
    for (const p of players) {
      if (!p.body) continue;
      const px = p.body.position.x * sx + offX;
      const py = p.body.position.z * sz + offZ;
      miniCtx.fillStyle = p.color;
      miniCtx.beginPath();
      miniCtx.arc(px, py, p.isMe ? 5.5 : 4.2, 0, Math.PI*2);
      miniCtx.fill();
      if (p.isMe) {
        miniCtx.strokeStyle = '#fff'; miniCtx.lineWidth = 2;
        miniCtx.stroke();
      } else {
        miniCtx.strokeStyle = 'rgba(0,0,0,0.4)'; miniCtx.lineWidth = 1;
        miniCtx.stroke();
      }
      if (p.finished) {
        miniCtx.fillStyle = 'rgba(255,255,255,0.7)';
        miniCtx.fillText('✓', px+4, py-4);
      }
    }
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
        if (p.label) p.label.visible = false;
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

  function getMySpeed() {
    const me = players.find(pp => pp.isMe);
    if (!me) return { speed: 0, ratio: 0 };
    const v = me.body.velocity;
    const sp = Math.hypot(v.x, v.z);
    return { speed: sp, ratio: Math.min(1, sp / cfg.maxSpeed) };
  }

  function getRaceStats() {
    const total = players.length;
    const finished = players.filter(p => p.finished).length;
    return { total, finished, remaining: total - finished };
  }

  // Returns { angle: radians (0=up screen, +x=right), distance: meters }
  function getGoalInfo() {
    const me = players.find(pp => pp.isMe);
    if (!me || !mazeData) return { angle: 0, distance: 0, finished: true };
    if (me.finished) return { angle: 0, distance: 0, finished: true };
    const g = mazeData.goalPos;
    // Camera looks toward -z, so "up screen" = -z. Right of screen = +x.
    const dx = g.x - me.body.position.x;
    const dz = g.z - me.body.position.z;
    // Screen-relative: x = dx, y(up) = -dz. atan2 of (x, y) gives angle CW from up.
    const angle = Math.atan2(dx, -dz);
    const distance = Math.hypot(dx, dz);
    return { angle, distance, finished: false };
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
    tryLocalDash, getDashCooldownRatio, getGoalInfo,
    getMySpeed, getRaceStats,
    manualEnd
  };
})();

console.log('[BDR] game loaded');
