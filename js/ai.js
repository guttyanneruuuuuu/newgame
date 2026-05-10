/* ============================================================
   ai.js - CPU pathfinding + aggressive PvP behavior
   - BFS shortest path to the goal (cached per cell)
   - Aggression: when an opponent is in line-of-sight nearby,
     bots may briefly divert to ram them
   ============================================================ */
window.BDR = window.BDR || {};

BDR.ai = (function() {

  function bfs(maze, sx, sy, gx, gy) {
    const W = maze.width, H = maze.height;
    const visited = Array.from({ length: H }, () => new Array(W).fill(false));
    const prev = Array.from({ length: H }, () => new Array(W).fill(null));
    const q = [{ x: sx, y: sy }];
    visited[sy][sx] = true;
    while (q.length) {
      const c = q.shift();
      if (c.x === gx && c.y === gy) break;
      const cell = maze.cells[c.y][c.x];
      const trials = [
        { dx: 0, dy: -1, name: 'N' },
        { dx: 1, dy: 0,  name: 'E' },
        { dx: 0, dy: 1,  name: 'S' },
        { dx: -1, dy: 0, name: 'W' }
      ];
      for (const t of trials) {
        if (cell.walls[t.name]) continue;
        const nx = c.x + t.dx, ny = c.y + t.dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (visited[ny][nx]) continue;
        visited[ny][nx] = true;
        prev[ny][nx] = { x: c.x, y: c.y };
        q.push({ x: nx, y: ny });
      }
    }
    if (!visited[gy][gx]) return null;
    const path = [];
    let cur = { x: gx, y: gy };
    while (cur && !(cur.x === sx && cur.y === sy)) {
      path.push(cur);
      cur = prev[cur.y][cur.x];
    }
    path.reverse();
    return path;
  }

  function makeBot(player, skill = 0.7) {
    return {
      player,
      skill,                // 0..1
      aggression: 0.3 + Math.random() * 0.6, // 0..1 willingness to ram
      pathCache: null,
      lastCellKey: '',
      jitter: Math.random() * 5,
      stuckTimer: 0,
      lastPos: null,
      ramUntil: 0,
      ramTargetId: null,
      lastDashAt: 0
    };
  }

  function posToCell(pos, cellSize) {
    return {
      cx: Math.round(pos.x / cellSize),
      cy: Math.round(pos.z / cellSize)
    };
  }

  // Check if there is a clear line of sight (no walls between cells in same row/col)
  function clearLine(maze, ax, ay, bx, by) {
    if (ax === bx) {
      const x = ax;
      const lo = Math.min(ay, by), hi = Math.max(ay, by);
      for (let y = lo; y < hi; y++) {
        if (maze.cells[y][x].walls.S) return false;
      }
      return true;
    }
    if (ay === by) {
      const y = ay;
      const lo = Math.min(ax, bx), hi = Math.max(ax, bx);
      for (let x = lo; x < hi; x++) {
        if (maze.cells[y][x].walls.E) return false;
      }
      return true;
    }
    return false;
  }

  function tick(bot, maze, cellSize, body, goalCell, dt, allPlayers, selfId) {
    const pos = body.position;
    const { cx, cy } = posToCell(pos, cellSize);
    const key = cx + ',' + cy;
    if (key !== bot.lastCellKey || !bot.pathCache) {
      bot.pathCache = bfs(maze,
        BDR.clamp(cx, 0, maze.width-1),
        BDR.clamp(cy, 0, maze.height-1),
        goalCell.x, goalCell.y) || [];
      bot.lastCellKey = key;
    }

    // ----- Aggression: try to ram a nearby opponent if line-of-sight -----
    const now = performance.now();
    if (allPlayers && bot.aggression > 0.35) {
      // Re-evaluate target every ~600ms or when ram has expired
      if (now > bot.ramUntil + 100) {
        let bestId = null, bestD2 = Infinity;
        for (const op of allPlayers) {
          if (!op || op.id === selfId || op.finished) continue;
          const opc = posToCell(op.body.position, cellSize);
          if (clearLine(maze, cx, cy, opc.cx, opc.cy)) {
            const dx = op.body.position.x - pos.x;
            const dz = op.body.position.z - pos.z;
            const d2 = dx*dx + dz*dz;
            const range = (cellSize * 5) * (cellSize * 5);
            if (d2 < range && d2 < bestD2) {
              bestD2 = d2;
              bestId = op.id;
            }
          }
        }
        if (bestId && Math.random() < 0.012 + bot.aggression * 0.025) {
          // Commit to ramming for a short window
          bot.ramTargetId = bestId;
          bot.ramUntil = now + 900 + Math.random() * 700;
        }
      }
    }

    let target;
    let intensity = 0.6 + 0.4 * bot.skill;

    if (now < bot.ramUntil && bot.ramTargetId && allPlayers) {
      const tp = allPlayers.find(pp => pp.id === bot.ramTargetId);
      if (tp && !tp.finished) {
        // Predict slightly ahead
        target = {
          x: tp.body.position.x + tp.body.velocity.x * 0.20,
          z: tp.body.position.z + tp.body.velocity.z * 0.20
        };
        intensity = 0.95; // full speed when ramming
      } else {
        bot.ramUntil = 0;
        target = null;
      }
    }

    if (!target) {
      // Goal-following behavior
      if (bot.pathCache.length === 0) {
        target = { x: goalCell.x * cellSize, z: goalCell.y * cellSize };
      } else {
        const next = bot.pathCache[0];
        target = { x: next.x * cellSize, z: next.y * cellSize };
      }
    }

    let dx = target.x - pos.x;
    let dz = target.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01) { dx /= d; dz /= d; }

    // Add slight jitter so multiple bots don't move in lockstep
    bot.jitter += dt;
    const j = Math.sin(bot.jitter * 2.3 + bot.skill * 5) * (1 - bot.skill) * 0.25;
    const ojx = -dz * j;
    const ojz = dx * j;
    dx += ojx; dz += ojz;

    // Stuck detection
    if (bot.lastPos) {
      const moved = Math.hypot(pos.x - bot.lastPos.x, pos.z - bot.lastPos.z);
      if (moved < 0.05) bot.stuckTimer += dt; else bot.stuckTimer = 0;
    }
    bot.lastPos = { x: pos.x, z: pos.z };
    if (bot.stuckTimer > 0.6) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dz = Math.sin(a);
      if (bot.stuckTimer > 1.5) bot.stuckTimer = 0;
    }

    return {
      x: BDR.clamp(dx * intensity, -1, 1),
      z: BDR.clamp(dz * intensity, -1, 1),
      ramming: now < bot.ramUntil
    };
  }

  return { makeBot, tick, bfs };
})();

console.log('[BDR] ai loaded');
