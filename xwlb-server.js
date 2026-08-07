'use strict';
/**
 * 新闻联播·每日总结 后端
 * ------------------------------------------------------------
 * 职责：
 *   1. 抓取央视网《新闻联播》栏目页 (tv.cctv.com/lm/xwlb/)
 *   2. 提取当天节目单（新闻标题列表）
 *   3. 调用通义千问生成结构化总结（导语 + 分类要点）
 *   4. 按日期内存缓存，提供 JSON 接口
 *
 * 运行：
 *   QWEN_API_KEY=sk-xxxx node xwlb-server.js
 *   （默认端口 8787，可用 PORT 环境变量覆盖）
 *
 * 接口：
 *   GET /xwlb?date=YYYY-MM-DD   返回当天总结（默认今天）
 *   GET /health                 健康检查（含是否配置 key）
 *
 * 零 npm 依赖，仅用 Node 内置 http / https。
 */

const http = require('http');
const https = require('https');
const PORT = process.env.PORT || 8787;
const QWEN_KEY = process.env.QWEN_API_KEY || '';
const XWLB_URL = 'https://tv.cctv.com/lm/xwlb/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const cache = new Map(); // date -> result

/** 抓取 URL 文本（含简单重定向跟随） */
function fetchText(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        return fetchText(next, timeout).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** 从栏目页 HTML 提取当天日期 + 节目单标题 */
function parseXwlb(html) {
  // 当天日期：取页面中出现的最大 YYYY-MM-DD（栏目页顶部“查看最新”即当天）
  const dates = (html.match(/\d{4}-\d{2}-\d{2}/g) || []).filter((d) => {
    const [y, m] = d.split('-').map(Number);
    return y >= 2020 && y <= 2035 && m >= 1 && m <= 12;
  });
  const date = dates.sort().reverse()[0] || '';
  // 节目单：[视频]标题（截断到 " 或 <，避免吞入 title 属性片段），再去重
  const raw = (html.match(/\[视频\]([^"<\n]+)/g) || [])
    .map((s) => s.replace(/^\[视频\]/, '').trim())
    .filter(Boolean);
  const seen = new Set();
  const titles = raw.filter((t) => { if (seen.has(t)) return false; seen.add(t); return true; });
  return { date, titles };
}

/** 调用通义千问生成结构化总结 */
async function callQwen(titles) {
  if (!QWEN_KEY) return null;
  const list = titles.map((t, i) => (i + 1) + '. ' + t).join('\n');
  const userPrompt =
    '以下是央视《新闻联播》当天播出的节目单（新闻标题列表）：\n' +
    list +
    '\n\n请基于这些标题，生成一份结构化每日总结。严格只输出如下 JSON（不要任何额外文字）：\n' +
    '{\n' +
    '  "lead": "一句话导语，概括当天主线（20字以内）",\n' +
    '  "groups": [\n' +
    '    { "category": "分类名（如：国内要闻/经济发展/国际动态/社会民生/其他）", "items": [ { "title": "原新闻标题", "point": "一句话要点（30字以内）" } ] }\n' +
    '  ]\n' +
    '}';
  const body = {
    model: 'qwen-plus',
    messages: [
      { role: 'system', content: '你是资深新闻编辑，擅长把《新闻联播》节目单整理成简洁、清晰、有条理的每日总结。' },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }
  };
  const data = await new Promise((resolve, reject) => {
    const r = https.request(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + QWEN_KEY }
      },
      (res) => { let d = ''; res.setEncoding('utf8'); res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }
    );
    r.on('error', reject);
    r.write(JSON.stringify(body));
    r.end();
  });
  try {
    const j = JSON.parse(data);
    if (j.error) return null;
    return JSON.parse(j.choices[0].message.content);
  } catch (e) {
    return null;
  }
}

/** 构建某天总结（带缓存） */
async function buildSummary(date) {
  if (date && cache.has(date)) return cache.get(date);
  const html = await fetchText(XWLB_URL);
  const parsed = parseXwlb(html);
  const useDate = date || parsed.date;
  const summary = await callQwen(parsed.titles);
  const result = {
    date: useDate,
    titles: parsed.titles,
    summary: summary, // 可能为 null（未配置 key 时）
    generatedAt: new Date().toISOString(),
    hasKey: !!QWEN_KEY,
    note: summary ? '' : (QWEN_KEY ? 'AI 总结生成失败' : '未配置 QWEN_API_KEY，仅返回原始节目单')
  };
  if (useDate) cache.set(useDate, result);
  return result;
}

function startServer() {
  http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/xwlb') {
      const date = u.searchParams.get('date') || '';
      try {
        const r = await buildSummary(date);
        res.end(JSON.stringify(r));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(e && e.message || e) }));
      }
      return;
    }
    if (u.pathname === '/health') {
      res.end(JSON.stringify({ ok: true, hasKey: !!QWEN_KEY, cached: cache.size }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  }).listen(PORT, () => {
    console.log('[xwlb] 新闻联播后端已启动: http://localhost:' + PORT + '/xwlb');
    if (!QWEN_KEY) console.log('[xwlb] 警告: 未配置 QWEN_API_KEY，将只返回原始节目单，不生成 AI 总结。');
  });
}

/** 每天 19:30 预抓当天（新闻联播 19:00 播出后） */
function scheduleDaily() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(19, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next - now;
  setTimeout(async () => {
    try { await buildSummary(''); } catch (e) { /* ignore */ }
    scheduleDaily();
  }, ms);
}

if (require.main === module) {
  startServer();
  scheduleDaily();
}

module.exports = { fetchText, parseXwlb, callQwen, buildSummary, startServer };
