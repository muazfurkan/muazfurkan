// A playable version of the contribution snake on the profile README.
//
// The board is read from the same SVGs the README shows (dist/, written every
// night by the snake workflow), so the cells, their colours and the newest-day
// highlight always match what the profile shows.

import { createRunner, UNLOCK_SCORE } from './runner.js';
import { createBricks, BRICKS_SCORE } from './bricks.js';
import { createMatch } from './match.js';
import { PLAY, clamp, drawCover } from './cells.js';

(() => {
  const PITCH = 16; // one cell in the SVG, gap included
  const DOT = 12; // the coloured square inside a cell
  const DOT_RADIUS = 2;
  const COLS = 53;
  const ROWS = 7;
  // The board is the graph itself: the snake stays on the cells.
  const MIN_COL = 0;
  const MAX_COL = COLS - 1;
  const MIN_ROW = 0;
  const MAX_ROW = ROWS - 1;
  const START_HEAD = { c: 8, r: 3 }; // left half, middle row, facing right
  const BOARD_COLS = MAX_COL - MIN_COL + 1;
  const BOARD_ROWS = MAX_ROW - MIN_ROW + 1;

  const START_TICK_MS = 130;
  const MIN_TICK_MS = 80;
  const TICK_STEP_MS = 2; // faster with every cell eaten
  const REGROW_DELAY_MS = 6000;
  const REGROW_FADE_MS = 1500;
  const QUEUE_SIZE = 3; // turns typed ahead, one per cell
  // A turn pressed just after the head left a cell still turns at that cell.
  const LATE_TURN = 0.45; // share of a move
  // Meeting a wall or the body is not the end yet: the snake waits this long
  // for a turn, and a turn made in time takes it on at once.
  const GRACE_MS = 220;
  const SETTLE_MS = 140; // the front of the snake eases up against what stopped it
  const RELEASE_MS = 120;
  const BOUNCE_MS = 380;
  const FADE_MS = 650;
  const DEAD_ALPHA = 0.35;
  const STATUS_DELAY_MS = 450;
  const RESTART_GUARD_MS = 700;
  const SWIPE_PX = 18;
  const FLICK_PX = 8;
  // Reaching UNLOCK_SCORE: the snake reels into its head, the lock below
  // breaks, the head rests a moment as one square, then drops into the strip
  // as the runner. Slow enough to follow.
  const CURL_MS = 900;
  const OPEN_DELAY_MS = 400;
  const HOLD_MS = 350;
  const DROP_MS = 950;
  const APPEAR_MS = 400;
  // Reaching BRICKS_SCORE: the runner stops, the wall's lock breaks and the
  // square drops onto the paddle as the ball.
  const LEAVE_OPEN_MS = 150;
  const LEAVE_HOLD_MS = 450;
  // The wall cleared: a beat, then the boards merge into the pitch.
  const FINAL_DELAY_MS = 700;
  const TOUCH_SETTLE_MS = 450; // a tap on a play icon is not also a tap on the game

  // Board sizes, in cells.
  const BRICK_ROWS = 14;
  const PHONE_BRICK_COLS = 22;
  const NARROW_PX = 560; // below this the board being played takes the room
  const MIN_GAP = 24;

  const POINTS = { '--c1': 1, '--c2': 2, '--c3': 3, '--c4': 4, '--hl': 5 };
  // Inset, size and corner radius of the first segments, as snk draws them.
  const SEGMENTS = [
    [0.8, 14.4, 4.5],
    [1.8, 12.3, 4.1],
    [2.6, 10.8, 3.6],
    [3.0, 9.9, 3.3],
  ];
  const MIN_SEGMENT = 8;
  // How far the first segments close up when the head is stopped, in cells,
  // and how much the head flattens against the obstacle.
  const PRESS = [0.07, 0.11, 0.1, 0.08, 0.05, 0.03];
  const SQUASH = 0.14;
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
  const calmQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const runnerBoard = document.getElementById('runner-board');
  const runnerCanvas = document.getElementById('runner-canvas');
  const bricksBoard = document.getElementById('bricks-board');
  const bricksCanvas = document.getElementById('bricks-canvas');
  const gamesEl = document.getElementById('games');
  const finalEl = document.getElementById('final');
  const pitchWrap = document.getElementById('pitch-wrap');
  const pitchCanvas = document.getElementById('pitch');
  const mainEl = document.querySelector('main');
  const headerEl = document.querySelector('header');
  const sections = { snake: boardEl.closest('.game'), runner: runnerBoard.closest('.game'), bricks: bricksBoard.closest('.game') };
  const fx = document.getElementById('fx');
  const fxCtx = fx.getContext('2d');

  let palettes = null; // { light: {...vars}, dark: {...vars} }
  let cells = []; // { col, row, fillVar, points, eatenAt }
  let cellAt = new Map();

  let snake = [];
  let previous = []; // where each segment started its current move
  let dir = RIGHT;
  let queue = [];
  let grow = 0;
  let score = 0;
  let best = readBest();
  let state = 'loading'; // loading | ready | running | paused | unlocking | over | error
  let tickMs = START_TICK_MS;
  let sinceTick = 0;
  let clock = 0; // game time, only advances while running
  let lastFrame = 0;
  let overAt = 0;
  let statusShown = true;

  let undo = null; // the game before the last straight move, for a late turn
  let headFrom = null; // where the head was drawn when a late turn bent its path
  let stalled = false;
  let stallMs = 0; // how long the front has been pressing, for drawing
  let waitMs = 0; // how long the snake has waited for a turn
  let pressVecs = null; // per segment, the way it closes up while stopped
  let release = null; // { level, at } after the snake gets going again

  let rotated = false;
  let scale = 1;
  let dpr = 1;

  let active = 'snake'; // the game that takes the keys: snake | runner | bricks | match
  let unlock = null; // snake to runner: { phase: 'finish' | 'curl' | 'hold', at, opened }
  let leaving = null; // runner to the wall: { at, opened, flying }
  let flight = null; // a square on its way between boards: { at, dur, from, to, land }
  let finalAt = null; // when the boards merge into the pitch
  let appearAt = null; // the snake fades back in after it became the runner
  let narrow = false;
  let cellPx = 16;
  let ignoreTouchUntil = 0;

  // The wall first: the runner reports its score to it from the start.
  const bricks = createBricks({
    canvas: bricksCanvas,
    statusEl: document.getElementById('bricks-status'),
    lockline: document.getElementById('bricks-lockline'),
    bar: document.getElementById('bricks-bar'),
    line: document.getElementById('brickline'),
    scoreEl: document.getElementById('bricks-score'),
    bestEl: document.getElementById('bricks-best'),
    livesEl: document.getElementById('bricks-lives'),
    palette: () => palettes && palette(),
    calm: calmQuery,
    touch: touchQuery,
    onCleared: (now) => {
      finalAt = now + FINAL_DELAY_MS;
    },
  });

  const runner = createRunner({
    board: runnerBoard,
    canvas: runnerCanvas,
    statusEl: document.getElementById('runner-status'),
    lockline: document.getElementById('lockline'),
    bar: document.getElementById('bar'),
    runline: document.getElementById('runline'),
    scoreEl: document.getElementById('run-score'),
    bestEl: document.getElementById('run-best'),
    palette: () => palettes && palette(),
    calm: calmQuery,
    touch: touchQuery,
    onScore: (runScore) => {
      bricks.showProgress(runScore);
      if (runScore >= BRICKS_SCORE && !bricks.isOpen() && runner.state === 'running' && !leaving) beginLeave(performance.now());
    },
  });

  const match = createMatch({
    wrap: pitchWrap,
    canvas: pitchCanvas,
    statusEl: document.getElementById('match-status'),
    hintEl: document.getElementById('match-hint'),
    finale: document.getElementById('finale'),
    artEl: document.getElementById('finale-art'),
    scoreEl: document.getElementById('finale-score'),
    replayEl: document.getElementById('replay'),
    palette: () => palettes && palette(),
    calm: calmQuery,
    touch: touchQuery,
  });

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
      applyPalette();
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

  const same = (a, b) => a.c === b.c && a.r === b.r;
  const opposite = (a, b) => a.c === -b.c && a.r === -b.r;
  const ahead = (body, d) => ({ c: body[0].c + d.c, r: body[0].r + d.r });

  // The way the head last moved, which can differ from `dir` while the snake
  // is stopped after turning into a wall.
  function heading() {
    return { c: snake[0].c - snake[1].c, r: snake[0].r - snake[1].r };
  }

  function blocked(next, body, growing) {
    if (next.c < MIN_COL || next.c > MAX_COL || next.r < MIN_ROW || next.r > MAX_ROW) return true;
    // Unless the snake grows, its tail moves out of the way this same step.
    const end = growing ? body.length : body.length - 1;
    for (let i = 0; i < end; i += 1) if (same(body[i], next)) return true;
    return false;
  }

  function reset() {
    // Four segments, as in the README, with the whole board ahead of the head.
    snake = [0, 1, 2, 3].map((i) => ({ c: START_HEAD.c - i, r: START_HEAD.r }));
    previous = snake.map((p) => ({ ...p }));
    dir = RIGHT;
    queue = [];
    grow = 0;
    score = 0;
    tickMs = START_TICK_MS;
    sinceTick = 0;
    clock = 0;
    undo = null;
    headFrom = null;
    stalled = false;
    stallMs = 0;
    waitMs = 0;
    pressVecs = null;
    release = null;
    for (const cell of cells) cell.eatenAt = null;
    state = 'ready';
    statusShown = true;
    updateStats();
    showStatus();
  }

  function edible(cell) {
    return cell.fillVar && (cell.eatenAt === null || clock - cell.eatenAt >= REGROW_DELAY_MS);
  }

  // Moves the head into `next` and returns what the game was before, so a
  // late turn can take the move back.
  function move(next) {
    const old = snake;
    const before = { snake: old, previous, grow, score, best, tickMs, cell: null, eatenAt: null };
    snake = [next, ...old];
    if (grow > 0) {
      grow -= 1;
      previous = [...old, old[old.length - 1]];
    } else {
      snake.pop();
      previous = old;
    }
    headFrom = null;

    const cell = cellAt.get(key(next.c, next.r));
    if (cell && edible(cell)) {
      before.cell = cell;
      before.eatenAt = cell.eatenAt;
      cell.eatenAt = clock + tickMs; // it empties when the head gets there
      score += cell.points;
      grow += 1;
      tickMs = Math.max(MIN_TICK_MS, tickMs - TICK_STEP_MS);
      if (score > best) {
        best = score;
        writeBest(best);
      }
      if (score >= UNLOCK_SCORE && !runner.isOpen() && state === 'running') beginUnlock();
    }
    updateStats();
    return before;
  }

  function step() {
    const turned = queue.length > 0;
    if (turned) dir = queue.shift();
    const next = ahead(snake, dir);
    if (blocked(next, snake, grow > 0)) {
      stall();
      return;
    }
    const before = move(next);
    undo = turned ? null : before;
  }

  function stall() {
    stalled = true;
    stallMs = 0;
    waitMs = 0;
    sinceTick = 0;
    undo = null;
    headFrom = null;
    release = null;
    previous = snake.map((p) => ({ ...p }));
    pressVecs = PRESS.map((amount, i) => {
      if (i >= snake.length) return null;
      const d = i === 0 ? dir : { c: snake[i - 1].c - snake[i].c, r: snake[i - 1].r - snake[i].r };
      return { c: d.c * amount, r: d.r * amount };
    });
  }

  // While stopped, the first free turn in the queue gets the snake going again.
  function escape() {
    while (queue.length) {
      const d = queue.shift();
      const next = ahead(snake, d);
      if (blocked(next, snake, grow > 0)) continue;
      release = { level: pressLevel(performance.now()), at: clock };
      stalled = false;
      sinceTick = 0;
      dir = d;
      move(next);
      undo = null;
      return;
    }
  }

  // The head left its cell a moment ago: take that move back and turn there.
  function lateTurn(d) {
    if (!undo || stalled || queue.length || sinceTick > tickMs * LATE_TURN) return false;
    const base = undo.snake;
    const next = ahead(base, d);
    if (blocked(next, base, undo.grow > 0)) return false;

    const drawn = segmentPos(0, moveT());
    snake = base;
    previous = undo.previous;
    grow = undo.grow;
    score = undo.score;
    tickMs = undo.tickMs;
    if (undo.cell) undo.cell.eatenAt = undo.eatenAt;
    if (best !== undo.best) {
      best = undo.best;
      writeBest(best);
    }
    dir = d;
    move(next);
    undo = null;
    // From where it is drawn now, the head cuts the corner to its new cell.
    headFrom = { c: drawn.c, r: drawn.r, t: moveT() };
    return true;
  }

  // ---------- opening the boards below ----------

  // The snake reached UNLOCK_SCORE.
  function beginUnlock() {
    state = 'unlocking';
    queue = [];
    unlock = { phase: 'finish', at: performance.now() };
    showStatus();
  }

  function advanceUnlock(now, delta) {
    if (unlock.phase === 'finish') {
      // Let the current move end before the snake reels in.
      sinceTick = Math.min(tickMs, sinceTick + delta);
      if (sinceTick >= tickMs) unlock = { phase: 'curl', at: now, opened: false };
      return;
    }
    if (unlock.phase === 'curl') {
      if (!unlock.opened && now - unlock.at >= OPEN_DELAY_MS) {
        runner.openUp(now);
        unlock.opened = true;
      }
      if (now - unlock.at < CURL_MS) return;
      if (calmQuery.matches) finishUnlock(now);
      else unlock = { phase: 'hold', at: now, opened: true };
      return;
    }
    if (unlock.phase === 'hold' && now - unlock.at >= HOLD_MS) {
      const from = headRect();
      unlock = { phase: 'drop', at: now, opened: true };
      setActive('runner');
      fly(from, runner.dropTarget(), now, finishUnlock);
    }
  }

  function finishUnlock(now) {
    unlock = null;
    runner.arrive(now);
    reset();
    appearAt = now;
    setActive('runner');
  }

  // The runner reached BRICKS_SCORE.
  function beginLeave(now) {
    runner.leave(now);
    leaving = { at: now, opened: false, flying: false };
  }

  function advanceLeave(now) {
    if (!leaving.opened && now - leaving.at >= LEAVE_OPEN_MS) {
      bricks.openUp(now);
      leaving.opened = true;
    }
    if (leaving.flying || now - leaving.at < LEAVE_HOLD_MS) return;
    const from = runner.squareRect();
    runner.hideSquare();
    leaving.flying = true;
    setActive('bricks');
    const land = (t) => {
      bricks.arrive(t);
      runner.finishLeave();
      leaving = null;
    };
    if (calmQuery.matches) land(now);
    else fly(from, bricks.dropTarget(), now, land);
  }

  // The wall is cleared: the three boards become one pitch.
  function startFinal(now) {
    const rects = [canvas, runnerCanvas, bricksCanvas].map((c) => c.getBoundingClientRect());
    const ball = bricks.ballRect();
    pauseGame(active);
    active = 'match';
    runner.setActive(false);
    bricks.setActive(false);
    showStatus();
    gamesEl.classList.add('merged');
    finalEl.hidden = false;
    match.layout(cellPx, dpr);
    match.start(rects, ball, now);
  }

  // A square crossing from one board to another, drawn above the page.
  function fly(from, to, now, land) {
    fx.width = Math.round(window.innerWidth * dpr);
    fx.height = Math.round(window.innerHeight * dpr);
    fx.hidden = false;
    flight = { at: now, dur: DROP_MS, from, to, land };
  }

  // Where the head is drawn, in page pixels.
  function headRect() {
    const rect = canvas.getBoundingClientRect();
    let bx = (snake[0].c - MIN_COL + 0.5) * PITCH;
    let by = (snake[0].r - MIN_ROW + 0.5) * PITCH;
    if (rotated) [bx, by] = [by, bx];
    return { x: rect.left + bx * scale, y: rect.top + by * scale, size: SEGMENTS[0][1] * scale };
  }

  // Segment i reeled toward the head along the body, p from 0 to 1.
  function curlPos(i, p) {
    const d = i * p;
    const k = Math.floor(d);
    const a = snake[i - k];
    const b = snake[Math.max(0, i - k - 1)];
    return { c: a.c + (b.c - a.c) * (d - k), r: a.r + (b.r - a.r) * (d - k) };
  }

  function drawFx(now) {
    if (!flight || !palettes) return;
    const { from, to } = flight;
    const p = Math.min(1, (now - flight.at) / flight.dur);
    const along = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
    // A small hop, then down the way things fall.
    const cx = from.x + (to.x - from.x) * along;
    const cy = from.y + (to.y - from.y) * p * p - 4 * p * (1 - p) * Math.max(to.size, from.size);
    const size = from.size + (to.size - from.size) * p;
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxCtx.clearRect(0, 0, fx.width, fx.height);
    fxCtx.fillStyle = palette()['--cs'] ?? 'purple';
    const r = Math.min(size / 2, 4.5 * scale);
    const x = cx - size / 2;
    const y = cy - size / 2;
    fxCtx.beginPath();
    fxCtx.moveTo(x + r, y);
    fxCtx.arcTo(x + size, y, x + size, y + size, r);
    fxCtx.arcTo(x + size, y + size, x, y + size, r);
    fxCtx.arcTo(x, y + size, x, y, r);
    fxCtx.arcTo(x, y, x + size, y, r);
    fxCtx.closePath();
    fxCtx.fill();
  }

  function gameOver() {
    state = 'over';
    overAt = performance.now();
    statusShown = false;
    queue = [];
    statusEl.textContent = '';
  }

  function start() {
    if (state !== 'ready' && state !== 'paused') return;
    const fresh = state === 'ready';
    state = 'running';
    showStatus();
    if (fresh) {
      // Move on the key press itself instead of one tick later.
      sinceTick = 0;
      step();
    } else if (stalled) {
      // A full wait again after a pause, so there is time to look and turn.
      waitMs = 0;
      if (queue.length) escape();
    }
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    showStatus();
  }

  function steer(d) {
    if (state === 'loading' || state === 'error' || state === 'over' || state === 'unlocking') return;
    const lastDir = queue.length ? queue[queue.length - 1] : dir;
    const lastMove = queue.length ? queue[queue.length - 1] : heading();
    const wanted = !opposite(d, lastMove) && !same(d, lastDir); // never back into the body
    if (state === 'ready' || state === 'paused') {
      if (wanted && queue.length < QUEUE_SIZE) queue.push(d);
      start();
      return;
    }
    if (!wanted) return;
    if (stalled) {
      queue.push(d);
      escape();
      return;
    }
    if (lateTurn(d)) return;
    if (queue.length < QUEUE_SIZE) queue.push(d);
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

  // The progress squares under the lock fill in the graph's own green.
  function applyPalette() {
    if (!palettes) return;
    document.documentElement.style.setProperty('--cell-on', palette()['--c4']);
    document.documentElement.style.setProperty('--icon', palette()['--cs']);
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
    if (since < 0) return color; // the head is still on its way
    if (since < REGROW_DELAY_MS) return empty;
    if (since < REGROW_DELAY_MS + REGROW_FADE_MS) {
      return mix(empty, color, (since - REGROW_DELAY_MS) / REGROW_FADE_MS);
    }
    return color;
  }

  function roundRect(x, y, w, h, r) {
    // Board coordinates; rotation swaps the axes.
    if (rotated) [x, y, w, h] = [y, x, h, w];
    r = Math.min(r, w / 2, h / 2);
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

  const easeOut = (x) => 1 - (1 - x) ** 3;

  // How far the current move has got, from 0 to 1.
  function moveT() {
    if (stalled || (state !== 'running' && state !== 'paused' && state !== 'unlocking')) return 1;
    return Math.min(1, sinceTick / tickMs);
  }

  function segmentPos(i, t) {
    const to = snake[i];
    let from = previous[i] ?? to;
    let u = t;
    if (i === 0 && headFrom) {
      from = headFrom;
      u = headFrom.t >= 1 ? 1 : Math.max(0, (t - headFrom.t) / (1 - headFrom.t));
    }
    return { c: from.c + (to.c - from.c) * u, r: from.r + (to.r - from.r) * u };
  }

  // How closed up the front of the snake is: 1 pressed against the obstacle,
  // 0 at rest, below 0 for a moment as it springs back on the way out.
  function pressLevel(now) {
    if (!pressVecs || calmQuery.matches) return 0;
    if (state === 'over') {
      const p = Math.min(1, (now - overAt) / BOUNCE_MS);
      return (1 - p) ** 2 * Math.cos(p * Math.PI * 2.5);
    }
    if (stalled) return easeOut(Math.min(1, stallMs / SETTLE_MS));
    if (release) {
      const p = Math.min(1, (clock - release.at) / RELEASE_MS);
      if (p >= 1) release = null;
      return release ? release.level * (1 - easeOut(p)) : 0;
    }
    return 0;
  }

  function draw() {
    const now = performance.now();
    const width = canvas.width;
    const height = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!palettes) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

    const pal = palette();
    // Not the game being played, or paused: the faint grid and a play icon.
    if (snakeCovered()) {
      drawCover(ctx, pal, rotated ? BOARD_ROWS : BOARD_COLS, rotated ? BOARD_COLS : BOARD_ROWS, PLAY);
      return;
    }
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

    // While the head drops into the strip below, the board is empty.
    if (unlock?.phase === 'drop') return;
    const t = moveT();
    const level = pressLevel(now);
    let curl = 0;
    let alpha = 1;
    let pulse = 1;
    if (unlock?.phase === 'curl') {
      const p = Math.min(1, (now - unlock.at) / CURL_MS);
      if (calmQuery.matches) alpha = 1 - p;
      else curl = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
    } else if (unlock?.phase === 'hold') {
      // One square now: it swells a little, as if taking a breath.
      curl = 1;
      pulse = 1 + 0.18 * Math.sin(Math.PI * Math.min(1, (now - unlock.at) / HOLD_MS));
    }
    if (state === 'over') {
      const p = Math.min(1, (now - overAt) / FADE_MS);
      alpha = 1 - (1 - DEAD_ALPHA) * easeOut(p);
    }
    if (appearAt !== null) {
      const p = (now - appearAt) / APPEAR_MS;
      if (p >= 1) appearAt = null;
      else alpha *= p;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal['--cs'] ?? 'purple';
    for (let i = snake.length - 1; i >= 0; i -= 1) {
      const pos = curl ? curlPos(i, curl) : segmentPos(i, t);
      const [inset, size, radius] = segmentShape(i);
      let w = i === 0 ? size * pulse : size;
      let h = i === 0 ? size * pulse : size;
      const push = level && pressVecs?.[i];
      if (push) {
        pos.c += push.c * level;
        pos.r += push.r * level;
        if (i === 0) {
          // The head flattens along the way it pushes and widens across it.
          const along = 1 - SQUASH * level;
          const across = 1 + SQUASH * 0.5 * level;
          if (push.c) [w, h] = [size * along, size * across];
          else [w, h] = [size * across, size * along];
        }
      }
      const x = (pos.c - MIN_COL) * PITCH + inset + (size - w) / 2;
      const y = (pos.r - MIN_ROW) * PITCH + inset + (size - h) / 2;
      roundRect(x, y, w, h, radius);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function snakeCovered() {
    return active !== 'snake' || state === 'paused';
  }

  function frame(now) {
    const delta = lastFrame ? Math.min(now - lastFrame, 250) : 0;
    lastFrame = now;
    if (state === 'running') {
      clock += delta;
      if (stalled) {
        stallMs += delta;
        waitMs += delta;
        if (queue.length) escape();
        if (stalled && waitMs >= GRACE_MS) gameOver();
      } else {
        sinceTick += delta;
        while (state === 'running' && !stalled && sinceTick >= tickMs) {
          sinceTick -= tickMs;
          step();
        }
      }
    }
    if (state === 'unlocking' && unlock && unlock.phase !== 'drop') advanceUnlock(now, delta);
    if (leaving) advanceLeave(now);
    if (flight && now - flight.at >= flight.dur) {
      const { land } = flight;
      flight = null;
      fx.hidden = true;
      land(now);
    }
    if (finalAt !== null && now >= finalAt) {
      finalAt = null;
      startFinal(now);
    }
    if (state === 'over' && !statusShown && now - overAt >= STATUS_DELAY_MS) {
      statusShown = true;
      showStatus();
    }
    runner.update(delta, now);
    bricks.update(delta, now);
    match.update(delta, now);
    if (match.isOn()) {
      match.draw(now);
    } else {
      draw();
      runner.draw(now);
      bricks.draw(now);
    }
    drawFx(now);
    requestAnimationFrame(frame);
  }

  // Everything on the page but the boards, which share what is left.
  function chromeHeight() {
    const style = getComputedStyle(mainEl);
    let h = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    h += headerEl.offsetHeight + parseFloat(getComputedStyle(headerEl).marginBottom);
    for (const section of Object.values(sections)) {
      h += section.offsetHeight - section.querySelector('.board').offsetHeight;
    }
    return h + 2 * MIN_GAP;
  }

  function setSnakeCanvas(cssW, cssH) {
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }

  function layout() {
    const availWidth = gamesEl.clientWidth;
    dpr = window.devicePixelRatio || 1;
    narrow = availWidth < NARROW_PX;
    // On a phone the board being played takes the room; the others shrink to a row.
    for (const [name, section] of Object.entries(sections)) {
      section.classList.toggle('compact', narrow && name !== active);
    }
    const availHeight = Math.max(320, window.innerHeight - chromeHeight());
    const w = BOARD_COLS * PITCH;
    const h = BOARD_ROWS * PITCH;
    const strip = ROWS * PITCH;
    const wall = BRICK_ROWS * PITCH;

    if (!narrow) {
      rotated = false;
      scale = Math.min(availWidth / w, availHeight / (h + strip + wall));
      setSnakeCanvas(w * scale, h * scale);
      runner.layout(w * scale, strip * scale, scale, dpr);
      bricks.layout(w * scale, wall * scale, scale, dpr, BOARD_COLS, BRICK_ROWS);
      cellPx = PITCH * scale;
    } else {
      const small = availWidth / w; // a whole row of the graph across
      const rowH = h * small;
      const room = Math.max(200, availHeight - 2 * rowH);
      if (active === 'snake') {
        // Standing on its side, weeks running downwards.
        rotated = true;
        scale = Math.min(availWidth / h, room / w);
        setSnakeCanvas(h * scale, w * scale);
      } else {
        rotated = false;
        scale = small;
        setSnakeCanvas(w * small, rowH);
      }
      if (active === 'runner') {
        const s = Math.min(room / strip, availWidth / (PHONE_BRICK_COLS * PITCH));
        runner.layout(availWidth, strip * s, s, dpr);
      } else {
        runner.layout(w * small, rowH, small, dpr);
      }
      const bs = availWidth / (PHONE_BRICK_COLS * PITCH);
      const bRows = clamp(Math.floor(room / (PITCH * bs)), 16, 34);
      if (active === 'bricks') bricks.layout(availWidth, bRows * PITCH * bs, bs, dpr, PHONE_BRICK_COLS, bRows);
      else bricks.layout(w * small, rowH, small, dpr, PHONE_BRICK_COLS, bRows);
      cellPx = clamp(availWidth / 26, 11, 18);
    }
    if (match.isOn()) match.layout(cellPx, dpr);
  }

  // ---------- page ----------

  function updateStats() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    lengthEl.textContent = String(snake.length + grow);
    runner.showProgress(score);
  }

  function showStatus() {
    const touch = touchQuery.matches;
    const messages = {
      loading: 'Loading the graph…',
      ready: touch ? 'Swipe to start' : 'Press an arrow key to start',
      running: '',
      unlocking: '',
      paused: '',
      over: `Game over: ${score} points. ${touch ? 'Tap' : 'Press Space'} to play again`,
      error: 'The graph could not be loaded. Try again later.',
    };
    // A board under its play icon says nothing.
    const quiet = (active !== 'snake' && state !== 'loading' && state !== 'error') || (state === 'over' && !statusShown);
    statusEl.textContent = quiet ? '' : messages[state];
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

  // ---------- which game has the keys ----------

  const GAMES = ['snake', 'runner', 'bricks'];

  function isOpen(name) {
    if (name === 'snake') return true;
    if (name === 'runner') return runner.isOpen();
    if (name === 'bricks') return bricks.isOpen();
    return match.isOn();
  }

  function covered(name) {
    if (name === 'snake') return snakeCovered();
    if (name === 'runner') return runner.covered();
    if (name === 'bricks') return bricks.covered();
    return match.state === 'paused';
  }

  function pauseGame(name) {
    if (name === 'snake') pause();
    else if (name === 'runner') runner.pause();
    else if (name === 'bricks') bricks.pause();
    else match.pause();
  }

  function resumeGame(name, now) {
    if (name === 'snake') {
      if (state === 'paused') start();
    } else if (name === 'runner') runner.resume();
    else if (name === 'bricks') bricks.resume();
    else match.resume(now);
  }

  // A board changes hands mid-way only between its own moves.
  const switching = () => unlock !== null || leaving !== null || flight !== null || finalAt !== null || match.isOn();

  function setActive(name) {
    if (name === active) return;
    // The board left behind pauses and shows its play icon.
    pauseGame(active);
    active = name;
    runner.setActive(name === 'runner');
    bricks.setActive(name === 'bricks');
    showStatus();
    if (narrow) layout();
  }

  // A play icon pressed, or its number typed: go on with that game.
  function continueGame(name, now) {
    setActive(name);
    resumeGame(name, now);
    ignoreTouchUntil = now + TOUCH_SETTLE_MS;
  }

  function togglePause(now, onlyPause) {
    if (covered(active) && active !== 'match' && !onlyPause) resumeGame(active, now);
    else if (active === 'match' && match.state === 'paused') {
      if (!onlyPause) match.resume(now);
    } else pauseGame(active);
  }

  function lockedAt(el) {
    if (el === runnerBoard && !runner.isOpen()) return runner;
    if (el === bricksBoard && !bricks.isOpen()) return bricks;
    return null;
  }

  const JUMP_KEYS = new Set([' ', 'ArrowUp', 'w']);
  const GAME_KEYS = new Set([' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']);

  function keyName(event) {
    return event.key.length === 1 ? event.key.toLowerCase() : event.key;
  }

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Enter on the link back to the profile, or on a button, does what it says.
    if (event.key === 'Enter' && event.target.closest?.('a, button')) return;
    const name = keyName(event);
    const now = performance.now();
    if (name === 'p' || name === 'Escape') {
      event.preventDefault();
      if (!event.repeat) togglePause(now, name === 'Escape');
      return;
    }
    if (name === '1' || name === '2' || name === '3') {
      const game = GAMES[Number(name) - 1];
      if (isOpen(game) && !switching()) continueGame(game, now);
      return;
    }
    // A key on a locked board only shakes its lock.
    const locked = lockedAt(document.activeElement);
    if (locked && GAME_KEYS.has(name)) {
      event.preventDefault();
      locked.nudge(now);
      return;
    }
    if (active === 'match') {
      if (match.keydown(name, now)) event.preventDefault();
      return;
    }
    if (active === 'bricks') {
      if (GAME_KEYS.has(name)) event.preventDefault();
      if (!event.repeat) bricks.keydown(name, now);
      return;
    }
    if (active === 'runner') {
      if (JUMP_KEYS.has(name) || name === 'Enter') {
        event.preventDefault();
        if (event.repeat) return;
        if (name === 'Enter') runner.primary(now);
        else runner.press(now);
      } else if (GAME_KEYS.has(name)) {
        event.preventDefault();
      }
      return;
    }
    const d = KEYS[name];
    if (d) {
      event.preventDefault();
      // A held key repeats; only the first press is a turn.
      if (!event.repeat) steer(fromScreen(d));
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      // Holding Space would otherwise pause and resume over and over.
      if (!event.repeat) primary();
    }
  });

  window.addEventListener('keyup', (event) => {
    const name = keyName(event);
    if (active === 'runner' && JUMP_KEYS.has(name)) runner.release();
    else if (active === 'bricks') bricks.keyup(name);
    else if (active === 'match') match.keyup(name);
  });

  function local(event, el) {
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function capture(el, event) {
    try {
      // Letting go off the board still counts as letting go.
      el.setPointerCapture(event.pointerId);
    } catch {
      // Nothing to hold on to; pointerup on the board does the same.
    }
  }

  // A press on a board: the lock shakes, a play icon goes on with its game,
  // otherwise the game takes it.
  function boardDown(name, event) {
    if (event.button > 0) return false;
    const now = performance.now();
    if (!isOpen(name)) {
      (name === 'runner' ? runner : bricks).nudge(now);
      return false;
    }
    if (switching()) return false;
    if (covered(name)) {
      event.preventDefault();
      continueGame(name, now);
      return false;
    }
    return true;
  }

  boardEl.addEventListener('pointerdown', (event) => boardDown('snake', event));

  // The strip: a press is a jump, and letting go early keeps it low.
  runnerBoard.addEventListener('pointerdown', (event) => {
    if (!boardDown('runner', event) || active !== 'runner') return;
    capture(runnerBoard, event);
    runner.press(performance.now());
  });
  for (const type of ['pointerup', 'pointercancel']) runnerBoard.addEventListener(type, () => runner.release());

  // The wall: a finger or the mouse leads the paddle; a tap launches.
  bricksBoard.addEventListener('pointerdown', (event) => {
    if (!boardDown('bricks', event) || active !== 'bricks') return;
    capture(bricksBoard, event);
    const p = local(event, bricksCanvas);
    bricks.pointer('down', p.x, p.y, performance.now(), true);
  });
  bricksBoard.addEventListener('pointermove', (event) => {
    if (active !== 'bricks' || bricks.covered()) return;
    const p = local(event, bricksCanvas);
    bricks.pointer('move', p.x, p.y, performance.now(), event.buttons > 0);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    bricksBoard.addEventListener(type, (event) => {
      if (active !== 'bricks') return;
      const p = local(event, bricksCanvas);
      bricks.pointer('up', p.x, p.y, performance.now(), false);
    });
  }

  // The pitch: hold and drag to lead our square.
  pitchWrap.addEventListener('pointerdown', (event) => {
    if (event.button > 0 || event.target.closest('button')) return;
    if (match.state === 'paused') {
      match.resume(performance.now());
      return;
    }
    capture(pitchWrap, event);
    const p = local(event, pitchCanvas);
    match.pointer('down', p.x, p.y);
  });
  pitchWrap.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse' && !event.buttons) return;
    const p = local(event, pitchCanvas);
    match.pointer('move', p.x, p.y);
  });
  for (const type of ['pointerup', 'pointercancel']) pitchWrap.addEventListener(type, () => match.pointer('up'));

  for (const [name, board] of [['snake', boardEl], ['runner', runnerBoard], ['bricks', bricksBoard]]) {
    // Tabbing to a board hands it the keys; Space or Enter then goes on.
    board.addEventListener('focus', () => {
      if (isOpen(name) && !switching()) setActive(name);
    });
  }

  const inOtherBoard = (event) => runnerBoard.contains(event.target) || bricksBoard.contains(event.target);

  let touchStart = null;
  let swiped = false;
  mainEl.addEventListener(
    'touchstart',
    (event) => {
      touchStart = null;
      if (active !== 'snake' || snakeCovered() || inOtherBoard(event) || state === 'unlocking') return;
      if (performance.now() < ignoreTouchUntil) return;
      const t = event.touches[0];
      touchStart = { x: t.clientX, y: t.clientY };
      swiped = false;
    },
    { passive: true },
  );

  function swipeDir(dx, dy) {
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : dy > 0 ? DOWN : UP;
  }

  mainEl.addEventListener(
    'touchmove',
    (event) => {
      if (!touchStart) return;
      event.preventDefault();
      const t = event.touches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      steer(fromScreen(swipeDir(dx, dy)));
      touchStart = { x: t.clientX, y: t.clientY };
      swiped = true;
    },
    { passive: false },
  );
  mainEl.addEventListener('touchend', (event) => {
    if (touchStart && !swiped && !event.target.closest('a')) {
      // A quick, short flick still steers; only a still finger is a tap.
      const t = event.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= FLICK_PX) steer(fromScreen(swipeDir(dx, dy)));
      else primary();
    }
    touchStart = null;
  });

  // Leaving the tab or the window pauses, so nothing runs on unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame(active);
  });
  window.addEventListener('blur', () => pauseGame(active));
  darkQuery.addEventListener('change', applyPalette);
  touchQuery.addEventListener('change', () => {
    showStatus();
    runner.showStatus();
    bricks.showStatus();
    match.showStatus();
  });
  // The canvases set the boards' heights, so only a change of width re-lays them out.
  let observedWidth = 0;
  new ResizeObserver(() => {
    if (gamesEl.clientWidth === observedWidth) return;
    observedWidth = gamesEl.clientWidth;
    layout();
  }).observe(gamesEl);
  window.addEventListener('resize', layout);

  layout();
  updateStats();
  requestAnimationFrame(frame);
  load();
})();
