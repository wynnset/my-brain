#!/usr/bin/env python3
"""
Hearth — local rental collector (Facebook Marketplace + Craigslist + more).

Why local: Facebook needs a real logged-in browser, and Craigslist blocks the
deployed server's datacenter IP — both work fine from your home machine. This
tool collects listings into one dated file. You drag that file into your Cyrus
workspace's `team-inbox/`, and Hearth (deployed) scores everything against
`docs/rental-criteria.md`, writes rentals.db, and posts the report.

It does NOT score — it captures each listing's URL + visible text + cover photo
and lets Hearth's LLM parse/score. (Fighting each site's CSS is brittle; a text
blob is stable.)

Sources, all toggled in config.json:
  - Facebook Marketplace  (browser, your login)   -> search_urls
  - Craigslist            (browser HTML page)      -> craigslist
  - Generic sites         (browser)                -> sites[]  (Rentals.ca etc.)

Craigslist 403s plain HTTP/RSS clients, so it's scraped through the same real
browser as everything else — that's what a normal visitor looks like.

Usage:
    python hearth_fbm.py login     # one-time: log into Facebook
    python hearth_fbm.py run       # daily: collect all enabled sources
    python hearth_fbm.py add URL   # capture one listing by hand (any site)

Setup (once):
    python3 -m venv .venv && . .venv/bin/activate     # Win: .venv\\Scripts\\activate
    pip install -r requirements.txt
    python -m playwright install chromium
    cp config.example.json config.json                # then edit it
"""

import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
PROFILE_DIR = ROOT / ".fb-profile"
SEEN_PATH = ROOT / ".seen.json"
OUT_DIR = ROOT / "out"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
FB_ITEM_RE = re.compile(r"/marketplace/item/(\d+)")
CL_ID_RE = re.compile(r"/(\d+)\.html")

# Runs in the page. Pulls just the listing content, not the whole page:
#   1. Craigslist has stable selectors (#postingbody etc.) — use them exactly.
#   2. Otherwise read the main content region ([role=main]/main/article), which
#      drops the global header, footer, nav and side rails.
#   3. Trim the trailing "suggested / more like this" sections (the biggest
#      source of noise on Facebook), but only when they appear past the real
#      content so we never cut a short description short.
#   4. Prepend og:title / og:description as a reliable summary line.
EXTRACT_JS = r"""
() => {
  const t = el => (el && el.innerText ? el.innerText.trim() : '');
  const meta = k => {
    const m = document.querySelector(`meta[property="${k}"]`) || document.querySelector(`meta[name="${k}"]`);
    return m && m.content ? m.content.trim() : '';
  };

  // 1) Craigslist — precise.
  const pb = document.querySelector('#postingbody');
  if (pb) {
    const attrs = [...document.querySelectorAll('.attrgroup')].map(e => e.innerText.trim()).join(' | ');
    return [
      t(document.querySelector('.postingtitletext, #titletextonly')),
      t(document.querySelector('.price')),
      t(document.querySelector('.mapaddress')),
      attrs,
      t(pb),
    ].filter(Boolean).join('\n\n');
  }

  // 2) Main content region.
  const main = document.querySelector('[role="main"]') || document.querySelector('main')
            || document.querySelector('article') || document.body;
  let body = main ? main.innerText : '';

  // 3) Cut the suggested/related tail.
  const markers = [
    'More items like this', 'More like this', 'Related listings', 'Similar listings',
    'More from this seller', 'People also viewed', 'You might also like',
    'Suggested for you', 'More listings', 'Sponsored', 'Related searches',
  ];
  let cut = body.length;
  for (const m of markers) {
    const i = body.indexOf(m);
    if (i > 200 && i < cut) cut = i;   // only trim if it's past the real content
  }
  body = body.slice(0, cut).trim();

  // 4) Reliable summary line from structured metadata.
  const head = [meta('og:title'), meta('og:description') || meta('description')]
    .filter(Boolean).join(' — ');
  return (head ? head + '\n\n' : '') + body;
}
"""


# ─── config / seen ──────────────────────────────────────────────────────────
def load_config():
    if not CONFIG_PATH.exists():
        sys.exit("No config.json. Copy config.example.json to config.json and edit it.")
    return json.loads(CONFIG_PATH.read_text())


def load_seen():
    if SEEN_PATH.exists():
        try:
            return set(json.loads(SEEN_PATH.read_text()))
        except Exception:
            return set()
    return set()


def save_seen(seen):
    SEEN_PATH.write_text(json.dumps(sorted(seen)))


# ─── location filter ──────────────────────────────────────────────────────────
def passes_location(cfg, *texts):
    """True if the listing should be kept. Drops anything that matches a
    location_block term, or (when location_allow is set) that mentions none of
    the allowed places. Empty allow list = keep everything."""
    blob = " ".join(t or "" for t in texts).lower()
    for b in cfg.get("location_block", []):
        if b.lower() in blob:
            return False
    allow = cfg.get("location_allow", [])
    if not allow:
        return True
    return any(a.lower() in blob for a in allow)


# ─── output ───────────────────────────────────────────────────────────────────
def write_outputs(rows):
    OUT_DIR.mkdir(exist_ok=True)
    today = date.today().isoformat()
    jsonl = OUT_DIR / f"hearth-listings-{today}.jsonl"
    md = OUT_DIR / f"hearth-listings-{today}.md"

    with jsonl.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    header = (
        f"# Rental listings — {today}\n\n"
        "Collected locally (FB Marketplace + Craigslist + sites). Drop this file\n"
        "(or its `.jsonl` twin) into your Cyrus `team-inbox/` and say "
        "\"find rentals\".\n\n"
    )
    blocks = []
    for r in rows:
        blocks.append(
            f"## [{r['source']}] {r.get('title') or r['url']}\n\n"
            f"- URL: {r['url']}\n"
            f"- Source: {r['source']} · id {r['source_listing_id']}\n"
            f"- Captured: {r['captured_at']}\n"
            + (f"- Photo: {r['photos'][0]}\n" if r.get("photos") else "")
            + "\n```\n" + (r.get("text") or "") + "\n```\n"
        )
    with md.open("a", encoding="utf-8") as f:
        f.write(("" if md.exists() else header) + "\n".join(blocks) + "\n")
    return jsonl, md


def make_row(source, source_id, url, title="", text="", photos=None):
    return {
        "source": source,
        "source_listing_id": source_id,
        "url": url,
        "title": title,
        "text": text,
        "photos": photos or [],
        "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


# ─── Craigslist (via the real browser — avoids the 403 plain HTTP clients get) ──
def collect_craigslist(page, cfg, seen):
    cl = cfg.get("craigslist", {})
    if not cl.get("enabled"):
        return []
    site = cl.get("site", "vancouver")

    # If you paste your own (map-constrained) search URLs, we use those as-is;
    # otherwise we build one from the simple params.
    search_urls = cl.get("search_urls") or []
    if not search_urls:
        params = []
        if cl.get("min_price"):
            params.append(f"min_price={cl['min_price']}")
        if cl.get("max_price"):
            params.append(f"max_price={cl['max_price']}")
        if cl.get("min_bedrooms"):
            params.append(f"min_bedrooms={cl['min_bedrooms']}")
        # search_distance (miles) + postal bounds results to a radius around a
        # point — the in-subdomain way to keep Surrey/Langley/etc. out.
        if cl.get("search_distance") and cl.get("postal"):
            params.append(f"search_distance={cl['search_distance']}")
            params.append(f"postal={cl['postal']}")
        u = f"https://{site}.craigslist.org/search/apa"
        if params:
            u += "?" + "&".join(params)
        search_urls = [u]

    # Only keep listings hosted on the Craigslist site(s) we searched. This
    # kills the "nearby areas" results that link off to other cities' subdomains.
    allowed_hosts = {urlparse(u).netloc for u in search_urls}
    # The vancouver site bundles the whole Lower Mainland into subareas — the
    # first path segment, e.g. /van/ (city of Vancouver), /bnc/ (Burnaby/NewWest),
    # /nvn/ (north shore), /rds/ (richmond/delta), /pml/ (tri-cities). Set
    # craigslist.subareas to the codes you want (empty = all). Read the code off
    # any listing URL: vancouver.craigslist.org/<subarea>/apa/...
    allowed_subareas = {s.lower() for s in (cl.get("subareas") or [])}
    print("Craigslist (browser):", ", ".join(search_urls))

    links = harvest_links(page, search_urls, r"/\d{8,}\.html", int(cfg.get("max_scrolls", 8)))
    rows, off_site, off_area, skipped = [], 0, 0, 0
    for url in links:
        if urlparse(url).netloc not in allowed_hosts:
            off_site += 1
            continue
        if allowed_subareas:
            segs = urlparse(url).path.strip("/").split("/")
            subarea = segs[0].lower() if segs else ""
            if subarea not in allowed_subareas:
                off_area += 1
                continue
        idm = CL_ID_RE.search(url)
        cid = idm.group(1) if idm else url
        key = f"cl:{cid}"
        if key in seen:
            continue
        try:
            cap = capture_listing(page, url)
        except Exception as e:
            print("  ! capture failed", cid, e)
            continue
        # Include the URL slug — it carries the neighbourhood (e.g.
        # "burnaby-north-burnaby") even when the page chrome says "vancouver".
        if not passes_location(cfg, cap["title"], cap["text"], url):
            skipped += 1
            seen.add(key)
            continue
        rows.append(make_row("craigslist", cid, url, cap["title"], cap["text"], cap["photos"]))
        seen.add(key)
    print(f"  Craigslist: {len(rows)} new, {off_site} off-site, {off_area} wrong subarea, {skipped} out of area")
    return rows


# ─── browser helpers (FB + generic sites) ──────────────────────────────────────
def open_context(p, headless):
    return p.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE_DIR),
        headless=headless,
        viewport={"width": 1280, "height": 1600},
        args=["--disable-blink-features=AutomationControlled"],
    )


def capture_listing(page, url):
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    # Best-effort: expand truncated descriptions ("See more") so we capture the
    # full body, not the collapsed preview. Harmless if absent.
    for _ in range(2):
        try:
            btn = page.get_by_text("See more", exact=False).first
            if btn.is_visible():
                btn.click(timeout=1000)
                page.wait_for_timeout(400)
            else:
                break
        except Exception:
            break

    text = (page.evaluate(EXTRACT_JS) or "").strip()
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()[:4000]
    title = (page.title() or "").replace(" | Facebook", "").replace(" - Facebook", "").strip()
    photo = ""
    og = page.query_selector('meta[property="og:image"]')
    if og:
        photo = og.get_attribute("content") or ""
    return {"title": title, "text": text, "photos": [photo] if photo else []}


def harvest_links(page, search_urls, pattern, max_scrolls):
    """Scroll each search page and collect hrefs matching pattern -> {key: abs_url}."""
    found = {}
    rx = re.compile(pattern)
    for su in search_urls:
        try:
            page.goto(su, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(3000)
        except Exception as e:
            print("  ! search failed:", su, e)
            continue
        for _ in range(max_scrolls):
            for a in page.query_selector_all("a[href]"):
                href = a.get_attribute("href") or ""
                if rx.search(href):
                    absu = urljoin(su, href.split("?")[0])
                    found[absu] = absu
            page.mouse.wheel(0, 4000)
            page.wait_for_timeout(1500)
    return found


def collect_facebook(page, cfg, seen):
    urls = cfg.get("search_urls", [])
    if not urls:
        return []
    print("Facebook Marketplace:", len(urls), "search(es)")
    links = harvest_links(page, urls, r"/marketplace/item/\d+", int(cfg.get("max_scrolls", 8)))
    rows, skipped = [], 0
    for url in links:
        m = FB_ITEM_RE.search(url)
        iid = m.group(1) if m else url
        key = f"fb:{iid}"
        if key in seen or iid in seen:  # iid covers legacy un-namespaced entries
            continue
        try:
            cap = capture_listing(page, f"https://www.facebook.com/marketplace/item/{iid}/")
        except Exception as e:
            print("  ! capture failed", iid, e)
            continue
        if not passes_location(cfg, cap["title"], cap["text"], url):
            skipped += 1
            seen.add(key)  # don't recheck this out-of-area listing tomorrow
            continue
        rows.append(make_row("fb_marketplace", iid, f"https://www.facebook.com/marketplace/item/{iid}/",
                             cap["title"], cap["text"], cap["photos"]))
        seen.add(key)
    print(f"  Facebook: {len(rows)} new, {skipped} skipped (out of area)")
    return rows


def collect_site(page, site, cfg, seen):
    name = site["name"]
    urls = site.get("search_urls", [])
    print(f"{name}: {len(urls)} search(es)")
    links = harvest_links(page, urls, site["link_pattern"], int(site.get("max_scrolls", cfg.get("max_scrolls", 8))))
    rows, skipped = [], 0
    for url in links:
        key = f"{name}:{url}"
        if key in seen:
            continue
        try:
            cap = capture_listing(page, url)
        except Exception as e:
            print("  ! capture failed", url, e)
            continue
        if not passes_location(cfg, cap["title"], cap["text"], url):
            skipped += 1
            seen.add(key)
            continue
        rows.append(make_row(name, url, url, cap["title"], cap["text"], cap["photos"]))
        seen.add(key)
    print(f"  {name}: {len(rows)} new, {skipped} skipped (out of area)")
    return rows


# ─── commands ───────────────────────────────────────────────────────────────
def cmd_login(cfg):
    from playwright.sync_api import sync_playwright
    print("Opening a browser. Log into Facebook, then close the window.")
    with sync_playwright() as p:
        ctx = open_context(p, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.facebook.com/login", wait_until="domcontentloaded")
        try:
            page.wait_for_event("close", timeout=0)
        except Exception:
            pass
        ctx.close()
    print("Login session saved to", PROFILE_DIR)


def cmd_run(cfg):
    seen = load_seen()
    rows = []

    # All sources go through the real browser — Craigslist blocks plain HTTP
    # clients, so we scrape its HTML page the same way a person's browser does.
    enabled_sites = [s for s in cfg.get("sites", []) if s.get("enabled")]
    cl_enabled = cfg.get("craigslist", {}).get("enabled")
    needs_browser = bool(cfg.get("search_urls")) or enabled_sites or cl_enabled
    if needs_browser:
        from playwright.sync_api import sync_playwright
        if cfg.get("search_urls") and not PROFILE_DIR.exists():
            print("! Facebook needs login first: python hearth_fbm.py login (skipping FB)")
        with sync_playwright() as p:
            ctx = open_context(p, headless=bool(cfg.get("headless", False)))
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            if cl_enabled:
                try:
                    rows += collect_craigslist(page, cfg, seen)
                except Exception as e:
                    print("  ! Craigslist failed:", e)
            if cfg.get("search_urls") and PROFILE_DIR.exists():
                rows += collect_facebook(page, cfg, seen)
            for s in enabled_sites:
                try:
                    rows += collect_site(page, s, cfg, seen)
                except Exception as e:
                    print(f"  ! site {s.get('name')} failed:", e)
            ctx.close()

    if not rows:
        print("\nNo new listings. Nothing written.")
        save_seen(seen)
        return
    save_seen(seen)
    jsonl, md = write_outputs(rows)
    print(f"\nWrote {len(rows)} listings:\n  {md}\n  {jsonl}")
    print("Drag the .md (or .jsonl) into your Cyrus team-inbox and say 'find rentals'.")


def cmd_add(cfg, url):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = open_context(p, headless=bool(cfg.get("headless", False)))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        cap = capture_listing(page, url)
        ctx.close()
    m = FB_ITEM_RE.search(url)
    source = "fb_marketplace" if m else "manual"
    sid = m.group(1) if m else url
    row = make_row(source, sid, url, cap["title"], cap["text"], cap["photos"])
    jsonl, md = write_outputs([row])
    print(f"Added 1 listing to:\n  {md}\n  {jsonl}")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in {"login", "run", "add"}:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    cfg = load_config()
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
