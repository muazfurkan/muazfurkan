// The third board: a paddle, the purple ball and a wall of graph cells laid
// out at random each time. Some cells drop a gift when they break: ×2 splits
// every ball, +3 adds three balls, ↔ widens the paddle for a while. Clearing
// the wall merges the boards into one pitch for the final match.

import {
  PITCH,
  DOT,
  DOT_RADIUS,
  INSET,
  DIM,
  LOCK,
  PLAY,
  easeOut,
  lerp,
  clamp,
  roundRect,
  read,
  write,
  teamColors,
  drawGrid,
  drawCover,
  iconCenter,
  shardsOf,
  drawShards,
} from './cells.js';

export const BRICKS_SCORE = 500; // a runner run this long opens the wall

// Feel, in cells and seconds.
const BALL_R = 0.38;
const START_SPEED = 12;
const MAX_SPEED = 19;
const SPEED_UP = 1.012; // with every cell broken
const PADDLE_SPEED = 26;
const PADDLE_H = 0.55;
const MAX_ANGLE = (62 * Math.PI) / 180; // off the paddle's ends
const LIVES = 3;
const MAX_BALLS = 16;
const WIDE = 1.6; // how much ↔ widens the paddle
const WIDE_S = 15;
const GIFT_SPEED = 5;
const GIFT_CHANCE = 0.08; // orange cells always drop one
const ORANGE = 0.26; // share of the wall that is orange
const GIFTS = [
  ['split', 0.4],
  ['more', 0.3],
  ['wide', 0.3],
];
const GIFT_LABEL = { split: '×2', more: '+3', wide: '↔' };

// Drawing, in milliseconds.
const LOST_MS = 700;
const POP_MS = 220;
const OPEN_MS = 1100;
const SHATTER_MS = 1100;
const LAND_MS = 200;
const WIGGLE_MS = 380;
const FADE_MS = 650;
const STATUS_DELAY_MS = 450;
const RESTART_GUARD_MS = 700;
const APPEAR_MS = 300;
const CATCH_MS = 260;

const BEST_KEY = 'contribution-bricks-best';
const POINTS = { '--c1': 1, '--c2': 2, '--c3': 3, '--c4': 4, '--hl': 5 };
const SHADES = ['--c1', '--c2', '--c3', '--c4'];
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

export function createBricks({ canvas, statusEl, lockline, bar, line, scoreEl, bestEl, livesEl, palette, calm, touch, onCleared }) {
  const ctx = canvas.getContext('2d');

  // locked | arriving | ready | running | paused | lost | over | cleared
  let state = 'locked';
  let open = false;
  let active = false;
  let greeting = false;

  let scale = 1;
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let cols = 53; // the board being played, in cells
  let rows = 14;
  let wantCols = 53;
  let wantRows = 14;

  let bricks = new Map(); // "c,r" -> { c, r, fill, gift }
  let popping = []; // broken cells on their way out
  let gifts = []; // { x, y, kind } falling toward the paddle
  const paddle = { x: 26.5, w: 6, base: 6, vx: 0 };
  let balls = []; // { x, y, vx, vy }
  let speed = START_SPEED;
  let wideLeft = 0; // seconds of ↔ left
  let lives = LIVES;
  let score = 0;
  let best = Number(read(BEST_KEY)) || 0;
  let keys = { left: false, right: false };
  let aim = null; // where a finger or the mouse wants the paddle, in cells
  let down = null; // { x, y, at } of a press, to tell a tap from a drag

  let lostAt = 0;
  let overAt = 0;
  let statusShown = true;
  let openAt = null;
  let shards = [];
  let wiggleAt = null;
  let landAt = null;
  let appearAt = null;
  let caughtAt = null;
  let filled = -1;
  let shown = { score: -1, best: -1, lives: -1 };

  // ---------- the board ----------

  const key = (c, r) => `${c},${r}`;
  const paddleTop = () => rows - 1 + (1 - PADDLE_H) / 2;

  function pickGift() {
    let pick = Math.random();
    for (const [kind, share] of GIFTS) {
      pick -= share;
      if (pick < 0) return kind;
    }
    return GIFTS[0][0];
  }

  function add(c, r, fill) {
    if (c < 1 || c > cols - 2) return;
    const gift = fill === '--hl' || Math.random() < GIFT_CHANCE ? pickGift() : null;
    bricks.set(key(c, r), { c, r, fill, gift });
  }

  // A new wall each time, mirrored so it reads as a pattern, not noise, and
  // light enough to clear in a few minutes.
  function generate() {
    bricks = new Map();
    const wallRows = clamp(Math.round(rows * 0.3), 3, 6);
    const half = Math.floor((cols - 2) / 2);
    const middle = cols % 2 === 1 ? Math.floor(cols / 2) : null;
    const target = clamp(cols - 6, 30, 46);
    const density = clamp(target / (wallRows * (cols - 2)), 0.2, 0.6);
    for (let r = 1; r <= wallRows; r += 1) {
      const rowDensity = clamp(density + (Math.random() - 0.5) * 0.12, 0.1, 0.8);
      const depth = (wallRows - r) / Math.max(1, wallRows - 1); // 1 at the top
      const shade = SHADES[clamp(Math.floor(depth * 3.2 + Math.random() * 1.2), 0, 3)];
      for (let i = 0; i < half; i += 1) {
        if (Math.random() >= rowDensity) continue;
        const fill = Math.random() < ORANGE ? '--hl' : shade;
        add(1 + i, r, fill);
        add(cols - 2 - i, r, fill);
      }
      if (middle !== null && Math.random() < rowDensity) add(middle, r, shade);
    }
    // Never a wall too thin to be worth playing, nor one that takes too long.
    for (let guard = 0; bricks.size < target * 0.8 && guard < 500; guard += 1) {
      const r = 1 + Math.floor(Math.random() * wallRows);
      const i = Math.floor(Math.random() * half);
      add(1 + i, r, '--c2');
      add(cols - 2 - i, r, '--c2');
    }
    for (let guard = 0; bricks.size > target * 1.15 && guard < 500; guard += 1) {
      const [any] = [...bricks.values()].slice(Math.floor(Math.random() * bricks.size));
      bricks.delete(key(any.c, any.r));
      bricks.delete(key(cols - 1 - any.c, any.r));
    }
  }

  function ballOnPaddle() {
    return { x: paddle.x, y: paddleTop() - BALL_R, vx: 0, vy: 0 };
  }

  function resetBoard() {
    cols = wantCols;
    rows = wantRows;
    paddle.base = Math.max(4, Math.round(cols * 0.12));
    paddle.w = paddle.base;
    paddle.x = cols / 2;
    paddle.vx = 0;
    speed = START_SPEED;
    wideLeft = 0;
    lives = LIVES;
    score = 0;
    popping = [];
    gifts = [];
    keys = { left: false, right: false };
    aim = null;
    generate();
    balls = [ballOnPaddle()];
    statusShown = true;
    updateStats();
  }

  // ---------- play ----------

  function aimBall(ball, angle) {
    ball.vx = speed * Math.sin(angle);
    ball.vy = -speed * Math.cos(angle);
  }

  // Keeps the speed, and never lets a ball run nearly flat.
  function renormalize(ball) {
    const len = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / len) * speed;
    ball.vy = (ball.vy / len) * speed;
    const least = speed * 0.3;
    if (Math.abs(ball.vy) < least) {
      ball.vy = Math.sign(ball.vy || -1) * least;
      ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(speed ** 2 - least ** 2);
    }
  }

  function launch() {
    state = 'running';
    greeting = false;
    for (const ball of balls) aimBall(ball, ((Math.random() - 0.5) * 50 * Math.PI) / 180);
    showStatus();
  }

  function hit(c, r, now) {
    const brick = bricks.get(key(c, r));
    if (!brick) return false;
    bricks.delete(key(c, r));
    popping.push({ ...brick, at: now });
    if (brick.gift) gifts.push({ x: c + 0.5, y: r + 0.5, kind: brick.gift });
    score += POINTS[brick.fill] ?? 1;
    speed = Math.min(MAX_SPEED, speed * SPEED_UP);
    updateStats();
    if (bricks.size === 0) {
      state = 'cleared';
      gifts = [];
      saveBest();
      showStatus();
      onCleared?.(now);
    }
    return true;
  }

  function catchGift(kind, now) {
    caughtAt = now;
    if (kind === 'wide') {
      wideLeft = WIDE_S;
      return;
    }
    if (kind === 'split') {
      // Every ball turns into two, a little apart.
      for (const ball of [...balls]) {
        if (balls.length >= MAX_BALLS) break;
        const a = Math.atan2(ball.vx, -ball.vy) + 0.45;
        const twin = { x: ball.x, y: ball.y, vx: 0, vy: 0 };
        aimBall(twin, a);
        balls.push(twin);
      }
      return;
    }
    // Three more from the paddle, fanned out.
    for (const a of [-0.5, 0, 0.5]) {
      if (balls.length >= MAX_BALLS) break;
      const ball = ballOnPaddle();
      aimBall(ball, a);
      balls.push(ball);
    }
  }

  function lose(now) {
    state = 'lost';
    lostAt = now;
    lives -= 1;
    gifts = [];
    wideLeft = 0;
    updateStats();
  }

  function moveBall(ball, h, now) {
    let nx = ball.x + ball.vx * h;
    let ny = ball.y + ball.vy * h;
    // One axis at a time, so a corner turns the ball the right way.
    if (hit(Math.floor(nx + Math.sign(ball.vx) * BALL_R), Math.floor(ball.y), now)) {
      ball.vx = -ball.vx;
      nx = ball.x;
      renormalize(ball);
    }
    if (state === 'running' && hit(Math.floor(nx), Math.floor(ny + Math.sign(ball.vy) * BALL_R), now)) {
      ball.vy = -ball.vy;
      ny = ball.y;
      renormalize(ball);
    }
    if (nx < BALL_R) {
      nx = BALL_R;
      ball.vx = Math.abs(ball.vx);
    } else if (nx > cols - BALL_R) {
      nx = cols - BALL_R;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ny < BALL_R) {
      ny = BALL_R;
      ball.vy = Math.abs(ball.vy);
    }
    const top = paddleTop();
    if (ball.vy > 0 && ball.y + BALL_R <= top + 0.05 && ny + BALL_R >= top && Math.abs(nx - paddle.x) <= paddle.w / 2 + BALL_R) {
      // Where it lands on the paddle sets the angle; the paddle's swing adds a little.
      const offset = clamp((nx - paddle.x) / (paddle.w / 2), -1, 1);
      aimBall(ball, offset * MAX_ANGLE);
      ball.vx += paddle.vx * 0.12;
      renormalize(ball);
      ny = top - BALL_R;
      landAt = now;
    }
    ball.x = nx;
    ball.y = ny;
  }

  function step(h, now) {
    // The paddle eases to its width, and back once ↔ runs out.
    wideLeft = Math.max(0, wideLeft - (state === 'running' ? h : 0));
    const width = wideLeft > 0 ? paddle.base * WIDE : paddle.base;
    paddle.w += (width - paddle.w) * (1 - Math.exp(-h / 0.12));

    let target = 0;
    if (keys.left !== keys.right) target = keys.left ? -PADDLE_SPEED : PADDLE_SPEED;
    else if (aim !== null) target = clamp((aim - paddle.x) * 16, -PADDLE_SPEED * 1.6, PADDLE_SPEED * 1.6);
    paddle.vx += (target - paddle.vx) * (1 - Math.exp(-h / 0.04));
    const x = clamp(paddle.x + paddle.vx * h, paddle.w / 2, cols - paddle.w / 2);
    if (x !== paddle.x + paddle.vx * h) paddle.vx = 0;
    paddle.x = x;

    if (state === 'ready') {
      balls = [ballOnPaddle()];
      return;
    }
    if (state !== 'running') return;

    for (const ball of balls) {
      moveBall(ball, h, now);
      if (state !== 'running') return;
    }
    balls = balls.filter((ball) => ball.y - BALL_R <= rows);

    const top = paddleTop();
    for (const gift of gifts) {
      gift.y += GIFT_SPEED * h;
      if (gift.y + 0.5 >= top && gift.y - 0.5 <= top + PADDLE_H && Math.abs(gift.x - paddle.x) <= paddle.w / 2 + 0.5) {
        gift.caught = true;
        catchGift(gift.kind, now);
      }
    }
    gifts = gifts.filter((gift) => !gift.caught && gift.y - 0.5 <= rows);

    if (!balls.length) lose(now);
  }

  function update(deltaMs, now) {
    if (state === 'running' || state === 'ready') {
      let left = deltaMs / 1000;
      while (left > 1e-6 && (state === 'running' || state === 'ready')) {
        const h = Math.min(left, 1 / 240);
        step(h, now);
        left -= h;
      }
    }
    if (state === 'lost' && now - lostAt >= LOST_MS) {
      if (lives > 0) {
        state = 'ready';
        balls = [ballOnPaddle()];
        appearAt = now;
      } else {
        state = 'over';
        overAt = now;
        statusShown = false;
        saveBest();
      }
      showStatus();
    }
    if (state === 'over' && !statusShown && now - overAt >= STATUS_DELAY_MS) {
      statusShown = true;
      showStatus();
    }
  }

  // ---------- drawing ----------

  function coverSize() {
    return { cols: cssW / (PITCH * scale), rows: cssH / (PITCH * scale) };
  }

  function wiggle(now) {
    if (wiggleAt === null) return 0;
    const p = (now - wiggleAt) / WIGGLE_MS;
    if (p >= 1 || calm.matches) {
      wiggleAt = null;
      return 0;
    }
    return Math.sin(p * Math.PI * 4) * (1 - p) * 0.18 * PITCH;
  }

  function drawGift(gift, team, pal) {
    const size = DOT + 3;
    const x = gift.x * PITCH - size / 2;
    const y = gift.y * PITCH - size / 2;
    ctx.fillStyle = gift.kind === 'wide' ? team.ours : team.ball;
    roundRect(ctx, x, y, size, size, 4);
    ctx.fill();
    ctx.fillStyle = pal['--ce'];
    ctx.font = `700 ${gift.kind === 'wide' ? 11 : 9}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(GIFT_LABEL[gift.kind], gift.x * PITCH, gift.y * PITCH + 0.5);
    ctx.textAlign = 'left';
  }

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pal = palette();
    if (!pal) return;
    const team = teamColors(pal);

    if (state === 'locked' || (state !== 'arriving' && (!active || state === 'paused'))) {
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      const size = coverSize();
      drawCover(ctx, pal, size.cols, size.rows, state === 'locked' ? LOCK : PLAY, { shift: wiggle(now) });
      return;
    }

    // The board being played fits the canvas, centred.
    const cell = Math.min(cssW / cols, cssH / rows);
    const k = cell / PITCH;
    const ox = (cssW - cols * cell) / 2;
    const oy = (cssH - rows * cell) / 2;
    ctx.setTransform(k * dpr, 0, 0, k * dpr, ox * dpr, oy * dpr);

    let dim = 1;
    let reveal = 1;
    if (openAt !== null && now - openAt < OPEN_MS) {
      reveal = easeOut((now - openAt) / OPEN_MS);
      dim = lerp(DIM, 1, reveal);
    }
    drawGrid(ctx, pal, cols, rows, dim);

    ctx.globalAlpha = reveal;
    for (const brick of bricks.values()) {
      ctx.fillStyle = pal[brick.fill] ?? pal['--c2'];
      roundRect(ctx, brick.c * PITCH + INSET, brick.r * PITCH + INSET, DOT, DOT, DOT_RADIUS);
      ctx.fill();
    }
    popping = popping.filter((brick) => now - brick.at < POP_MS);
    for (const brick of popping) {
      const p = (now - brick.at) / POP_MS;
      const size = DOT * (1 + 0.5 * p);
      ctx.globalAlpha = reveal * (1 - p);
      ctx.fillStyle = pal[brick.fill] ?? pal['--c2'];
      roundRect(ctx, (brick.c + 0.5) * PITCH - size / 2, (brick.r + 0.5) * PITCH - size / 2, size, size, DOT_RADIUS);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // While the lock breaks, its pieces fly from the middle of the board.
    if (openAt !== null) {
      ctx.save();
      const centre = iconCenter(coverSize().cols, coverSize().rows, LOCK);
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, centre.x * scale * dpr, centre.y * scale * dpr);
      if (!drawShards(ctx, pal['--cs'] ?? 'purple', shards, now - openAt, SHATTER_MS)) shards = [];
      ctx.restore();
    }

    if (state === 'arriving') return;

    let alpha = 1;
    if (state === 'over') alpha = 1 - (1 - DIM) * easeOut(Math.min(1, (now - overAt) / FADE_MS));
    for (const gift of gifts) drawGift(gift, team, pal);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = team.ours;
    const top = paddleTop();
    let glow = 0;
    if (caughtAt !== null && !calm.matches) {
      const p = (now - caughtAt) / CATCH_MS;
      if (p >= 1) caughtAt = null;
      else glow = (1 - p) * 0.35;
    }
    const ph = PADDLE_H * PITCH * (1 + glow);
    roundRect(ctx, (paddle.x - paddle.w / 2) * PITCH + 1, top * PITCH - (ph - PADDLE_H * PITCH) / 2, paddle.w * PITCH - 2, ph, 4);
    ctx.fill();

    let ballAlpha = alpha;
    if (state === 'lost') ballAlpha *= 1 - Math.min(1, (now - lostAt) / (LOST_MS * 0.6));
    if (appearAt !== null) {
      const p = (now - appearAt) / APPEAR_MS;
      if (p >= 1) appearAt = null;
      else ballAlpha *= p;
    }
    let w = BALL_R * 2 * PITCH;
    let h = w;
    if (landAt !== null && !calm.matches && state === 'ready') {
      const p = (now - landAt) / LAND_MS;
      if (p >= 1) landAt = null;
      else {
        const squash = 0.18 * (1 - easeOut(p));
        w *= 1 + squash;
        h *= 1 - squash;
      }
    }
    ctx.globalAlpha = ballAlpha;
    ctx.fillStyle = team.ball;
    for (const ball of balls) {
      roundRect(ctx, ball.x * PITCH - w / 2, (ball.y + BALL_R) * PITCH - h, w, h, w * 0.32);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- page ----------

  function saveBest() {
    if (score > best) {
      best = score;
      write(BEST_KEY, String(best));
    }
    updateStats();
  }

  function updateStats() {
    const top = Math.max(best, score);
    if (score !== shown.score) scoreEl.textContent = String((shown.score = score));
    if (top !== shown.best) bestEl.textContent = String((shown.best = top));
    if (lives !== shown.lives) livesEl.textContent = String((shown.lives = Math.max(0, lives)));
  }

  function showStatus() {
    const tap = touch.matches;
    let text = '';
    if (active && state === 'ready') {
      const go = tap ? 'Tap to launch' : 'Press Space to launch';
      if (greeting) text = `Unlocked. ${go}`;
      else if (lives < LIVES) text = `${lives === 1 ? 'Last ball' : `${lives} balls left`}. ${go}`;
      else text = go;
    } else if (active && state === 'over' && statusShown) {
      text = `Game over: ${score} points. ${tap ? 'Tap' : 'Press Space'} to play again`;
    } else if (active && state === 'cleared') {
      text = 'Wall cleared';
    }
    statusEl.textContent = text;
  }

  function showOpen() {
    lockline.hidden = open;
    line.hidden = !open;
    canvas.setAttribute(
      'aria-label',
      open
        ? 'A third board of the graph, with a paddle, a ball and a wall of cells'
        : `A locked board of the graph that opens when the runner scores ${BRICKS_SCORE}`,
    );
  }

  function restart() {
    resetBoard();
    state = 'ready';
    showStatus();
  }

  function toCell(x) {
    const cell = Math.min(cssW / cols, cssH / rows);
    return (x - (cssW - cols * cell) / 2) / cell;
  }

  function lead() {
    return balls[0] ?? ballOnPaddle();
  }

  resetBoard();
  showOpen();
  showStatus();

  return {
    get state() {
      return state;
    },
    isOpen: () => open,
    covered: () => state === 'locked' || (state !== 'arriving' && (!active || state === 'paused')),
    update,
    draw,
    showStatus,

    // cssW × cssH on the page; cell = 16 × s pixels; the board to play when
    // a new one is laid out.
    layout(width, height, s, ratio, playCols, playRows) {
      cssW = width;
      cssH = height;
      scale = s;
      dpr = ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      wantCols = playCols;
      wantRows = playRows;
      // A new size applies at once only when nothing is under way.
      const idle = state === 'locked' || ((state === 'ready' || state === 'over') && score === 0);
      if (idle && (cols !== wantCols || rows !== wantRows)) resetBoard();
    },

    showProgress(runScore) {
      const cells = Math.min(10, Math.floor((runScore / BRICKS_SCORE) * 10));
      if (cells === filled) return;
      filled = cells;
      [...bar.children].forEach((cell, i) => cell.classList.toggle('on', i < cells));
    },

    setActive(value) {
      active = value;
      keys = { left: false, right: false };
      aim = null;
      showStatus();
    },

    pause() {
      keys = { left: false, right: false };
      aim = null;
      if (state !== 'running') return;
      state = 'paused';
      saveBest();
      showStatus();
    },

    resume() {
      if (state === 'paused') {
        state = 'running';
        showStatus();
      }
    },

    nudge(now) {
      if (!calm.matches) wiggleAt = now;
    },

    keydown(name, now) {
      const left = name === 'ArrowLeft' || name === 'a';
      const right = name === 'ArrowRight' || name === 'd';
      const go = name === ' ' || name === 'ArrowUp' || name === 'w' || name === 'Enter';
      if (!left && !right && !go) return false;
      if (state === 'locked') {
        this.nudge(now);
        return true;
      }
      if (state === 'paused') {
        this.resume();
        return true;
      }
      if (left || right) {
        keys[left ? 'left' : 'right'] = true;
        aim = null;
      } else if (state === 'ready') {
        launch();
      } else if (state === 'over' && now - overAt > RESTART_GUARD_MS) {
        restart();
      }
      return true;
    },

    keyup(name) {
      if (name === 'ArrowLeft' || name === 'a') keys.left = false;
      if (name === 'ArrowRight' || name === 'd') keys.right = false;
    },

    // x, y in page pixels relative to the canvas.
    pointer(type, x, y, now, pressed) {
      if (state === 'locked' || state === 'arriving' || state === 'cleared') return;
      if (type === 'down') {
        down = { x, y, at: now };
        aim = toCell(x);
      } else if (type === 'move') {
        if (pressed || down) aim = toCell(x);
        else if (state === 'running' || state === 'ready') aim = toCell(x); // a mouse just hovering steers too
      } else if (type === 'up') {
        const tap = down && Math.hypot(x - down.x, y - down.y) < 8 && now - down.at < 350;
        down = null;
        if (!tap) return;
        if (state === 'ready') launch();
        else if (state === 'over' && now - overAt > RESTART_GUARD_MS) restart();
      }
    },

    // The lock breaks and the wall fades in.
    openUp(now) {
      if (open) return;
      open = true;
      state = 'arriving';
      openAt = now;
      greeting = true;
      shards = calm.matches ? [] : shardsOf(LOCK);
      resetBoard();
      showOpen();
      showStatus();
    },

    // The square from the runner lands on the paddle as the ball.
    arrive(now) {
      state = 'ready';
      balls = [ballOnPaddle()];
      if (calm.matches) appearAt = now;
      else landAt = now;
      showStatus();
    },

    // Where the ball rests on the paddle, in page pixels.
    dropTarget() {
      const rect = canvas.getBoundingClientRect();
      const cell = Math.min(cssW / wantCols, cssH / wantRows);
      const ox = (cssW - wantCols * cell) / 2;
      const oy = (cssH - wantRows * cell) / 2;
      const top = wantRows - 1 + (1 - PADDLE_H) / 2;
      return {
        x: rect.left + ox + (wantCols / 2) * cell,
        y: rect.top + oy + (top - BALL_R) * cell,
        size: BALL_R * 2 * cell,
      };
    },

    // Where the (first) ball is now, in page pixels.
    ballRect() {
      const rect = canvas.getBoundingClientRect();
      const cell = Math.min(cssW / cols, cssH / rows);
      const ox = (cssW - cols * cell) / 2;
      const oy = (cssH - rows * cell) / 2;
      const ball = lead();
      return { x: rect.left + ox + ball.x * cell, y: rect.top + oy + ball.y * cell, size: BALL_R * 2 * cell };
    },
  };
}
