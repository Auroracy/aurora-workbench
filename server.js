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

// 批量基金估值/净值接口（替代已失效的 fundgz.1234567.com.cn 单只接口）
// 数据源：东方财富 fundmobapi（一次请求返回多只基金的 GSZ+NAV）
// GET /api/fundgz-batch?codes=017745,019708,...
// 返回: { ts, count, data: { "017745": { name, gsz, gszzl, nav, gztime }, ... } }
const FUND_BATCH_CACHE = { ts: 0, payload: null };
const FUND_BATCH_TTL = 60 * 1000;  // 交易时间60s缓存，收盘后可更长
function handleFundgzBatch(res, qs) {
  const m = qs.match(/(?:^|&)codes=([^&]+)/);
  if (!m) return sendJSON(res, 400, { error: '缺少 codes 参数（逗号分隔的6位基金代码）' });
  const raw = decodeURIComponent(m[1]);
  const codes = raw.split(',').map(function(s){ return s.trim(); }).filter(function(s){ return /^\d{6}$/.test(s); });
  if (!codes.length) return sendJSON(res, 400, { error: '无有效基金代码' });
  // 短缓存命中
  if (FUND_BATCH_CACHE.payload && (Date.now() - FUND_BATCH_CACHE.ts) < FUND_BATCH_TTL) {
    console.log('[fundgz-batch] 缓存命中');
    return sendJSON(res, 200, FUND_BATCH_CACHE.payload);
  }
  const target = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo'
    + '?pageIndex=1&pageSize=' + codes.length
    + '&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=aurora-workbench&Ession=1'
    + '&Fcodes=' + codes.join(',');
  console.log('[fundgz-batch] 拉取', codes.length, '只基金:', codes.join(','));
  upstreamGet(target, { 'Referer': 'https://fund.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' }, function(err, status, buf) {
    if (err || !buf || status >= 400) {
      console.error('[fundgz-batch] 失败:', err || ('HTTP ' + status));
      return sendJSON(res, 502, { error: '基金估值批量查询失败: ' + (err && err.message || 'HTTP ' + status) });
    }
    try {
      var body = JSON.parse(buf.toString('utf-8'));
      var items = body.Datas || [];
      var data = {};
      for (var i = 0; i < items.length; i++) {
        var f = items[i];
        data[f.FCODE] = {
          name: f.SHORTNAME || '',
          gsz: f.GSZ != null ? parseFloat(f.GSZ) : null,
          gszzl: f.GSZZL != null ? parseFloat(f.GSZZL) : null,
          nav: f.NAV != null ? parseFloat(f.NAV) : null,
          /* dwjz: 接口无DWJZ字段, 用NAV(确认净值)作为单位净值 */
          dwjz: f.DWJZ || (f.NAV != null ? String(f.NAV) : null),
          /* gztime: 周末GZTIME为空, fallback到PDATE(净值日期) */
          gztime: f.GZTIME || f.PDATE || null,
          /* pdate: 净值确认日期(用于前端显示"净值 08-22") */
          pdate: f.PDATE || null,
          /* navChgRt: 日涨跌幅%(NAVCHGRT), 周末GSZZL为空时的替代数据源 */
          navChgRt: f.NAVCHGRT != null ? parseFloat(f.NAVCHGRT) : null,
        };
      }
      var payload = {
        ts: Date.now(),
        count: Object.keys(data).length,
        data: data,
        source: 'fundmobapi.eastmoney.com',
        note: items.length < codes.length ? ('缺失 ' + (codes.length - items.length) + ' 只') : '',
      };
      FUND_BATCH_CACHE.ts = Date.now();
      FUND_BATCH_CACHE.payload = payload;
      console.log('[fundgz-batch] 成功:', payload.count, '/', codes.length);
      return sendJSON(res, 200, payload);
    } catch(e) {
      console.error('[fundgz-batch] 解析失败:', e.message);
      return sendJSON(res, 502, { error: '响应解析失败: ' + e.message });
    }
  });
}

// ★ 基金实时估算净值（真正的盘中估算，替代 fundmobapi 空GSZ问题）
// 数据源：东方财富 fundgz JSONP 接口（天天基金 App 同源）
// GET /api/fund-gsz?codes=017811,016874,...
// 返回: { ts, count, source, data: { "017811": { name, gsz, gszzl, dwjz, gztime }, ... } }
// 特点：交易时段返回实时估算(GSZ/GSZZL)，收盘后返回当日最终估算，全天有值
const FUND_GSZ_CACHE = { ts: 0, payload: null };
const FUND_GSZ_TTL = 55 * 1000;  // 交易时段55s缓存
function handleFundGszRealtime(res, qs) {
  const m = qs.match(/(?:^|&)codes=([^&]+)/);
  if (!m) return sendJSON(res, 400, { error: '缺少 codes 参数' });
  const raw = decodeURIComponent(m[1]);
  const codes = raw.split(',').map(function(s){ return s.trim(); }).filter(function(s){ return /^\d{6}$/.test(s); });
  if (!codes.length) return sendJSON(res, 400, { error: '无有效基金代码' });
  if (FUND_GSZ_CACHE.payload && (Date.now() - FUND_GSZ_CACHE.ts) < FUND_GSZ_TTL) {
    return sendJSON(res, 200, FUND_GSZ_CACHE.payload);
  }
  /* 并发请求所有基金的 fundgz JSONP */
  var results = {};
  var pending = codes.length;
  var done = function() {
    pending--;
    if (pending === 0) {
      var payload = { ts: Date.now(), count: Object.keys(results).length, source: 'fundgz.eastmoney.com', data: results };
      FUND_GSZ_CACHE.ts = Date.now();
      FUND_GSZ_CACHE.payload = payload;
      console.log('[fund-gsz] 成功:', payload.count, '/', codes.length);
      return sendJSON(res, 200, payload);
    }
  };
  codes.forEach(function(code) {
    var url = 'https://fundgz.01823.xyz/js/' + code + '.js';
    upstreamGet(url, { 'Referer': 'https://fund.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, function(err, status, buf) {
      if (err || !buf) { done(); return; }
      try {
        var text = buf.toString('utf-8');
        /* JSONP 格式: jsonpgz({...}); 提取中间的JSON */
        var jsonStr = text.replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, '');
        var d = JSON.parse(jsonStr);
        /* 解析 gszzl 字符串如 "-0.88%" 为数字 */
        var gszzlRaw = d.gszzl || '';
        var gszzlNum = parseFloat(gszzlRaw.toString().replace('%', ''));
        results[code] = {
          name: d.name || '',
          gsz: d.gsz != null ? parseFloat(d.gsz) : null,
          gszzl: !isNaN(gszzlNum) ? gszzlNum : null,
          dwjz: d.dwjz != null ? parseFloat(d.dwjz) : null,
          gztime: d.gztime || null,
          jzrq: d.jzrq || null,
          /* 原始字符串保留(用于调试) */
          _rawGszzl: gszzlRaw,
        };
      } catch(e) {
        console.warn('[fund-gsz] 解析失败 ' + code + ':', e.message);
      }
      done();
    });
  });
}

// 基金历史净值（近 N 日确认净值），用于量化建议的"近月净值位置/网格加仓"因子
// 数据源：东方财富 f10/lsjz（确认净值序列）
// GET /api/fund-history?code=016963&days=30
// 返回: { code, days, count, list:[ { date:'YYYY-MM-DD', dwjz:Number, navChgRt:Number }, ... ] }（降序：最新在前）
const FUND_HISTORY_CACHE = {};
const FUND_HISTORY_TTL = 60 * 60 * 1000;  // 历史净值慢变，缓存1小时
function handleFundHistory(res, qs) {
  const mCode = qs.match(/(?:^|&)code=([^&]+)/);
  if (!mCode) return sendJSON(res, 400, { error: '缺少 code 参数' });
  const code = decodeURIComponent(mCode[1]).trim();
  if (!/^\d{6}$/.test(code)) return sendJSON(res, 400, { error: '基金代码格式错误' });
  const mDays = qs.match(/(?:^|&)days=(\d+)/);
  const days = mDays ? Math.min(parseInt(mDays[1], 10), 90) : 30;
  const now = Date.now();
  if (FUND_HISTORY_CACHE[code] && (now - FUND_HISTORY_CACHE[code].ts) < FUND_HISTORY_TTL) {
    return sendJSON(res, 200, FUND_HISTORY_CACHE[code].payload);
  }
  const target = 'https://api.fund.eastmoney.com/f10/lsjz?fundCode=' + code
    + '&pageIndex=1&pageSize=' + days + '&startDate=&endDate=&_=' + now;
  upstreamGet(target, {
    'Referer': 'http://fundf10.eastmoney.com/f10/jjjz_' + code + '.html',
    'User-Agent': 'Mozilla/5.0',
  }, function(err, status, buf) {
    if (err || !buf || status >= 400) {
      console.error('[fund-history] 失败:', err || ('HTTP ' + status));
      return sendJSON(res, 502, { error: '历史净值查询失败: ' + (err && err.message || 'HTTP ' + status) });
    }
    try {
      const body = JSON.parse(buf.toString('utf-8'));
      const list0 = (body.Data && body.Data.LSJZList) || [];
      const list = list0.map(function(it){
        return {
          date: (it.FSRQ || '').slice(0, 10),
          dwjz: it.DWJZ != null ? parseFloat(it.DWJZ) : null,
          navChgRt: it.JZZZL != null ? parseFloat(it.JZZZL) : null,
        };
      }).filter(function(it){ return it.date && it.dwjz > 0; });
      const payload = { code: code, days: days, count: list.length, list: list, ts: now };
      FUND_HISTORY_CACHE[code] = { ts: now, payload: payload };
      console.log('[fund-history]', code, '成功', list.length, '条');
      sendJSON(res, 200, payload);
    } catch(e) {
      console.error('[fund-history] 解析失败:', e.message);
      sendJSON(res, 502, { error: '响应解析失败: ' + e.message });
    }
  });
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

// 解析《新闻联播》指定日期的节目单/新闻标题列表。
//   数据源优先级（央视仅公开「当日」节目单，历史日期需第三方归档）：
//   1) 央视栏目页 https://tv.cctv.com/lm/xwlb/ —— 最权威，仅当日可稳定返回。
//   2) mrxwlb.com 第三方文字版归档 —— 月度归档页提取当日详情链接，覆盖历史（回溯至 2015）。
//   3) cn.govopendata.com 公共数据平台 —— 兜底备用。
//   历史日期自动降级到第三方源，实现「选任意日期都能自动出节目单 + 生成总结」。
// GET /api/cctv/xwlb-parse?date=YYYY-MM-DD  ->  { date, found, titles:[...], count, source, note, fetchedAt }
const XWLB_PARSE_CACHE = {};               // date -> { ts, payload } 进程内短缓存，避免重复抓取
const XWLB_PARSE_TTL = 10 * 60 * 1000;     // 10 分钟
function xwlbCleanText(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&[a-z]+;/gi, ' ').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
// 判断文本是否像 CSS/HTML 代码（非正常新闻标题）—— 与客户端 isCssLikeText 保持同步
function xwlbIsCssOrCode(s) {
  if (!s) return true;
  s = s.trim();
  if (s.length < 4) return true;
  // CSS 规则特征: { } ; 选择器 .xxx #xxx :伪类 px/rem/em 单位 rgba/hex颜色
  if (/[\{\}]/.test(s)) return true;
  if (/^\s*[\.\#\[\]]/.test(s)) return true;           // 以 . # [ ] 开头（CSS选择器）
  if (/:\s*\d+(px|rem|em|%|vw|vh)\b/i.test(s)) return true; // margin: 20px
  if (/\brgba?\(/i.test(s)) return true;              // rgb(0,102,204)
  if (/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/.test(s) && !/[一二三四五六七八九十]/.test(s)) return true; // 纯hex色值（排除含中文的）
  // CSS 注释
  if (/\/\*/.test(s) || /\*\//.test(s)) return true;
  // CSS 变量 / 函数调用
  if (/var\(--/.test(s)) return true;
  if (/calc\(|clamp\(|min\(|max\(|rgba?\(/i.test(s)) return true;
  // 完整 CSS 属性名列表（与客户端同步，含 animation/pointer-events 等）
  if (/^(margin|padding|border|font-size|color|background|display|flex|width|height|gap|align|justify|min-width|max-width|line-height|overflow|position|top|left|right|bottom|text-|white-space|word-break|box-sizing|border-radius|box-shadow|transition|transform|opacity|z-index|cursor|float|clear|vertical-align|font-weight|font-family|letter-spacing|text-decoration|border-top|border-bottom|border-left|border-right|content|visibility|grid|grid-template|flex-wrap|flex-direction|object-fit|filter|backdrop|scroll|text-align|text-indent|list-style|outline|animation|transition|transform-origin|user-select|pointer-events|will-change|contain|aspect-ratio|inset|scrollbar|accent-color|fill|stroke|clip-path|mask|background-image|linear-gradient|radial-gradient|conic-gradient|animation-fill-mode|animation-delay|animation-duration|animation-timing-function|animation-name)\b/i.test(s)) return true;
  // 纯单位值: "875rem", "6s ease-out", "3s ease"
  if (/^\d+(\.\d+)?(rem|em|px|%|vw|vh|s|ms)$/i.test(s)) return true;
  if (/^\d+(\.\d+)?(rem|em|px|s|ms)\s+\w[\w\-]*$/.test(s)) return true;
  if (/^\d+[a-zA-Z]+\s+[a-zA-Z]+$/.test(s) && s.length <= 15) return true;
  // JS/DOM 操作模式
  if (/\.(style|className|id|src|height|width|appendChild|addEventListener|getElementById|querySelector|textContent|innerHTML)\s*[/=]/.test(s)) return true;
  if (/document\./.test(s)) return true;
  if (/window\./.test(s)) return true;
  // vendor 前缀
  if (/-webkit-|-moz-|-ms-|-o-/.test(s)) return true;
  // HTML 标签名
  if (/^<\/?(div|span|p|a|ul|ol|li|h[1-6]|section|article|nav|header|footer|main|aside|figure|img|table|tr|td|th|form|input|button|label|select|option|textarea|style|script|link|meta|head|body|html|title|br|hr|details|summary|nav-btn|date-navigation|article-header|meta-item|article-title)\b/i.test(s)) return false;
  return false;
}
// 从详情页 HTML 抽取新闻标题列表：优先 li（mrxwlb），不足则按段落/编号兜底（govopendata）
function xwlbExtractItems(html) {
  const m = html.match(/<(div|article|section)[^>]*class="[^"]*(entry-content|post-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const body = m ? m[3] : html;
  let items = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let x;
  while ((x = re.exec(body)) !== null) {
    const t = xwlbCleanText(x[1]);
    if (t && t.length >= 6 && !/继续阅读|首页|分类目录|归档|标签|上一篇|下一篇/.test(t) && !xwlbIsCssOrCode(t)) items.push(t);
  }
  if (items.length < 3) {
    const pre = html.indexOf('主要内容');
    const seg = pre >= 0 ? html.slice(pre) : body;
    const txt = xwlbCleanText(seg);
    const parts = txt.split(/(?:；|;|。|\n|\r|\d+[.、)、])/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length >= 6 && s.length <= 80 && !/继续阅读|主要内容/.test(s) && !xwlbIsCssOrCode(s); });
    items = parts.slice(0, 30);
  }
  return items;
}
// 带重定向跟随的抓取（govopendata 会 301 跳转）
function fetchText(url, hdrs, redirects, cb) {
  upstreamGet(url, hdrs, function (err, status, buf, headers) {
    if (err) return cb(err);
    if ([301, 302, 303, 307, 308].indexOf(status) >= 0) {
      if (redirects <= 0) return cb(new Error('too many redirects'));
      let loc = headers && headers.location;
      if (!loc) return cb(new Error('redirect without location'));
      if (loc[0] === '/') { try { loc = new URL(url).origin + loc; } catch (e) { return cb(new Error('bad redirect')); } }
      return fetchText(loc, hdrs, redirects - 1, cb);
    }
    if (status && status >= 400) return cb(new Error('HTTP ' + status));
    cb(null, buf.toString('utf-8'));
  });
}
// 第三方源1：mrxwlb.com（月度归档页 -> 当日详情链接，避免 slug 猜测）
function tryMrxwlb(date, cb) {
  const p = date.split('-');
  const Y = p[0], M = p[1], D = p[2];
  const monthUrl = 'http://mrxwlb.com/' + Y + '/' + M + '/';
  fetchText(monthUrl, { 'Referer': 'http://mrxwlb.com/' }, 3, function (err, html) {
    if (err || !html) return cb(null, []);
    const re = new RegExp('href="(https?://mrxwlb\\.com/' + Y + '/' + M + '/' + D + '/[^"]+)"', 'i');
    const mm = html.match(re);
    if (!mm) return cb(null, []);
    fetchText(mm[1], { 'Referer': monthUrl }, 3, function (err2, html2) {
      if (err2 || !html2) return cb(null, []);
      cb(null, xwlbExtractItems(html2));
    });
  });
}
// 第三方源2：cn.govopendata.com 公共数据平台（兜底）
function tryGovopendata(date, cb) {
  const ymd = date.replace(/-/g, '');
  const url = 'https://cn.govopendata.com/xinwenlianbo/' + ymd + '/';
  fetchText(url, { 'Referer': 'https://cn.govopendata.com/' }, 3, function (err, html) {
    if (err || !html) return cb(null, []);
    cb(null, xwlbExtractItems(html));
  });
}
function tryThirdParty(date, cb) {
  tryMrxwlb(date, function (err, items) {
    if (items && items.length) return cb(null, { found: true, titles: items, source: 'mrxwlb' });
    tryGovopendata(date, function (err2, items2) {
      if (items2 && items2.length) return cb(null, { found: true, titles: items2, source: 'govopendata' });
      cb(null, { found: false, titles: [], source: 'none' });
    });
  });
}
function handleCctvXwlbParse(res, qs) {
  const m = qs.match(/(?:^|&)date=([^&]+)/);
  const raw = m ? decodeURIComponent(m[1]) : '';
  const dm = raw.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);   // 支持 YYYY-MM-DD / YYYYMMDD
  if (!dm) return sendJSON(res, 400, { error: '缺少或非法 date 参数（需要 YYYY-MM-DD）' });
  const norm = dm[1] + '-' + dm[2] + '-' + dm[3];
  const slashDate = norm.replace(/-/g, '/');
  console.log('[cctv/xwlb-parse] date=' + norm + ' slash=' + slashDate);
  /* 时间守卫：当天日期在19:30(北京时间)前不抓取，避免返回CSS代码片段 */
  const nowBeijing = new Date(Date.now() + (8 * 60 * 60 * 1000) + (new Date().getTimezoneOffset() * 60 * 1000));
  const todayStr = nowBeijing.getFullYear() + '-' + String(nowBeijing.getMonth()+1).padStart(2,'0') + '-' + String(nowBeijing.getDate()).padStart(2,'0');
  if (norm === todayStr) {
    const bh = nowBeijing.getHours();
    const bm = nowBeijing.getMinutes();
    if (bh < 19 || (bh === 19 && bm < 30)) {
      console.log('[cctv/xwlb-parse] 当天 ' + norm + ' 未到19:30北京时(' + bh + ':' + String(bm).padStart(2,'0') + ')，跳过');
      return finish({ found: false, titles: [], source: 'none', note: '当日新闻尚未播出（19:00开播），请于播出后再试' });
    }
  }
  const hit = XWLB_PARSE_CACHE[norm];
  if (hit && (Date.now() - hit.ts) < (hit.ttl || XWLB_PARSE_TTL)) {
    console.log('[cctv/xwlb-parse] 内存缓存命中，count=' + hit.payload.count);
    return sendJSON(res, 200, hit.payload);
  }
  const target = 'https://tv.cctv.com/lm/xwlb/';
  let attempts = 0;
  const MAX = 3;
  function finish(payload) {
    payload.date = norm;
    payload.count = payload.titles ? payload.titles.length : 0;
    if (!payload.note) payload.note = '';
    payload.fetchedAt = new Date().toISOString();
    /* 当天 found:false 的结果不缓存（或只缓存2分钟），因为 19:30 后应该重试获取真实数据 */
    var cacheTtl = (!payload.found && norm === todayStr) ? 2 * 60 * 1000 : XWLB_PARSE_TTL;
    XWLB_PARSE_CACHE[norm] = { ts: Date.now(), payload: payload, ttl: cacheTtl };
    console.log('[cctv/xwlb-parse] 完成 source=' + payload.source + ' count=' + payload.count + (payload.found ? '' : ' [negative, ttl=' + (cacheTtl/1000) + 's]'));
    return sendJSON(res, 200, payload);
  }
  function finishThirdParty() {
    console.log('[cctv/xwlb-parse] 央视无当日数据，尝试第三方归档源');
    tryThirdParty(norm, function (err, r) {
      if (r && r.found) return finish(r);
      return finish({ found: false, titles: [], source: 'none', note: '央视仅公开当日节目单，且第三方归档源暂未收录该日期，请手动粘贴后生成' });
    });
  }
  function tryFetch() {
    attempts++;
    console.log('[cctv/xwlb-parse] attempt ' + attempts + '/' + MAX + ' (央视)');
    upstreamGet(target, { 'Referer': 'https://tv.cctv.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' }, function (err, status, buf) {
      if (err || !buf || (status && status >= 400)) {
        console.error('[cctv/xwlb-parse] 央视 attempt ' + attempts + ' 失败：', err || ('HTTP ' + status));
        if (attempts < MAX) return setTimeout(tryFetch, 2000 * attempts);
        return finishThirdParty();
      }
      const html = buf.toString('utf-8');
      const re = new RegExp('href="(https://tv\\.cctv\\.com/' + slashDate.replace(/\//g, '\\/') + '/VIDE[^"]+\\.shtml)"', 'g');
      const titles = [];
      const seen = {};
      let mm;
      while ((mm = re.exec(html)) !== null) {
        const seg = html.slice(Math.max(0, mm.index - 300), mm.index + 60);
        const txts = seg.match(/>([^<]{4,60})</g) || [];
        let title = '';
        for (let i = txts.length - 1; i >= 0; i--) {
          const t = txts[i].replace(/^>|<\/$/g, '').trim();
          if (t && !/完整版/.test(t) && t !== '/') { title = t; break; }
        }
        if (title && /\[视频\]/.test(title)) {
          title = title.replace('[视频]', '').trim();
          if (title && !seen[title]) { seen[title] = 1; titles.push(title); }
        }
      }
      if (titles.length > 0) return finish({ found: true, titles: titles, source: 'cctv-column' });
      return finishThirdParty();
    });
  }
  tryFetch();
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
    return sendJSON(res, 200, { ok: true, ts: Date.now(), routes: ['/api/sge', '/api/sina', '/api/eastmoney/ann', '/api/eastmoney/proxy', '/api/fundgz', '/api/fundgz-batch', '/api/fund-gsz', '/api/fund-history', '/api/ifzq', '/api/qt', '/api/cctv/xwlb', '/api/cctv/xwlb-parse', '/api/db'], store: redisMode ? 'redis' : 'json-file' });
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
      let chunks = [];
      req.on('data', function (c) { chunks.push(c); let size = chunks.reduce(function(s,b){return s+b.length;},0); if (size > 32 * 1024 * 1024) req.destroy(); });
      req.on('end', function () {
        let body = Buffer.concat(chunks).toString('utf-8');
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
    if (pathname === '/api/fundgz-batch') return handleFundgzBatch(res, qs);
    if (pathname === '/api/fund-gsz') return handleFundGszRealtime(res, qs);
    if (pathname === '/api/fund-history') return handleFundHistory(res, qs);
    if (pathname === '/api/ifzq') {
      const m = qs.match(/(?:^|&)param=([^&]+)/);
      return handleIfzq(res, m ? decodeURIComponent(m[1]) : '');
    }
    if (pathname === '/api/qt') {
      const m = qs.match(/(?:^|&)q=([^&]+)/);
      return handleQt(res, m ? decodeURIComponent(m[1]) : '');
    }
    if (pathname === '/api/cctv/xwlb') return handleCctvXwlb(res, qs);
    if (pathname === '/api/cctv/xwlb-parse') return handleCctvXwlbParse(res, qs);
    return sendJSON(res, 404, { error: 'unknown api route' });
  }

  return serveStatic(res, pathname);
});

server.listen(PORT, HOST, function () {
  console.log('Aurora 工作台已启动： http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '   (CTRL+C 退出)');
  console.log('注意：/api/db 无需 token 即可读写，建议仅在内网或本机访问');
  initStore();
});
