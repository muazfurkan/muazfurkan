// The final: the three boards merge into one pitch. Green is ours, orange is
// theirs and the ball is purple. Each side keeps to its own half; theirs is
// played by the page. Two minutes, and a draw goes to a golden goal. The
// ending is drawn with the pitch's own cells over a darkened pitch.

import { PITCH, DOT, DOT_RADIUS, INSET, DIM, PLAY, easeOut, easeInOut, lerp, clamp, roundRect, teamColors, drawGrid, drawCover } from './cells.js';

const MATCH_S = 120;

// Pitch, in cells and seconds.
const BALL_R = 0.5;
const SIDE = 2; // both players are SIDE × SIDE cells
const OUR_SPEED = 13;
const THEIR_SPEED = 11.5;
const THINK_S = 0.13; // how often their player looks again
const BALL_MAX = 30;
const FRICTION = 0.18;
const BOUNCE = 0.9;
const KICK_MIN = 14;
const THEIR_KICK = 16; // plus up to 6 more
const ASPECT = 2.2; // the pitch, length to width
const STILL_S = 5; // a ball left in one place this long goes back to the middle

// Drawing and pacing, in milliseconds.
const MERGE_MS = 1400;
const MARKS_MS = 600;
const GOAL_MS = 1900;
const GOAL_FADE_MS = 260;
const GOLDEN_MS = 2600;
const REPLAY_DELAY_MS = 1700;
const POP_MS = 420;
const SHADE = 0.78; // how dark the pitch goes behind an ending

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

// The endings, in cells: o hand, p sleeve or spark, w and b the ball.
const CLAP_OPEN = [
  'p.............p',
  '.p...........p.',
  '..oo.......oo..',
  '.oooo.....oooo.',
  '.oooo.....oooo.',
  '.oooo.....oooo.',
  '.oooo.....oooo.',
  '.ooooo...ooooo.',
  '..oooo...oooo..',
  '..oooo...oooo..',
  '...ooo...ooo...',
  '...ooo...ooo...',
];
const CLAP_SHUT = [
  '..p.........p..',
  '...p...p...p...',
  '......o.o......',
  '.....oo.oo.....',
  '.....oo.oo.....',
  '....ooo.ooo....',
  '....ooo.ooo....',
  '....ooo.ooo....',
  '.....oo.oo.....',
  '.....oo.oo.....',
  '......o.o......',
  '......o.o......',
];
const THUMB_DOWN = [
  '..ooooooooopp',
  '.oooooooooopp',
  'ooooooooooopp',
  'ooooooooooopp',
  'ooooooooooopp',
  '.oooooooooopp',
  '..oooo.......',
  '...ooo.......',
  '...ooo.......',
  '....oo.......',
];
const BALL_A = [
  '...wwwww...',
  '.wwwwbwwww.',
  '.wwwbbbwww.',
  'wwwwbbbwwww',
  'wbwwwbwwwbw',
  'bbwwwwwwwbb',
  'wbwwwwwwwbw',
  'wwwbwwwbwww',
  '.wbbbwbbbw.',
  '.wwbwwwbww.',
  '...wwwww...',
];
const BALL_B = BALL_A.map((line) => [...line].reverse().join(''));
// Play again: a circle with its arrowhead, seven cells square.
const REPLAY = ['..###.#', '.#...##', '#...###', '#......', '#.....#', '.#...#.', '..###..'];

export function createMatch({ wrap, canvas, statusEl, hintEl, finale, artEl, scoreEl, replayEl, palette, calm, touch }) {
  const ctx = canvas.getContext('2d');

  // off | merging | kickoff | play | goal | golden | over | paused
  let state = 'off';
  let resumeTo = 'play';

  let cssW = 0;
  let cssH = 0;
  let boardCell = 16;
  let cell = 16;
  let dpr = 1;
  let cols = 53;
  let rows = 24;
  let ox = 0;
  let oy = 0;
  let rotated = false;
  let L = 53; // along the pitch, goal to goal
  let B = 24; // across it
  let mouthTop = 8;
  let mouthBottom = 16;

  const ball = { x: 0, y: 0, vx: 0, vy: 0 };
  const us = { x: 0, y: 0, vx: 0, vy: 0 };
  const them = { x: 0, y: 0, vx: 0, vy: 0 };
  let theirAim = { x: 0, y: 0 };
  let thinkIn = 0;
  let touchedUs = -1; // match time of each side's last touch
  let touchedThem = -1;
  let still = { x: 0, y: 0, for: 0 }; // where the ball has been sitting, and for how long
  let respot = null; // { at, x, y }: the ball just went back to the middle
  let ours = 0;
  let theirs = 0;
  let clock = MATCH_S;
  let golden = false;
  let t = 0;
  let stateAt = 0;
  let lastGoal = null; // 'us' | 'them'
  let merge = null; // { from: [rects], ball: {x, y} }
  let ending = null; // { kind: 'win' | 'lose' | 'golden', at }

  let keys = { left: false, right: false, up: false, down: false };
  let aim = null; // a finger's point on the pitch

  // The play-again button is drawn with cells too.
  for (const line of REPLAY) {
    for (const ch of line) {
      const i = document.createElement('i');
      if (ch === '#') i.className = 'on';
      replayEl.append(i);
    }
  }

  // ---------- geometry ----------

  function toScreen(px, py) {
    return rotated ? { x: py, y: L - px } : { x: px, y: py };
  }

  function toPitch(sx, sy) {
    return rotated ? { x: L - sy, y: sx } : { x: sx, y: sy };
  }

  // Wider than it is tall: the length runs across a wide screen and down a
  // narrow one.
  function setPitch() {
    const hud = 34;
    const tall = cssH - hud > cssW * 1.15;
    cell = Math.max(10, boardCell * 0.95);
    if (!tall) {
      cols = Math.max(20, Math.floor(cssW / cell));
      rows = Math.max(9, Math.min(Math.floor((cssH - hud) / cell), Math.round(cols / ASPECT)));
    } else {
      cols = Math.max(12, Math.floor(cssW / cell));
      rows = Math.max(20, Math.min(Math.floor((cssH - hud) / cell), Math.round(cols * ASPECT)));
    }
    ox = (cssW - cols * cell) / 2;
    oy = hud + (cssH - hud - rows * cell) / 2;
    rotated = tall;
    L = rotated ? rows : cols;
    B = rotated ? cols : rows;
    const mouth = clamp(Math.round(B * 0.38), 5, 13);
    mouthTop = (B - mouth) / 2;
    mouthBottom = (B + mouth) / 2;
  }

  function kickoffPositions() {
    ball.x = L / 2;
    ball.y = B / 2;
    ball.vx = 0;
    ball.vy = 0;
    us.x = L / 4;
    us.y = B / 2;
    us.vx = 0;
    us.vy = 0;
    them.x = (L * 3) / 4;
    them.y = B / 2;
    them.vx = 0;
    them.vy = 0;
    theirAim = { x: them.x, y: them.y };
    thinkIn = 0;
    touchedUs = -1;
    touchedThem = -1;
    still = { x: ball.x, y: ball.y, for: 0 };
    respot = null;
  }

  // ---------- play ----------

  function setState(next, now) {
    state = next;
    stateAt = now;
    showStatus();
  }

  // Eases a player toward a velocity and keeps it inside its half.
  function steerPlayer(p, tx, ty, h, minX, maxX) {
    const k = 1 - Math.exp(-h / 0.06);
    p.vx += (tx - p.vx) * k;
    p.vy += (ty - p.vy) * k;
    const half = SIDE / 2;
    const nx = clamp(p.x + p.vx * h, minX, maxX);
    const ny = clamp(p.y + p.vy * h, half, B - half);
    if (nx !== p.x + p.vx * h) p.vx = 0;
    if (ny !== p.y + p.vy * h) p.vy = 0;
    p.x = nx;
    p.y = ny;
  }

  function moveUs(h) {
    let tx = 0;
    let ty = 0;
    if (aim) {
      const dx = aim.x - us.x;
      const dy = aim.y - us.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.15) {
        const speed = Math.min(OUR_SPEED, d * 9);
        tx = (dx / d) * speed;
        ty = (dy / d) * speed;
      }
    } else {
      // Screen directions, turned with the pitch.
      const sx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const sy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      let px = rotated ? -sy : sx;
      let py = rotated ? sx : sy;
      const len = Math.hypot(px, py);
      if (len) {
        px /= len;
        py /= len;
      }
      tx = px * OUR_SPEED;
      ty = py * OUR_SPEED;
    }
    const half = SIDE / 2;
    steerPlayer(us, tx, ty, h, 1 + half, L / 2 - half);
  }

  // Their player: chases a ball in its half from behind, so it drives the
  // ball at our goal, and falls back in front of its own goal otherwise. It
  // looks again only every so often, which leaves room to beat it.
  function moveThem(h) {
    const half = SIDE / 2;
    thinkIn -= h;
    if (thinkIn <= 0) {
      thinkIn = THINK_S;
      if (ball.x > L / 2 + 0.6) {
        const gx = 1 - ball.x;
        const gy = B / 2 - ball.y;
        const g = Math.hypot(gx, gy) || 1;
        // The spot behind the ball, seen from our goal.
        const bx = ball.x - (gx / g) * (half + BALL_R + 0.4);
        const by = ball.y - (gy / g) * (half + BALL_R + 0.4);
        if (them.x > ball.x + 0.3) theirAim = { x: ball.x, y: ball.y };
        else if (Math.hypot(them.x - bx, them.y - by) < 1) theirAim = { x: ball.x, y: ball.y };
        else if (bx > L - 1 - half - 0.2) theirAim = { x: ball.x, y: ball.y }; // no room behind it: just hit it
        else theirAim = { x: Math.max(bx, ball.x + 1.5), y: by + (them.y < ball.y ? -1.5 : 1.5) };
      } else {
        theirAim = { x: L - 1 - half - 4, y: B / 2 + (ball.y - B / 2) * 0.6 };
      }
    }
    const dx = theirAim.x - them.x;
    const dy = theirAim.y - them.y;
    const d = Math.hypot(dx, dy);
    let tx = 0;
    let ty = 0;
    if (d > 0.1) {
      const speed = Math.min(THEIR_SPEED, d * 7);
      tx = (dx / d) * speed;
      ty = (dy / d) * speed;
    }
    steerPlayer(them, tx, ty, h, L / 2 + half, L - 1 - half);
  }

  // The ball against a square player; true on a touch.
  function collide(p, isThem) {
    const half = SIDE / 2;
    const cx = clamp(ball.x, p.x - half, p.x + half);
    const cy = clamp(ball.y, p.y - half, p.y + half);
    let nx = ball.x - cx;
    let ny = ball.y - cy;
    const d = Math.hypot(nx, ny);
    if (d >= BALL_R) return false;
    if (d < 1e-6) {
      // The ball's centre got inside: out along the shallower side.
      const dx = ball.x - p.x;
      const dy = ball.y - p.y;
      if (half - Math.abs(dx) < half - Math.abs(dy)) {
        nx = Math.sign(dx) || 1;
        ny = 0;
      } else {
        nx = 0;
        ny = Math.sign(dy) || 1;
      }
      ball.x = p.x + nx * (half + BALL_R);
      ball.y = p.y + ny * (half + BALL_R);
    } else {
      nx /= d;
      ny /= d;
      ball.x = cx + nx * BALL_R;
      ball.y = cy + ny * BALL_R;
    }
    if (isThem && nx < 0.2) {
      // A touch on the side facing us: a shot at our goal, never quite the same.
      const gx = 1 - ball.x;
      const gy = B / 2 + (Math.random() - 0.5) * (mouthBottom - mouthTop) * 0.7 - ball.y;
      const a = Math.atan2(gy, gx) + (Math.random() - 0.5) * 0.12;
      const speed = THEIR_KICK + Math.random() * 6;
      ball.vx = Math.cos(a) * speed;
      ball.vy = Math.sin(a) * speed;
      return true;
    }
    const rvx = ball.vx - p.vx;
    const rvy = ball.vy - p.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      ball.vx = rvx - 1.6 * vn * nx + p.vx;
      ball.vy = rvy - 1.6 * vn * ny + p.vy;
    }
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed < KICK_MIN) {
      const dx = speed ? ball.vx / speed : nx;
      const dy = speed ? ball.vy / speed : ny;
      ball.vx = dx * KICK_MIN;
      ball.vy = dy * KICK_MIN;
    }
    return true;
  }

  function moveBall(h, now) {
    const f = Math.exp(-FRICTION * h);
    ball.vx *= f;
    ball.vy *= f;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;

    if (ball.y < BALL_R) {
      ball.y = BALL_R;
      ball.vy = Math.abs(ball.vy) * BOUNCE;
    } else if (ball.y > B - BALL_R) {
      ball.y = B - BALL_R;
      ball.vy = -Math.abs(ball.vy) * BOUNCE;
    }
    const inMouth = ball.y > mouthTop && ball.y < mouthBottom;
    if (ball.x < 1) {
      if (inMouth) return goal('them', now);
      ball.x = 1 + BALL_R;
      ball.vx = Math.abs(ball.vx) * BOUNCE;
    } else if (ball.x < 1 + BALL_R && !inMouth) {
      ball.x = 1 + BALL_R;
      ball.vx = Math.abs(ball.vx) * BOUNCE;
    }
    if (ball.x > L - 1) {
      if (inMouth) return goal('us', now);
      ball.x = L - 1 - BALL_R;
      ball.vx = -Math.abs(ball.vx) * BOUNCE;
    } else if (ball.x > L - 1 - BALL_R && !inMouth) {
      ball.x = L - 1 - BALL_R;
      ball.vx = -Math.abs(ball.vx) * BOUNCE;
    }

    if (collide(us, false)) touchedUs = t;
    if (collide(them, true)) touchedThem = t;
    // Squeezed between the two on the halfway line: it squirts out sideways.
    if (t - touchedUs < 0.12 && t - touchedThem < 0.12 && Math.abs(ball.x - L / 2) < 2) {
      const side = ball.y < B / 2 ? 1 : -1;
      ball.vx *= 0.3;
      ball.vy = side * (10 + Math.random() * 4);
      touchedUs = -1;
      touchedThem = -1;
    }
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > BALL_MAX) {
      ball.vx *= BALL_MAX / speed;
      ball.vy *= BALL_MAX / speed;
    }
    return null;
  }

  // Nobody has moved the ball for a while: back to the middle it goes.
  function watchStill(h, now) {
    if (Math.hypot(ball.x - still.x, ball.y - still.y) > 0.6) {
      still = { x: ball.x, y: ball.y, for: 0 };
      return;
    }
    still.for += h;
    if (still.for < STILL_S || Math.hypot(ball.x - L / 2, ball.y - B / 2) < 1) return;
    respot = { at: now, x: ball.x, y: ball.y };
    ball.x = L / 2;
    ball.y = B / 2;
    ball.vx = 0;
    ball.vy = 0;
    still = { x: ball.x, y: ball.y, for: 0 };
  }

  function goal(by, now) {
    if (by === 'us') ours += 1;
    else theirs += 1;
    lastGoal = by;
    setState('goal', now);
    return by;
  }

  function finish(now) {
    setState('over', now);
    showFinale(ours > theirs ? 'win' : 'lose', now);
  }

  function step(h, now) {
    if (state === 'kickoff') {
      moveUs(h);
      t += h;
      // The first move starts the clock.
      if (Math.hypot(us.vx, us.vy) > 0.5) setState('play', now);
      return;
    }
    if (state !== 'play') return;
    t += h;
    if (!golden) clock = Math.max(0, clock - h);
    moveUs(h);
    moveThem(h);
    if (moveBall(h, now)) return;
    watchStill(h, now);
    if (!golden && clock <= 0) {
      if (ours !== theirs) finish(now);
      else {
        golden = true;
        setState('golden', now);
        showFinale('golden', now, 'Golden goal: the next goal wins');
      }
    }
  }

  function update(deltaMs, now) {
    if (state === 'off' || state === 'paused') return;
    if (state === 'merging' && now - stateAt >= MERGE_MS + MARKS_MS) {
      kickoffPositions();
      setState('kickoff', now);
    }
    if (state === 'goal' && now - stateAt >= GOAL_MS) {
      if (golden) finish(now);
      else {
        kickoffPositions();
        setState('kickoff', now);
      }
    }
    if (state === 'golden' && now - stateAt >= GOLDEN_MS) {
      hideFinale();
      kickoffPositions();
      setState('kickoff', now);
    }
    if (state === 'over' && replayEl.hidden && now - stateAt >= REPLAY_DELAY_MS) {
      replayEl.hidden = false;
    }
    let left = deltaMs / 1000;
    while (left > 1e-6 && (state === 'kickoff' || state === 'play')) {
      const h = Math.min(left, 1 / 240);
      step(h, now);
      left -= h;
    }
  }

  // ---------- drawing ----------

  function muted() {
    return getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#888';
  }

  function dotAt(sx, sy) {
    roundRect(ctx, sx * PITCH + INSET, sy * PITCH + INSET, DOT, DOT, DOT_RADIUS);
  }

  function drawMarks(pal, team, alpha) {
    // Halfway line and centre circle, in the graph's palest green.
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = pal['--c1'] ?? pal['--ce'];
    const mid = Math.floor(L / 2);
    const radius = Math.min(B * 0.2, 4.2);
    for (let i = 0; i < L; i += 1) {
      for (let j = 0; j < B; j += 1) {
        const d = Math.hypot(i + 0.5 - L / 2, j + 0.5 - B / 2);
        if (i !== mid && Math.abs(d - radius) > 0.5) continue;
        const s = toScreen(i + 0.5, j + 0.5);
        dotAt(Math.floor(s.x), Math.floor(s.y));
        ctx.fill();
      }
    }
    // The two goals, each in its side's colour.
    for (let j = Math.ceil(mouthTop); j < mouthBottom; j += 1) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = team.ours;
      let s = toScreen(0.5, j + 0.5);
      dotAt(Math.floor(s.x), Math.floor(s.y));
      ctx.fill();
      ctx.fillStyle = team.theirs;
      s = toScreen(L - 0.5, j + 0.5);
      dotAt(Math.floor(s.x), Math.floor(s.y));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSquare(px, py, size, color, alpha, radius) {
    const s = toScreen(px, py);
    const w = size * PITCH;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    roundRect(ctx, s.x * PITCH - w / 2, s.y * PITCH - w / 2, w, w, radius);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPlayers(team, alpha, now) {
    drawSquare(us.x, us.y, SIDE - 0.15, team.ours, alpha, 6);
    drawSquare(them.x, them.y, SIDE - 0.15, team.theirs, alpha, 6);
    const size = BALL_R * 2 - 0.1;
    if (respot && !calm.matches) {
      // It shrinks away where it stood and grows back in the middle.
      const p = (now - respot.at) / 450;
      if (p >= 1) respot = null;
      else {
        if (p < 0.5) drawSquare(respot.x, respot.y, size * (1 - p * 2), team.ball, alpha, 4);
        drawSquare(ball.x, ball.y, size * easeOut(clamp((p - 0.3) / 0.7, 0, 1)), team.ball, alpha, 4);
        return;
      }
    }
    drawSquare(ball.x, ball.y, size, team.ball, alpha, 4);
  }

  function clockText() {
    if (golden) return 'Golden goal';
    const s = Math.ceil(clock);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // Time and score above the pitch, in page pixels.
  function drawHud(team) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'alphabetic';
    const parts = [
      [String(ours), team.ours, 700],
      ['  –  ', muted(), 600],
      [String(theirs), team.theirs, 700],
      [`    ${clockText()}`, muted(), 600],
    ];
    let width = 0;
    for (const [text, , weight] of parts) {
      ctx.font = `${weight} 20px ${FONT}`;
      width += ctx.measureText(text).width;
    }
    let x = cssW / 2 - width / 2;
    for (const [text, color, weight] of parts) {
      ctx.font = `${weight} 20px ${FONT}`;
      ctx.fillStyle = color;
      ctx.fillText(text, x, oy - 10);
      x += ctx.measureText(text).width;
    }
  }

  // After a goal: the pitch fades back and the score fills the middle.
  function drawGoalScore(team, p) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const size = Math.round(Math.min(cssH * 0.38, cssW * 0.2));
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textBaseline = 'middle';
    const parts = [
      [String(ours), team.ours],
      [' – ', muted()],
      [String(theirs), team.theirs],
    ];
    let width = 0;
    for (const [text] of parts) width += ctx.measureText(text).width;
    let x = cssW / 2 - width / 2;
    const rise = calm.matches ? 0 : (1 - easeOut(Math.min(1, p * 3))) * size * 0.15;
    ctx.globalAlpha = Math.min(1, p * 4) * (1 - Math.max(0, (p - 0.85) / 0.15));
    for (const [text, color] of parts) {
      ctx.fillStyle = color;
      ctx.fillText(text, x, cssH / 2 + rise);
      x += ctx.measureText(text).width;
    }
    ctx.globalAlpha = 1;
  }

  // An ending drawn in cells, centred on (cx, cy) in page pixels. Each cell
  // pops in from the middle out.
  function drawArt(pattern, colors, cx, cy, sinceMs, shiftX = 0, shiftY = 0) {
    const h = pattern.length;
    const w = pattern[0].length;
    const k = cell / PITCH;
    ctx.setTransform(k * dpr, 0, 0, k * dpr, (cx - (w * cell) / 2) * dpr, (cy - (h * cell) / 2) * dpr);
    pattern.forEach((line, r) => {
      [...line].forEach((ch, c) => {
        const color = colors[ch];
        if (!color) return;
        let size = DOT + 1;
        if (!calm.matches) {
          const delay = Math.hypot(c - w / 2, r - h / 2) * 18;
          const p = clamp((sinceMs - delay) / 180, 0, 1);
          if (p <= 0) return;
          size *= 0.4 + 0.6 * easeOut(p) + 0.12 * Math.sin(Math.PI * p);
        }
        ctx.fillStyle = color;
        const x = (c + shiftX + 0.5) * PITCH;
        const y = (r + shiftY + 0.5) * PITCH;
        roundRect(ctx, x - size / 2, y - size / 2, size, size, DOT_RADIUS);
        ctx.fill();
      });
    });
  }

  function artHeight(kind) {
    if (kind === 'win') return CLAP_OPEN.length;
    if (kind === 'lose') return THUMB_DOWN.length;
    return BALL_A.length;
  }

  function drawEnding(pal, team, now) {
    const since = now - ending.at;
    // The pitch goes dark behind it.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let shade = SHADE * Math.min(1, since / 250);
    if (ending.kind === 'golden') shade *= 1 - clamp((since - GOLDEN_MS + 400) / 400, 0, 1);
    ctx.globalAlpha = shade;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.globalAlpha = 1;

    const box = artEl.getBoundingClientRect();
    const own = canvas.getBoundingClientRect();
    const cx = box.left + box.width / 2 - own.left;
    const cy = box.top + box.height / 2 - own.top;
    const dark = parseInt((pal['--ce'] ?? '#ffffff').slice(1, 3), 16) < 128;
    const colors = { o: team.theirs, p: team.ball, w: dark ? '#f0f6fc' : '#c9d1d9', b: '#1f2328' };
    const calmNow = calm.matches;

    if (ending.kind === 'win') {
      // Hands clapping: open, shut, open, with a little hop on each clap.
      const shut = !calmNow && since > POP_MS && Math.floor((since - POP_MS) / 230) % 2 === 1;
      const hop = shut ? -0.25 : 0;
      drawArt(shut ? CLAP_SHUT : CLAP_OPEN, colors, cx, cy, since, 0, hop);
    } else if (ending.kind === 'lose') {
      // Down it comes, then a slow shake of the head.
      let dy = 0;
      let dx = 0;
      if (!calmNow) {
        const fall = clamp(since / 520, 0, 1);
        dy = -5 * (1 - easeOut(fall)) + Math.sin(fall * Math.PI) * 0.6;
        const shake = clamp((since - 600) / 900, 0, 1);
        if (shake > 0 && shake < 1) dx = Math.round(Math.sin(shake * Math.PI * 4) * (1 - shake) * 2) / 2;
      }
      drawArt(THUMB_DOWN, colors, cx, cy, since + 600, dx, dy);
    } else {
      // The ball rolls in and bounces, turning as it goes.
      let dx = 0;
      let dy = 0;
      if (!calmNow) {
        const roll = clamp(since / 700, 0, 1);
        dx = -10 * (1 - easeOut(roll));
        const bounce = clamp((since - 700) / 900, 0, 1);
        dy = -Math.abs(Math.sin(bounce * Math.PI * 2)) * (1 - bounce) * 1.6;
      }
      const turn = !calmNow && Math.floor(since / 140) % 2 === 1;
      const alpha = 1 - clamp((since - GOLDEN_MS + 400) / 400, 0, 1);
      ctx.globalAlpha = alpha;
      drawArt(turn ? BALL_B : BALL_A, colors, cx, cy, since, dx, dy);
      ctx.globalAlpha = 1;
    }
  }

  function drawMerge(pal, now) {
    const p = Math.min(1, (now - stateAt) / MERGE_MS);
    const e = calm.matches ? 1 : easeInOut(p);
    const k = cell / PITCH;
    // Each board slides and grows into the one pitch.
    for (const r of merge.from) {
      const x = lerp(r.x, ox, e);
      const y = lerp(r.y, oy, e);
      const w = lerp(r.w, cols * cell, e);
      const h = lerp(r.h, rows * cell, e);
      ctx.setTransform(k * dpr, 0, 0, k * dpr, x * dpr, y * dpr);
      drawGrid(ctx, pal, Math.max(1, Math.round(w / cell)), Math.max(1, Math.round(h / cell)), lerp(DIM, 0.75, e));
    }
    const team = teamColors(pal);
    // The ball comes along from where the last board left it.
    const target = toScreen(L / 2, B / 2);
    const bx = lerp(merge.ball.x, ox + target.x * cell, e);
    const by = lerp(merge.ball.y, oy + target.y * cell, e);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = team.ball;
    const size = cell * (BALL_R * 2 - 0.1);
    roundRect(ctx, bx - size / 2, by - size / 2, size, size, 4 * k);
    ctx.fill();
  }

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pal = palette();
    if (!pal || state === 'off') return;
    const team = teamColors(pal);
    const k = cell / PITCH;

    if (state === 'merging' && now - stateAt < MERGE_MS) {
      drawMerge(pal, now);
      return;
    }

    ctx.setTransform(k * dpr, 0, 0, k * dpr, ox * dpr, oy * dpr);
    if (state === 'paused') {
      drawCover(ctx, pal, cols, rows, PLAY);
      return;
    }
    let content = 1;
    if (state === 'merging') content = easeOut((now - stateAt - MERGE_MS) / MARKS_MS);
    let gridAlpha = 1;
    let goalP = null;
    if (state === 'goal') {
      goalP = (now - stateAt) / GOAL_MS;
      const fade = Math.min(1, (now - stateAt) / GOAL_FADE_MS);
      content = lerp(1, 0.18, fade);
      gridAlpha = lerp(1, DIM, fade);
    }
    drawGrid(ctx, pal, cols, rows, gridAlpha);
    drawMarks(pal, team, content);
    drawPlayers(team, content, now);
    if (state !== 'merging') drawHud(team);
    if (goalP !== null) drawGoalScore(team, goalP);
    if (ending) drawEnding(pal, team, now);
  }

  // ---------- page ----------

  function showStatus() {
    const tap = touch.matches;
    let text = '';
    if (state === 'kickoff') text = tap ? 'Drag to kick off' : 'Press an arrow key to kick off';
    statusEl.textContent = text;
  }

  function showFinale(kind, now, text = '') {
    ending = { kind, at: now };
    artEl.style.height = `${artHeight(kind) * cell + 8}px`;
    const team = teamColors(palette());
    scoreEl.replaceChildren();
    if (kind === 'golden') {
      scoreEl.textContent = text;
    } else {
      const a = document.createElement('b');
      a.textContent = String(ours);
      a.style.color = team.ours;
      const b = document.createElement('b');
      b.textContent = String(theirs);
      b.style.color = team.theirs;
      scoreEl.append(a, ' – ', b);
    }
    replayEl.hidden = true;
    finale.hidden = false;
  }

  function hideFinale() {
    ending = null;
    finale.hidden = true;
  }

  function replay(now) {
    ours = 0;
    theirs = 0;
    clock = MATCH_S;
    golden = false;
    lastGoal = null;
    t = 0;
    hideFinale();
    kickoffPositions();
    setState('kickoff', now);
  }

  function pointerToPitch(x, y) {
    return toPitch((x - ox) / cell, (y - oy) / cell);
  }

  replayEl.addEventListener('click', () => replay(performance.now()));

  return {
    get state() {
      return state;
    },
    isOn: () => state !== 'off',
    update,
    draw,
    showStatus,

    // Size from the wrapper; cells a little smaller than the boards' were.
    layout(cellPx, ratio) {
      boardCell = cellPx;
      dpr = ratio;
      cssW = wrap.clientWidth;
      cssH = wrap.clientHeight;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      const before = { L, B };
      setPitch();
      if (ending) artEl.style.height = `${artHeight(ending.kind) * cell + 8}px`;
      // A new shape mid-match keeps everyone where they were, scaled.
      if (state !== 'off' && (before.L !== L || before.B !== B)) {
        const fx = L / before.L;
        const fy = B / before.B;
        for (const o of [ball, us, them]) {
          o.x *= fx;
          o.y *= fy;
        }
      }
    },

    // The boards' rectangles and the ball, in page pixels.
    start(rects, ballPoint, now) {
      const box = canvas.getBoundingClientRect();
      merge = {
        from: rects.map((r) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height })),
        ball: { x: ballPoint.x - box.left, y: ballPoint.y - box.top },
      };
      ours = 0;
      theirs = 0;
      clock = MATCH_S;
      golden = false;
      lastGoal = null;
      t = 0;
      kickoffPositions();
      hideFinale();
      setState('merging', now);
    },

    pause() {
      keys = { left: false, right: false, up: false, down: false };
      aim = null;
      if (state !== 'kickoff' && state !== 'play') return;
      resumeTo = state;
      state = 'paused';
      showStatus();
    },

    resume(now) {
      if (state !== 'paused') return;
      setState(resumeTo, now);
    },

    keydown(name, now) {
      const dirs = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down' };
      const dir = dirs[name];
      if (state === 'paused' && (dir || name === ' ' || name === 'Enter')) {
        this.resume(now);
        return true;
      }
      if (state === 'over' && (name === ' ' || name === 'Enter') && !replayEl.hidden) {
        replay(now);
        return true;
      }
      if (!dir) return name === ' ';
      keys[dir] = true;
      aim = null;
      return true;
    },

    keyup(name) {
      const dirs = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down' };
      if (dirs[name]) keys[dirs[name]] = false;
    },

    // A finger or a pressed mouse leads our square; letting go stops it.
    pointer(type, x, y) {
      if (type === 'up') {
        aim = null;
        return;
      }
      if (state === 'kickoff' || state === 'play' || state === 'golden' || state === 'goal') aim = pointerToPitch(x, y);
    },
  };
}
