/* ============================================================
   items.js - projectiles, hazards & item pickups
   - Projectiles: spheres CPUs (and players via dash) shoot to bump
     opponents. They use simple ballistic motion + sphere bodies.
   - Hazards: spinning walls / sliding bumpers in a few cells.
   - Pickups: dash charge, speed boost, shield (existing boost ring
     handled by game.js for compatibility).
   ============================================================ */
window.BDR = window.BDR || {};

BDR.items = (function() {
  const cfg = {
    projRadius: 0.32,
    projLifeMs: 4000,
    projSpeed: 9.5,
    projKnockback: 12,
    projCooldownMs: 1200,    // CPUs fire at this rate when within range
    projRangeCells: 4,
    dashImpulse: 8.5,
    dashCooldownMs: 1800,
    bumpKnockback: 9,
    projDamage: 20,
    slamDamage: 25,
    invulMs: 800
  };

  const pool = []; // active projectiles

  function makeProjectile(scene, world, ballMat, owner, fromPos, dir, color) {
    const geo = new THREE.SphereGeometry(cfg.projRadius, 16, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x222244,
      roughness: 0.4,
      metalness: 0.5,
      emissive: color || 0xffaa00,
      emissiveIntensity: 0.5
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(fromPos);
    scene.add(mesh);

    // Trail
    const trailGeo = new THREE.SphereGeometry(cfg.projRadius * 1.4, 12, 8);
    const trailMat = new THREE.MeshBasicMaterial({
      color: color || 0xffcc66, transparent: true, opacity: 0.45
    });
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.position.copy(fromPos);
    scene.add(trail);

    const body = new CANNON.Body({
      mass: 0.18,
      shape: new CANNON.Sphere(cfg.projRadius),
      material: ballMat,
      linearDamping: 0.05,
      angularDamping: 0.1
    });
    body.position.copy(fromPos);
    body.velocity.set(dir.x * cfg.projSpeed, 1.5, dir.z * cfg.projSpeed);
    body.collisionFilterGroup = 4;  // projectile
    body.collisionFilterMask = 1 | 2; // walls(1) + balls(2)
    world.addBody(body);

    return {
      mesh, trail, body,
      ownerId: owner.id,
      bornAt: performance.now(),
      hit: false,
      color: color || 0xffaa00
    };
  }

  function update(scene, world, players, projectiles, dt) {
    const now = performance.now();
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pj = projectiles[i];
      // Sync mesh
      pj.mesh.position.copy(pj.body.position);
      pj.mesh.quaternion.copy(pj.body.quaternion);
      pj.trail.position.lerp(pj.body.position, 0.35);
      pj.trail.material.opacity *= 0.94;

      // Player collision (manual sphere check, faster than contact callbacks)
      for (const p of players) {
        if (p.finished) continue;
        if (p.id === pj.ownerId) continue;
        const dx = p.body.position.x - pj.body.position.x;
        const dy = p.body.position.y - pj.body.position.y;
        const dz = p.body.position.z - pj.body.position.z;
        const r = BDR.game.cfg.ballRadius + cfg.projRadius;
        if (dx*dx + dy*dy + dz*dz < r*r * 1.2) {
          if (now > (p.invulUntil || 0)) {
            // damage + steal pressure: a clean hit makes the target drop one collected star.
            p.hp = Math.max(0, p.hp - cfg.projDamage);
            p.invulUntil = now + cfg.invulMs;
            if (p.stars > 0) {
              p.stars -= 1;
              if (BDR.game && BDR.game.dropStarFromPlayer) BDR.game.dropStarFromPlayer(p);
            }
            
            // knockback
            const d = Math.hypot(dx, dz) || 1;
            const ax = dx / d, az = dz / d;
            p.body.velocity.x += ax * cfg.projKnockback;
            p.body.velocity.z += az * cfg.projKnockback;
            p.body.velocity.y += 4;
            
            if (p.hp <= 0) {
              // Respawn logic
              p.hp = BDR.game.cfg.maxHP;
              const sc = p.startCell || {x:0, y:0};
              p.body.position.set(sc.x * BDR.game.cfg.cellSize, 2, sc.y * BDR.game.cfg.cellSize);
              p.body.velocity.set(0,0,0);
              if (BDR.sound && p.isMe) BDR.sound.bump(); 
            }
          }
          
          pj.hit = true;
          spawnHitFlash(scene, p.body.position, pj.color);
          break;
        }
      }

      // Lifetime / out-of-bounds / hit
      if (pj.hit || (now - pj.bornAt > cfg.projLifeMs) || pj.body.position.y < -10) {
        scene.remove(pj.mesh);
        scene.remove(pj.trail);
        world.removeBody(pj.body);
        projectiles.splice(i, 1);
      }
    }
  }

  function spawnHitFlash(scene, pos, color) {
    const geo = new THREE.SphereGeometry(0.6, 12, 8);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    scene.add(m);
    const start = performance.now();
    function anim() {
      const t = (performance.now() - start) / 350;
      if (t >= 1) { scene.remove(m); return; }
      m.scale.setScalar(1 + t * 2.5);
      m.material.opacity = 0.85 * (1 - t);
      requestAnimationFrame(anim);
    }
    anim();
  }

  return {
    cfg,
    makeProjectile,
    update,
    spawnHitFlash
  };
})();

console.log('[BDR] items loaded');
