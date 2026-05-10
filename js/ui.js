/* ============================================================
   ui.js - UI controller / glue between menus and game
   ============================================================ */
window.BDR = window.BDR || {};

(function() {
  const $ = (id) => document.getElementById(id);

  const ui = {
    me: {
      name: BDR.storage.get('name', '') || 'Player' + Math.floor(Math.random() * 90 + 10),
      color: BDR.storage.get('color', BDR.PLAYER_COLORS[Math.floor(Math.random()*BDR.PLAYER_COLORS.length)].hex)
    },
    mode: 'solo',
    cpuCount: 0,
    gameInited: false
  };

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('visible'));
    $(id).classList.add('visible');
  }

  // --- Color picker ---
  function buildColorPicker() {
    const cp = $('color-picker');
    cp.innerHTML = '';
    BDR.PLAYER_COLORS.forEach(c => {
      const el = document.createElement('div');
      el.className = 'color-swatch' + (c.hex.toLowerCase() === ui.me.color.toLowerCase() ? ' selected' : '');
      el.style.background = `radial-gradient(circle at 30% 30%, ${BDR.lighten(c.hex, 0.25)}, ${c.hex} 60%, ${BDR.darken(c.hex, 0.2)})`;
      el.title = c.name;
      el.onclick = () => {
        ui.me.color = c.hex;
        BDR.storage.set('color', c.hex);
        cp.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
      };
      cp.appendChild(el);
    });
  }

  function bindNameInput() {
    const inp = $('player-name');
    inp.value = ui.me.name;
    inp.addEventListener('input', () => {
      ui.me.name = inp.value.trim().slice(0, 10) || 'Player';
      BDR.storage.set('name', ui.me.name);
    });
  }

  // --- Title menu ---
  function bindTitleButtons() {
    $('btn-solo').onclick = () => startLocalGame(0);
    $('btn-cpu').onclick = () => startLocalGame(3); // default 3 CPU
    $('btn-host').onclick = () => beginHost();
    $('btn-join').onclick = () => showScreen('screen-join');
    $('btn-howto').onclick = () => showScreen('screen-howto');
    $('btn-howto-back').onclick = () => showScreen('screen-title');
  }

  // --- Local (solo / cpu) ---
  function startLocalGame(cpuCount) {
    ui.mode = 'local';
    const me = { id: 'me-' + BDR.uid(), name: ui.me.name, color: ui.me.color, isHost: true, isCPU: false };
    const list = [me];
    const cpuNames = ['ハル','ナナ','カイ','ミオ','レイ','ソラ'];
    const cpuColors = BDR.PLAYER_COLORS.map(c => c.hex).filter(c => c !== ui.me.color);
    for (let i = 0; i < cpuCount; i++) {
      list.push({
        id: 'cpu-' + i,
        name: cpuNames[i % cpuNames.length] + (i >= cpuNames.length ? (i+1) : ''),
        color: cpuColors[i % cpuColors.length],
        isHost: false, isCPU: true,
        skill: 0.55 + 0.1 * i + Math.random() * 0.1
      });
    }
    enterGame({
      mazeSeed: (Math.random() * 0xffffffff) >>> 0,
      players: list,
      selfId: me.id,
      hostFlag: true
    });
  }

  // --- Host ---
  function beginHost() {
    showScreen('screen-host');
    $('host-status').textContent = '初期化中...';
    $('host-status').className = 'status';
    const code = BDR.randCode(6);
    $('host-code').textContent = code;
    const me = { id: '', name: ui.me.name, color: ui.me.color, isHost: true, isCPU: false };

    BDR.network.setupHost(me, code).then(() => {
      $('host-status').textContent = '部屋を作りました。あいことばを共有してください。';
      $('host-status').className = 'status ok';
    }).catch((err) => {
      console.error(err);
      $('host-status').textContent = '部屋の作成に失敗しました: ' + (err.message || err);
      $('host-status').className = 'status error';
    });

    BDR.network.state.onPlayersChanged = renderHostPlayers;
    renderHostPlayers(BDR.network.state.players);
  }

  function renderHostPlayers(list) {
    const el = $('host-players');
    el.innerHTML = '';
    if (!list || !list.length) { el.innerHTML = '<div class="muted">まだ誰もいません...</div>'; return; }
    list.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `
        <span class="pdot" style="background:${p.color}"></span>
        <span class="pname">${escapeHtml(p.name)}</span>
        ${p.isHost ? '<span class="ptag">HOST</span>' : ''}
        ${p.isCPU ? '<span class="ptag">CPU</span>' : ''}
      `;
      el.appendChild(row);
    });
  }

  function bindHostButtons() {
    $('btn-copy-code').onclick = () => {
      const code = $('host-code').textContent;
      try {
        navigator.clipboard.writeText(code);
        $('btn-copy-code').textContent = 'コピー済';
        setTimeout(() => $('btn-copy-code').textContent = 'コピー', 1200);
      } catch (e) {}
    };
    $('btn-host-back').onclick = () => {
      BDR.network.destroy();
      showScreen('screen-title');
    };
    const slider = $('host-cpu-slider');
    slider.addEventListener('input', () => {
      $('host-cpu-count').textContent = slider.value;
    });
    $('btn-host-start').onclick = () => {
      // Add CPUs to fill
      const n = parseInt(slider.value, 10) || 0;
      const ns = BDR.network.state;
      // Remove existing CPUs first
      ns.players = ns.players.filter(p => !p.isCPU);
      const remaining = BDR.MAX_PLAYERS - ns.players.length;
      const toAdd = Math.min(n, remaining);
      const cpuNames = ['ハル','ナナ','カイ','ミオ','レイ','ソラ'];
      const usedColors = ns.players.map(p => p.color.toLowerCase());
      const palette = BDR.PLAYER_COLORS.map(c => c.hex).filter(c => !usedColors.includes(c.toLowerCase()));
      for (let i = 0; i < toAdd; i++) {
        BDR.network.addCPU({
          id: 'cpu-' + BDR.uid(),
          name: cpuNames[i % cpuNames.length],
          color: palette[i % palette.length] || '#888',
          isHost: false, isCPU: true,
          skill: 0.55 + 0.1 * i + Math.random() * 0.1
        });
      }
      // Trigger start
      BDR.network.startGameAsHost();
    };

    BDR.network.state.onStart = (msg) => {
      enterGame({
        mazeSeed: msg.seed,
        players: msg.players,
        selfId: BDR.network.state.selfId,
        hostFlag: BDR.network.state.role === 'host',
        startedAt: msg.startedAt
      });
    };
  }

  // --- Join ---
  function bindJoinButtons() {
    $('btn-join-back').onclick = () => {
      BDR.network.destroy();
      showScreen('screen-title');
    };
    $('btn-join-go').onclick = () => {
      const code = ($('join-code').value || '').trim().toUpperCase();
      if (code.length < 4) {
        $('join-status').textContent = 'あいことばを入力してください';
        $('join-status').className = 'status error';
        return;
      }
      $('join-status').textContent = '接続中...';
      $('join-status').className = 'status';
      const me = { id: '', name: ui.me.name, color: ui.me.color, isHost: false, isCPU: false };
      BDR.network.setupClient(me, code).then((welcome) => {
        $('join-status').textContent = '接続しました。ホストの開始を待っています...';
        $('join-status').className = 'status ok';
      }).catch((err) => {
        console.warn(err);
        $('join-status').textContent = '失敗: ' + (err.message || err);
        $('join-status').className = 'status error';
      });

      BDR.network.state.onStart = (msg) => {
        enterGame({
          mazeSeed: msg.seed,
          players: msg.players,
          selfId: BDR.network.state.selfId,
          hostFlag: false,
          startedAt: msg.startedAt
        });
      };
    };
  }

  // --- Enter game ---
  function enterGame(opts) {
    showScreen('screen-game');

    if (!ui.gameInited) {
      BDR.game.init();
      BDR.game.startLoop();
      ui.gameInited = true;
    }

    BDR.game.setup({
      mazeSeed: opts.mazeSeed,
      playerList: opts.players,
      selfId: opts.selfId,
      hostFlag: opts.hostFlag,
      onResult: showResult,
      onTick: opts.hostFlag ? (snap) => BDR.network.broadcastState(snap) : null
    });

    // Network input/state hooks
    BDR.network.state.onInput = (id, input) => BDR.game.setNetworkInput(id, input);
    BDR.network.state.onState = (snap) => BDR.game.applyNetworkSnapshot(snap);

    // Gyro setup (ask permission on iOS once)
    setupGyroFlow();

    // Joystick setup if needed
    BDR.controls.setupJoystick($('touch-joystick'));

    // Schedule countdown
    const startAt = opts.startedAt || (Date.now() + 4000);
    BDR.game.startCountdown(startAt);

    // Start HUD updater
    startHud();

    // pause
    $('btn-pause').onclick = () => $('pause-overlay').classList.remove('hidden');
    $('btn-resume').onclick = () => $('pause-overlay').classList.add('hidden');
    $('btn-quit').onclick = () => {
      BDR.network.destroy();
      $('pause-overlay').classList.add('hidden');
      $('result-overlay').classList.add('hidden');
      showScreen('screen-title');
    };
    $('btn-result-again').onclick = () => {
      $('result-overlay').classList.add('hidden');
      // Restart same mode
      if (BDR.network.state.role === 'host') {
        BDR.network.startGameAsHost();
      } else if (BDR.network.state.role === 'client') {
        // wait for host
      } else {
        startLocalGame(opts.players.filter(p => p.isCPU).length);
      }
    };
    $('btn-result-home').onclick = () => {
      BDR.network.destroy();
      $('result-overlay').classList.add('hidden');
      showScreen('screen-title');
    };
  }

  // --- Gyro permission flow ---
  function setupGyroFlow() {
    const overlay = $('gyro-overlay');
    const joy = $('touch-joystick');

    // For iOS we MUST ask via a user-gesture button.
    if (BDR.isIOS()) {
      overlay.classList.add('visible');
      $('btn-gyro-allow').onclick = async () => {
        const ok = await BDR.controls.requestGyroPermission();
        overlay.classList.remove('visible');
        if (!ok) joy.classList.remove('hidden');
      };
      $('btn-gyro-deny').onclick = () => {
        overlay.classList.remove('visible');
        joy.classList.remove('hidden');
      };
    } else if (BDR.isMobile()) {
      // Android etc.: try without prompt
      BDR.controls.requestGyroPermission().then(ok => {
        if (!ok) joy.classList.remove('hidden');
      });
    } else {
      // Desktop: keyboard only, hide joystick
      joy.classList.add('hidden');
    }
  }

  // --- HUD updater ---
  function startHud() {
    const dashBtn = $('btn-dash');
    const dashArc = $('hud-dash-arc');
    const arcLen = 100.53;
    if (dashBtn) {
      dashBtn.onclick = () => BDR.game.tryLocalDash && BDR.game.tryLocalDash();
      // Spacebar dash
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && $('screen-game').classList.contains('visible')) {
          e.preventDefault();
          BDR.game.tryLocalDash && BDR.game.tryLocalDash();
        }
      });
    }
    function tick() {
      // Time
      const t = BDR.game.getElapsed();
      $('hud-time').textContent = BDR.formatTime(t);
      // Rank
      const r = BDR.game.getMyRank();
      $('hud-rank').textContent = `${r.rank} / ${r.total}`;
      // Leaderboard
      const ranking = BDR.game.getRanking();
      const lb = $('hud-leaderboard');
      lb.innerHTML = ranking.slice(0, 6).map((p, i) => `
        <div class="lb-row ${p.isMe ? 'me' : ''}">
          <span>${i+1}.</span>
          <span class="lb-dot" style="background:${p.color}"></span>
          <span>${escapeHtml(p.name)}${p.finished ? ' ✓' : ''}</span>
        </div>
      `).join('');
      // Dash cooldown ring
      if (dashArc && BDR.game.getDashCooldownRatio) {
        const ratio = BDR.game.getDashCooldownRatio();
        dashArc.setAttribute('stroke-dashoffset', String(arcLen * (1 - ratio)));
        if (ratio >= 1) dashBtn.classList.remove('cooling');
        else dashBtn.classList.add('cooling');
      }
      // Apply control input pump
      BDR.controls.update();

      // Continue if game screen visible
      if ($('screen-game').classList.contains('visible')) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function showResult(ranking) {
    const overlay = $('result-overlay');
    const list = $('result-list');
    list.innerHTML = '';
    ranking.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'res-row' + (p.isMe ? ' me' : '');
      row.innerHTML = `
        <span class="res-rank ${i<3?'r'+(i+1):''}">${i+1}</span>
        <span class="lb-dot" style="background:${p.color}; width:12px; height:12px; border-radius:50%; display:inline-block"></span>
        <span style="flex:1">${escapeHtml(p.name)}${p.isCPU ? ' <small>(CPU)</small>' : ''}</span>
        <span style="font-variant-numeric:tabular-nums">${BDR.formatTime(p.finishTime)}</span>
      `;
      list.appendChild(row);
    });
    const me = ranking.find(p => p.isMe);
    $('result-title').textContent = (me && me.place === 1) ? 'YOU WIN!' : (me ? `${me.place}位` : 'FINISH!');
    overlay.classList.remove('hidden');
  }

  function escapeHtml(s) {
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  // --- Init ---
  function init() {
    buildColorPicker();
    bindNameInput();
    bindTitleButtons();
    bindHostButtons();
    bindJoinButtons();
    showScreen('screen-title');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already ready (we are loaded dynamically by the boot loader)
    init();
  }

})();

console.log('[BDR] ui loaded');
