#!/usr/bin/env node
/**
 * Discovery probe (round 2) for katieloxton.com.
 * The site is custom (not Shopify) but declares a sitemap in robots.txt.
 * This walks the sitemap index to find product URLs, then analyses a sample
 * product page to see how per-product data (price, availability, category) is
 * embedded, so we can build the right extractor. Diagnostic only.
 */
const SITEMAP = process.env.SITEMAP || "https://katieloxton.com/media/sitemaps/sitemap_kl.xml";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};
const get = async (url) => {
  const r = await fetch(url, { headers: HEADERS, redirect: "follow" });
  return { status: r.status, ctype: r.headers.get("content-type") || "", body: await r.text(), url: r.url };
};
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

async function main() {
  console.log(`\n=== Sitemap walk: ${SITEMAP} ===`);
  const idx = await get(SITEMAP);
  console.log(`index: ${idx.status} ${idx.ctype.split(";")[0]} ${idx.body.length}b`);
  const top = locs(idx.body);
  const children = top.filter((u) => /\.xml/i.test(u));
  console.log(`  ${top.length} <loc>; ${children.length} look like child sitemaps`);
  top.slice(0, 15).forEach((u) => console.log(`   · ${u}`));

  // Gather product URLs from child sitemaps (or from the index itself if it's a urlset).
  let urls = [];
  if (children.length) {
    for (const c of children.slice(0, 12)) {
      try { const r = await get(c); const u = locs(r.body); console.log(`  child ${c.split("/").pop()} → ${u.length} urls`); urls.push(...u); }
      catch (e) { console.log(`  child ${c} error ${e.message}`); }
    }
  } else {
    urls = top;
  }
  urls = [...new Set(urls)].filter((u) => !/\.xml/i.test(u));
  console.log(`\nTotal non-sitemap URLs: ${urls.length}`);

  // Heuristic: product URLs tend to be the deepest / most numerous leaf pattern.
  const byPrefix = {};
  for (const u of urls) { const seg = (u.replace(/^https?:\/\/[^/]+/, "").split("/").filter(Boolean)[0] || "(root)"); byPrefix[seg] = (byPrefix[seg] || 0) + 1; }
  console.log("URL count by first path segment:");
  Object.entries(byPrefix).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, n]) => console.log(`   /${k.padEnd(20)} ${n}`));

  // Analyse a couple of candidate product pages.
  const candidates = urls.filter((u) => /product|\/p\/|-p\d|\/prod/i.test(u)).slice(0, 2);
  const sample = candidates.length ? candidates : urls.slice(0, 2);
  for (const u of sample) {
    try {
      const r = await get(u);
      const ld = [...r.body.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
      const types = ld.map((m) => { try { const j = JSON.parse(m[1].trim()); return j["@type"] || (j["@graph"]||[]).map(x=>x["@type"]).join("+"); } catch { return "?"; } });
      const hasProduct = ld.some((m) => /"@type"\s*:\s*"Product"/.test(m[1]));
      const offer = r.body.match(/"price"\s*:\s*"?([\d.]+)"?[\s\S]{0,120}?"availability"\s*:\s*"([^"]+)"/i);
      const pound = (r.body.match(/£\s?\d[\d.,]*/g) || []).slice(0, 4);
      console.log(`\nPRODUCT? ${u}`);
      console.log(`  status ${r.status} ${r.body.length}b · ld+json=[${types.join(", ")}] · Product=${hasProduct}`);
      console.log(`  offer match: ${offer ? offer[1] + " / " + offer[2] : "—"} · £-text: ${pound.join("  ") || "—"}`);
    } catch (e) { console.log(`  ${u} error ${e.message}`); }
  }
  console.log("\n=== end ===");
}
main().catch((e) => { console.error("Discovery failed:", e.message, e.cause?.code || ""); process.exit(1); });
