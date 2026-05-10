/* ============================================================
   ai.js - simple CPU pathfinding through the maze
   - BFS from each CPU's current cell to the goal cell
   - Output input vector aimed at the next cell center
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
      skill,                // 0..1, higher = more accurate, faster reactions
      pathCache: null,
      lastCellKey: '',
      jitter: 0,
      stuckTimer: 0,
      lastPos: null
    };
  }

  // worldPos -> { x, z } in cell coords
  function posToCell(pos, cellSize) {
    return {
      cx: Math.round(pos.x / cellSize),
      cy: Math.round(pos.z / cellSize)
    };
  }

  function tick(bot, maze, cellSize, body, goalCell, dt) {
    const pos = body.position;
    const { cx, cy } = posToCell(pos, cellSize);
    const key = cx + ',' + cy;
    if (key !== bot.lastCellKey || !bot.pathCache) {
      bot.pathCache = bfs(maze, BDR.clamp(cx, 0, maze.width-1), BDR.clamp(cy, 0, maze.height-1), goalCell.x, goalCell.y) || [];
      bot.lastCellKey = key;
    }

    let target;
    if (bot.pathCache.length === 0) {
      target = { x: goalCell.x * cellSize, z: goalCell.y * cellSize };
    } else {
      const next = bot.pathCache[0];
      target = { x: next.x * cellSize, z: next.y * cellSize };
    }

    let dx = target.x - pos.x;
    let dz = target.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01) { dx /= d; dz /= d; }

    // Add slight jitter so multiple bots don't move in lockstep
    bot.jitter += dt;
    const j = Math.sin(bot.jitter * 2.3 + bot.skill * 5) * (1 - bot.skill) * 0.25;
    dx += -dz * j;
    dz += dx * j;

    // Stuck detection: if barely moving for a while, push perpendicular
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

    // Reaction limited by skill
    const intensity = 0.55 + 0.45 * bot.skill;
    return { x: BDR.clamp(dx * intensity, -1, 1), z: BDR.clamp(dz * intensity, -1, 1) };
  }

  return { makeBot, tick, bfs };
})();

console.log('[BDR] ai loaded');
