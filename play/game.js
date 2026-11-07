// A playable version of the contribution snake on the profile README.
//
// The board is read from the same SVGs the README shows (dist/, written every
// night by the snake workflow), so the cells, their colours and the newest-day
// highlight always match what the profile shows.

'use strict';

(() => {
  const PITCH = 16; // one cell in the SVG, gap included
  const DOT = 12; // the coloured square inside a cell
  const DOT_RADIUS = 2;
  const COLS = 53;
  const ROWS = 7;
  // As in the SVG, the snake may also use a one-cell margin around the graph.
  const MIN_COL = -1;
  const MAX_COL = COLS;
  const MIN_ROW = -1;
  const MAX_ROW = ROWS;
  const BOARD_COLS = MAX_COL - MIN_COL + 1;
  const BOARD_ROWS = MAX_ROW - MIN_ROW + 1;

  const START_TICK_MS = 130;
  const MIN_TICK_MS = 80;
  const TICK_STEP_MS = 2; // faster with every cell eaten
  const REGROW_DELAY_MS = 6000;
  const REGROW_FADE_MS = 1500;
  const RESTART_GUARD_MS = 400;
  const SWIPE_PX = 18;

  const POINTS = { '--c1': 1, '--c2': 2, '--c3': 3, '--c4': 4, '--hl': 5 };
  // Inset, size and corner radius of the first segments, as snk draws them.
  const SEGMENTS = [
    [0.8, 14.4, 4.5],
    [1.8, 12.3, 4.1],
    [2.6, 10.8, 3.6],
    [3.0, 9.9, 3.3],
  ];
  const MIN_SEGMENT = 8;
  const BEST_KEY = 'contribution-snake-best';

  const LEFT = { c: -1, r: 0 };
  const RIGHT = { c: 1, r: 0 };
  const UP = { c: 0, r: -1 };
  const DOWN = { c: 0, r: 1 };

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const boardEl = document.getElementById('board');
  const statusEl = document.getElementById('status');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const lengthEl = document.getElementById('length');
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const touchQuery = window.matchMedia('(pointer: coarse)');

  let palettes = null; // { light: {...vars}, dark: {...vars} }
  let cells = []; // { col, row, fillVar, points, eatenAt }
  let cellAt = new Map();

  let snake = [];
  let previous = [];
  let dir = LEFT;
  let queue = [];
  let grow = 0;
  let score = 0;
  let best = readBest();
  let state = 'loading'; // loading | ready | running | paused | over | error
  let tickMs = START_TICK_MS;
  let sinceTick = 0;
  let clock = 0; // game time, only advances while running
  let lastFrame = 0;
  let overAt = 0;

  let rotated = false;
  let scale = 1;
  let dpr = 1;

  // ---------- loading ----------

  async function loadSvg(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error(`${url}: not an SVG`);

    const css = doc.querySelector('style')?.textContent ?? '';
    const vars = {};
    const root = css.match(/:root\{([^}]*)\}/);
    if (root) {
      for (const decl of root[1].split(';')) {
        const i = decl.indexOf(':');
        if (i > 0) vars[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
      }
    }
    const fills = {};
    for (const m of css.matchAll(/\.c\.(c[0-9a-z]+)\{fill:var\((--[a-z0-9]+)\)/g)) {
      fills[m[1]] = m[2];
    }
    const found = [];
    for (const rect of doc.querySelectorAll('rect')) {
      const classes = rect.getAttribute('class')?.split(/\s+/) ?? [];
      if (classes[0] !== 'c') continue;
      const col = Math.round((Number(rect.getAttribute('x')) - 2) / PITCH);
      const row = Math.round((Number(rect.getAttribute('y')) - 2) / PITCH);
      const fillVar = classes[1] ? fills[classes[1]] ?? null : null;
      found.push({ col, row, fillVar });
    }
    return { vars, cells: found };
  }

  async function load() {
    try {
      const [light, dark] = await Promise.all([
        loadSvg('../dist/github-snake.svg'),
        loadSvg('../dist/github-snake-dark.svg'),
      ]);
      if (light.cells.length !== COLS * ROWS) {
        throw new Error(`expected ${COLS * ROWS} cells, found ${light.cells.length}`);
      }
      palettes = { light: light.vars, dark: dark.vars };
      cells = light.cells.map((cell) => ({
        ...cell,
        points: cell.fillVar ? POINTS[cell.fillVar] ?? 1 : 0,
        eatenAt: null,
      }));
      cellAt = new Map(cells.map((cell) => [key(cell.col, cell.row), cell]));
      reset();
    } catch (error) {
      console.error(error);
      state = 'error';
      showStatus();
    }
  }

  // ---------- game ----------

  function key(col, row) {
    return `${col},${row}`;
  }

  function reset() {
    // The README animation's first frame: head at the top-left, in the margin.
    snake = [0, 1, 2, 3].map((c) => ({ c, r: -1 }));
    previous = snake.map((p) => ({ ...p }));
    dir = LEFT;
    queue = [];
    grow = 0;
    score = 0;
    tickMs = START_TICK_MS;
    sinceTick = 0;
    clock = 0;
    for (const cell of cells) cell.eatenAt = null;
    state = 'ready';
    updateStats();
    showStatus();
  }

  function edible(cell) {
    return cell.fillVar && (cell.eatenAt === null || clock - cell.eatenAt >= REGROW_DELAY_MS);
  }

  function step() {
    if (queue.length) dir = queue.shift();
    const head = snake[0];
    const next = { c: head.c + dir.c, r: head.r + dir.r };
    const old = snake;

    if (next.c < MIN_COL || next.c > MAX_COL || next.r < MIN_ROW || next.r > MAX_ROW) {
      return gameOver();
    }
    const body = grow > 0 ? old : old.slice(0, -1);
    if (body.some((p) => p.c === next.c && p.r === next.r)) return gameOver();

    snake = [next, ...old];
    if (grow > 0) {
      grow -= 1;
      previous = [...old, old[old.length - 1]];
    } else {
      snake.pop();
      previous = old;
    }

    const cell = cellAt.get(key(next.c, next.r));
    if (cell && edible(cell)) {
      cell.eatenAt = clock;
      score += cell.points;
      grow += 1;
      tickMs = Math.max(MIN_TICK_MS, tickMs - TICK_STEP_MS);
      if (score > best) {
        best = score;
        writeBest(best);
      }
    }
    updateStats();
  }

  function gameOver() {
    previous = snake.map((p) => ({ ...p }));
    state = 'over';
    overAt = performance.now();
    showStatus();
  }

  function start() {
    if (state !== 'ready' && state !== 'paused') return;
    state = 'running';
    sinceTick = 0;
    showStatus();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    showStatus();
  }

  function steer(d) {
    if (state === 'loading' || state === 'error' || state === 'over') return;
    const last = queue.length ? queue[queue.length - 1] : dir;
    if (d.c === -last.c && d.r === -last.r) return; // no turning back into the body
    if (state === 'ready' || state === 'paused') {
      if (d.c !== last.c || d.r !== last.r) queue.push(d);
      start();
      return;
    }
    if (d.c === last.c && d.r === last.r) return;
    if (queue.length < 2) queue.push(d);
  }

  function primary() {
    if (state === 'running') pause();
    else if (state === 'ready' || state === 'paused') start();
    else if (state === 'over' && performance.now() - overAt > RESTART_GUARD_MS) reset();
  }

  // ---------- drawing ----------

  function palette() {
    return darkQuery.matches ? palettes.dark : palettes.light;
  }

  function hexToRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(from, to, t) {
    const a = hexToRgb(from);
    const b = hexToRgb(to);
    if (!a || !b) return t < 0.5 ? from : to;
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  function cellColor(cell, pal) {
    const empty = pal['--ce'];
    if (!cell.fillVar) return empty;
    const color = pal[cell.fillVar] ?? empty;
    if (cell.eatenAt === null) return color;
    const since = clock - cell.eatenAt;
    if (since < REGROW_DELAY_MS) return empty;
    if (since < REGROW_DELAY_MS + REGROW_FADE_MS) {
      return mix(empty, color, (since - REGROW_DELAY_MS) / REGROW_FADE_MS);
    }
    return color;
  }

  function roundRect(x, y, w, h, r) {
    // Board coordinates; rotation swaps the axes.
    if (rotated) [x, y, w, h] = [y, x, h, w];
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function segmentShape(i) {
    if (i < SEGMENTS.length) return SEGMENTS[i];
    const size = Math.max(MIN_SEGMENT, SEGMENTS[SEGMENTS.length - 1][1] - (i - SEGMENTS.length + 1) * 0.12);
    return [(PITCH - size) / 2, size, size * 0.33];
  }

  function draw() {
    const width = canvas.width;
    const height = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!palettes) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

    const pal = palette();
    ctx.lineWidth = 1;
    ctx.strokeStyle = pal['--cb'] ?? 'transparent';
    for (const cell of cells) {
      const x = (cell.col - MIN_COL) * PITCH + (PITCH - DOT) / 2;
      const y = (cell.row - MIN_ROW) * PITCH + (PITCH - DOT) / 2;
      roundRect(x, y, DOT, DOT, DOT_RADIUS);
      ctx.fillStyle = cellColor(cell, pal);
      ctx.fill();
      ctx.stroke();
    }

    const t = state === 'running' ? Math.min(1, sinceTick / tickMs) : 1;
    ctx.fillStyle = pal['--cs'] ?? 'purple';
    for (let i = snake.length - 1; i >= 0; i -= 1) {
      const from = previous[i] ?? snake[i];
      const to = snake[i];
      const c = from.c + (to.c - from.c) * t;
      const r = from.r + (to.r - from.r) * t;
      const [inset, size, radius] = segmentShape(i);
      roundRect((c - MIN_COL) * PITCH + inset, (r - MIN_ROW) * PITCH + inset, size, size, radius);
      ctx.fill();
    }
  }

  function frame(now) {
    const delta = lastFrame ? Math.min(now - lastFrame, 250) : 0;
    lastFrame = now;
    if (state === 'running') {
      clock += delta;
      sinceTick += delta;
      while (state === 'running' && sinceTick >= tickMs) {
        sinceTick -= tickMs;
        step();
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  function layout() {
    const header = document.querySelector('header');
    const hint = document.getElementById('hint');
    const availWidth = boardEl.clientWidth;
    const availHeight = Math.max(160, window.innerHeight - header.offsetHeight - hint.offsetHeight - 80);
    const w = BOARD_COLS * PITCH;
    const h = BOARD_ROWS * PITCH;
    const flat = Math.min(availWidth / w, availHeight / h);
    const upright = Math.min(availWidth / h, availHeight / w);
    // On a tall, narrow screen the graph stands on its side: weeks run downwards.
    rotated = upright > flat * 1.2;
    scale = rotated ? upright : flat;
    dpr = window.devicePixelRatio || 1;
    const cssW = (rotated ? h : w) * scale;
    const cssH = (rotated ? w : h) * scale;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }

  // ---------- page ----------

  function updateStats() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    lengthEl.textContent = String(snake.length + grow);
  }

  function showStatus() {
    const touch = touchQuery.matches;
    const messages = {
      loading: 'Loading the graph…',
      ready: touch ? 'Swipe to start' : 'Press an arrow key to start',
      running: '',
      paused: touch ? 'Paused. Swipe to go on' : 'Paused. Press Space or an arrow key',
      over: touch ? `Game over: ${score} points. Tap to play again` : `Game over: ${score} points. Press Space to play again`,
      error: 'The graph could not be loaded. Try again later.',
    };
    statusEl.textContent = messages[state];
  }

  function readBest() {
    try {
      return Number(window.localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  function writeBest(value) {
    try {
      window.localStorage.setItem(BEST_KEY, String(value));
    } catch {
      // Private windows may refuse storage; the best score then lasts for the visit.
    }
  }

  // Screen directions map to board directions; a rotated board swaps the axes.
  function fromScreen(d) {
    return rotated ? { c: d.r, r: d.c } : d;
  }

  const KEYS = {
    ArrowLeft: LEFT,
    ArrowRight: RIGHT,
    ArrowUp: UP,
    ArrowDown: DOWN,
    a: LEFT,
    d: RIGHT,
    w: UP,
    s: DOWN,
  };

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const d = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (d) {
      event.preventDefault();
      steer(fromScreen(d));
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      primary();
    } else if (event.key === 'Escape' || event.key === 'p') {
      pause();
    }
  });

  let touchStart = null;
  let swiped = false;
  boardEl.parentElement.addEventListener(
    'touchstart',
    (event) => {
      const t = event.touches[0];
      touchStart = { x: t.clientX, y: t.clientY };
      swiped = false;
    },
    { passive: true },
  );
  boardEl.parentElement.addEventListener(
    'touchmove',
    (event) => {
      if (!touchStart) return;
      event.preventDefault();
      const t = event.touches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : dy > 0 ? DOWN : UP;
      steer(fromScreen(d));
      touchStart = { x: t.clientX, y: t.clientY };
      swiped = true;
    },
    { passive: false },
  );
  boardEl.parentElement.addEventListener('touchend', (event) => {
    if (touchStart && !swiped && !event.target.closest('a')) primary();
    touchStart = null;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  darkQuery.addEventListener('change', draw);
  touchQuery.addEventListener('change', showStatus);
  // The canvas sets the board's height, so only a change of width re-lays it out.
  let observedWidth = 0;
  new ResizeObserver(() => {
    if (boardEl.clientWidth === observedWidth) return;
    observedWidth = boardEl.clientWidth;
    layout();
  }).observe(boardEl);
  window.addEventListener('resize', layout);

  layout();
  updateStats();
  requestAnimationFrame(frame);
  load();
})();
