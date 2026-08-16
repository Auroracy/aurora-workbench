#!/usr/bin/env node
/*
 * 一次性清洗脚本：扫描 Redis 中的 aurora:workbench:db，
 * 找出被「◆ 乱码」污染的 新闻联播(xwlb) 历史条目并删除，
 * 同时全库扫描任何其他含连续 ◆ 的字段并报告。
 *
 * 用法（在服务器上，确保 REDIS_URL 已设置 / 或 --url 传入）：
 *   node clean-garbled.js            # 默认 dry-run，只报告不修改
 *   node clean-garbled.js --apply    # 实际删除污染条目并写回
 *   node clean-garbled.js --url "redis://:密码@host:6379" --apply
 *
 * 注意：乱码不可还原，脚本只做「定位 + 删除污染条目」，
 * 删除后该日期在历史里不再显示；当天可照常刷新重新生成。
 */
const fs = require('fs');
const path = require('path');
const DATA_KEY = 'aurora:workbench:db';

// 取 REDIS_URL：命令行 --url 优先，否则环境变量
function getRedisUrl() {
  const i = process.argv.indexOf('--url');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.REDIS_URL || '';
}
const APPLY = process.argv.includes('--apply');
const URL = getRedisUrl();

if (!URL) {
  console.error('✗ 未找到 REDIS_URL。请在服务器环境下运行（已 export REDIS_URL），或用 --url 传入。');
  process.exit(1);
}

// 连续 3 个以上 ◆ 视为污染标记
const GARBLED = /◆{3,}/;

// 递归扫描对象，收集所有匹配「连续◆」的字符串路径
function scanGarbled(obj, prefix, hits) {
  if (obj == null) return;
  if (typeof obj === 'string') {
    if (GARBLED.test(obj)) hits.push(prefix || '(root)');
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, idx) => scanGarbled(v, prefix + '[' + idx + ']', hits));
    return;
  }
  if (typeof obj === 'object') {
    Object.keys(obj).forEach(k => scanGarbled(obj[k], prefix ? prefix + '.' + k : k, hits));
  }
}

(async () => {
  let redis;
  try {
    redis = require('redis');
  } catch (e) {
    console.error('✗ 未安装 redis 模块，请在该项目目录（含 node_modules/redis）下运行：', e.message);
    process.exit(1);
  }

  const client = redis.createClient({ url: URL });
  client.on('error', e => console.error('[redis] error:', e.message));
  await client.connect();

  const raw = await client.get(DATA_KEY);
  if (!raw) {
    console.error('✗ Redis 中无 ' + DATA_KEY + ' 数据。');
    await client.quit();
    process.exit(1);
  }

  // 备份原始数据（无论如何都留档）
  const backupDir = path.join(__dirname, 'data');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, 'backup-' + Date.now() + '.json');
  fs.writeFileSync(backupFile, raw, 'utf8');
  console.log('✓ 已备份原始数据 -> ' + backupFile);

  let db;
  try { db = JSON.parse(raw); } catch (e) {
    console.error('✗ JSON 解析失败：', e.message);
    await client.quit();
    process.exit(1);
  }

  // 1) 扫描 xwlb 缓存，定位污染日期条目
  const xwlb = (db.xwlb && db.xwlb.cache) || {};
  const garbledDates = [];
  Object.keys(xwlb).forEach(date => {
    const hits = [];
    scanGarbled(xwlb[date], 'cache.' + date, hits);
    if (hits.length) garbledDates.push({ date, hits });
  });

  // 2) 全库扫描其他含连续◆的字段（排除 xwlb 已统计的）
  const otherHits = [];
  (function walk(o, p) {
    if (o == null) return;
    if (typeof o === 'string') {
      if (GARBLED.test(o) && !p.startsWith('xwlb.cache.')) otherHits.push(p);
      return;
    }
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, p + '[' + i + ']')); return; }
    if (typeof o === 'object') { Object.keys(o).forEach(k => walk(o[k], p ? p + '.' + k : k)); }
  })(db, '');

  console.log('\n========== 扫描结果 ==========');
  console.log('污染的新闻联播日期条目（将删除）：' + garbledDates.length + ' 条');
  garbledDates.forEach(d => {
    console.log('  • ' + d.date + '  (' + d.hits.length + ' 处含 ◆：' + d.hits.slice(0, 3).join(', ') + (d.hits.length > 3 ? ' …' : '') + ')');
  });
  console.log('\n全库其他含连续◆的字段：' + otherHits.length + ' 处');
  otherHits.slice(0, 20).forEach(p => console.log('  - ' + p));
  if (otherHits.length > 20) console.log('  … 其余 ' + (otherHits.length - 20) + ' 处略');

  if (!APPLY) {
    console.log('\n⚠ 当前为 dry-run（只读），未做任何修改。');
    console.log('   确认无误后加 --apply 执行删除：node clean-garbled.js --apply');
    await client.quit();
    process.exit(0);
  }

  // 3) 实际删除污染日期条目
  garbledDates.forEach(({ date }) => { delete xwlb[date]; });
  const newRaw = JSON.stringify(db);
  await client.set(DATA_KEY, newRaw);
  console.log('\n✓ 已删除 ' + garbledDates.length + ' 条污染的新闻联播历史，并写回 Redis。');
  console.log('  全库其他 ' + otherHits.length + ' 处含 ◆ 字段未自动处理（请人工确认模块）。');
  await client.quit();
  process.exit(0);
})().catch(e => {
  console.error('✗ 脚本执行失败：', e.message);
  process.exit(1);
});
