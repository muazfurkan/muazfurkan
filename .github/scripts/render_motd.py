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
DEFAULT_SITE = "https://www.ljasp.com"


def clean(value, limit=400):
  """Escape a value coming from the endpoint and cap its length."""
  text = " ".join(str(value).split())
  if len(text) > limit:
    text = text[: limit - 1].rstrip() + "…"
  return html.escape(text, quote=False)


def safe_url(value):
  """Return value if it is a plain absolute http(s) URL, otherwise None.

  These fields come from the endpoint, which is untrusted, and they end up as
  markdown link targets -- a javascript: scheme would be an injection straight
  into the profile page. Anything that is not a clean http(s) URL is dropped
  rather than raised, so the endpoint can start sending a new optional field
  without breaking a run.
  """
  if not isinstance(value, str):
    return None
  text = value.strip()
  if not text.lower().startswith(("http://", "https://")):
    return None
  if any(char in text for char in ' \t\n\r"\'()<>'):
    return None
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

  site = safe_url(data.get("site")) or DEFAULT_SITE
  permalink = safe_url(data.get("permalink"))

  score = (
    f"**{home_name} {home_score} &ndash; {away_score} {away_name}** &middot; {minute}'"
  )
  if permalink:
    score += f" &nbsp;\u25b8&nbsp; [Play this match]({permalink})"

  return "\n".join([
    START,
    "",
    "---",
    "",
    f"### \u26bd Daily LJASP puzzle &middot; #{matchday}",
    "",
    f"From [LJASP]({site}), a deterministic football management simulation I build. "
    "A new decision every day.",
    "",
    score,
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
    f"<sub>Seeded by date. Last run: {date}.</sub>",
    "",
    "---",
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
