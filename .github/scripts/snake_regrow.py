#!/usr/bin/env python3
"""Give snk's contribution-snake SVGs a gradual regrow.

snk rewrites these SVGs from scratch on every run, so this is a post-processing
step in the workflow rather than an edit to the committed files.

Each eaten cell originally snaps to the empty colour and stays there until the
cycle restarts, so every cell pops back at once at t=0. This rewrites each cell's
keyframes to hold the empty colour for REGROW_DELAY_MS after the snake passes,
then ramp back to the cell's own contribution colour over REGROW_FADE_MS and
hold it to the end of the cycle -- which also makes the loop boundary seamless,
since the final stop then matches the implicit 0% value.

It fails loudly rather than leaving an SVG untouched: if snk's output format
changes, the workflow should break so we find out.
"""

import re
import sys

REGROW_DELAY_MS = 3000   # after a cell is eaten, how long before it starts coming back
REGROW_FADE_MS = 1500    # how long the ramp back to full colour takes
HIDE_COUNTER = True      # hide the .u tally bars, which only ever count up

STYLE_RE = re.compile(r"<style>(.*?)</style>", re.S)
DURATION_RE = re.compile(r"(\d+)ms")

# Every cell keyframe snk emits looks exactly like:
#   @keyframes c9{79.7%{fill:var(--c4)}79.72%,100%{fill:var(--ce)}}
CELL_RE = re.compile(
    r"@keyframes (c[0-9a-z]+)\{"
    r"([\d.]+)%\{fill:var\((--c[0-9a-z]+)\)\}"
    r"([\d.]+)%,100%\{fill:var\(--ce\)\}\}"
)
# Loose form, used only to prove the rewrite neither dropped nor duplicated one.
CELL_NAME_RE = re.compile(r"@keyframes c[0-9a-z]+\{")
U_RULE_RE = re.compile(r"\.u\{([^}]*)\}")


def fail(path, reason):
    sys.stderr.write(f"snake_regrow: {path}: {reason}\n")
    sys.exit(1)


def process(path):
    with open(path, encoding="utf-8") as handle:
        svg = handle.read()

    style = STYLE_RE.search(svg)
    if not style:
        fail(path, "no <style> block found")

    durations = sorted(set(DURATION_RE.findall(style.group(1))))
    if len(durations) != 1:
        fail(path, f"expected exactly one animation duration, found {durations or 'none'}")
    cycle_ms = int(durations[0])

    cells_before = len(CELL_NAME_RE.findall(svg))
    matches = CELL_RE.findall(svg)
    if not matches:
        fail(path, "no cell keyframes matched the expected format -- snk's output has changed")

    delay_pct = REGROW_DELAY_MS / cycle_ms * 100
    fade_pct = REGROW_FADE_MS / cycle_ms * 100
    counts = {"rewritten": 0, "skipped": 0, "clipped": 0}

    def rewrite(match):
        name, eat, level, off = match.group(1), float(match.group(2)), match.group(3), match.group(4)
        start = eat + delay_pct
        if start >= 100:
            # No room left in this cycle for a regrow; leave the cell as snk made it.
            counts["skipped"] += 1
            return match.group(0)
        end = start + fade_pct
        if end >= 100:
            end = 100.0
            counts["clipped"] += 1
        if not start < end:
            fail(path, f"{name}: regrow start {start:.2f}% is not before end {end:.2f}%")
        counts["rewritten"] += 1
        # At end >= 100 the ramp finishes exactly on the cycle boundary, so the
        # closing stop is the ramp's own -- no duplicate 100% stop.
        hold = "" if end >= 100 else f"100.00%{{fill:var({level})}}"
        return (
            f"@keyframes {name}{{"
            f"{match.group(2)}%{{fill:var({level})}}"
            f"{off}%{{fill:var(--ce)}}"
            f"{start:.2f}%{{fill:var(--ce)}}"
            f"{end:.2f}%{{fill:var({level})}}"
            f"{hold}}}"
        )

    svg = CELL_RE.sub(rewrite, svg)

    cells_after = len(CELL_NAME_RE.findall(svg))
    if cells_after != cells_before:
        fail(path, f"cell keyframe count changed: {cells_before} -> {cells_after}")

    if HIDE_COUNTER:
        u_rules = U_RULE_RE.findall(svg)
        if len(u_rules) != 1:
            fail(path, f"HIDE_COUNTER is set but found {len(u_rules)} '.u' rules, expected 1")
        if "opacity:0" not in u_rules[0]:
            svg = U_RULE_RE.sub(lambda m: f".u{{{m.group(1)};opacity:0}}", svg, count=1)

    with open(path, "w", encoding="utf-8") as handle:
        handle.write(svg)

    print(
        f"snake_regrow: {path}: cycle={cycle_ms}ms "
        f"delay={REGROW_DELAY_MS}ms ({delay_pct:.2f}%) fade={REGROW_FADE_MS}ms ({fade_pct:.2f}%) "
        f"cells={cells_after} rewritten={counts['rewritten']} "
        f"clipped={counts['clipped']} skipped={counts['skipped']} "
        f"counter={'hidden' if HIDE_COUNTER else 'visible'}"
    )


def main(argv):
    if not argv:
        sys.stderr.write("snake_regrow: usage: snake_regrow.py <svg> [<svg> ...]\n")
        return 1
    for path in argv:
        process(path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
