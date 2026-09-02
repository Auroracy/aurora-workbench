/**
 * aurora-fund-proxy —— Cloudflare Worker
 * 代理新浪 hq.sinajs.cn 基金盘中实时估算，输出与 aurora-workbench server.js
 * /api/fund-gsz 完全一致的 JSON，让 GitHub Pages 托管的页面无需自建 server
 * 即可默认拿到今日实时估值（红涨绿跌的 GSZ / GSZZL）。
 *
 * 部署后把你的 Worker 地址（如 https://aurora-fund.xxx.workers.dev）
 * 填回前端 HTML 的 DEFAULT_WORKER_BASE，GitHub Pages 用户即默认生效。
 *
 * 接口： GET /api/fund-gsz?codes=017811,000369
 * 返回： { ts, count, source, data:{ "017811":{name,gsz,gszzl,dwjz,gztime,jzrq}, ... } }
 */

// 30s 内存缓存，降低对新浪的请求频率（个人用量足够；同 isolate 内共享）
const CACHE_TTL = 30 * 1000;
const cache = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }
    if (request.method !== 'GET') {
      return cors(json({ error: '仅支持 GET' }, 405));
    }

    const codesParam = url.searchParams.get('codes') || '';
    const list = codesParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{6}$/.test(s));
    if (!list.length) {
      return cors(json({ error: '缺少有效 codes 参数, 例如 ?codes=017811,000369' }, 400));
    }

    const key = list.join(',');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      return cors(json(hit.payload, 200));
    }

    const sinaList = list.map((c) => 'fu_' + c).join(',');
    const target = 'https://hq.sinajs.cn/list=' + sinaList;

    try {
      const upstream = await fetch(target, {
        headers: {
          // 新浪必须带 Referer，否则返回空/403
          Referer: 'https://finance.sina.com.cn/',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      if (!upstream.ok) {
        return cors(json({ error: '新浪接口 HTTP ' + upstream.status }, 502));
      }

      // 新浪返回 GBK 编码；本 Worker 用默认 UTF-8 解码。
      // 数字/日期字段均为 ASCII，解码后完好无损；仅中文基金名会乱码，
      // 这里直接丢弃（name:''），前端回退用户自己的配置名。
      const text = await upstream.text();

      const results = {};
      const re = /hq_str_fu_(\d{6})="([^"]*)"/g;
      let mm;
      while ((mm = re.exec(text)) !== null) {
        const code = mm[1];
        const f = mm[2].split(',');
        if (f.length < 8) continue;
        const gsz = parseFloat(f[2]); // 当前估算净值
        const dwjz = parseFloat(f[3]); // 昨收单位净值
        const gszzl = parseFloat(f[6]); // 估算涨跌幅 %
        const date = f[7]; // 净值日期 YYYY-MM-DD
        const time = f[1]; // 时间 HH:MM:SS
        results[code] = {
          name: '',
          gsz: isNaN(gsz) ? null : gsz,
          gszzl: isNaN(gszzl) ? null : gszzl,
          dwjz: isNaN(dwjz) ? null : dwjz,
          gztime: date && time ? date + ' ' + time : date || null,
          jzrq: date || null,
        };
      }

      const payload = {
        ts: Date.now(),
        count: Object.keys(results).length,
        source: 'sina hq.sinajs.cn (cloudflare worker)',
        data: results,
      };
      cache.set(key, { ts: Date.now(), payload });
      return cors(json(payload, 200));
    } catch (e) {
      return cors(json({ error: '上游请求失败: ' + e.message }, 502));
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', '*');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
