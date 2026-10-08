#!/usr/bin/env python3
"""Render the LJASP match-of-the-day JSON into a marked region of the README.

Usage: render_motd.py <motd.json> <README.md>

The endpoint response is treated as untrusted text: every string is HTML-escaped
before it is written, so a stray tag in the source data cannot inject markup
into the profile page.
"""

import html
import json
import re
import sys
from pathlib import Path

START = "<!-- MOTD:START -->"
END = "<!-- MOTD:END -->"


def clean(value, limit=400):
  """Escape a value coming from the endpoint and cap its length."""
  text = " ".join(str(value).split())
  if len(text) > limit:
    text = text[: limit - 1].rstrip() + "…"
  return html.escape(text, quote=False)


def require(data, *path):
  node = data
  for key in path:
    if not isinstance(node, dict) or key not in node:
      raise SystemExit(f"missing field: {'.'.join(path)}")
    node = node[key]
  return node


def build(data):
  home_name = clean(require(data, "home", "name"), 60)
  away_name = clean(require(data, "away", "name"), 60)
  home_score = int(require(data, "home", "score"))
  away_score = int(require(data, "away", "score"))
  matchday = int(require(data, "matchday"))
  date = clean(require(data, "date"), 20)
  minute = int(require(data, "hint", "minute"))
  situation = clean(require(data, "hint", "situation"))
  question = clean(data.get("hint", {}).get("question") or "What's your call?", 120)
  answer = clean(require(data, "hint", "answer"))

  return "\n".join([
    START,
    "",
    f"### Daily LJASP puzzle &middot; #{matchday}",
    "",
    f"**{home_name} {home_score} &ndash; {away_score} {away_name}** &middot; {minute}'",
    "",
    f"> {situation}",
    "",
    f"**{question}**",
    "",
    "<details>",
    "<summary>Reveal</summary>",
    "",
    answer,
    "",
    "</details>",
    "",
    f"<sub>Generated from a deterministic simulation. Seeded by date, so the "
    f"same day always resolves the same way. Last run: {date}.</sub>",
    "",
    END,
  ])


def main():
  if len(sys.argv) != 3:
    raise SystemExit("usage: render_motd.py <motd.json> <README.md>")

  data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
  readme_path = Path(sys.argv[2])
  readme = readme_path.read_text(encoding="utf-8")

  if START not in readme or END not in readme:
    raise SystemExit(
      f"README is missing the {START} / {END} markers; add them first."
    )

  block = build(data)
  pattern = re.compile(
    re.escape(START) + ".*?" + re.escape(END), re.DOTALL
  )
  updated = pattern.sub(lambda _: block, readme, count=1)

  if updated == readme:
    print("no change")
    return

  readme_path.write_text(updated, encoding="utf-8")
  print("README updated")


if __name__ == "__main__":
  main()
