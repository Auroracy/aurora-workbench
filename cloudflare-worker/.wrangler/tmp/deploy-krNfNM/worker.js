var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var CACHE_TTL = 30 * 1e3;
var cache = /* @__PURE__ */ new Map();
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }
    if (request.method !== "GET") {
      return cors(json({ error: "\u4EC5\u652F\u6301 GET" }, 405));
    }
    const codesParam = url.searchParams.get("codes") || "";
    const list = codesParam.split(",").map((s) => s.trim()).filter((s) => /^\d{6}$/.test(s));
    if (!list.length) {
      return cors(json({ error: "\u7F3A\u5C11\u6709\u6548 codes \u53C2\u6570, \u4F8B\u5982 ?codes=017811,000369" }, 400));
    }
    const key = list.join(",");
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      return cors(json(hit.payload, 200));
    }
    const sinaList = list.map((c) => "fu_" + c).join(",");
    const target = "https://hq.sinajs.cn/list=" + sinaList;
    try {
      const upstream = await fetch(target, {
        headers: {
          // 新浪必须带 Referer，否则返回空/403
          Referer: "https://finance.sina.com.cn/",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
      });
      if (!upstream.ok) {
        return cors(json({ error: "\u65B0\u6D6A\u63A5\u53E3 HTTP " + upstream.status }, 502));
      }
      const text = await upstream.text();
      const results = {};
      const re = /hq_str_fu_(\d{6})="([^"]*)"/g;
      let mm;
      while ((mm = re.exec(text)) !== null) {
        const code = mm[1];
        const f = mm[2].split(",");
        if (f.length < 8) continue;
        const gsz = parseFloat(f[2]);
        const dwjz = parseFloat(f[3]);
        const gszzl = parseFloat(f[6]);
        const date = f[7];
        const time = f[1];
        results[code] = {
          name: "",
          gsz: isNaN(gsz) ? null : gsz,
          gszzl: isNaN(gszzl) ? null : gszzl,
          dwjz: isNaN(dwjz) ? null : dwjz,
          gztime: date && time ? date + " " + time : date || null,
          jzrq: date || null
        };
      }
      const payload = {
        ts: Date.now(),
        count: Object.keys(results).length,
        source: "sina hq.sinajs.cn (cloudflare worker)",
        data: results
      };
      cache.set(key, { ts: Date.now(), payload });
      return cors(json(payload, 200));
    } catch (e) {
      return cors(json({ error: "\u4E0A\u6E38\u8BF7\u6C42\u5931\u8D25: " + e.message }, 502));
    }
  }
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
__name(json, "json");
function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "*");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
__name(cors, "cors");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
