#!/usr/bin/env node
/* Aurora 工作台 · CCTV《新闻联播》每日总结抓取器
 * 供 GitHub Actions 调用：抓 CCTV 栏目页 → 通义千问生成总结 → 写 data/xwlb/{date}.json
 *
 * Usage:
 *   node scripts/fetch-xwlb.mjs [--date=YYYY-MM-DD] [--out=path/to.json]
 *
 * Env:
 *   QWEN_API_KEY — 必填（DashScope 密钥）
 *
 * Output:
 *   写文件到 --out 或默认 data/xwlb/{date}.json
 *   stdout 输出 { ok, file, titleCount } 一行 JSON，便于 CI 解析
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.+)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));

/* 默认取「北京当天」日期（UTC+8，无夏令时）。CCTV 栏目首页只显示当日节目。
   定时任务 UTC 12:00 = 北京 20:00（节目播出 30 分钟后），抓北京当天节目。
   手动触发同样按北京日期取，避免 UTC/北京跨日错位导致抓不到节目。
   补录历史日期请显式传 --date，但 CCTV 只保留当日节目单，历史需在工作台 Tab9 手动粘贴。 */
const now = new Date();
const bjMs = now.getTime() + 8 * 3600 * 1000; // 北京 = UTC+8，无夏令时（不依赖运行机时区）
const defDate = new Date(bjMs).toISOString().slice(0, 10);
const date = args.date || defDate;
const OUT = args.out || `data/xwlb/${date}.json`;

const QWEN_KEY = process.env.QWEN_API_KEY;
if(!QWEN_KEY){
  console.error('❌ 缺少环境变量 QWEN_API_KEY');
  process.exit(1);
}

const XWLB_SYS_PROMPT = '你是资深新闻编辑，把以下《新闻联播》节目单整理成结构化每日总结，严格只输出如下 JSON（不要任何额外文字）：{"lead":"一句话导语（20字以内）","groups":[{"category":"分类名（如：国内要闻/经济发展/国际动态/社会民生/其他）","items":[{"title":"原标题","point":"一句话要点（30字以内）"}]}]}';

function parseTitles(html){
  /* CCTV 栏目页结构：<a href="...VIDEXXXXXX260810.shtml">标题</a>
     注意：栏目页 URL 是「当前节目日」，未必是 date；若 date 不匹配需提示用户 */
  const titles = [];
  const seen = {};
  const re = /<a[^>]+href="[^"]*?(\d{6})\.shtml[^"]*"[^>]*>([^<]+)<\/a>/g;
  let m;
  while((m = re.exec(html)) !== null){
    const yymmdd = m[1];
    const t = m[2].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if(t && !seen[t]){ seen[t] = true; titles.push({ yymmdd, title: t }); }
  }
  return titles;
}

async function fetchCctv(){
  const url = 'https://tv.cctv.com/lm/xwlb/';
  console.log('🌐 抓取 CCTV 栏目首页:', url);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Aurora-Workbench/1.0)' }
  });
  if(!res.ok) throw new Error('CCTV HTTP ' + res.status);
  return res.text();
}

async function callQwen(titles){
  const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  console.log('🤖 调通义千问生成总结...');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + QWEN_KEY },
    body: JSON.stringify({
      model: 'qwen-plus',
      messages: [
        { role: 'system', content: XWLB_SYS_PROMPT },
        { role: 'user', content: titles.map(t => t.title).join('\n') }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
  });
  if(!res.ok){
    const t = await res.text();
    throw new Error('Qwen HTTP ' + res.status + ': ' + t.slice(0, 300));
  }
  const j = await res.json();
  return JSON.parse(j.choices[0].message.content);
}

(async () => {
  try {
    /* 1. 抓 CCTV 栏目页 */
    const html = await fetchCctv();
    const all = parseTitles(html);

    /* 2. 过滤出目标日期的条目（date YYYY-MM-DD → yymmdd）*/
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) throw new Error('bad date format: ' + date);
    const yymmdd = m[1].slice(2) + m[2] + m[3];
    const titles = all.filter(t => t.yymmdd === yymmdd).map(t => t.title);
    const pageDate = all[0] ? all[0].yymmdd : null;

    if(!titles.length){
      throw new Error(`CCTV 栏目页没找到 ${date} 的节目（当前栏目页日期=${pageDate || '未知'}）。CCTV 栏目页只保留当日节目，无法抓历史日期；如需补录请用 Tab9「手动粘贴节目单」。`);
    }
    console.log(`📋 抓到 ${titles.length} 条 ${date} 节目:`);
    titles.forEach((t, i) => console.log(`  ${i+1}. ${t}`));

    /* 3. 调通义千问 */
    const summary = await callQwen(titles);
    console.log('✅ 总结生成成功:', JSON.stringify(summary).slice(0, 200));

    /* 4. 写文件 */
    const out = {
      date,
      titles,
      summary,
      generatedAt: new Date().toISOString(),
      source: 'github-actions'
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
    console.log(`💾 写入: ${OUT}`);

    process.stdout.write(JSON.stringify({ ok: true, file: OUT, titleCount: titles.length }) + '\n');
  } catch(e){
    console.error('❌ 失败:', e.message);
    process.exit(1);
  }
})();