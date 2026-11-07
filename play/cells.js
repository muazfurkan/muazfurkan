// Shared pieces for the games on the contribution graph: the cell grid,
// the icons drawn with its cells, easing and storage.

export const PITCH = 16; // one cell, gap included
export const DOT = 12; // the coloured square inside a cell
export const DOT_RADIUS = 2;
export const INSET = (PITCH - DOT) / 2;
export const DIM = 0.35; // a board that is not being played

// Icons five cells wide and seven tall, the height of a strip.
export const LOCK = ['.###.', '#...#', '#...#', '#####', '##.##', '##.##', '#####'];
export const PLAY = ['#....', '##...', '###..', '####.', '###..', '##...', '#....'];

export const easeOut = (x) => 1 - (1 - x) ** 3;
export const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; then it lasts for the visit.
  }
}

export function forget(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored, or no storage at all.
  }
}

function luminance(hex) {
  const m = /^#([0-9a-f]{6})/i.exec(hex ?? '');
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// Our side is green, theirs orange and the ball purple, all from the graph.
export function teamColors(pal) {
  const dark = luminance(pal['--ce']) < 0.5;
  return {
    ours: dark ? pal['--c4'] : pal['--c3'],
    theirs: pal['--hl'] ?? '#d97757',
    ball: pal['--cs'] ?? 'purple',
  };
}

// A pattern of cells with its top left at column c0, row r0.
export function drawPattern(ctx, color, pattern, c0, r0, shift = 0) {
  ctx.fillStyle = color;
  pattern.forEach((line, r) => {
    [...line].forEach((ch, i) => {
      if (ch !== '#') return;
      roundRect(ctx, (c0 + i) * PITCH + INSET + shift, (r0 + r) * PITCH + INSET, DOT, DOT, DOT_RADIUS);
      ctx.fill();
    });
  });
}

// An empty, faint grid of cols × rows cells.
export function drawGrid(ctx, pal, cols, rows, alpha) {
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal['--cb'] ?? 'transparent';
  ctx.fillStyle = pal['--ce'];
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      roundRect(ctx, c * PITCH + INSET, r * PITCH + INSET, DOT, DOT, DOT_RADIUS);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// Where an icon sits on a board of cols × rows cells: its top left cell.
export function iconOrigin(cols, rows, pattern) {
  return {
    c0: Math.floor(cols / 2) - Math.floor(pattern[0].length / 2),
    r0: Math.max(0, Math.floor((rows - pattern.length) / 2)),
  };
}

// The middle of that icon, in board pixels.
export function iconCenter(cols, rows, pattern) {
  const { c0, r0 } = iconOrigin(cols, rows, pattern);
  return { x: (c0 + pattern[0].length / 2) * PITCH, y: (r0 + pattern.length / 2) * PITCH };
}

// A board that is locked or waiting: the faint grid and one icon in the middle.
export function drawCover(ctx, pal, cols, rows, pattern, { shift = 0, alpha = 1 } = {}) {
  drawGrid(ctx, pal, Math.ceil(cols), Math.ceil(rows), DIM);
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  const { c0, r0 } = iconOrigin(cols, rows, pattern);
  drawPattern(ctx, pal['--cs'] ?? 'purple', pattern, c0, r0, shift);
  ctx.globalAlpha = 1;
}

// The squares an icon breaks into, around its middle, in cells.
export function shardsOf(pattern) {
  const shards = [];
  const w = pattern[0].length;
  const h = pattern.length;
  pattern.forEach((line, r) => {
    [...line].forEach((ch, i) => {
      if (ch !== '#') return;
      shards.push({
        x: i + 0.5 - w / 2,
        y: r + 0.5 - h / 2,
        vx: (i - (w - 1) / 2) * 1.6 + (Math.random() - 0.5) * 1.6,
        vy: -(2 + Math.random() * 3),
      });
    });
  });
  return shards;
}

// Draws the pieces flying apart around the current origin; false once gone.
export function drawShards(ctx, color, shards, elapsedMs, durationMs, pace = 0.7) {
  const p = elapsedMs / durationMs;
  if (p >= 1 || !shards.length) return false;
  const t = (elapsedMs / 1000) * pace;
  ctx.fillStyle = color;
  ctx.globalAlpha = 1 - easeOut(p);
  for (const s of shards) {
    const size = DOT * (1 - 0.5 * p);
    const cx = (s.x + s.vx * t) * PITCH;
    const cy = (s.y + s.vy * t + 15 * t * t) * PITCH;
    roundRect(ctx, cx - size / 2, cy - size / 2, size, size, DOT_RADIUS);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return true;
}
