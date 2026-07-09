#!/usr/bin/env node
/**
 * Discovery probe for katieloxton.com — the site is not standard Shopify, so
 * this reports HOW product data is embedded (structured data, a JS state blob,
 * a sitemap, an internal API, or a headless-Shopify backend) so we can build
 * the right extractor. Diagnostic only; writes nothing.
 *
 *     node scripts/discover.mjs
 */
const BASE = (process.env.BASE || "https://www.katieloxton.com").replace(/\/$/, "");
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};
const get = async (url) => {
  const r = await fetch(url, { headers: HEADERS, redirect: "follow" });
  return { status: r.status, ctype: r.headers.get("content-type") || "", body: await r.text() };
};
const show = (label, v) => console.log(`  ${label.padEnd(24)} ${v}`);
const first = (re, s, n = 1) => { const m = s.match(re); return m ? m.slice(0, n + 1).join(" | ").slice(0, 160) : "—"; };

async function main() {
  console.log(`\n=== Discovery: ${BASE} ===\n`);

  // 1) Homepage signals
  const home = await get(BASE + "/");
  console.log(`Homepage: ${home.status} ${home.ctype.split(";")[0]} ${home.body.length}b`);
  const b = home.body;
  show("myshopify host:", first(/[a-z0-9-]+\.myshopify\.com/gi, b));
  show("cdn.shopify:", /cdn\.shopify/i.test(b) ? "present (headless Shopify?)" : "—");
  show("shopify storefront:", /shopify(-storefront|\.com\/api)/i.test(b) ? "present" : "—");
  show("__NEXT_DATA__:", /__NEXT_DATA__/.test(b) ? "present (Next.js)" : "—");
  show("__NUXT__:", /__NUXT__/.test(b) ? "present (Nuxt)" : "—");
  show("__APOLLO_STATE__:", /__APOLLO_STATE__/.test(b) ? "present" : "—");
  show("Algolia:", first(/algolia[^"']{0,40}/gi, b));
  show("app id hint:", first(/"(?:appId|applicationId|x-algolia-application-id)"\s*:\s*"([^"]+)"/i, b));
  show("graphql endpoints:", first(/["'][^"']*graphql[^"']*["']/gi, b));
  show("api paths:", first(/["']\/api\/[a-z0-9/_-]+["']/gi, b, 3));
  const ld = [...b.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  show("ld+json blocks:", ld.length);
  ld.slice(0, 6).forEach((m, i) => {
    try { const j = JSON.parse(m[1].trim()); const t = j["@type"] || (j["@graph"] && j["@graph"].map(x => x["@type"]).join(",")); console.log(`      ld[${i}] @type=${t}`); }
    catch { console.log(`      ld[${i}] (unparseable)`); }
  });
  show("platform meta:", first(/<meta[^>]+(generator|powered)[^>]+content="([^"]+)"/i, b));

  // 2) Sitemaps — the reliable way to enumerate every product URL
  for (const sm of ["/sitemap.xml", "/sitemap_index.xml", "/robots.txt"]) {
    try {
      const r = await get(BASE + sm);
      const locs = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
      const sitemapLine = sm === "/robots.txt" ? first(/Sitemap:\s*(\S+)/gi, r.body, 4) : `${locs.length} <loc> entries`;
      console.log(`\n${sm}: ${r.status} — ${sitemapLine}`);
      locs.slice(0, 12).forEach((l) => console.log(`      ${l}`));
    } catch (e) { console.log(`\n${sm}: error ${e.message}`); }
  }

  // 3) A product-listing page — does it carry JSON-LD ItemList / product prices?
  for (const path of ["/bags", "/sale"]) {
    try {
      const r = await get(BASE + path);
      const ld2 = [...r.body.matchAll(/application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
      const prices = [...r.body.matchAll(/"price"\s*:\s*"?([\d.]+)/gi)].length;
      console.log(`\n${path}: ${r.status} ${r.body.length}b — ld+json=${ld2.length}, "price" hits=${prices}`);
    } catch (e) { console.log(`\n${path}: error ${e.message}`); }
  }
  console.log("\n=== end ===");
}
main().catch((e) => { console.error("Discovery failed:", e.message, e.cause?.code || ""); process.exit(1); });
