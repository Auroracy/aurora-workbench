#!/usr/bin/env node
'use strict';
/*
 * Aurora 工作台 · 自托管服务器（零依赖，纯 Node 内置模块）
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
 *
 * 启动： node server.js            （默认 8080 端口）
 *        PORT=80 node server.js    （用 80 端口，需 root）
 *        HOST=127.0.0.1 node server.js （仅本机访问）
 *
 * 安全：仅转发白名单域名；只读 GET；CORS *；无任何密钥。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

// 允许被代理的东方财富/天天基金域名白名单（防止被当作开放代理滥用）
const EASTMONEY_HOSTS = [
  'np-anotice-stock.eastmoney.com',
  'np-cnotice-stock.eastmoney.com',
  'datacenter-web.eastmoney.com',
  'datacenter.eastmoney.com',
  'fundf10.eastmoney.com',
];
const FUNDGZ_HOST = 'fundgz.1234567.com.cn';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

// 上金所 Au99.99 — 复用 Cloudflare Worker /sge 的解析逻辑
function handleSge(res) {
  upstreamGet('https://hq.sinajs.cn/list=SGE_AU9999', { 'Referer': 'https://finance.sina.com.cn/' }, function (err, status, buf) {
    if (err) { return sendJSON(res, 502, { error: String(err && err.message || err) }); }
    const text = new TextDecoder('gb18030').decode(buf); // 新浪返回 GBK/GB18030
    const m = text.match(/="([^"]*)"/);
    if (!m) { return sendJSON(res, 502, { error: 'parse failed', raw: text.slice(0, 200) }); }
    const parts = m[1].split(',');
    const price = parseFloat(parts[3]);
    const chgPct = parseFloat(String(parts[17] || '').replace('%', '').trim());
    if (!isFinite(price) || price <= 0) { return sendJSON(res, 502, { error: 'invalid price', parts: parts.slice(0, 20) }); }
    const chg = isFinite(chgPct) ? (price * chgPct / 100) : 0;
    const prev = price - chg;
    sendJSON(res, 200, {
      price: Math.round(price * 100) / 100,
      prev: Math.round(prev * 100) / 100,
      chg: Math.round(chg * 100) / 100,
      chgPct: isFinite(chgPct) ? Math.round(chgPct * 100) / 100 : 0,
      name: parts[1] || 'SGE Au99.99',
      unit: '元/克',
      time: parts[16] || '',
      ts: Date.now(),
    });
  });
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
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(function (req, res) {
  const qi = req.url.indexOf('?');
  const pathname = qi >= 0 ? req.url.slice(0, qi) : req.url;
  const qs = qi >= 0 ? req.url.slice(qi + 1) : '';

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  if (pathname === '/health') {
    return sendJSON(res, 200, { ok: true, ts: Date.now(), routes: ['/api/sge', '/api/sina', '/api/eastmoney/ann', '/api/eastmoney/proxy', '/api/fundgz', '/api/ifzq', '/api/qt'] });
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
    return sendJSON(res, 404, { error: 'unknown api route' });
  }

  return serveStatic(res, pathname);
});

server.listen(PORT, HOST, function () {
  console.log('Aurora 工作台已启动： http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '   (CTRL+C 退出)');
});
