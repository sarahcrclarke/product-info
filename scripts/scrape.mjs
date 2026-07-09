#!/usr/bin/env node
/**
 * Katie Loxton catalogue scraper.
 *
 * Katie Loxton runs on Shopify, which exposes a public, read-only products
 * feed at /products.json (paginated). This script walks every page, normalises
 * each product into the shape the dashboard expects, and writes data/products.json.
 *
 * Run it anywhere with open web access:
 *     node scripts/scrape.mjs
 *
 * Options (env vars):
 *     BASE=https://www.katieloxton.com   base store URL
 *     LIMIT=250                          products per page (Shopify max 250)
 *
 * No dependencies — uses Node 18+ global fetch.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.BASE || "https://www.katieloxton.com").replace(/\/$/, "");
const LIMIT = Number(process.env.LIMIT || 250);
const OUT = fileURLToPath(new URL("../data/products.json", import.meta.url));

/* Map Shopify product_type / tags into the dashboard's top-level categories.
   Tune this map after your first run by inspecting the raw product_type values
   printed in the run summary. */
const CATEGORY_MAP = [
  [/pouch/i,                         "Perfect Pouches"],
  [/purse|wallet|card holder|coin/i, "Purses & Wallets"],
  [/bag|tote|backpack|holdall|clutch|crossbody|cross body/i, "Bags"],
  [/necklace|earring|bracelet|jewel|ring|pendant/i, "Jewellery"],
  [/candle|diffuser|fragrance|home|wax|hand cream|frame|dish/i, "Home & Fragrance"],
  [/gift|set|box|hamper/i,           "Gifts"],
  [/scarf|sunglass|keyring|umbrella|hair|passport|travel|accessor/i, "Accessories"],
];
function categorise(p) {
  const hay = `${p.product_type || ""} ${(p.tags || []).join(" ")} ${p.title}`;
  for (const [re, cat] of CATEGORY_MAP) if (re.test(hay)) return cat;
  return p.product_type || "Other";
}

function normalise(p) {
  const variants = p.variants || [];
  const prices = variants.map((v) => Number(v.price)).filter((n) => n > 0);
  const price = prices.length ? Math.min(...prices) : 0;
  const compareAt = Math.max(0, ...variants.map((v) => Number(v.compare_at_price) || 0));
  const available = variants.some((v) => v.available);
  return {
    title: p.title,
    handle: p.handle,
    url: `${BASE}/products/${p.handle}`,
    category: categorise(p),
    productType: p.product_type || "",
    tags: p.tags || [],
    vendor: p.vendor || "",
    price,
    compareAt: compareAt > price ? compareAt : 0,
    available,
    image: (p.images && p.images[0] && p.images[0].src) || null,
    createdAt: p.created_at || null,
  };
}

async function fetchPage(page) {
  const url = `${BASE}/products.json?limit=${LIMIT}&page=${page}`;
  const r = await fetch(url, { headers: { "User-Agent": "kl-product-intelligence/1.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} on page ${page} — ${url}`);
  const json = await r.json();
  return json.products || [];
}

async function main() {
  console.log(`Scraping ${BASE}/products.json …`);
  const products = [];
  for (let page = 1; page <= 200; page++) {
    const batch = await fetchPage(page);
    if (!batch.length) break;
    products.push(...batch);
    process.stdout.write(`  page ${page}: ${batch.length} (total ${products.length})\r`);
  }
  console.log("");

  const normalised = products.map(normalise).filter((p) => p.price > 0);
  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: BASE,
    currency: "GBP",
    count: normalised.length,
    products: normalised,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 0));

  // Summary — useful for tuning CATEGORY_MAP.
  const byCat = {};
  for (const p of normalised) byCat[p.category] = (byCat[p.category] || 0) + 1;
  const types = [...new Set(products.map((p) => p.product_type).filter(Boolean))].sort();
  console.log(`\nWrote ${normalised.length} products → data/products.json`);
  console.log("\nBy category:");
  Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${String(n).padStart(4)}  ${c}`));
  console.log(`\nRaw Shopify product_type values seen (tune CATEGORY_MAP if any land in "Other"):`);
  console.log("  " + types.join(", "));
}

main().catch((e) => { console.error("\nScrape failed:", e.message); process.exit(1); });
