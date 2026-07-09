# Katie Loxton · Product Intelligence

An installable **PWA dashboard** for understanding the Katie Loxton product range at a
glance — and clicking into the detail when something looks interesting.

It answers, on one screen:

- **Assortment** — how many styles sit in each category, and where the breadth is concentrated
- **Price architecture** — how the range spreads across price brackets (Under £10 → £75+)
- **Availability** — in-stock vs out-of-stock, by category, with anomaly flags
- **Discounting** — how much of the range is reduced, and how deep
- **What to notice** — auto-generated insight cards that jump you straight to the affected products

Every chart, KPI and insight is **clickable** and drills through to the underlying product list
(grid or table), so a glance can always become a deep-dive.

---

## Quick start

It's a static site — no build step.

```bash
# serve locally (any static server works)
python3 -m http.server 8080
# then open http://localhost:8080
```

Out of the box it runs on a **representative sample** of the range so you can see the whole
thing working. Load the real catalogue with the scraper below.

## Load the live catalogue

Katie Loxton runs on Shopify, which publishes a public read-only product feed. The scraper
walks it and writes `data/products.json`, which the dashboard picks up automatically (the
source badge flips from *Sample data* to *Live catalogue*).

```bash
node scripts/scrape.mjs        # Node 18+; no dependencies
```

> **Note on this environment:** Claude Code's sandbox here blocks outbound web requests, so the
> scrape must run somewhere with open internet — your laptop, or a Claude Code environment set to
> an open network policy. See the follow-up questions in the chat for how to enable that.

After the first run, check the printed summary of raw Shopify `product_type` values and tune the
`CATEGORY_MAP` in `scripts/scrape.mjs` if anything unexpected lands in "Other".

## Deploy (GitHub Pages)

1. Push this branch and enable Pages on it (Settings → Pages → deploy from branch).
2. Commit a fresh `data/products.json` whenever you want to refresh the numbers, or wire the
   scraper into a scheduled GitHub Action.
3. On your phone, open the Pages URL and **Add to Home Screen** — it installs as an app and works
   offline (the service worker caches the shell and last-seen data).

---

## How it's built

| File | Purpose |
|------|---------|
| `index.html` | The whole app — self-contained HTML/CSS/JS, no dependencies |
| `scripts/scrape.mjs` | Shopify `/products.json` scraper → `data/products.json` |
| `data/products.json` | Live catalogue (created by the scraper; falls back to the built-in sample) |
| `manifest.webmanifest`, `sw.js`, `icon.svg` | PWA install + offline plumbing |

**Data model** (per product): `title, category, price, compareAt, available, onSale, discountPct,
bracket, url, image`. Charts derive everything from this, so pointing it at a competitor's Shopify
store later is mostly a matter of changing `BASE` in the scraper.

The colour system is a colourblind-safe categorical palette (validated in both light and dark
themes) tuned to Katie Loxton's brand — dusky rose, sage, warm neutrals and gold.
