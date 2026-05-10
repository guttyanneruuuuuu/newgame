/* ============================================================
   maze.js - procedural 3D maze generator
   Returns: { cells, walls, size, startCells[], goalCell, cellSize }
   ============================================================ */
window.BDR = window.BDR || {};

BDR.generateMaze = function(seed = Date.now(), width = 13, height = 13) {
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

  // Add some loops for more interesting paths (knock down ~15% of inner walls)
  const extraLoops = Math.floor(width * height * 0.18);
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

  // Goal is roughly center
  const goalCell = { x: Math.floor(width / 2), y: Math.floor(height / 2) };

  // Start positions: distribute along the outer edge as far from goal as possible
  const startCells = [];
  const corners = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 },
    { x: Math.floor(width / 2), y: 0 },
    { x: Math.floor(width / 2), y: height - 1 }
  ];
  for (const c of corners) startCells.push(c);

  return { cells, width, height, startCells, goalCell };
};

BDR.buildMazeMeshes = function(maze, opts = {}) {
  const cellSize = opts.cellSize || 6;
  const wallH = opts.wallH || 3.2;
  const wallT = opts.wallT || 0.5;
  const W = maze.width, H = maze.height;
  const totalW = W * cellSize, totalH = H * cellSize;

  const group = new THREE.Group();

  // ---- Floor ----
  const floorGeo = new THREE.PlaneGeometry(totalW + 4, totalH + 4, 1, 1);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xfbeec1,
    roughness: 0.95,
    metalness: 0.0
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(totalW / 2 - cellSize / 2, 0, totalH / 2 - cellSize / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // Add a slightly darker ring for visual contrast
  const ringGeo = new THREE.RingGeometry(0.5, 1, 32);

  // ---- Walls (collected for physics) ----
  const wallSpecs = []; // {x,z,sx,sz, isOuter}

  // Outer perimeter
  // North outer
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

  // Render walls as instanced-like batched meshes for perf
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x9ad6ff,
    roughness: 0.55,
    metalness: 0.0
  });
  const wallTopMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4
  });
  const meshes = [];
  for (const w of wallSpecs) {
    const m = new THREE.Mesh(wallGeo, wallMat);
    m.scale.set(w.sx, wallH, w.sz);
    m.position.set(w.cx, wallH / 2, w.cz);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    meshes.push(m);

    // Top trim
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
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(cellSize * 0.42, cellSize * 0.5, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(goalCx, 0.04, goalCz);
  group.add(ring);
  // Pole/flag (visible from far)
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 4, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(goalCx, 2, goalCz);
  group.add(pole);
  const flagGeo = new THREE.PlaneGeometry(1.4, 0.9);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xff6b6b, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(goalCx + 0.7, 3.4, goalCz);
  group.add(flag);

  // Decorative grass tufts on outer area
  for (let i = 0; i < 50; i++) {
    const tx = (Math.random() - 0.5) * (totalW + 30);
    const tz = (Math.random() - 0.5) * (totalH + 30);
    if (Math.abs(tx - totalW / 2) < totalW / 2 + 2 && Math.abs(tz - totalH / 2) < totalH / 2 + 2) continue;
    const tg = new THREE.Mesh(
      new THREE.ConeGeometry(0.2 + Math.random() * 0.2, 0.6, 5),
      new THREE.MeshStandardMaterial({ color: 0x8de07a })
    );
    tg.position.set(tx, 0.3, tz);
    group.add(tg);
  }

  return {
    group,
    wallSpecs,
    cellSize,
    wallH,
    goalPos: new THREE.Vector3(goalCx, 0, goalCz),
    floorMesh: floor
  };
};

console.log('[BDR] maze loaded');
