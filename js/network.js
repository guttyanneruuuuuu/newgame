/* ============================================================
   network.js - PeerJS-based room networking (host/client)
   ----------------------------------------------------------------
   Topology: STAR (host = authoritative simulator).
     Host: receives 'input' messages from each client every tick,
           runs physics for everyone, broadcasts 'state' snapshots.
     Client: sends 'input' messages, renders from 'state' snapshots.
   ============================================================ */
window.BDR = window.BDR || {};

BDR.network = (function() {
  const PEER_PREFIX = 'bdr-v1-'; // namespace to avoid id clashes

  const state = {
    role: 'none',         // 'host' | 'client' | 'none'
    peer: null,
    code: '',
    hostId: '',
    selfId: '',
    me: null,             // { id, name, color, isHost, isCPU? }
    players: [],          // [ {id, name, color, isHost, conn?, isCPU} ]
    conns: {},            // host: id -> DataConnection
    hostConn: null,       // client: connection to host
    onPlayersChanged: null,
    onStart: null,        // (cfg) => void   payload: {seed, players, startedAt}
    onState: null,        // (snap) => void  client side
    onInput: null,        // (id, input) => void   host side
    onChat: null,
    started: false,
    seed: 0
  };

  function send(conn, msg) {
    try { conn.send(msg); } catch (e) { console.warn('[net] send err', e); }
  }

  function broadcastFromHost(msg) {
    for (const id in state.conns) {
      const c = state.conns[id];
      if (c && c.open) send(c, msg);
    }
  }

  function setupHost(me, code) {
    return new Promise((resolve, reject) => {
      const peerId = PEER_PREFIX + code;
      const peer = new Peer(peerId, { debug: 1 });
      state.peer = peer;
      state.role = 'host';
      state.code = code;
      state.hostId = peerId;
      state.selfId = peerId;
      me.id = peerId;
      me.isHost = true;
      state.me = me;
      state.players = [me];
      state.conns = {};

      peer.on('open', () => resolve({ id: peerId, code }));
      peer.on('error', (err) => {
        console.warn('[net] host peer err', err);
        if (!peer.disconnected) reject(err);
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          // Will receive 'hello' next from client
        });
        conn.on('data', (msg) => onHostMessage(conn, msg));
        conn.on('close', () => onHostDisconnect(conn));
        conn.on('error', (e) => console.warn('[net] host conn err', e));
      });
    });
  }

  function onHostMessage(conn, msg) {
    if (!msg || !msg.t) return;
    switch (msg.t) {
      case 'hello': {
        if (state.started) {
          send(conn, { t: 'reject', reason: 'already-started' });
          conn.close();
          return;
        }
        if (state.players.length >= BDR.MAX_PLAYERS) {
          send(conn, { t: 'reject', reason: 'full' });
          conn.close();
          return;
        }
        const p = {
          id: msg.id, name: (msg.name || 'Player').slice(0, 10),
          color: msg.color || '#ff7a59', isHost: false, isCPU: false
        };
        state.conns[p.id] = conn;
        state.players.push(p);
        send(conn, {
          t: 'welcome',
          you: p,
          host: state.me,
          players: state.players
        });
        broadcastFromHost({ t: 'lobby', players: state.players });
        if (state.onPlayersChanged) state.onPlayersChanged(state.players);
        break;
      }
      case 'input': {
        if (state.onInput) state.onInput(msg.id, msg.input);
        break;
      }
      case 'chat': {
        broadcastFromHost({ t: 'chat', from: msg.id, text: msg.text });
        if (state.onChat) state.onChat(msg.id, msg.text);
        break;
      }
    }
  }

  function onHostDisconnect(conn) {
    let removed = null;
    for (const id in state.conns) {
      if (state.conns[id] === conn) {
        removed = id;
        delete state.conns[id];
        break;
      }
    }
    if (removed) {
      state.players = state.players.filter(p => p.id !== removed);
      broadcastFromHost({ t: 'lobby', players: state.players });
      if (state.onPlayersChanged) state.onPlayersChanged(state.players);
    }
  }

  function setupClient(me, code) {
    return new Promise((resolve, reject) => {
      const targetId = PEER_PREFIX + code;
      const myId = PEER_PREFIX + 'c-' + BDR.uid();
      const peer = new Peer(myId, { debug: 1 });
      state.peer = peer;
      state.role = 'client';
      state.code = code;
      state.hostId = targetId;
      state.selfId = myId;
      me.id = myId;
      me.isHost = false;
      state.me = me;

      peer.on('open', () => {
        const conn = peer.connect(targetId, { reliable: true });
        state.hostConn = conn;
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) {
            try { peer.destroy(); } catch(e){}
            reject(new Error('接続タイムアウト。あいことばを確認してください。'));
          }
        }, 8000);
        conn.on('open', () => {
          send(conn, { t: 'hello', id: myId, name: me.name, color: me.color });
        });
        conn.on('data', (msg) => {
          if (!resolved && msg && msg.t === 'welcome') {
            resolved = true;
            clearTimeout(timer);
            state.players = msg.players;
            state.me = msg.you;
            resolve(msg);
          } else if (!resolved && msg && msg.t === 'reject') {
            resolved = true;
            clearTimeout(timer);
            try { peer.destroy(); } catch(e){}
            reject(new Error(msg.reason === 'full' ? '部屋が満員です' : 'すでに開始されています'));
            return;
          }
          onClientMessage(msg);
        });
        conn.on('close', () => {
          if (state.onPlayersChanged) state.onPlayersChanged(state.players);
        });
        conn.on('error', (e) => {
          if (!resolved) { resolved = true; clearTimeout(timer); reject(e); }
        });
      });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          reject(new Error('部屋が見つかりません。あいことばを確認してください。'));
        } else {
          reject(err);
        }
      });
    });
  }

  function onClientMessage(msg) {
    if (!msg || !msg.t) return;
    switch (msg.t) {
      case 'lobby':
        state.players = msg.players;
        if (state.onPlayersChanged) state.onPlayersChanged(state.players);
        break;
      case 'start':
        state.started = true;
        state.seed = msg.seed;
        state.players = msg.players;
        if (state.onStart) state.onStart(msg);
        break;
      case 'state':
        if (state.onState) state.onState(msg);
        break;
      case 'chat':
        if (state.onChat) state.onChat(msg.from, msg.text);
        break;
    }
  }

  function startGameAsHost(extraConfig = {}) {
    if (state.role !== 'host') return;
    state.started = true;
    state.seed = (Math.random() * 0xffffffff) >>> 0;
    const payload = {
      t: 'start',
      seed: state.seed,
      players: state.players,
      config: extraConfig,
      startedAt: Date.now() + 4000 // 4s countdown
    };
    broadcastFromHost(payload);
    if (state.onStart) state.onStart(payload);
  }

  function broadcastState(snap) {
    if (state.role !== 'host') return;
    broadcastFromHost({ t: 'state', ...snap });
  }

  function sendInput(input) {
    if (state.role !== 'client') return;
    if (state.hostConn && state.hostConn.open) {
      send(state.hostConn, { t: 'input', id: state.selfId, input });
    }
  }

  function addCPU(cpu) {
    if (state.role !== 'host') return;
    if (state.players.length >= BDR.MAX_PLAYERS) return;
    state.players.push(cpu);
    broadcastFromHost({ t: 'lobby', players: state.players });
    if (state.onPlayersChanged) state.onPlayersChanged(state.players);
  }

  function removeAllCPUs() {
    state.players = state.players.filter(p => !p.isCPU);
    if (state.role === 'host') broadcastFromHost({ t: 'lobby', players: state.players });
    if (state.onPlayersChanged) state.onPlayersChanged(state.players);
  }

  function destroy() {
    try { if (state.peer) state.peer.destroy(); } catch (e) {}
    state.peer = null;
    state.role = 'none';
    state.players = [];
    state.conns = {};
    state.hostConn = null;
    state.started = false;
  }

  return {
    state,
    setupHost, setupClient,
    startGameAsHost, broadcastState, sendInput,
    addCPU, removeAllCPUs,
    destroy
  };
})();

console.log('[BDR] network loaded');
