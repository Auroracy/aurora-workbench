// Aurora · 国内金价（SGE Au99.99）CORS 代理
// 部署步骤（约 2 分钟）：
//   1. 打开 https://dash.cloudflare.com → 左侧 Workers & Pages → Create → Create Worker
//   2. 命名（如 aurora-sge-proxy），点 Deploy
//   3. 进入 Worker → Edit Code → 粘贴本文件全文 → Save and Deploy
//   4. 复制 Worker URL（形如 https://aurora-sge-proxy.auroracy.workers.dev）
//   5. 回到工作台 Tab4 → 国内金价瓦片 → 点「⚙ 代理」→ 粘贴 URL → 保存
//
// 接口：
//   GET /sge       → 上金所 Au99.99 实时报价 JSON
//   GET /health    → 健康检查
//   GET /          → 帮助
//
// 安全：纯只读 GET，数据公开（CORS *），无密钥。
// 费用：Cloudflare Workers 免费额度 10 万次/天，足够个人日常使用。

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=30',
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
        // SGE 接口返回 GB18030 编码
        const text = new TextDecoder('gb18030').decode(buf);
        const m = text.match(/="([^"]*)"/);
        if (!m) {
          return json({ error: 'parse failed', raw: text.slice(0, 200) }, 502, corsHeaders);
        }
        const parts = m[1].split(',');
        // 字段顺序（实测）：name, current, ?, ?, open, high, low, prev, bid, ask, ..., time, chgPct%
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
          // 实测 SGE 字段顺序：0=品种代码 1=中文名(GB18030) 2=英文名 3=最新价 4=开盘 5=昨收 ... 16=时间 17=涨跌幅%
          time: parts[16] || '',
          ts: Date.now(),
        }, 200, corsHeaders);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500, corsHeaders);
      }
    }

    // === /health 健康检查 ===
    if (url.pathname === '/health') {
      return json({ ok: true, ts: Date.now() }, 200, corsHeaders);
    }

    // === / 帮助 ===
    return new Response(
      'Aurora SGE Proxy · GET /sge → 上金所 Au99.99 实时报价\n' +
      '                · GET /health → 健康检查\n' +
      '                · CORS: * (open)\n',
      { headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  },
};

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function round2(n) { return Math.round(n * 100) / 100; }