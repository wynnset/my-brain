#!/usr/bin/env python3
"""
Hearth — local Facebook Marketplace collector.

Why this exists: Facebook Marketplace blocks datacenter IPs and needs a real
logged-in session, so it can't run on the deployed server. You run this on your
own machine (logged into Facebook), it writes one results file, and you drag
that file into your Cyrus workspace's `team-inbox/`. Hearth (on the deployed
side) then ingests it alongside its own Craigslist results, scores everything,
and writes the report.

It does NOT score listings. It captures each listing's URL + visible text +
cover photo and lets Hearth's LLM do the parsing/scoring. That's deliberate:
fighting Facebook's obfuscated, ever-changing CSS selectors is brittle; a text
blob is stable.

Usage:
    python hearth_fbm.py login     # one-time: opens a browser, you log into FB
    python hearth_fbm.py run       # daily: collect new listings -> out/ file
    python hearth_fbm.py add URL   # manually capture one listing (any URL)

Setup (once):
    python3 -m venv .venv
    . .venv/bin/activate            # Windows: .venv\\Scripts\\activate
    pip install -r requirements.txt
    python -m playwright install chromium
    cp config.example.json config.json   # then edit config.json

Edit config.json with your Marketplace search URL(s) and price/bed filters.
"""

import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
PROFILE_DIR = ROOT / ".fb-profile"      # persistent login session (gitignored)
SEEN_PATH = ROOT / ".seen.json"         # item ids we've already captured
OUT_DIR = ROOT / "out"

ITEM_ID_RE = re.compile(r"/marketplace/item/(\d+)")


def load_config():
    if not CONFIG_PATH.exists():
        sys.exit(
            "No config.json. Copy config.example.json to config.json and edit "
            "it with your Marketplace search URL(s) and filters."
        )
    cfg = json.loads(CONFIG_PATH.read_text())
    if not cfg.get("search_urls"):
        sys.exit("config.json has no search_urls. Add at least one Marketplace search URL.")
    return cfg


def load_seen():
    if SEEN_PATH.exists():
        try:
            return set(json.loads(SEEN_PATH.read_text()))
        except Exception:
            return set()
    return set()


def save_seen(seen):
    SEEN_PATH.write_text(json.dumps(sorted(seen)))


def item_id_from_url(url):
    m = ITEM_ID_RE.search(url or "")
    return m.group(1) if m else None


def open_context(p, headless):
    # Persistent context = your Facebook login survives between runs.
    return p.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE_DIR),
        headless=headless,
        viewport={"width": 1280, "height": 1600},
        args=["--disable-blink-features=AutomationControlled"],
    )


def cmd_login(cfg):
    from playwright.sync_api import sync_playwright

    print("Opening a browser. Log into Facebook, then close the window.")
    with sync_playwright() as p:
        ctx = open_context(p, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.facebook.com/login", wait_until="domcontentloaded")
        print("Waiting for you to finish logging in (close the window when done)...")
        try:
            page.wait_for_event("close", timeout=0)
        except Exception:
            pass
        ctx.close()
    print("Login session saved to", PROFILE_DIR)


def collect_links(page, search_url, max_scrolls):
    page.goto(search_url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    seen_local = {}
    for _ in range(max_scrolls):
        for a in page.query_selector_all('a[href*="/marketplace/item/"]'):
            href = a.get_attribute("href") or ""
            iid = item_id_from_url(href)
            if not iid:
                continue
            if iid not in seen_local:
                # Normalize to a clean canonical URL.
                seen_local[iid] = f"https://www.facebook.com/marketplace/item/{iid}/"
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(1500)
    return seen_local


def capture_listing(page, url):
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    # Robust by design: take the visible text + the cover image; let the LLM parse.
    text = page.evaluate("() => document.body ? document.body.innerText : ''") or ""
    text = re.sub(r"\n{3,}", "\n\n", text).strip()[:5000]
    title = (page.title() or "").replace(" | Facebook", "").replace(" - Facebook", "").strip()
    photo = ""
    og = page.query_selector('meta[property="og:image"]')
    if og:
        photo = og.get_attribute("content") or ""
    return {"title": title, "text": text, "photos": [photo] if photo else []}


def write_outputs(rows):
    OUT_DIR.mkdir(exist_ok=True)
    today = date.today().isoformat()
    jsonl = OUT_DIR / f"hearth-fbm-{today}.jsonl"
    md = OUT_DIR / f"hearth-fbm-{today}.md"

    # Append so multiple runs in a day accumulate.
    with jsonl.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    header = (
        f"# Facebook Marketplace listings — {today}\n\n"
        "Source: local Hearth FBM collector. Drop this file (or the matching\n"
        "`.jsonl`) into your Cyrus `team-inbox/` and say \"find rentals\".\n\n"
    )
    body = []
    for r in rows:
        body.append(
            f"## {r.get('title') or r['url']}\n\n"
            f"- URL: {r['url']}\n"
            f"- Source: fb_marketplace · item {r['source_listing_id']}\n"
            f"- Captured: {r['captured_at']}\n"
            + (f"- Photo: {r['photos'][0]}\n" if r.get("photos") else "")
            + "\n```\n" + (r.get("text") or "") + "\n```\n"
        )
    new_block = ("" if md.exists() else header) + "\n".join(body) + "\n"
    with md.open("a", encoding="utf-8") as f:
        f.write(new_block)
    return jsonl, md


def make_row(url, cap):
    return {
        "source": "fb_marketplace",
        "source_listing_id": item_id_from_url(url) or url,
        "url": url,
        "title": cap["title"],
        "text": cap["text"],
        "photos": cap.get("photos", []),
        "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def cmd_run(cfg):
    from playwright.sync_api import sync_playwright

    if not PROFILE_DIR.exists():
        sys.exit("Not logged in yet. Run:  python hearth_fbm.py login")

    max_scrolls = int(cfg.get("max_scrolls", 8))
    headless = bool(cfg.get("headless", False))
    seen = load_seen()
    rows = []

    with sync_playwright() as p:
        ctx = open_context(p, headless=headless)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        all_links = {}
        for su in cfg["search_urls"]:
            print("Searching:", su)
            try:
                all_links.update(collect_links(page, su, max_scrolls))
            except Exception as e:
                print("  ! search failed:", e)

        new_ids = [iid for iid in all_links if iid not in seen]
        print(f"Found {len(all_links)} listings, {len(new_ids)} new.")

        for iid in new_ids:
            url = all_links[iid]
            try:
                cap = capture_listing(page, url)
                rows.append(make_row(url, cap))
                seen.add(iid)
                print("  captured", iid, "-", (cap["title"] or "")[:60])
            except Exception as e:
                print("  ! failed", iid, e)
        ctx.close()

    if not rows:
        print("No new listings. Nothing written.")
        return
    save_seen(seen)
    jsonl, md = write_outputs(rows)
    print(f"\nWrote {len(rows)} listings:\n  {md}\n  {jsonl}")
    print("Drag the .md (or .jsonl) into your Cyrus team-inbox and say 'find rentals'.")


def cmd_add(cfg, url):
    from playwright.sync_api import sync_playwright

    if not PROFILE_DIR.exists():
        sys.exit("Not logged in yet. Run:  python hearth_fbm.py login")
    with sync_playwright() as p:
        ctx = open_context(p, headless=bool(cfg.get("headless", False)))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        cap = capture_listing(page, url)
        ctx.close()
    row = make_row(url, cap)
    seen = load_seen()
    iid = item_id_from_url(url)
    if iid:
        seen.add(iid)
        save_seen(seen)
    jsonl, md = write_outputs([row])
    print(f"Added 1 listing to:\n  {md}\n  {jsonl}")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in {"login", "run", "add"}:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    cfg = load_config() if cmd != "login" else (load_config() if CONFIG_PATH.exists() else {"search_urls": ["x"]})
    if cmd == "login":
        cmd_login(cfg)
    elif cmd == "run":
        cmd_run(cfg)
    elif cmd == "add":
        if len(sys.argv) < 3:
            sys.exit("Usage: python hearth_fbm.py add <listing-url>")
        cmd_add(cfg, sys.argv[2])


if __name__ == "__main__":
    main()
