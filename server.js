#!/usr/bin/env node
'use strict';
/*
 * Aurora 工作台 · 自托管服务器（纯 Node 内置模块 + 可选 redis）
 * ---------------------------------------------------------------
 * 功能：
 *   1) 托管 aurora-workbench.html（及同目录静态文件）
 *   2) 提供同源 CORS 代理，替代 Cloudflare Worker，覆盖：
 *        /api/sge            上金所 Au99.99 国内金价
 *        /api/sina           新浪滚动资讯（科技/财经）
 *        /api/eastmoney/ann  东方财富财报公告
 *        /api/eastmoney/proxy 东方财富白名单域名转发（基金持仓等）
 *        /api/fundgz         天天基金实时估值
 *        /api/ifzq           腾讯月线（定投30月均线 / 黄金ETF）
 *        /api/qt             腾讯行情（指数/自选，直连也行，留作兜底）
 *   3) 提供 /api/db 全量数据读写（Redis 优先，未配则降级 JSON 文件）
 *        GET  /api/db     拉取全量数据（无需 token，建议仅内网/本机使用）
 *        POST /api/db     保存全量数据（无需 token，Content-Type: application/json）
 *
 * 启动： node server.js            （默认 8080 端口）
 *        PORT=80 node server.js    （用 80 端口，需 root）
 *        HOST=127.0.0.1 node server.js （仅本机访问）
 *        REDIS_URL=redis://127.0.0.1:6379 node server.js （启用 Redis；不设置则降级 JSON 文件）
 *
 * 依赖：redis（可选，npm install redis）；未安装时自动降级为本地 JSON 文件 data/db.json
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 进程级异常兜底：单请求抛错不再拖垮整个服务（仅记录，不退出）
process.on('uncaughtException', function (e) {
  console.error('[uncaughtException] 已捕获，进程继续运行：', (e && e.stack) || e);
});
process.on('unhandledRejection', function (reason) {
  console.error('[unhandledRejection] 已捕获：', (reason && reason.stack) || reason);
});

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const REDIS_URL = process.env.REDIS_URL || '';        // 空 = 降级 JSON 文件
const DB_FILE = path.join(ROOT, 'data', 'db.json');   // JSON 降级存储路径
const DATA_KEY = 'aurora:workbench:db';               // Redis key

// 允许被代理的东方财富/天天基金域名白名单（防止被当作开放代理滥用）
const EASTMONEY_HOSTS = [
  'np-anotice-stock.eastmoney.com',
  'np-cnotice-stock.eastmoney.com',
  'datacenter-web.eastmoney.com',
  'datacenter.eastmoney.com',
  'fundf10.eastmoney.com',
  'fundsuggest.eastmoney.com',
];
const FUNDGZ_HOST = 'fundgz.1234567.com.cn';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---------- 数据持久化层（Redis 优先，未配则降级 JSON 文件） ----------
let redisClient = null;
let redisMode = false;
let fsMode = false;

function initStore() {
  if (REDIS_URL) {
    try {
      const redis = require('redis');
      redisClient = redis.createClient({ url: REDIS_URL });
      redisClient.on('error', function (e) { console.error('[redis] error:', e.message); });
      redisClient.connect().then(function () {
        redisMode = true;
        console.log('[store] Redis 已连接：', REDIS_URL);
        /* 自动迁移：如果 Redis 为空但 JSON 文件有数据，则导入 */
        migrateJsonToRedis();
      }).catch(function (e) {
        console.warn('[store] Redis 连接失败，降级 JSON 文件：', e.message);
        redisClient = null;
        ensureFs();
      });
    } catch (e) {
      console.warn('[store] 未安装 redis 模块，降级 JSON 文件：', e.message);
      ensureFs();
    }
  } else {
    console.log('[store] 未设置 REDIS_URL，使用本地 JSON 文件存储：', DB_FILE);
    ensureFs();
  }
}

function ensureFs() {
  fsMode = true;
  try {
    if (!fs.existsSync(path.join(ROOT, 'data'))) fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}', 'utf8');
  } catch (e) { console.error('[store] 数据目录创建失败：', e.message); }
}

async function dbGet() {
  if (redisMode && redisClient && redisClient.isReady) {
    const raw = await redisClient.get(DATA_KEY);
    if (raw) return raw;
    // Redis 为空（可能被 FLUSH / 重启未开持久化）→ 从磁盘快照 data/db.json 兜底，并回填 Redis。
    // 关键：dbSet 在每次保存时都会同步落盘 data/db.json，因此磁盘快照是最新的、可靠的真相来源，
    // 即使 Redis 在运行中被清空，读取也能从磁盘恢复，不依赖服务器重启时机。
    try {
      const disk = fs.readFileSync(DB_FILE, 'utf8');
      if (disk && disk.trim() && disk.trim() !== '{}' && disk.trim() !== 'null') {
        await redisClient.set(DATA_KEY, disk).catch(function () {});
        console.warn('[store] Redis 为空，已从磁盘快照 data/db.json 恢复并回填 Redis');
        return disk;
      }
    } catch (e) { /* 磁盘也无数据，返回空 */ }
    return '';
  }
  // 文件兜底（同步读）
  try { return fs.readFileSync(DB_FILE, 'utf8'); } catch (e) { return ''; }
}

async function dbSet(dataStr) {
  // 始终同步落盘一份到 data/db.json（已在 .gitignore 排除），作为 Redis 崩溃/重启时的恢复兜底；
  // 配合 initStore→migrateJsonToRedis：Redis 为空但文件有数据时，启动时自动回填 Redis。
  try {
    if (!fs.existsSync(path.join(ROOT, 'data'))) fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
    fs.writeFileSync(DB_FILE, dataStr, 'utf8');
  } catch (e) { console.error('[store] 落盘快照失败：', e.message); }
  // 同步把新闻联播归档拆成 data/xwlb/{date}.json 每日静态文件，
  // 使「本地文件恢复」完全自洽，不再依赖外部 GitHub Actions 工作流。
  try {
    const obj = JSON.parse(dataStr);
    const cache = obj && obj.xwlb && obj.xwlb.cache;
    if (cache && typeof cache === 'object') {
      const xwlbDir = path.join(ROOT, 'data', 'xwlb');
      if (!fs.existsSync(xwlbDir)) fs.mkdirSync(xwlbDir, { recursive: true });
      Object.keys(cache).forEach(function (d) {
        const item = cache[d];
        if (!item || !item.date) return;
        const fp = path.join(xwlbDir, d + '.json');
        fs.writeFileSync(fp, JSON.stringify(item, null, 2), 'utf8');
      });
    }
  } catch (e) { console.error('[store] 拆分 xwlb 每日文件失败：', e.message); }
  if (redisMode && redisClient && redisClient.isReady) {
    await redisClient.set(DATA_KEY, dataStr);
    return;
  }
  // 未启用 Redis：纯文件存储，已在上方写入，无需额外操作
}

/* 启动时自动迁移：Redis 空但 JSON 文件有数据 → 导入 Redis */
async function migrateJsonToRedis() {
  if (!redisMode || !redisClient || !redisClient.isReady) return;
  try {
    const redisData = await redisClient.get(DATA_KEY);
    if (redisData) { console.log('[migrate] Redis 已有数据，跳过迁移'); return; }
    /* Redis 为空，检查 JSON 文件 */
    let jsonData = '';
    try { jsonData = fs.readFileSync(DB_FILE, 'utf8'); } catch (e) { /* 文件不存在 */ }
    if (!jsonData || jsonData === '{}' || jsonData.trim() === '') {
      console.log('[migrate] JSON 文件也为空，无需迁移');
      return;
    }
    /* 有旧数据 → 写入 Redis，并补全每日静态文件 */
    await redisClient.set(DATA_KEY, jsonData);
    try {
      const obj = JSON.parse(jsonData);
      const cache = obj && obj.xwlb && obj.xwlb.cache;
      if (cache && typeof cache === 'object') {
        const xwlbDir = path.join(ROOT, 'data', 'xwlb');
        if (!fs.existsSync(xwlbDir)) fs.mkdirSync(xwlbDir, { recursive: true });
        Object.keys(cache).forEach(function (d) {
          const item = cache[d];
          if (!item || !item.date) return;
          const fp = path.join(xwlbDir, d + '.json');
          if (!fs.existsSync(fp)) fs.writeFileSync(fp, JSON.stringify(item, null, 2), 'utf8');
        });
      }
    } catch (e) { console.error('[migrate] 补全 xwlb 每日文件失败：', e.message); }
    console.log('[migrate] ✓ 已将 JSON 文件数据迁移到 Redis（', (jsonData.length / 1024).toFixed(1), 'KB ）');
  } catch (e) {
    console.error('[migrate] 迁移失败（不影响启动）:', e.message);
  }
}

function sendJSON(res, status, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({}, CORS, { 'Content-Type': 'application/json; charset=utf-8' }, extra || {}));
  res.end(body);
}

// 通用上游抓取：处理 http/https，自动解 gzip/deflate/br
function upstreamGet(target, headers, cb) {
  let u;
  try { u = new URL(target); } catch (e) { return cb(new Error('invalid url')); }
  const lib = u.protocol === 'https:' ? https : http;
  const reqHeaders = Object.assign({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
  }, headers || {});
  const req = lib.get(target, { headers: reqHeaders }, function (resp) {
    const chunks = [];
    const enc = (resp.headers['content-encoding'] || '').toLowerCase();
    let stream = resp;
    if (enc === 'gzip') stream = resp.pipe(zlib.createGunzip());
    else if (enc === 'deflate') stream = resp.pipe(zlib.createInflate());
    else if (enc === 'br') stream = resp.pipe(zlib.createBrotliDecompress());
    stream.on('data', function (c) { chunks.push(c); });
    stream.on('end', function () {
      cb(null, resp.statusCode, Buffer.concat(chunks), resp.headers);
    });
    stream.on('error', function (e) { cb(e); });
  });
  req.on('error', function (e) { cb(e); });
  req.setTimeout(15000, function () { req.destroy(new Error('upstream timeout')); });
}

function proxyRaw(target, referer, res) {
  upstreamGet(target, { 'Referer': referer || target }, function (err, status, buf, headers) {
    if (err) { return sendJSON(res, 502, { error: String(err && err.message || err) }); }
    if (status && status >= 400) { return sendJSON(res, status, { error: 'upstream HTTP ' + status }); }
    const ct = (headers && headers['content-type']) || 'application/json; charset=utf-8';
    res.writeHead(200, Object.assign({}, CORS, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=20' }));
    res.end(buf);
  });
}

// 上金所 Au99.99 国内基准金价
//   数据源：东方财富行情接口（push2delay 主用，push2 兜底），免鉴权、实时
//   secid 118.AU9999 = 上海黄金交易所现货频道 Au99.99，单位「元/克」，接口编码 ×100
//   字段：f43 最新价 f60 昨收 f169 涨跌额 f170 涨跌幅(%) f44 最高 f45 最低 f86 时间 f58 名称
//   返回结构与前版一致，前端 fetchGoldQuotes 无需改动即可消费
function handleSge(res) {
  const SECID = '118.AU9999';
  const HOSTS = ['push2delay.eastmoney.com', 'push2.eastmoney.com'];
  let idx = 0;
  const r2 = function (n) { return Math.round(n * 100) / 100; };
  const attempt = function () {
    if (idx >= HOSTS.length) {
      return sendJSON(res, 502, { error: 'SGE 上游全部失败（Eastmoney Au99.99）' });
    }
    const host = HOSTS[idx++];
    const target = 'https://' + host +
      '/api/qt/stock/get?secid=' + SECID +
      '&fields=f43,f44,f45,f46,f57,f58,f60,f86,f168,f169,f170';
    upstreamGet(target, { 'Referer': 'https://quote.eastmoney.com/' }, function (err, status, buf) {
      if (err) { return attempt(); }
      let j;
      try { j = JSON.parse(buf.toString('utf-8')); } catch (e) { return attempt(); }
      const d = j && j.data;
      if (!d || d.f43 == null) { return attempt(); }
      const price = d.f43 / 100;   // 元/克
      const prev = d.f60 / 100;    // 昨收 元/克
      const chg = d.f169 / 100;    // 涨跌额 元/克
      const chgPct = d.f170 / 100; // 涨跌幅 %
      sendJSON(res, 200, {
        price: r2(price),
        prev: r2(prev),
        chg: r2(chg),
        chgPct: r2(chgPct),
        name: d.f58 || 'SGE Au99.99',
        unit: '元/克',
        high: r2((d.f44 || 0) / 100),
        low: r2((d.f45 || 0) / 100),
        time: d.f86 || '',
        ts: Date.now(),
      });
    });
  };
  attempt();
}

function handleSina(res, qs) {
  const target = 'https://feed.mix.sina.com.cn/api/roll/get?' + qs;
  proxyRaw(target, 'https://finance.sina.com.cn/', res);
}

function handleEastmoneyAnn(res, qs) {
  const target = 'https://np-anotice-stock.eastmoney.com/api/security/ann?' + qs;
  proxyRaw(target, 'https://np-anotice-stock.eastmoney.com/', res);
}

function handleEastmoneyProxy(res, target) {
  let u;
  try { u = new URL(target); } catch (e) { return sendJSON(res, 400, { error: 'invalid url' }); }
  if (!EASTMONEY_HOSTS.includes(u.host)) {
    return sendJSON(res, 403, { error: 'host not allowed: ' + u.host, allowed: EASTMONEY_HOSTS });
  }
  // Referer 必须与目标域名同站（东方财富按 Referer 校验），否则返回 404
  proxyRaw(target, 'https://' + u.host + '/', res);
}

function handleFundgz(res, code) {
  if (!/^\d{6}$/.test(code)) { return sendJSON(res, 400, { error: 'bad fund code' }); }
  const target = 'https://' + FUNDGZ_HOST + '/js/' + code + '.js';
  proxyRaw(target, 'https://fundf10.eastmoney.com/', res);
}

function handleIfzq(res, param) {
  const target = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + param;
  proxyRaw(target, 'https://stockapp.finance.qq.com/', res);
}

// 央视新闻联播节目单页面代理（替代不稳定的公共 CORS 代理）
// 3 次重试(递增延迟) + 更长超时。不缓存——已生成数据存 Redis，按需读取。
function handleCctvXwlb(res, query) {
  const target = 'https://tv.cctv.com/lm/xwlb/';
  const reqDate = (query && query.date) || '';
  console.log('[cctv/xwlb] request date=' + (reqDate || 'latest') + ' target=' + target);
  let attempts = 0;
  const MAX_ATTEMPTS = 3;
  function tryFetch() {
    attempts++;
    console.log('[cctv/xwlb] attempt ' + attempts + '/' + MAX_ATTEMPTS);
    upstreamGet(target, { 'Referer': 'https://tv.cctv.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' }, function (err, status, buf, headers) {
      if (err || !buf || (status && status >= 400)) {
        console.error('[cctv/xwlb] attempt ' + attempts + ' failed:', err || ('HTTP ' + status));
        if (attempts < MAX_ATTEMPTS) return setTimeout(tryFetch, 2000 * attempts); // 递增延迟: 2s, 4s
        return sendJSON(res, 502, { error: '央视抓取失败(' + MAX_ATTEMPTS + '次): ' + (err && err.message || 'HTTP ' + status) });
      }
      const ct = (headers && headers['content-type']) || 'text/html; charset=utf-8';
      console.log('[cctv/xwlb] success, size=' + buf.length);
      res.writeHead(200, Object.assign({}, CORS, { 'Content-Type': ct, 'Cache-Control': 'no-store' }));
      res.end(buf);
    });
  }
  tryFetch();
}

function handleQt(res, q) {
  const target = 'https://qt.gtimg.cn/q=' + q;
  proxyRaw(target, 'https://stockapp.finance.qq.com/', res);
}

// ---------- 静态文件托管 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/aurora-workbench.html' : pathname;
  // 解码中文/带空格等 URL 编码字符（只 decode 一次，防双重解码绕过穿越校验）
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch (e) { decoded = rel; }
  rel = decoded;
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    /* HTML 文件禁用缓存（确保 git pull 后浏览器立即获取最新代码） */
    var headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(function (req, res) {
  const qi = req.url.indexOf('?');
  const pathname = qi >= 0 ? req.url.slice(0, qi) : req.url;
  const qs = qi >= 0 ? req.url.slice(qi + 1) : '';

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  if (pathname === '/health') {
    return sendJSON(res, 200, { ok: true, ts: Date.now(), routes: ['/api/sge', '/api/sina', '/api/eastmoney/ann', '/api/eastmoney/proxy', '/api/fundgz', '/api/ifzq', '/api/qt', '/api/cctv/xwlb', '/api/db'], store: redisMode ? 'redis' : 'json-file' });
  }

  // 全量数据读写（Redis 优先 / JSON 文件兜底，无需 token）
  if (pathname === '/api/db') {
    if (req.method === 'GET') {
      return dbGet().then(function (raw) {
        res.writeHead(200, Object.assign({}, CORS, { 'Content-Type': 'application/json; charset=utf-8' }));
        res.end(raw || '{}');
      }).catch(function (e) { sendJSON(res, 500, { error: String(e && e.message || e) }); });
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', function (c) { body += c; if (body.length > 32 * 1024 * 1024) req.destroy(); });
      req.on('end', function () {
        if (!body) return sendJSON(res, 400, { error: 'empty body' });
        let parsed;
        try { parsed = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { error: 'invalid JSON' }); }
        dbSet(JSON.stringify(parsed)).then(function () {
          sendJSON(res, 200, { ok: true, bytes: body.length, ts: Date.now() });
        }).catch(function (e) { sendJSON(res, 500, { error: String(e && e.message || e) }); });
      });
      return;
    }
    return sendJSON(res, 405, { error: 'method not allowed' });
  }

  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/sge') return handleSge(res);
    if (pathname === '/api/sina') return handleSina(res, qs);
    if (pathname === '/api/eastmoney/ann') return handleEastmoneyAnn(res, qs);
    if (pathname === '/api/eastmoney/proxy') {
      const m = qs.match(/(?:^|&)url=([^&]+)/);
      return handleEastmoneyProxy(res, m ? decodeURIComponent(m[1]) : '');
    }
    if (pathname === '/api/fundgz') {
      const m = qs.match(/(?:^|&)code=([^&]+)/);
      return handleFundgz(res, m ? decodeURIComponent(m[1]) : '');
    }
    if (pathname === '/api/ifzq') {
      const m = qs.match(/(?:^|&)param=([^&]+)/);
      return handleIfzq(res, m ? decodeURIComponent(m[1]) : '');
    }
    if (pathname === '/api/qt') {
      const m = qs.match(/(?:^|&)q=([^&]+)/);
      return handleQt(res, m ? decodeURIComponent(m[1]) : '');
    }
    if (pathname === '/api/cctv/xwlb') return handleCctvXwlb(res, qs);
    return sendJSON(res, 404, { error: 'unknown api route' });
  }

  return serveStatic(res, pathname);
});

server.listen(PORT, HOST, function () {
  console.log('Aurora 工作台已启动： http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '   (CTRL+C 退出)');
  console.log('注意：/api/db 无需 token 即可读写，建议仅在内网或本机访问');
  initStore();
});
