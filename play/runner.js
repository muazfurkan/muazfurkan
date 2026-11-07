// A second strip under the snake: one square runs along its own stretch of
// graph and jumps over blocks and gaps. It opens when a snake run reaches
// UNLOCK_SCORE points and stays open until the page is left; every visit
// starts locked.

export const UNLOCK_SCORE = 200;

const PITCH = 16;
const DOT = 12;
const DOT_RADIUS = 2;
const ROWS = 7;
const GROUND_TOP = (ROWS - 1) * PITCH; // the line the runner stands on, in board pixels

// Feel, in cells and seconds.
const START_SPEED = 7.5;
const MAX_SPEED = 12;
const RAMP_CELLS = 900; // distance over which the speed rises
const GRAVITY = 58;
const FALL_GRAVITY = 80; // a little heavier on the way down
const JUMP_SPEED = 17.4; // about 2.6 cells high when held
const CUT_SPEED = 9.5; // letting go early ends the rise here
const MIN_HOLD = 0.08;
const MAX_FALL = 26;
const JUMP_BUFFER = 0.13; // a press just before landing still jumps
const COYOTE = 0.09; // and so does one just after running off an edge
const STEP_UP = 0.3; // a ledge this low is stepped onto, not run into
const GRACE = 0.22; // pressed against a block, time left to jump
const LOST_DEPTH = 0.35; // this far down a gap there is no way back
const HALF_W = 0.35; // the hitbox is a little smaller than the square drawn
const HEIGHT = 0.8;
const START_X = 4.5;
const GEM_POINTS = 5;
const GEM_HALF = 0.25;

// Drawing, in board pixels and milliseconds.
const SIZE = 14.4; // as big as the snake's head
const RADIUS = 4.5;
const INSET = 0.8;
const GEM_PX = 8;
const DIM = 0.35;
const OPEN_MS = 700;
const SHATTER_MS = 750;
const LAND_MS = 170;
const SQUASH = 0.2;
const BOUNCE_MS = 380;
const FADE_MS = 650;
const DEAD_ALPHA = 0.35;
const STATUS_DELAY_MS = 450;
const RESTART_GUARD_MS = 700;
const SETTLE_MS = 300; // a fall eases the world to rest
const WIGGLE_MS = 380;
const APPEAR_MS = 300;

const BEST_KEY = 'contribution-runner-best';
// An earlier version kept the strip open across visits under this key.
const OLD_OPEN_KEY = 'contribution-runner-open';

// The lock, five cells wide and as tall as the strip.
const LOCK = ['.###.', '#...#', '#...#', '#####', '##.##', '##.##', '#####'];

// The first stretch is always the same, so the locked strip shows a real
// piece of the course and every run starts the same way.
const OPENING = {
  length: 54,
  gaps: [22, 23, 39, 40],
  blocks: [
    [14, 1],
    [28, 1],
    [29, 2],
    [34, 1],
    [35, 1],
    [44, 2],
    [51, 1],
  ],
  gems: [
    [17.5, 2.2],
    [23, 2.4],
    [29.5, 3.3],
    [47.5, 0.5],
    [48.5, 0.5],
    [49.5, 0.5],
  ],
};

// After the opening the course is made up as it goes, harder further on.
const FEATURES = [
  { from: 0, weight: 3, shape: [1] },
  { from: 0, weight: 2, shape: [1, 1] },
  { from: 0.05, weight: 2, gap: 2 },
  { from: 0.1, weight: 2, shape: [2] },
  { from: 0.2, weight: 2, shape: [1, 2] },
  { from: 0.35, weight: 1, shape: [2, 2, 1] },
  { from: 0.4, weight: 1, gap: 3 },
];

const easeOut = (x) => 1 - (1 - x) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; then it lasts for the visit.
  }
}

function forget(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored, or no storage at all.
  }
}

export function createRunner({ board, canvas, statusEl, lockline, bar, runline, scoreEl, bestEl, palette, calm, touch }) {
  const ctx = canvas.getContext('2d');

  forget(OLD_OPEN_KEY);
  let open = false; // only a snake run on this page opens it
  // locked | arriving | ready | running | paused | ending | over
  let state = 'locked';
  let filled = -1;
  let active = false;
  let greeting = false; // the first prompt after opening says so

  let scale = 1;
  let dpr = 1;
  let cols = 53;

  let gaps = new Set();
  let blocks = new Map();
  let gems = [];
  let nextCol = 0;

  let x = START_X;
  let y = 0;
  let vy = 0;
  let grounded = true;
  let jumped = false;
  let holding = false;
  let clock = 0; // run time in seconds, only while running
  let lastGround = 0;
  let pressAt = -Infinity;
  let takeoffAt = -Infinity;
  let waitTime = 0;
  let pressLevel = 0; // 0 free, 1 pressed against a block
  let distance = 0;
  let gemsTaken = 0;
  let score = 0;
  let best = Number(read(BEST_KEY)) || 0;
  let shownScore = -1;
  let shownBest = -1;
  let landAt = null;
  let landImpact = 0;
  let ending = null; // { kind: 'crash' | 'fall', at, speed }
  let statusShown = true;

  let openAt = null;
  let shards = [];
  let wiggleAt = null;
  let appearAt = null;

  // ---------- course ----------

  function topAt(c) {
    if (gaps.has(c)) return -Infinity;
    return blocks.get(c) ?? 0;
  }

  function generate() {
    const d = Math.min(1, Math.max(0, (nextCol - OPENING.length) / 700));
    const run = randInt(Math.round(lerp(6, 3, d)), Math.round(lerp(10, 6, d)));
    if (Math.random() < 0.25) {
      // A few cells to pick up on the way, on the ground or a jump up.
      const high = Math.random() < 0.4;
      const n = Math.min(randInt(2, 3), run - 1);
      for (let i = 0; i < n; i += 1) gems.push({ x: nextCol + 1.5 + i, y: high ? 2 : 0.5, takenAt: null });
    }
    nextCol += run;

    const options = FEATURES.filter((f) => d >= f.from);
    let pick = Math.random() * options.reduce((sum, f) => sum + f.weight, 0);
    const feature = options.find((f) => (pick -= f.weight) < 0) ?? options[0];
    const c = nextCol;
    let gem;
    if (feature.gap) {
      for (let i = 0; i < feature.gap; i += 1) gaps.add(c + i);
      gem = [c + feature.gap / 2, 2.4];
    } else {
      feature.shape.forEach((h, i) => blocks.set(c + i, h));
      const top = Math.max(...feature.shape);
      gem = [c + feature.shape.indexOf(top) + 0.5, top + 1.4];
    }
    if (Math.random() < 0.45) gems.push({ x: gem[0], y: gem[1], takenAt: null });
    nextCol += feature.gap ?? feature.shape.length;
  }

  function ensureCourse() {
    const camX = x - START_X;
    while (nextCol < camX + cols + 12) generate();
    if (gems.length > 120) gems = gems.filter((gem) => gem.x > camX - 2);
  }

  function resetRun() {
    gaps = new Set(OPENING.gaps);
    blocks = new Map(OPENING.blocks);
    gems = OPENING.gems.map(([gx, gy]) => ({ x: gx, y: gy, takenAt: null }));
    nextCol = OPENING.length;
    x = START_X;
    y = 0;
    vy = 0;
    grounded = true;
    jumped = false;
    holding = false;
    clock = 0;
    lastGround = 0;
    pressAt = -Infinity;
    takeoffAt = -Infinity;
    waitTime = 0;
    pressLevel = 0;
    distance = 0;
    gemsTaken = 0;
    score = 0;
    landAt = null;
    ending = null;
    statusShown = true;
    ensureCourse();
    updateStats();
  }

  // ---------- running ----------

  function supportTop(fromY) {
    let top = -Infinity;
    const c0 = Math.floor(x - HALF_W + 1e-6);
    const c1 = Math.floor(x + HALF_W - 1e-6);
    for (let c = c0; c <= c1; c += 1) {
      const t = topAt(c);
      if (t <= fromY + 1e-6 && t > top) top = t;
    }
    return top;
  }

  function land(top) {
    y = top;
    vy = 0;
    grounded = true;
    jumped = false;
    lastGround = clock;
  }

  // Moves forward until something stands in the way; false when stopped.
  function moveX(dx) {
    const front = x + HALF_W;
    for (let c = Math.floor(front) + 1; c <= Math.floor(front + dx); c += 1) {
      const top = topAt(c);
      if (y >= top - 1e-6) continue;
      if (top - y <= STEP_UP && vy <= 0) {
        land(top);
        continue;
      }
      x = c - HALF_W - 1e-4;
      return false;
    }
    x += dx;
    return true;
  }

  function tick(h, now) {
    clock += h;
    const speed = lerp(START_SPEED, MAX_SPEED, Math.min(1, distance / RAMP_CELLS));

    // Jump on a recent press, with ground underfoot now or a moment ago.
    if (clock - pressAt <= JUMP_BUFFER && !jumped && clock - lastGround <= COYOTE) {
      vy = JUMP_SPEED;
      jumped = true;
      grounded = false;
      takeoffAt = clock;
      pressAt = -Infinity;
      waitTime = 0;
    }
    if (jumped && !holding && vy > CUT_SPEED && clock - takeoffAt >= MIN_HOLD) vy = CUT_SPEED;

    const from = x;
    const free = moveX(speed * h);
    distance += x - from;
    pressLevel += ((free ? 0 : 1) - pressLevel) * (1 - Math.exp(-h / 0.05));
    if (free) {
      waitTime = 0;
    } else if (grounded) {
      waitTime += h;
      if (waitTime >= GRACE) {
        end('crash', now, 0);
        return;
      }
    }

    const fromY = y;
    vy = Math.max(vy - (vy > 0 ? GRAVITY : FALL_GRAVITY) * h, -MAX_FALL);
    y += vy * h;
    if (vy <= 0) {
      const top = supportTop(fromY);
      if (y <= top) {
        if (!grounded && -vy > 4) {
          landAt = now;
          landImpact = Math.min(1, -vy / 20);
        }
        land(top);
      } else {
        grounded = false;
      }
    } else {
      grounded = false;
    }

    if (y < -LOST_DEPTH) {
      end('fall', now, speed);
      return;
    }

    for (const gem of gems) {
      if (gem.takenAt !== null || Math.abs(gem.x - x) > HALF_W + GEM_HALF) continue;
      if (gem.y - GEM_HALF < y + HEIGHT && gem.y + GEM_HALF > y) {
        gem.takenAt = now;
        gemsTaken += 1;
      }
    }
  }

  function end(kind, now, speed) {
    state = 'ending';
    ending = { kind, at: now, speed };
    holding = false;
    statusShown = false;
    saveBest();
    showStatus();
  }

  function update(deltaMs, now) {
    if (state === 'running') {
      let left = deltaMs / 1000;
      while (left > 1e-6 && state === 'running') {
        const h = Math.min(left, 1 / 120);
        tick(h, now);
        left -= h;
      }
      ensureCourse();
      updateStats();
    }
    if (ending?.kind === 'fall' && y > -4) {
      // Off the edge: the world eases to rest while the square drops away.
      const dt = deltaMs / 1000;
      x += ending.speed * Math.max(0, 1 - (now - ending.at) / SETTLE_MS) * dt;
      vy = Math.max(vy - FALL_GRAVITY * dt, -MAX_FALL);
      y += vy * dt;
    }
    if (state === 'ending' && now - ending.at >= STATUS_DELAY_MS) {
      state = 'over';
      statusShown = true;
      showStatus();
    }
  }

  // ---------- drawing ----------

  function roundRect(px, py, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + w, py, px + w, py + h, r);
    ctx.arcTo(px + w, py + h, px, py + h, r);
    ctx.arcTo(px, py + h, px, py, r);
    ctx.arcTo(px, py, px + w, py, r);
    ctx.closePath();
  }

  function lockColumn() {
    return Math.floor(cols / 2) - 2;
  }

  function drawCourse(pal, camX, alpha, now) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = pal['--cb'] ?? 'transparent';
    const inset = (PITCH - DOT) / 2;
    for (let c = Math.floor(camX) - 1; c <= Math.ceil(camX + cols); c += 1) {
      const px = (c - camX) * PITCH + inset;
      const top = topAt(c);
      for (let r = 0; r < ROWS; r += 1) {
        let color = pal['--ce'];
        if (r === ROWS - 1) {
          if (top > -Infinity) color = pal['--c2'];
        } else if (top > 0 && r >= ROWS - 1 - top) {
          color = pal['--c4'];
        }
        roundRect(px, r * PITCH + inset, DOT, DOT, DOT_RADIUS);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.fillStyle = pal['--hl'] ?? 'orange';
    const bob = calm.matches || state === 'locked' ? 0 : 1;
    for (const gem of gems) {
      if (gem.x < camX - 1 || gem.x > camX + cols + 1) continue;
      let size = GEM_PX;
      let fade = 1;
      if (gem.takenAt !== null) {
        const p = (now - gem.takenAt) / 220;
        if (p >= 1) continue;
        size *= 1 + 0.6 * p;
        fade = 1 - p;
      }
      const cx = (gem.x - camX) * PITCH;
      const cy = GROUND_TOP - gem.y * PITCH + bob * Math.sin(now / 320 + gem.x) * 1.2;
      ctx.globalAlpha = alpha * fade;
      roundRect(cx - size / 2, cy - size / 2, size, size, 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawLock(pal, now, alpha) {
    const c0 = lockColumn();
    let shift = 0;
    if (wiggleAt !== null) {
      const p = (now - wiggleAt) / WIGGLE_MS;
      if (p >= 1 || calm.matches) wiggleAt = null;
      else shift = Math.sin(p * Math.PI * 4) * (1 - p) * 0.18 * PITCH;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal['--cs'] ?? 'purple';
    const inset = (PITCH - DOT) / 2;
    LOCK.forEach((line, r) => {
      [...line].forEach((ch, i) => {
        if (ch !== '#') return;
        roundRect((c0 + i) * PITCH + inset + shift, r * PITCH + inset, DOT, DOT, DOT_RADIUS);
        ctx.fill();
      });
    });
    ctx.globalAlpha = 1;
  }

  function drawShards(pal, now) {
    if (!shards.length) return;
    const t = (now - openAt) / 1000;
    const p = (now - openAt) / SHATTER_MS;
    if (p >= 1) {
      shards = [];
      return;
    }
    ctx.fillStyle = pal['--cs'] ?? 'purple';
    ctx.globalAlpha = 1 - easeOut(p);
    for (const s of shards) {
      const size = DOT * (1 - 0.5 * p);
      const cx = (s.x + s.vx * t) * PITCH;
      const cy = (s.y + s.vy * t + 15 * t * t) * PITCH;
      roundRect(cx - size / 2, cy - size / 2, size, size, DOT_RADIUS);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function bounce(p) {
    return (1 - p) ** 2 * Math.cos(p * Math.PI * 2.5);
  }

  function drawRunner(pal, camX, now) {
    let w = SIZE;
    let h = SIZE;
    let lean = 0;
    let alpha = 1;
    if (!calm.matches) {
      // Taller on the way up, flatter on landing and against a block.
      if (vy > 0 && state !== 'ending' && state !== 'over') {
        const s = 0.1 * Math.min(1, vy / JUMP_SPEED);
        w *= 1 - s;
        h *= 1 + s;
      }
      if (landAt !== null) {
        const p = (now - landAt) / LAND_MS;
        if (p >= 1) landAt = null;
        else {
          const k = SQUASH * landImpact * (1 - easeOut(p));
          w *= 1 + k;
          h *= 1 - k;
        }
      }
      let press = pressLevel;
      if (ending?.kind === 'crash') press *= bounce(Math.min(1, (now - ending.at) / BOUNCE_MS));
      if (press) {
        w *= 1 - 0.14 * press;
        h *= 1 + 0.07 * press;
        lean = 0.06 * PITCH * press;
      }
    }
    if (ending) alpha = 1 - (1 - DEAD_ALPHA) * easeOut(Math.min(1, (now - ending.at) / FADE_MS));
    if (appearAt !== null) {
      const p = (now - appearAt) / APPEAR_MS;
      if (p >= 1) appearAt = null;
      else alpha *= p;
    }
    const cx = (x - camX) * PITCH + lean;
    const bottom = GROUND_TOP - INSET - y * PITCH;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal['--cs'] ?? 'purple';
    roundRect(cx - w / 2, bottom - h, w, h, RADIUS);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pal = palette();
    if (!pal) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

    const camX = x - START_X;
    let dim = state === 'locked' ? DIM : 1;
    if (openAt !== null && now - openAt < OPEN_MS) dim = lerp(DIM, 1, easeOut((now - openAt) / OPEN_MS));
    drawCourse(pal, camX, dim, now);

    if (state === 'locked') drawLock(pal, now, 1);
    else if (openAt !== null && calm.matches && now - openAt < OPEN_MS) drawLock(pal, now, 1 - (now - openAt) / OPEN_MS);
    drawShards(pal, now);
    if (state !== 'locked' && state !== 'arriving') drawRunner(pal, camX, now);
  }

  // ---------- page ----------

  function layout(cssW, cssH, s, ratio) {
    scale = s;
    dpr = ratio;
    cols = cssW / (PITCH * s);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ensureCourse();
  }

  function saveBest() {
    if (score > best) {
      best = score;
      write(BEST_KEY, String(best));
    }
    updateStats();
  }

  function updateStats() {
    score = Math.floor(distance) + gemsTaken * GEM_POINTS;
    const top = Math.max(best, score);
    if (score !== shownScore) scoreEl.textContent = String((shownScore = score));
    if (top !== shownBest) bestEl.textContent = String((shownBest = top));
  }

  function showStatus() {
    const tap = touch.matches;
    let text = '';
    if (state === 'ready') {
      if (!active) text = tap ? 'Tap to play' : 'Click to play';
      else if (greeting) text = tap ? 'Unlocked. Tap to run' : 'Unlocked. Press Space to run';
      else text = tap ? 'Tap to run' : 'Press Space to run';
    } else if (state === 'paused') {
      text = tap ? 'Paused. Tap to go on' : active ? 'Paused. Press Space to go on' : 'Paused. Click to go on';
    } else if (state === 'over' && statusShown) {
      const again = tap ? 'Tap' : active ? 'Press Space' : 'Click';
      text = `Game over: ${score} points. ${again} to run again`;
    }
    statusEl.textContent = text;
  }

  function showOpen() {
    lockline.hidden = open;
    runline.hidden = !open;
    board.tabIndex = open ? 0 : -1;
    canvas.setAttribute(
      'aria-label',
      open
        ? 'A second strip of the graph, where a square runs and jumps'
        : `A locked strip of the graph that opens when the snake scores ${UNLOCK_SCORE}`,
    );
  }

  // While locked, anything aimed at the strip only shakes the lock.
  function nudge(now) {
    if (!calm.matches) wiggleAt = now;
  }

  resetRun();
  showOpen();
  showStatus();

  return {
    get state() {
      return state;
    },
    isOpen: () => open,
    // A run is under way, so keys that belong to the snake are held back.
    busy: () => state === 'running' || state === 'ending',
    update,
    draw,
    layout,
    showStatus,

    // How far the snake's current run has got toward opening the strip.
    showProgress(runScore) {
      const cells = Math.min(10, Math.floor((runScore / UNLOCK_SCORE) * 10));
      if (cells === filled) return;
      filled = cells;
      [...bar.children].forEach((cell, i) => cell.classList.toggle('on', i < cells));
    },

    setActive(value) {
      active = value;
      if (!active) holding = false;
      showStatus();
    },

    press(now) {
      if (state === 'locked') {
        nudge(now);
      } else if (state === 'ready' || state === 'paused') {
        // The first press sets off; only later ones jump.
        state = 'running';
        greeting = false;
        holding = true;
        showStatus();
      } else if (state === 'running') {
        pressAt = clock;
        holding = true;
      } else if (state === 'over' && now - ending.at > RESTART_GUARD_MS) {
        resetRun();
        state = 'ready';
        showStatus();
      }
    },

    release() {
      holding = false;
    },

    primary(now) {
      if (state === 'locked') {
        nudge(now);
      } else if (state === 'ready' || state === 'paused') {
        state = 'running';
        greeting = false;
        showStatus();
      } else if (state === 'over' && now - ending.at > RESTART_GUARD_MS) {
        resetRun();
        state = 'ready';
        showStatus();
      }
    },

    pause() {
      holding = false;
      if (state !== 'running') return;
      state = 'paused';
      saveBest();
      showStatus();
    },

    // The snake reached the score: the lock breaks and the strip lights up.
    openUp(now) {
      if (open) return;
      open = true;
      state = 'arriving';
      openAt = now;
      greeting = true;
      shards = [];
      if (!calm.matches) {
        const c0 = lockColumn();
        LOCK.forEach((line, r) => {
          [...line].forEach((ch, i) => {
            if (ch !== '#') return;
            shards.push({
              x: c0 + i + 0.5,
              y: r + 0.5,
              vx: (i - 2) * 1.6 + (Math.random() - 0.5) * 1.6,
              vy: -(2 + Math.random() * 3),
            });
          });
        });
      }
      resetRun();
      showOpen();
      showStatus();
    },

    // The square from the snake lands at the start.
    arrive(now) {
      state = 'ready';
      if (calm.matches) appearAt = now;
      else {
        landAt = now;
        landImpact = 1;
      }
      showStatus();
    },

    // Where the runner stands at the start, in page pixels.
    dropTarget() {
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + START_X * PITCH * scale,
        y: rect.top + (GROUND_TOP - INSET - SIZE / 2) * scale,
        size: SIZE * scale,
      };
    },
  };
}
