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
  console.error('❌ [step 0] 缺少环境变量 QWEN_API_KEY，请在仓库 Settings → Secrets and variables → Actions 配置');
  process.exit(1);
}
const HAS_QWEN = !!QWEN_KEY;
const NO_QWEN_FLAG_FILE = process.env.NO_QWEN_FALLBACK === '1';

const XWLB_SYS_PROMPT = '你是资深新闻编辑，把以下《新闻联播》节目单整理成结构化每日总结，严格只输出如下 JSON（不要任何额外文字）：{"lead":"一句话导语（20字以内）","groups":[{"category":"分类名（如：国内要闻/经济发展/国际动态/社会民生/其他）","items":[{"title":"原标题","point":"一句话要点（30字以内）"}]}]}';

/* 关键词分类（无 QWEN 时降级用，不依赖 AI） */
const CAT_KW = [
  { cat: '国内要闻', kw: ['习近平','中共中央','中央政治局','国务院','全国人大','全国政协','中央军委','党和国家','总书记','主席'] },
  { cat: '经济发展', kw: ['经济','产业','工业','农业','企业','市场','消费','投资','改革','发展','金融','数据','增长','项目','投产','开工'] },
  { cat: '国际动态', kw: ['俄罗斯','美国','日本','韩国','朝鲜','伊朗','欧盟','联合国','北约','会谈','会见','外长','访问','国际','外交','峰会','元首','总统','总理'] },
  { cat: '社会民生', kw: ['民生','教育','医疗','就业','保障','扶贫','乡村','群众','人民','群众','春节','文化','体育','考古','文物','航天','科技','卫星','火箭'] },
  { cat: '其他',     kw: [] },
];
function fallbackSummary(titles){
  const groups = {};
  for(const title of titles){
    let placed = false;
    for(const def of CAT_KW){
      if(def.kw.some(k => title.includes(k))){
        (groups[def.cat] = groups[def.cat] || []).push({ title, point: title });
        placed = true; break;
      }
    }
    if(!placed){
      (groups['其他'] = groups['其他'] || []).push({ title, point: title });
    }
  }
  const order = ['国内要闻','经济发展','国际动态','社会民生','其他'];
  return {
    lead: `今日共 ${titles.length} 条要闻`,
    groups: order.filter(c => groups[c]).map(c => ({ category: c, items: groups[c].slice(0, 5) })),
  };
}

/* 通用：带超时的 GET 文本抓取 */
function fetchText(url, label, timeoutMs){
  console.log('🌐 抓取' + label + ':', url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(label + ' timeout ' + (timeoutMs/1000) + 's')), timeoutMs);
  return fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Aurora-Workbench/1.0)' },
    signal: controller.signal,
  }).then(res => {
    if(!res.ok) throw new Error(label + ' HTTP ' + res.status);
    return res.text();
  }).finally(() => clearTimeout(timer));
}

/* 阶段1：从栏目首页定位当天那期新闻联播详情页链接。
   CCTV 改版后：栏目首页只有视频列表（<a> 内嵌 <img>/<i>），
   节目单（"本期节目主要内容"）在当期详情页里，故需先定位详情页 URL。
   详情页链接形如 .../2026/08/12/VIDE...<YYMMDD>.shtml */
function findTodayEpisode(html, yymmdd){
  const re = /href="([^"]*?(\d{6})\.shtml)"/g;
  let m;
  while((m = re.exec(html)) !== null){
    if(m[2] === yymmdd){
      let link = m[1];
      if(link.startsWith('//')) link = 'https:' + link;
      else if(link.startsWith('/')) link = 'https://tv.cctv.com' + link;
      return link;
    }
  }
  return null;
}

/* 阶段2：从详情页提取「本期节目主要内容」节目单文字，按顶层序号(1. 2. 3.)分割为条目 */
function parseDetail(html){
  // 终止标记：节目单真实结尾是 "（《新闻联播》 YYYYMMDD HH:MM）"，其后紧接 HTML/JS 代码，必须在此截断
  const m = html.match(/本期节目主要内容[:：]([\s\S]*?)(?:（《新闻联播》|栏目信息|责任编辑|相关推荐|"\s*>|"\s*<\/|$)/);
  if(!m) return [];
  const body = m[1].replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ');
  const items = [];
  const re = /(\d+)\.\s*([\s\S]*?)(?=\s*\d+\.|$)/g;
  let mm;
  while((mm = re.exec(body)) !== null){
    const t = mm[2].replace(/\s+/g, ' ').trim();
    if(t) items.push(t);
  }
  return items;
}

async function callQwen(titles){
  const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  console.log('🤖 调通义千问生成总结...');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Qwen timeout 60s')), 60000);
  try {
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
      }),
      signal: controller.signal,
    });
    if(!res.ok){
      const t = await res.text();
      throw new Error('Qwen HTTP ' + res.status + ': ' + t.slice(0, 300));
    }
    const j = await res.json();
    return JSON.parse(j.choices[0].message.content);
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  try {
    /* 1. 抓栏目首页 → 定位当天那期详情页 → 抓详情页 → 提取节目单 */
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) throw new Error('bad date format: ' + date);
    const yymmdd = m[1].slice(2) + m[2] + m[3];

    const columnHtml = await fetchText('https://tv.cctv.com/lm/xwlb/', 'CCTV 栏目首页', 30000);
    const epLink = findTodayEpisode(columnHtml, yymmdd);
    if(!epLink){
      throw new Error(`栏目首页没找到 ${date} (${yymmdd}) 那期新闻联播。CCTV 栏目页只保留当日节目，无法抓历史日期；如需补录请用 Tab9「手动粘贴节目单」。`);
    }
    console.log('🔗 当期详情页:', epLink);

    const detailHtml = await fetchText(epLink, 'CCTV 当期详情页', 30000);
    const titles = parseDetail(detailHtml);

    if(!titles.length){
      throw new Error(`详情页没解析到 ${date} 的节目单（可能当日新闻联播尚未更新，或页面结构再次变更）。如需补录请用 Tab9「手动粘贴节目单」。`);
    }
    console.log(`📋 抓到 ${titles.length} 条 ${date} 节目:`);
    titles.forEach((t, i) => console.log(`  ${i+1}. ${t}`));

    /* 3. 调通义千问（失败则降级为本地关键词打分，保证 workflow 不 fail） */
    let summary;
    try {
      summary = await callQwen(titles);
      console.log('✅ AI 总结生成成功:', JSON.stringify(summary).slice(0, 200));
    } catch(qe){
      console.error('⚠️ Qwen 调用失败，使用关键词降级总结:', qe.message);
      summary = fallbackSummary(titles);
    }

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