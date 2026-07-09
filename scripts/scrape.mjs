#!/usr/bin/env node
/**
 * Katie Loxton catalogue scraper (Magento / public data).
 *
 * katieloxton.com is a Magento store — no Shopify products.json — but its
 * sitemap enumerates the catalogue and every product page carries JSON-LD
 * (Product + BreadcrumbList). This walks the sitemap, fetches each product
 * page, and reads the structured data into the shape the dashboard expects.
 * Uses only publicly available pages. No dependencies (Node 18+ global fetch).
 *
 *     node scripts/scrape.mjs
 *
 * Env:
 *     SITEMAP      sitemap URL (default: the KL sitemap from robots.txt)
 *     MAX          cap number of product pages (0 = all; use a small value to test)
 *     CONCURRENCY  parallel requests (default 8)
 *
 * Run with a raised header cap — KL's CDN sends very large headers:
 *     NODE_OPTIONS=--max-http-header-size=262144 node scripts/scrape.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITEMAP = process.env.SITEMAP || "https://katieloxton.com/media/sitemaps/sitemap_kl.xml";
const ORIGIN = new URL(SITEMAP).origin;
const MAX = Number(process.env.MAX || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const OUT = fileURLToPath(new URL("../data/products.json", import.meta.url));

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};
const getText = async (url) => {
  const r = await fetch(url, { headers: HEADERS, redirect: "follow" });
  return { status: r.status, ok: r.ok, body: await r.text() };
};

/* ---- JSON-LD helpers ---- */
function ldObjects(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const stack = Array.isArray(j) ? [...j] : [j];
    while (stack.length) {
      const o = stack.pop();
      if (o && typeof o === "object") {
        out.push(o);
        if (Array.isArray(o["@graph"])) stack.push(...o["@graph"]);
      }
    }
  }
  return out;
}
const typeOf = (o) => [].concat(o["@type"] || []).map(String);

/* ---- category mapping (from breadcrumb + name) ---- */
// Promo / merchandising crumbs that aren't real product categories.
const PROMO_CRUMB = /^(sale|new[\s-]?in|clearance|outlet|last chance|limited availability|offers?|bestsellers?|shop all|view all|black friday|cyber|christmas shop|gifts? under|under £?\d+|up to \d+%|\d+%(\s*off)?)$/i;
const CATEGORY_MAP = [
  [/pouch/i, "Perfect Pouches"],
  [/purse|wallet|card holder|cardholder|coin/i, "Purses & Wallets"],
  [/bag|tote|backpack|holdall|clutch|cross.?body|weekend|luggage/i, "Bags"],
  [/necklace|earring|bracelet|jewel|ring\b|pendant|anklet|charm/i, "Jewellery"],
  [/card|stationery|sticker|notebook|note ?book|\bpen\b|wrap|journal|planner|diary|greeting/i, "Stationery"],
  [/candle|diffuser|fragrance|wax|hand cream|lotion|home|dish|frame|storage|mug|ceramic|decoration|cushion|blanket/i, "Home & Fragrance"],
  [/scarf|sunglass|keyring|umbrella|hair|passport|hat|glove|belt|accessor/i, "Accessories"],
  [/gift|hamper|pamper|set\b/i, "Gifts"],
];
function cleanCrumbs(crumbs) { return crumbs.filter((c) => c && !PROMO_CRUMB.test(c.trim())); }
function categorise(name, crumbs) {
  const clean = cleanCrumbs(crumbs);
  const hay = `${clean.join(" ")} ${name}`;
  for (const [re, cat] of CATEGORY_MAP) if (re.test(hay)) return cat;
  return clean[0] || "Other";
}
// Discount depth from a promo breadcrumb like "Sale › 60%".
function discountFromCrumbs(crumbs) {
  for (const c of crumbs) { const m = c.match(/(\d{1,2})\s*%/); if (m) { const p = +m[1]; if (p > 0 && p < 100) return p; } }
  return 0;
}

/* ---- extra dimensions (best-effort, from name) ---- */
const has = (t, ...w) => w.some((x) => t.toLowerCase().includes(x));
function occasionOf(name) {
  const t = name.toLowerCase();
  if (has(t, "mum", "mother")) return "Mum";
  if (has(t, "bride", "wedding", "bridesmaid", "hen ")) return "Wedding";
  if (has(t, "baby", "christening")) return "New Baby";
  if (has(t, "best friend", "friendship", "bestie")) return "Best Friend";
  if (has(t, "thank you")) return "Thank You";
  if (has(t, "birthday", "birthstone")) return "Birthday";
  if (has(t, "pamper", "prosecco", "treat")) return "Treat / Self";
  return "Everyday";
}
function materialOf(name, cat) {
  const t = name.toLowerCase();
  if (has(t, "straw", "basket", "raffia")) return "Straw";
  if (has(t, "woven")) return "Woven";
  if (has(t, "candle", "wax", "melt")) return "Wax";
  if (has(t, "diffuser")) return "Glass";
  if (has(t, "ceramic", "dish", "frame", "trinket")) return "Ceramic";
  if (has(t, "scarf")) return "Cotton";
  if (has(t, "sunglass")) return "Acetate";
  if (has(t, "necklace", "earring", "bracelet", "pendant", "chain", "hoop", "ring", "charm")) return "Metal";
  if (cat === "Bags" || cat === "Purses & Wallets") return "Vegan Leather";
  if (cat === "Perfect Pouches") return "Cotton";
  return "Mixed";
}
const COLOUR_WORDS = ["Blush","Sage","Tan","Black","Gold","Cream","Navy","Pink","Silver","White","Grey","Green","Blue","Red","Brown","Tortoiseshell","Natural","Nude","Rose","Taupe","Mint","Lilac","Burgundy"];
function colourOf(name, product) {
  if (product && product.color) return String(product.color);
  for (const w of COLOUR_WORDS) if (new RegExp(`\\b${w}\\b`, "i").test(name)) return w;
  return "Mixed";
}

/* ---- price / sale from Magento HTML (best effort) ---- */
function pricesFromHtml(html) {
  const amt = (type) => {
    const m = html.match(new RegExp(`data-price-type="${type}"[^>]*data-price-amount="([\\d.]+)"`, "i"))
      || html.match(new RegExp(`"${type}"\\s*:\\s*\\{[^}]*"amount"\\s*:\\s*"?([\\d.]+)`, "i"));
    return m ? Number(m[1]) : null;
  };
  return { final: amt("finalPrice"), old: amt("oldPrice") };
}

function offerPrice(product) {
  let off = product.offers;
  if (Array.isArray(off)) off = off[0];
  if (!off) return { price: null, available: true };
  const price = Number(off.price ?? off.lowPrice ?? off.highPrice);
  const avail = off.availability ? /InStock/i.test(off.availability) : true;
  return { price: Number.isFinite(price) ? price : null, available: avail };
}

/* ---- main ---- */
async function pool(items, worker, concurrency) {
  const results = []; let i = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx); }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  console.log(`Fetching sitemap ${SITEMAP} …`);
  const sm = await getText(SITEMAP);
  if (!sm.ok) throw new Error(`sitemap HTTP ${sm.status}`);
  const entries = [...sm.body.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((m) => {
    const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i) || [])[1];
    const lastmod = (m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i) || [])[1] || null;
    return loc ? { loc, lastmod } : null;
  }).filter(Boolean);

  // Drop obvious category / CMS pages to cut wasted fetches; keep the rest and
  // confirm each is a product via its JSON-LD.
  const KNOWN_CATS = /^(bags|accessories|jewellery|home|gifts|travel|womenswear|sale|new-in|archive|collections|mothers-day|christmas|brand|about|contact|blog|stores|catalog\/category)(\/|$)/i;
  let candidates = entries.filter((e) => {
    const path = new URL(e.loc).pathname.replace(/^\//, "");
    if (/^catalog\/category\//i.test(path)) return false;
    if (KNOWN_CATS.test(path)) return false;
    return true;
  });
  if (MAX > 0) candidates = candidates.slice(0, MAX);
  console.log(`${entries.length} sitemap URLs → ${candidates.length} product candidates (fetching with concurrency ${CONCURRENCY})…`);

  let done = 0, products = [];
  await pool(candidates, async (e) => {
    let r; try { r = await getText(e.loc); } catch { return; }
    done++;
    if (done % 100 === 0) process.stdout.write(`  fetched ${done}/${candidates.length}, products ${products.length}\r`);
    if (!r.ok) return;
    const objs = ldObjects(r.body);
    const product = objs.find((o) => typeOf(o).includes("Product"));
    if (!product) return;
    const crumbsObj = objs.find((o) => typeOf(o).includes("BreadcrumbList"));
    const crumbs = crumbsObj && Array.isArray(crumbsObj.itemListElement)
      ? crumbsObj.itemListElement.map((el) => (el.name || (el.item && el.item.name) || "")).filter((n) => n && !/^home$/i.test(n))
      : [];
    crumbs.pop(); // last crumb is the product itself
    const name = product.name || "";
    const cat = categorise(name, crumbs);
    const { price: ldPrice, available } = offerPrice(product);
    const { final, old } = pricesFromHtml(r.body);
    const price = final ?? ldPrice ?? 0;
    // Prefer a real old-price from the page; otherwise derive it from a
    // "Sale › 60%" style breadcrumb so discount depth still shows.
    let compareAt = old && old > price ? old : 0;
    if (!compareAt) { const pct = discountFromCrumbs(crumbs); if (pct) compareAt = Math.round((price / (1 - pct / 100)) * 100) / 100; }
    const image = Array.isArray(product.image) ? product.image[0] : product.image || null;
    products.push({
      title: name,
      handle: new URL(e.loc).pathname.replace(/^\//, "").replace(/\/$/, ""),
      url: e.loc,
      brand: (product.brand && (product.brand.name || product.brand)) || "Katie Loxton",
      category: cat,
      breadcrumb: crumbs.join(" › "),
      sku: product.sku || null,
      price,
      compareAt,
      available,
      colour: colourOf(name, product),
      occasion: occasionOf(name),
      material: materialOf(name, cat),
      createdAt: null,          // Magento pages don't expose created date; see /new-in for newness
      updatedAt: e.lastmod,
      image,
    });
  }, CONCURRENCY);
  console.log("");

  const clean = products.filter((p) => p.price > 0);
  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: ORIGIN,
    platform: "magento",
    currency: "GBP",
    brands: [...new Set(clean.map((p) => p.brand))].sort(),
    count: clean.length,
    products: clean,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));

  // Summary
  const byCat = {}; for (const p of clean) byCat[p.category] = (byCat[p.category] || 0) + 1;
  const onSale = clean.filter((p) => p.compareAt > p.price).length;
  const oos = clean.filter((p) => !p.available).length;
  const prices = clean.map((p) => p.price).sort((a, b) => a - b);
  console.log(`\nWrote ${clean.length} products → data/products.json`);
  console.log(`  price £${prices[0]}–£${prices[prices.length - 1]}, on sale ${onSale}, out of stock ${oos}`);
  console.log("  by category:");
  Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`    ${String(n).padStart(4)}  ${c}`));
}

main().catch((e) => { console.error("\nScrape failed:", e.message, e.cause?.code || ""); process.exit(1); });
