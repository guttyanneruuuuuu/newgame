/* ============================================================
   utils.js - shared utilities
   ============================================================ */
window.BDR = window.BDR || {};

BDR.PLAYER_COLORS = [
  { name: 'tomato',  hex: '#ff6b6b' },
  { name: 'orange',  hex: '#ffa94d' },
  { name: 'yellow',  hex: '#ffd43b' },
  { name: 'lime',    hex: '#a9e34b' },
  { name: 'green',   hex: '#51cf66' },
  { name: 'teal',    hex: '#3bc9db' },
  { name: 'sky',     hex: '#4dabf7' },
  { name: 'blue',    hex: '#5c7cfa' },
  { name: 'purple',  hex: '#9775fa' },
  { name: 'pink',    hex: '#f783ac' },
  { name: 'rose',    hex: '#ff8787' },
  { name: 'brown',   hex: '#b08968' },
  { name: 'gray',    hex: '#adb5bd' },
  { name: 'mint',    hex: '#8ce99a' },
  { name: 'sun',     hex: '#ffd166' },
  { name: 'cherry',  hex: '#e64980' }
];

BDR.MAX_PLAYERS = 6;

BDR.randCode = function(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

BDR.uid = function() {
  return Math.random().toString(36).slice(2, 10);
};

BDR.clamp = function(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); };

BDR.lerp = function(a, b, t) { return a + (b - a) * t; };

BDR.deg2rad = Math.PI / 180;

BDR.formatTime = function(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
};

BDR.storage = {
  get(k, d) {
    try { const v = localStorage.getItem('bdr.' + k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('bdr.' + k, JSON.stringify(v)); } catch (e) {}
  }
};

BDR.isMobile = function() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
};

BDR.isIOS = function() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
};

BDR.hexToInt = function(hex) {
  const h = hex.replace('#', '');
  return parseInt(h, 16);
};

BDR.lighten = function(hex, amt = 0.2) {
  const c = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((c >> 16) & 0xff) + Math.floor(255 * amt));
  const g = Math.min(255, ((c >> 8) & 0xff) + Math.floor(255 * amt));
  const b = Math.min(255, (c & 0xff) + Math.floor(255 * amt));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
};

BDR.darken = function(hex, amt = 0.2) {
  const c = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((c >> 16) & 0xff) - Math.floor(255 * amt));
  const g = Math.max(0, ((c >> 8) & 0xff) - Math.floor(255 * amt));
  const b = Math.max(0, (c & 0xff) - Math.floor(255 * amt));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
};

console.log('[BDR] utils loaded');
