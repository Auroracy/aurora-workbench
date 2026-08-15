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

    // === /sge 上金所 Au99.99 国内基准金价 ===
    //   数据源：东方财富行情接口（push2delay 主用，push2 兜底），免鉴权、实时
    //   secid 118.AU9999 = 上海黄金交易所现货频道 Au99.99，单位「元/克」，接口编码 ×100
    if (url.pathname === '/sge') {
      try {
        const SECID = '118.AU9999';
        const HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com'];
        let lastErr = null;
        for (const host of HOSTS) {
          try {
            const target = 'https://' + host +
              '/api/qt/stock/get?secid=' + SECID +
              '&fields=f43,f44,f45,f60,f86,f169,f170,f58';
            const upstream = await fetch(target, {
              headers: { 'Referer': 'https://quote.eastmoney.com/' },
            });
            if (!upstream.ok) { lastErr = 'HTTP ' + upstream.status; continue; }
            const j = await upstream.json();
            const d = j && j.data;
            if (!d || d.f43 == null) { lastErr = 'empty data'; continue; }
            const price = d.f43 / 100;   // 元/克
            const prev = d.f60 / 100;    // 昨收 元/克
            const chg = d.f169 / 100;    // 涨跌额 元/克
            const chgPct = d.f170 / 100; // 涨跌幅 %
            return json({
              price: round2(price),
              prev: round2(prev),
              chg: round2(chg),
              chgPct: round2(chgPct),
              name: d.f58 || 'SGE Au99.99',
              unit: '元/克',
              high: round2((d.f44 || 0) / 100),
              low: round2((d.f45 || 0) / 100),
              time: d.f86 || '',
              ts: Date.now(),
            }, 200, corsHeaders);
          } catch (e) { lastErr = String(e && e.message || e); }
        }
        return json({ error: 'SGE 上游全部失败', detail: lastErr }, 502, corsHeaders);
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