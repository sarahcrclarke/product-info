#!/usr/bin/env node
/**
 * Enriches the built-in sample dataset with the extra dimensions the dashboard
 * now uses (occasion, colour, material, added-date, brand) and rewrites the
 * <script id="seed"> block in index.html to full objects — the SAME shape the
 * live scraper emits, so the app has one code path for sample and live data.
 *
 * Reuses the product list already embedded in index.html, so the source of
 * truth for the sample stays in one place.
 *
 *     node scripts/gen-sample.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const INDEX = fileURLToPath(new URL("../index.html", import.meta.url));
const SAMPLE = fileURLToPath(new URL("../data/products.sample.json", import.meta.url));

const html = readFileSync(INDEX, "utf8");
const seedMatch = html.match(/(<script type="application\/json" id="seed">)([\s\S]*?)(<\/script>)/);
const seed = JSON.parse(seedMatch[2]);
// seed.products may already be tuples (first run) or objects (subsequent runs)
const base = seed.products.map((p) =>
  Array.isArray(p) ? { title: p[0], category: p[1], price: p[2], compareAt: p[3] || 0, available: !!p[4] }
                   : { title: p.title, category: p.category, price: p.price, compareAt: p.compareAt || 0, available: p.available });

const slug = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
const has = (t, ...w) => w.some((x) => t.toLowerCase().includes(x));

function colourOf(t) {
  if (has(t, "blush")) return "Blush";
  if (has(t, "sage")) return "Sage";
  if (has(t, "tortoise")) return "Tortoiseshell";
  if (has(t, "gold")) return "Gold";
  if (has(t, "spot")) return "Monochrome";
  return null;
}
const CAT_COLOUR = { "Bags": "Tan", "Purses & Wallets": "Black", "Accessories": "Blush", "Jewellery": "Gold",
  "Home & Fragrance": "Cream", "Gifts": "Blush", "Perfect Pouches": "Sage" };

function occasionOf(t, cat) {
  if (has(t, "mum")) return "Mum";
  if (has(t, "bride")) return "Wedding";
  if (has(t, "bridesmaid")) return "Wedding";
  if (has(t, "baby")) return "New Baby";
  if (has(t, "best friend", "friendship")) return "Best Friend";
  if (has(t, "thank you")) return "Thank You";
  if (has(t, "birthday", "birthstone")) return "Birthday";
  if (has(t, "pamper", "prosecco")) return "Treat / Self";
  if (cat === "Perfect Pouches" || cat === "Gifts") return "Everyday Gifting";
  return "Everyday";
}
function materialOf(t, cat) {
  if (has(t, "straw", "basket")) return "Straw";
  if (has(t, "woven")) return "Woven";
  if (has(t, "candle", "wax", "melt")) return "Wax";
  if (has(t, "diffuser")) return "Glass";
  if (has(t, "dish", "frame", "ceramic")) return "Ceramic";
  if (has(t, "scarf")) return "Cotton";
  if (has(t, "sunglass")) return "Acetate";
  if (has(t, "keyring", "hoop", "stud", "chain", "necklace", "bracelet", "pendant", "clip")) return "Metal";
  if (cat === "Bags" || cat === "Purses & Wallets") return "Vegan Leather";
  if (cat === "Perfect Pouches") return "Cotton";
  return "Mixed";
}
// Deterministic spread of "added" dates: ~1 in 5 recent (<90d), rest across the year.
function daysAgoFor(i, n) {
  const seq = [18, 210, 130, 320, 42, 250, 155, 400, 235, 300, 190, 110, 500, 75, 165, 275, 350, 125, 460, 220];
  return seq[i % seq.length] + ((i * 13) % 20);
}

const today = new Date("2026-07-09T00:00:00Z");
const products = base.map((p, i) => {
  const created = new Date(today.getTime() - daysAgoFor(i, base.length) * 86400000);
  return {
    title: p.title,
    handle: slug(p.title),
    url: "https://www.katieloxton.com/products/" + slug(p.title),
    brand: "Katie Loxton",
    category: p.category,
    price: p.price,
    compareAt: p.compareAt || 0,
    available: p.available,
    colour: colourOf(p.title) || CAT_COLOUR[p.category] || "Mixed",
    occasion: occasionOf(p.title, p.category),
    material: materialOf(p.title, p.category),
    createdAt: created.toISOString().slice(0, 10),
    image: null,
  };
});

const out = {
  generatedAt: "2026-07-09",
  source: "sample",
  currency: "GBP",
  brands: ["Katie Loxton"],
  count: products.length,
  products,
};

writeFileSync(SAMPLE, JSON.stringify(out, null, 0));
const newSeed = seedMatch[1] + "\n" + JSON.stringify(out) + "\n" + seedMatch[3];
writeFileSync(INDEX, html.replace(seedMatch[0], newSeed));

const facet = (k) => [...new Set(products.map((p) => p[k]))].sort();
console.log(`Enriched ${products.length} sample products → seed + data/products.sample.json`);
console.log("  occasions:", facet("occasion").join(", "));
console.log("  colours:  ", facet("colour").join(", "));
console.log("  materials:", facet("material").join(", "));
console.log("  new (<90d):", products.filter((p) => (today - new Date(p.createdAt)) / 86400000 < 90).length);
