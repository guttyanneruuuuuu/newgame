/* ============================================================
   maze.js - procedural 3D maze generator (LARGE + obstacles + hazards)
   Returns: { cells, walls, size, startCells[], goalCell, cellSize }
   ============================================================ */
window.BDR = window.BDR || {};

BDR.generateMaze = function(seed = Date.now(), width = 17, height = 17) {
  // RNG seeded for reproducibility
  let s = seed >>> 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };

  // Each cell has walls on N, E, S, W
  const cells = [];
  for (let y = 0; y < height; y++) {
    cells[y] = [];
    for (let x = 0; x < width; x++) {
      cells[y][x] = { x, y, visited: false, walls: { N: true, E: true, S: true, W: true } };
    }
  }

  // Recursive backtracker
  const stack = [];
  const start = { x: 0, y: 0 };
  cells[start.y][start.x].visited = true;
  stack.push(start);

  const dirs = [
    { name: 'N', dx: 0, dy: -1, opp: 'S' },
    { name: 'E', dx: 1, dy: 0,  opp: 'W' },
    { name: 'S', dx: 0, dy: 1,  opp: 'N' },
    { name: 'W', dx: -1, dy: 0, opp: 'E' }
  ];

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const neighbors = [];
    for (const d of dirs) {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && !cells[ny][nx].visited) {
        neighbors.push({ ...d, nx, ny });
      }
    }
    if (neighbors.length) {
      const n = neighbors[Math.floor(rng() * neighbors.length)];
      cells[cur.y][cur.x].walls[n.name] = false;
      cells[n.ny][n.nx].walls[n.opp] = false;
      cells[n.ny][n.nx].visited = true;
      stack.push({ x: n.nx, y: n.ny });
    } else {
      stack.pop();
    }
  }

  // Add lots of loops for more interesting paths (knock down ~25% of inner walls)
  const extraLoops = Math.floor(width * height * 0.28);
  for (let i = 0; i < extraLoops; i++) {
    const x = 1 + Math.floor(rng() * (width - 2));
    const y = 1 + Math.floor(rng() * (height - 2));
    const d = dirs[Math.floor(rng() * 4)];
    const nx = x + d.dx, ny = y + d.dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
      cells[y][x].walls[d.name] = false;
      cells[ny][nx].walls[d.opp] = false;
    }
  }

  // Carve a few wide-open arenas (3x3) for big PvP brawls
  const arenas = [];
  for (let i = 0; i < 3; i++) {
    const ax = 2 + Math.floor(rng() * (width - 5));
    const ay = 2 + Math.floor(rng() * (height - 5));
    arenas.push({ x: ax, y: ay });
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const cx = ax + dx, cy = ay + dy;
        if (cx >= width || cy >= height) continue;
        if (dx < 2) { cells[cy][cx].walls.E = false; if (cx+1<width) cells[cy][cx+1].walls.W = false; }
        if (dy < 2) { cells[cy][cx].walls.S = false; if (cy+1<height) cells[cy+1][cx].walls.N = false; }
      }
    }
  }

  // Goal is roughly center
  const goalCell = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  // Make sure goal cell has at least 2 openings
  cells[goalCell.y][goalCell.x].walls.N = false;
  cells[goalCell.y][goalCell.x].walls.S = false;
  cells[goalCell.y][goalCell.x].walls.E = false;
  cells[goalCell.y][goalCell.x].walls.W = false;
  if (goalCell.y > 0) cells[goalCell.y-1][goalCell.x].walls.S = false;
  if (goalCell.y < height-1) cells[goalCell.y+1][goalCell.x].walls.N = false;
  if (goalCell.x > 0) cells[goalCell.y][goalCell.x-1].walls.E = false;
  if (goalCell.x < width-1) cells[goalCell.y][goalCell.x+1].walls.W = false;

  // Start positions: distribute as far from goal as possible (corners + edges)
  const startCells = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 },
    { x: Math.floor(width / 2), y: 0 },
    { x: Math.floor(width / 2), y: height - 1 }
  ];

  // Hazards/obstacles: rotating bumpers, bouncy pads, sliding walls
  const hazards = [];
  const used = new Set();
  function key(x,y){ return x+','+y; }
  used.add(key(goalCell.x, goalCell.y));
  for (const sc of startCells) used.add(key(sc.x, sc.y));

  // Rotating bumpers (spinning walls)
  for (let i = 0; i < 6; i++) {
    let tries = 0, x, y;
    do {
      x = 2 + Math.floor(rng() * (width - 4));
      y = 2 + Math.floor(rng() * (height - 4));
      tries++;
    } while (used.has(key(x,y)) && tries < 30);
    used.add(key(x,y));
    hazards.push({ type: 'spinner', x, y, speed: 1.2 + rng() * 1.5 });
  }
  // Bounce pads
  for (let i = 0; i < 8; i++) {
    let tries = 0, x, y;
    do {
      x = 1 + Math.floor(rng() * (width - 2));
      y = 1 + Math.floor(rng() * (height - 2));
      tries++;
    } while (used.has(key(x,y)) && tries < 30);
    used.add(key(x,y));
    hazards.push({ type: 'bounce', x, y });
  }
  // Sticky/slow tiles (mud)
  for (let i = 0; i < 5; i++) {
    let tries = 0, x, y;
    do {
      x = 1 + Math.floor(rng() * (width - 2));
      y = 1 + Math.floor(rng() * (height - 2));
      tries++;
    } while (used.has(key(x,y)) && tries < 30);
    used.add(key(x,y));
    hazards.push({ type: 'mud', x, y });
  }
  // Pusher (one-way conveyor)
  for (let i = 0; i < 5; i++) {
    let tries = 0, x, y;
    do {
      x = 1 + Math.floor(rng() * (width - 2));
      y = 1 + Math.floor(rng() * (height - 2));
      tries++;
    } while (used.has(key(x,y)) && tries < 30);
    used.add(key(x,y));
    const dir = Math.floor(rng() * 4); // 0=N,1=E,2=S,3=W
    hazards.push({ type: 'pusher', x, y, dir });
  }

  return { cells, width, height, startCells, goalCell, hazards, arenas };
};

BDR.buildMazeMeshes = function(maze, opts = {}) {
  const cellSize = opts.cellSize || 6;
  const wallH = opts.wallH || 3.6;
  const wallT = opts.wallT || 0.6;
  const W = maze.width, H = maze.height;
  const totalW = W * cellSize, totalH = H * cellSize;

  const group = new THREE.Group();

  // ---- Floor (checkered for visual reference) ----
  // Build a single plane with a procedural checker texture.
  const checkerSize = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = checkerSize;
  const ctx = cv.getContext('2d');
  // Soft cream base
  ctx.fillStyle = '#fbeec1';
  ctx.fillRect(0, 0, checkerSize, checkerSize);
  // Light squares
  ctx.fillStyle = '#ffe9a8';
  const grid = 8;
  const ts = checkerSize / grid;
  for (let yy = 0; yy < grid; yy++) {
    for (let xx = 0; xx < grid; xx++) {
      if ((xx + yy) % 2 === 0) {
        ctx.fillRect(xx * ts, yy * ts, ts, ts);
      }
    }
  }
  // Subtle border lines
  ctx.strokeStyle = 'rgba(60,80,120,0.10)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= grid; i++) {
    ctx.beginPath(); ctx.moveTo(i*ts, 0); ctx.lineTo(i*ts, checkerSize); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i*ts); ctx.lineTo(checkerSize, i*ts); ctx.stroke();
  }
  const floorTex = new THREE.CanvasTexture(cv);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(W * 0.5, H * 0.5);
  floorTex.colorSpace = THREE.SRGBColorSpace;

  const floorGeo = new THREE.PlaneGeometry(totalW + 4, totalH + 4, 1, 1);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.95,
    metalness: 0.0
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(totalW / 2 - cellSize / 2, 0, totalH / 2 - cellSize / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // ---- Walls (collected for physics) ----
  const wallSpecs = []; // {cx,cz,sx,sz}

  // Outer perimeter
  wallSpecs.push({ cx: totalW / 2 - cellSize / 2, cz: -cellSize / 2, sx: totalW + wallT, sz: wallT });
  wallSpecs.push({ cx: totalW / 2 - cellSize / 2, cz: totalH - cellSize / 2, sx: totalW + wallT, sz: wallT });
  wallSpecs.push({ cx: -cellSize / 2, cz: totalH / 2 - cellSize / 2, sx: wallT, sz: totalH + wallT });
  wallSpecs.push({ cx: totalW - cellSize / 2, cz: totalH / 2 - cellSize / 2, sx: wallT, sz: totalH + wallT });

  // Internal walls
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = maze.cells[y][x];
      const cx = x * cellSize;
      const cz = y * cellSize;
      // We only emit N and W walls to avoid duplicates (E/S handled by neighbor)
      if (cell.walls.N && y > 0) {
        wallSpecs.push({ cx: cx, cz: cz - cellSize / 2, sx: cellSize + wallT, sz: wallT });
      }
      if (cell.walls.W && x > 0) {
        wallSpecs.push({ cx: cx - cellSize / 2, cz: cz, sx: wallT, sz: cellSize + wallT });
      }
    }
  }

  // Render walls (opaque, full depth-tested boxes — no transparency!)
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x9ad6ff,
    roughness: 0.55,
    metalness: 0.0,
    transparent: false,
    depthWrite: true,
    depthTest: true
  });
  const wallTopMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    transparent: false,
    depthWrite: true,
    depthTest: true
  });
  for (const w of wallSpecs) {
    const m = new THREE.Mesh(wallGeo, wallMat);
    m.scale.set(w.sx, wallH, w.sz);
    m.position.set(w.cx, wallH / 2, w.cz);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);

    // Top trim (slightly outside; opaque)
    const top = new THREE.Mesh(wallGeo, wallTopMat);
    top.scale.set(w.sx + 0.05, 0.18, w.sz + 0.05);
    top.position.set(w.cx, wallH + 0.09, w.cz);
    group.add(top);
  }

  // ---- Goal ----
  const goalCx = maze.goalCell.x * cellSize;
  const goalCz = maze.goalCell.y * cellSize;
  // Hole = dark cylinder lower than floor
  const holeGeo = new THREE.CylinderGeometry(cellSize * 0.36, cellSize * 0.36, 0.05, 32);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x111122 });
  const hole = new THREE.Mesh(holeGeo, holeMat);
  hole.position.set(goalCx, 0.02, goalCz);
  group.add(hole);
  // Glow ring
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(cellSize * 0.42, cellSize * 0.5, 48),
    ringMat
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(goalCx, 0.04, goalCz);
  group.add(ring);
  // Pulsing pillar of light at goal (visible above walls)
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(cellSize*0.18, cellSize*0.30, 14, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  );
  pillar.position.set(goalCx, 7, goalCz);
  group.add(pillar);
  // Pole/flag (visible from far)
  const poleGeo = new THREE.CylinderGeometry(0.10, 0.10, 5, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(goalCx, 2.5, goalCz);
  group.add(pole);
  const flagGeo = new THREE.PlaneGeometry(1.6, 1.0);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xff6b6b, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(goalCx + 0.8, 4.4, goalCz);
  group.add(flag);

  // ---- Hazards ----
  const hazardMeshes = []; // { type, mesh, body, x, y, ...}

  for (const hz of (maze.hazards || [])) {
    const cx = hz.x * cellSize, cz = hz.y * cellSize;
    if (hz.type === 'spinner') {
      // Rotating bar that bumps players
      const bar = new THREE.Group();
      const armGeo = new THREE.BoxGeometry(cellSize * 0.85, 0.8, 0.45);
      const armMat = new THREE.MeshStandardMaterial({ color: 0xff7a59, roughness: 0.4 });
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.castShadow = true;
      arm.position.y = 0.7;
      bar.add(arm);
      // Center hub
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 1.6, 16),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
      );
      hub.position.y = 0.8;
      bar.add(hub);
      bar.position.set(cx, 0, cz);
      group.add(bar);
      hazardMeshes.push({ type: 'spinner', mesh: bar, x: hz.x, y: hz.y, speed: hz.speed, angle: 0 });
    } else if (hz.type === 'bounce') {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(cellSize * 0.42, cellSize * 0.42, 0.25, 24),
        new THREE.MeshStandardMaterial({ color: 0x51cf66, emissive: 0x2c8a3f, emissiveIntensity: 0.35, roughness: 0.4 })
      );
      pad.position.set(cx, 0.13, cz);
      pad.receiveShadow = true;
      group.add(pad);
      // Center ring
      const r2 = new THREE.Mesh(
        new THREE.RingGeometry(cellSize*0.20, cellSize*0.30, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false })
      );
      r2.rotation.x = -Math.PI/2;
      r2.position.set(cx, 0.27, cz);
      group.add(r2);
      hazardMeshes.push({ type: 'bounce', mesh: pad, x: hz.x, y: hz.y, lastFireAt: 0 });
    } else if (hz.type === 'mud') {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(cellSize * 0.42, cellSize * 0.42, 0.08, 24),
        new THREE.MeshStandardMaterial({ color: 0xb08968, roughness: 0.95 })
      );
      pad.position.set(cx, 0.05, cz);
      group.add(pad);
      // bubbles
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(
          new THREE.SphereGeometry(0.2, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0x6f5236, roughness: 0.9 })
        );
        b.position.set(cx + (Math.random()-0.5) * 1.6, 0.2, cz + (Math.random()-0.5) * 1.6);
        group.add(b);
      }
      hazardMeshes.push({ type: 'mud', mesh: pad, x: hz.x, y: hz.y });
    } else if (hz.type === 'pusher') {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(cellSize * 0.42, cellSize * 0.42, 0.08, 24),
        new THREE.MeshStandardMaterial({ color: 0x4dabf7, emissive: 0x2674b3, emissiveIntensity: 0.3, roughness: 0.5 })
      );
      pad.position.set(cx, 0.05, cz);
      group.add(pad);
      // Arrow
      const arrowGeo = new THREE.ConeGeometry(0.55, 1.2, 4);
      const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshStandardMaterial({ color: 0xffffff }));
      arrow.position.set(cx, 0.6, cz);
      // dir: 0=N(-z),1=E(+x),2=S(+z),3=W(-x)
      const rot = [Math.PI, Math.PI/2, 0, -Math.PI/2][hz.dir];
      arrow.rotation.x = -Math.PI/2;
      arrow.rotation.y = rot;
      group.add(arrow);
      hazardMeshes.push({ type: 'pusher', mesh: pad, x: hz.x, y: hz.y, dir: hz.dir });
    }
  }

  // Decorative clouds (simple white spheres in distance)
  for (let i = 0; i < 12; i++) {
    const cloudGroup = new THREE.Group();
    const baseAng = Math.random() * Math.PI * 2;
    const baseDist = 80 + Math.random() * 40;
    const cx = totalW/2 - cellSize/2 + Math.cos(baseAng) * baseDist;
    const cz = totalH/2 - cellSize/2 + Math.sin(baseAng) * baseDist;
    const cy = 22 + Math.random() * 10;
    for (let k = 0; k < 4; k++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(2.5 + Math.random() * 1.5, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
      );
      puff.position.set(
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 5
      );
      cloudGroup.add(puff);
    }
    cloudGroup.position.set(cx, cy, cz);
    group.add(cloudGroup);
  }

  // Decorative grass tufts on outer area
  for (let i = 0; i < 80; i++) {
    const tx = (Math.random() - 0.5) * (totalW + 60);
    const tz = (Math.random() - 0.5) * (totalH + 60);
    if (Math.abs(tx - totalW / 2) < totalW / 2 + 4 && Math.abs(tz - totalH / 2) < totalH / 2 + 4) continue;
    const tg = new THREE.Mesh(
      new THREE.ConeGeometry(0.2 + Math.random() * 0.2, 0.6, 5),
      new THREE.MeshStandardMaterial({ color: 0x8de07a })
    );
    tg.position.set(tx, 0.3, tz);
    group.add(tg);
  }
  // A few decorative trees in the far distance
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 30;
    const tx = totalW/2 - cellSize/2 + Math.cos(angle) * dist;
    const tz = totalH/2 - cellSize/2 + Math.sin(angle) * dist;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.5, 2, 6),
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
    );
    trunk.position.set(tx, 1, tz);
    group.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(1.6 + Math.random()*0.5, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x8de07a })
    );
    leaves.position.set(tx, 2.8, tz);
    group.add(leaves);
  }

  return {
    group,
    wallSpecs,
    cellSize,
    wallH,
    goalPos: new THREE.Vector3(goalCx, 0, goalCz),
    floorMesh: floor,
    hazardMeshes,
    flag,
    pillar,
    ring
  };
};

console.log('[BDR] maze loaded');
