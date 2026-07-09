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

/* Derive the extra dimensions the dashboard uses. These read from Shopify
   options/tags/title; tune the keyword lists once you've seen real data. */
const OCCASION_MAP = [
  [/\bmum\b|mother/i, "Mum"], [/bride|wedding|bridesmaid|hen\b/i, "Wedding"],
  [/baby|christening/i, "New Baby"], [/best friend|friendship|bestie/i, "Best Friend"],
  [/thank you|thanks/i, "Thank You"], [/birthday|birthstone/i, "Birthday"],
  [/pamper|prosecco|treat|self.?care/i, "Treat / Self"], [/anniversary/i, "Anniversary"],
];
function occasionOf(p) {
  const hay = `${p.title} ${(p.tags || []).join(" ")}`;
  for (const [re, o] of OCCASION_MAP) if (re.test(hay)) return o;
  return /gift|pouch/i.test(`${p.product_type} ${p.title}`) ? "Everyday Gifting" : "Everyday";
}
const MATERIAL_MAP = [
  [/straw|basket|raffia/i, "Straw"], [/woven/i, "Woven"], [/candle|wax|melt/i, "Wax"],
  [/diffuser|glass/i, "Glass"], [/ceramic|dish|frame|porcelain/i, "Ceramic"],
  [/scarf|cotton|canvas/i, "Cotton"], [/sunglass|acetate/i, "Acetate"],
  [/necklace|earring|bracelet|pendant|chain|hoop|stud|ring|metal|gold|silver/i, "Metal"],
  [/leather/i, "Vegan Leather"],
];
function materialOf(p) {
  const hay = `${p.title} ${p.product_type} ${(p.tags || []).join(" ")}`;
  for (const [re, m] of MATERIAL_MAP) if (re.test(hay)) return m;
  const cat = categorise(p);
  if (cat === "Bags" || cat === "Purses & Wallets") return "Vegan Leather";
  if (cat === "Perfect Pouches") return "Cotton";
  return "Mixed";
}
const COLOUR_WORDS = ["Blush","Sage","Tan","Black","Gold","Cream","Navy","Pink","Silver","White",
  "Grey","Gray","Green","Blue","Red","Brown","Tortoiseshell","Monochrome","Natural","Nude","Rose"];
function colourOf(p) {
  // Prefer a Shopify option named Colour/Color.
  const opt = (p.options || []).find((o) => /colou?r/i.test(o.name));
  if (opt && opt.values && opt.values.length) return opt.values[0];
  const hay = `${p.title} ${(p.tags || []).join(" ")}`;
  for (const w of COLOUR_WORDS) if (new RegExp(`\\b${w}\\b`, "i").test(hay)) return w === "Gray" ? "Grey" : w;
  return "Mixed";
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
    brand: p.vendor || "Katie Loxton",
    category: categorise(p),
    productType: p.product_type || "",
    tags: p.tags || [],
    vendor: p.vendor || "",
    price,
    compareAt: compareAt > price ? compareAt : 0,
    available,
    colour: colourOf(p),
    occasion: occasionOf(p),
    material: materialOf(p),
    image: (p.images && p.images[0] && p.images[0].src) || null,
    createdAt: (p.created_at || p.published_at || "").slice(0, 10) || null,
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
    brands: [...new Set(normalised.map((p) => p.brand))].sort(),
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
