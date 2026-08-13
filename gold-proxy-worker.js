// Aurora · 多用途 CORS 代理
//   - /sge              → 上金所 Au99.99 实时报价 JSON
//   - /eastmoney/ann    → 东方财富公告 API（np-anotice-stock.eastmoney.com）
//   - /eastmoney/proxy  → 任意东方财富 JSON API 转发（白名单域名）
//   - /health           → 健康检查
//   - /                 → 帮助
//
// 部署步骤（约 2 分钟）：
//   1. https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
//   2. 命名（如 aurora-sge-proxy），点 Deploy
//   3. 进入 Worker → Edit Code → 粘贴本文件全文 → Save and Deploy
//   4. 复制 Worker URL（形如 https://aurora-sge-proxy.auroracy.workers.dev）
//   5. 回到工作台 Tab4 → 国内金价瓦片 → 点「⚙ 代理」→ 粘贴 URL → 保存（同时给金价+财报抓取用）
//
// 安全：纯只读 GET，数据公开（CORS *），无密钥；eastmoney/proxy 限定域名白名单。
// 费用：Cloudflare Workers 免费额度 10 万次/天，足够个人日常使用。

const ALLOWED_EASTMONEY_HOSTS = [
  'np-anotice-stock.eastmoney.com',
  'np-cnotice-stock.eastmoney.com',
  'datacenter-web.eastmoney.com',
  'datacenter.eastmoney.com',
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=20',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // === /sge 上金所 Au99.99 ===
    if (url.pathname === '/sge') {
      try {
        const upstream = await fetch('https://hq.sinajs.cn/list=SGE_AU9999', {
          headers: {
            'Referer': 'https://finance.sina.com.cn/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          },
        });
        if (!upstream.ok) {
          return json({ error: 'SGE upstream HTTP ' + upstream.status }, 502, corsHeaders);
        }
        const buf = await upstream.arrayBuffer();
        const text = new TextDecoder('gb18030').decode(buf);
        const m = text.match(/="([^"]*)"/);
        if (!m) {
          return json({ error: 'parse failed', raw: text.slice(0, 200) }, 502, corsHeaders);
        }
        const parts = m[1].split(',');
        const price = parseFloat(parts[3]);
        const chgPct = parseFloat(String(parts[17] || '').replace('%', '').trim());
        if (!isFinite(price) || price <= 0) {
          return json({ error: 'invalid price', parts: parts.slice(0, 20) }, 502, corsHeaders);
        }
        const chg = isFinite(chgPct) ? (price * chgPct / 100) : 0;
        const prev = price - chg;
        return json({
          price: round2(price),
          prev: round2(prev),
          chg: round2(chg),
          chgPct: isFinite(chgPct) ? round2(chgPct) : 0,
          name: parts[1] || 'SGE Au99.99',
          unit: '元/克',
          time: parts[16] || '',
          ts: Date.now(),
        }, 200, corsHeaders);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, corsHeaders);
      }
    }

    // === /eastmoney/ann?params → 东方财富公告 API（推荐路径） ===
    //   前端只传 path 之后的查询串，例如 /eastmoney/ann?sr=-1&page_size=20&...
    //   自动补全 Referer + UA，把 JSON 原样回传
    if (url.pathname === '/eastmoney/ann') {
      const qs = url.search || '';
      const target = 'https://np-anotice-stock.eastmoney.com/api/security/ann' + qs;
      return proxyEastmoneyJSON(target, corsHeaders);
    }

    // === /eastmoney/proxy?url=... → 任意东方财富 JSON API（白名单域名）===
    //   用于未来扩展（基金持仓/行情等）
    if (url.pathname === '/eastmoney/proxy') {
      const target = url.searchParams.get('url') || '';
      let u;
      try { u = new URL(target); } catch (e) { return json({ error: 'invalid url' }, 400, corsHeaders); }
      if (!ALLOWED_EASTMONEY_HOSTS.includes(u.host)) {
        return json({ error: 'host not allowed: ' + u.host, allowed: ALLOWED_EASTMONEY_HOSTS }, 403, corsHeaders);
      }
      return proxyEastmoneyJSON(target, corsHeaders);
    }

    // === /health 健康检查 ===
    if (url.pathname === '/health') {
      return json({ ok: true, ts: Date.now(), routes: ['/sge', '/eastmoney/ann', '/eastmoney/proxy'] }, 200, corsHeaders);
    }

    // === / 帮助 ===
    return new Response(
      'Aurora Proxy · GET /sge                  → 上金所 Au99.99\n' +
      '             · GET /eastmoney/ann?…       → 东方财富公告 API（科技公司财报）\n' +
      '             · GET /eastmoney/proxy?url=… → 任意东方财富 JSON API（白名单）\n' +
      '             · GET /health                → 健康检查\n' +
      '             · CORS: * (open)\n',
      { headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  },
};

async function proxyEastmoneyJSON(target, corsHeaders) {
  try {
    const upstream = await fetch(target, {
      headers: {
        'Referer': 'https://data.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!upstream.ok) {
      return json({ error: 'eastmoney upstream HTTP ' + upstream.status }, 502, corsHeaders);
    }
    const txt = await upstream.text();
    // 原样转发（东财返回 application/json），保留 status
    return new Response(txt, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500, corsHeaders);
  }
}

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function round2(n) { return Math.round(n * 100) / 100; }