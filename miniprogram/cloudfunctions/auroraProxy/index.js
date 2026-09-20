/* ===== Aurora 工作台 · 联网代理云函数 =====
 *
 * 为什么需要它：
 *   小程序 wx.request 有硬限制 —— 必须 https、域名必须 ICP 备案、
 *   还必须在后台「服务器域名」里加白名单，http / IP / 带端口一律拒绝。
 *   而云函数跑在服务端，不受这套规则约束。
 *   所以：小程序 --wx.cloud.callFunction--> 云函数 --https--> 行情/新闻接口
 *   个人主体不买域名、不备案，也能联网。
 *
 * 安全：只放行下面白名单里的域名，拒绝任意转发（避免被拿去当中转站）。
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

let iconv = null;
try { iconv = require('iconv-lite'); } catch (e) { /* 未安装则退回 utf8 */ }

/* 与网页版 server.js 使用的数据源一致 */
const ALLOW = [
  /* 新浪 */
  'hq.sinajs.cn', 'finance.sina.com.cn', 'feed.mix.sina.com.cn',
  /* 东方财富 */
  'fundmobapi.eastmoney.com', 'api.fund.eastmoney.com', 'fundf10.eastmoney.com',
  'fund.eastmoney.com', 'np-anotice-stock.eastmoney.com', 'quote.eastmoney.com',
  'fundgz.1234567.com.cn',
  /* 腾讯行情 */
  'qt.gtimg.cn', 'web.ifzq.gtimg.cn', 'stockapp.finance.qq.com',
  /* 央视新闻联播 */
  'tv.cctv.com',
  /* 上海黄金交易所 */
  'www.sge.com.cn',
  /* 其它 */
  'cn.govopendata.com', 'mrxwlb.com'
];

function allowed(host) {
  const h = (host || '').toLowerCase();
  return ALLOW.some(function (d) { return h === d || h.endsWith('.' + d); });
}

function fetchUrl(rawUrl, headers, encoding) {
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(rawUrl); } catch (e) { return reject(new Error('URL 不合法')); }
    if (!allowed(u.hostname)) return reject(new Error('域名不在白名单：' + u.hostname));

    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'Referer': u.origin + '/',
        'Accept': '*/*'
      }, headers || {}),
      timeout: 12000
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const buf = Buffer.concat(chunks);
        let text = buf.toString('utf8');
        /* 新浪的行情接口是 GBK，需要转码 */
        if (iconv && /(gbk|gb2312|gb18030)/i.test(encoding || '')) {
          try { text = iconv.decode(buf, 'gb18030'); } catch (e) { /* 忽略 */ }
        }
        resolve({ ok: true, status: res.statusCode, body: text });
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(new Error('请求超时（12s）')); });
    req.end();
  });
}

exports.main = async function (event) {
  const url = event && event.url;
  if (!url) return { ok: false, error: '缺少 url 参数' };
  try {
    return await fetchUrl(url, (event && event.headers) || {}, (event && event.encoding) || '');
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
};
