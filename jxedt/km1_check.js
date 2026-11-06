/* 科目一小程序：逻辑层 + 静态结构验证（Node mock wx / Page，无需微信开发者工具） */
const fs = require('fs');
const path = require('path');
const MP = '/Users/aurora/WorkBuddy/2026-07-26-23-49-28/miniprogram';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗ FAIL', name, extra === undefined ? '' : extra); } };
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), '| got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

/* ---------- mock ---------- */
let storage = null;
const nav = [];
const toasts = [];
global.wx = {
  getStorageSync: () => storage,
  setStorageSync: (k, v) => { storage = v; },
  showToast: o => { toasts.push(o.title); },
  showModal: o => { if (o.success) o.success({ confirm: false }); },
  navigateTo: o => { nav.push(o.url); },
  switchTab: o => { nav.push(o.url); },
  navigateBack: () => {},
  getSystemInfoSync: () => ({ pixelRatio: 2 })
};
global.getApp = () => ({ globalData: { fontLevel: 1 }, setFontLevel(n) { this.globalData.fontLevel = n; } });
const PAGES = {};
let CUR = '';
global.Page = o => { PAGES[CUR] = o; };

const req = p => require(path.join(MP, p));
const Q = req('utils/questions.js');
const P = req('utils/points.js');
const S = req('utils/store.js');

/* ---------- 1. 题库 / 考点完整性 ---------- */
ok('科目一真题数 1821', Q.QUESTIONS.length === 1821, Q.QUESTIONS.length);
ok('考点总数 = 62 口诀 + 60 真题专项', P.POINT_IDS.length === 122, P.POINT_IDS.length);
ok('分类数 13', P.CATS.length === 13);
const ACTIVE = Object.keys(Q.BY_POINT);
ok('真题专项考点 60 个', ACTIVE.length === 60, ACTIVE.length);
ok('题目 id 唯一', new Set(Q.QUESTIONS.map(q => q.id)).size === Q.QUESTIONS.length);
ok('题库来源标注为驾校一点通专项练习',
  /驾校一点通/.test(fs.readFileSync(path.join(MP, 'utils/questions.js'), 'utf8').slice(0, 600)));
const noTip = [], badPoint = [], badAnswer = [], emptyOpt = [];
Q.QUESTIONS.forEach(q => {
  if (!P.POINT_MAP[q.point]) badPoint.push(q.id);
  if (q.answer < 0 || q.answer >= q.options.length) badAnswer.push(q.id);
  if (!q.tip) noTip.push(q.id);
  if (q.options.some(o => !o)) emptyOpt.push(q.id);
});
eq('无未知考点', badPoint, []);
eq('无越界答案', badAnswer, []);
eq('每题都有口诀解析', noTip, []);
eq('无空选项', emptyOpt, []);
const single = ACTIVE.filter(pid => (Q.BY_POINT[pid] || []).length < 1);
eq('每个真题考点都至少挂了 1 道题', single, []);
ok('多数真题考点有多道变式题', ACTIVE.filter(pid => Q.BY_POINT[pid].length >= 2).length >= 50,
  ACTIVE.filter(pid => Q.BY_POINT[pid].length >= 2).length);
ok('每道题的 cat 都能在 BY_CAT 找到', Q.QUESTIONS.every(q => (Q.BY_CAT[q.cat] || []).length > 0));
ok('至少 12 个口诀大类有真题可练', P.CAT_IDS.filter(c => (Q.BY_CAT[c] || []).length > 0).length >= 12,
  P.CAT_IDS.filter(c => (Q.BY_CAT[c] || []).length > 0).length);
ok('判断题选项固定 正确/错误', Q.QUESTIONS.filter(q => q.type === 'judge').every(q => q.options.length === 2 && q.options[0] === '正确' && q.options[1] === '错误'));
ok('选择题 2-4 个选项', Q.QUESTIONS.filter(q => q.type === 'choice').every(q => q.options.length >= 2 && q.options.length <= 4));
const withImg = Q.QUESTIONS.filter(q => q.img);
ok('带图题 887 道', withImg.length === 887, withImg.length);
ok('图片地址都是 https 外链', withImg.every(q => /^https:\/\//.test(q.img)));
ok('题目对象都带 topic / img / key 字段', Q.QUESTIONS.every(q => 'topic' in q && 'img' in q && 'key' in q));

/* ---------- 2. 出题引擎 ---------- */
storage = null;
S.resetAll();
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let paper = S.buildPaper({ size: 10, rnd });
ok('混合组卷 10 题', paper.length === 10);
ok('混合组卷题目都来自题库', paper.every(q => Q.QUESTIONS.some(x => x.id === q.id)));
ok('10 题内不重复', new Set(paper.map(q => q.id)).size === 10);
ok('加权抽题不会连续同考点过多', paper.filter((q, i) => i > 0 && q.point === paper[i - 1].point).length <= 3);

const catPaper = S.buildPaper({ cat: 'speed', size: 10, rnd });
ok('按大类组卷 10 题', catPaper.length === 10);
ok('大类组卷全部属于速度类', catPaper.every(q => q.cat === 'speed'));
const ptPaper = S.buildPaper({ point: 'zx39', size: 8, rnd });
ok('单考点组卷 8 题（同一考点循环出）', ptPaper.length === 8 && ptPaper.every(q => q.point === 'zx39'));
ok('单考点只有 1 道真题时会循环重复出', new Set(ptPaper.map(q => q.id)).size === 1);
const bigPt = ACTIVE.reduce((a, b) => Q.BY_POINT[a].length > Q.BY_POINT[b].length ? a : b);
const bigPaper = S.buildPaper({ point: bigPt, size: 8, rnd });
ok('大考点 8 题不重复', bigPaper.length === 8 && new Set(bigPaper.map(q => q.id)).size === 8);

/* 权重：错过多次的考点 > 已掌握的考点 */
S.resetAll();
const db = S.loadDb();
db.points['p_hard'] = { right: 0, wrong: 6, streak: 0, lastAt: Date.now() - 5 * 86400000 };
db.points['p_easy'] = { right: 8, wrong: 0, streak: 5, lastAt: Date.now() };
ok('错题多的考点权重更高', S.pointWeight(db, 'p_hard', Date.now()) > S.pointWeight(db, 'p_easy', Date.now()) * 5);
ok('新考点权重 > 1', S.pointWeight(db, 'p_brand_new', Date.now()) > 1);
ok('连对的考点权重 < 1', S.pointWeight(db, 'p_easy', Date.now()) < 1);

/* ---------- 3. 答题记录 / 错题本 / 掌握度 ---------- */
S.resetAll();
const q1 = Q.QUESTIONS[0], q2 = Q.QUESTIONS[1];
S.recordAnswer(q1, 1, false);
ok('答错进入错题本', S.wrongList().length === 1 && S.wrongList()[0].id === q1.id);
ok('答错统计 +1', S.overview().total === 1 && S.overview().right === 0);
S.recordAnswer(q1, q1.answer, true);
ok('错题答对 1 次仍留在错题本', S.wrongList().length === 1);
S.recordAnswer(q1, q1.answer, true);
ok('错题连对 2 次才毕业', S.wrongList().length === 0);
ok('1 错 2 对还没算掌握（正确率 67%）', !S.isMastered(S.pointStat(S.loadDb(), q1.point)));
S.recordAnswer(q1, q1.answer, true);
ok('再答对一次达到 75% 才算掌握', S.isMastered(S.pointStat(S.loadDb(), q1.point)));
S.resetAll();
S.recordAnswer(q2, 1 - q2.answer, false);
S.recordAnswer(q1, 1 - q1.answer, false);
const wrongPaper = S.buildPaper({ mode: 'wrong', size: 2, rnd });
ok('错题模式只出错题', wrongPaper.length === 2 && wrongPaper.every(q => q.id === q1.id || q.id === q2.id));
const cyclePaper = S.buildPaper({ mode: 'wrong', size: 10, rnd });
ok('错题不够 10 道时循环重复出（加强记忆）', cyclePaper.length === 10 && cyclePaper.every(q => q.id === q1.id || q.id === q2.id));

/* ---------- 4. 组卷结算 / 总览 ---------- */
S.resetAll();
const p10 = S.buildPaper({ size: 10, rnd });
const ans = p10.map((q, i) => ({ picked: q.answer, correct: i < 8 }));
const res = S.finishRound(p10, ans);
ok('结算 8/10', res.total === 10 && res.right === 8 && res.rate === 80);
ok('结算记入历史', S.overview().rounds === 1 && S.overview().history.length === 1);
ok('总览字段齐全', ['font','total','right','rate','rounds','mastered','pointTotal','wrongCount'].every(k => k in S.overview()));
ok('考点总览 13 类', S.catList().length === 13);
ok('每类有题数与掌握度', S.catList().every(c => c.questionCount >= 0 && c.pct >= 0 && c.pct <= 100));
ok('掌握度分母只算有真题的考点', S.overview().pointTotal === ACTIVE.length, S.overview().pointTotal);
ok('无真题的纯口诀类不显示练这组',
  S.catList().filter(c => c.questionCount === 0).every(c => c.pointTotal === 0));
ok('真题题数在分类里对得上', S.catList().reduce((n, c) => n + c.questionCount, 0) === Q.QUESTIONS.length);
S.setFont(2); ok('字号设置生效', S.getFont() === 2);
S.setFont(9); ok('字号越界被夹到 2', S.getFont() === 2);
S.resetAll(); ok('清空后回到默认大字', S.getFont() === 1);

/* ---------- 5. 页面逻辑：mock Page 跑一遍完整答题流程 ---------- */
['pages/index/index.js','pages/points/points.js','pages/quiz/quiz.js','pages/wrong/wrong.js'].forEach(f => { CUR = f; req(f); });
const idx = PAGES['pages/index/index.js'];
const pts = PAGES['pages/points/points.js'];
const quiz = PAGES['pages/quiz/quiz.js'];
const wrong = PAGES['pages/wrong/wrong.js'];
[idx, pts, quiz, wrong].forEach(p => { p.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); }; p.data = JSON.parse(JSON.stringify(p.data)); });

ok('四个页面都注册成功', !!(idx && pts && quiz && wrong));
let err = null;
try { idx.onShow(); pts.onShow(); wrong.onShow(); } catch (e) { err = e; }
ok('首页/考点/错题 onShow 无异常', !err, err && err.stack);
eq('考点页 13 类', pts.data.cats.length, 13);
eq('错题页空状态', wrong.data.count, 0);

idx.changeFont({ currentTarget: { dataset: { lv: 2 } } });
eq('首页字号按钮写入 data', idx.data.fontLevel, 2);
idx.startPractice();
ok('开始练习跳转到答题页', nav[nav.length - 1] === '/pages/quiz/quiz?mode=normal');
pts.practiceCat({ currentTarget: { dataset: { cat: 'speed' } } });
ok('按考点练带上 cat 参数', nav[nav.length - 1] === '/pages/quiz/quiz?mode=cat&cat=speed');

S.resetAll();
/* 页面流程走真实 Math.random → 用固定种子替身，保证可重复 */
const origRandom = Math.random;
Math.random = rnd;
quiz.onLoad({ mode: 'normal' });
eq('答题页组卷 10 题', quiz.data.total, 10);
eq('进度文案', quiz.data.idxText, '第 1 / 10 题');
ok('题干与选项已就绪', !!quiz.data.q.q && quiz.data.opts.length >= 2);
ok('未作答时不显示反馈', quiz.data.answered === false);
/* 全部答对 */
for (let i = 0; i < 10; i++) {
  quiz.choose({ currentTarget: { dataset: { i: String(quiz.data.q.answer) } } });
  ok('第 ' + (i + 1) + ' 题判对', quiz.data.correct === true);
  quiz.next();
}
ok('10 题后进入成绩页', quiz.data.finished === true);
ok('满分 10/10', quiz.data.result.right === 10 && quiz.data.result.rate === 100);
ok('满分鼓励语', quiz.data.encourage.indexOf('很稳') >= 0);
ok('全对则不进错题本', S.overview().wrongCount === 0);
ok('全对则所有做过的考点都记了答对次数',
  quiz.data.paper.every(q => S.pointStat(S.loadDb(), q.point).right > 0));
ok('全对则统计 +10', S.overview().right === 10 && S.overview().total === 10);
quiz.again();
ok('再练一组重置状态', quiz.data.finished === false && quiz.data.idx === 0);
/* 全错一遍 */
for (let i = 0; i < 10; i++) {
  quiz.choose({ currentTarget: { dataset: { i: String((quiz.data.q.answer + 1) % quiz.data.q.options.length) } } });
  quiz.next();
}
ok('全错成绩 0 分', quiz.data.result.right === 0 && quiz.data.result.rate === 0);
ok('全错进入错题本', S.overview().wrongCount === 10, S.overview().wrongCount);
ok('错题复盘列出考点', quiz.data.result.pointList.length > 0);
wrong.onShow();
eq('错题页显示 10 题', wrong.data.count, 10);
ok('错题卡带正确答案与口诀', wrong.data.list.every(w => w.answerText && w.tip));
ok('错题卡保留图片字段', wrong.data.list.every(w => 'img' in w));
wrong.practice();
ok('错题页跳转重练', nav[nav.length - 1] === '/pages/quiz/quiz?mode=wrong');
quiz.onLoad({ mode: 'wrong' });
ok('错题重练组卷', quiz.data.total === 10 && quiz.data.title === '错题重练');
S.clearWrong();
eq('清空错题本', S.overview().wrongCount, 0);
Math.random = origRandom;

/* ---------- 6. 静态检查：JSON / WXML / WXSS / 事件名 ---------- */
const pageDirs = ['index', 'points', 'quiz', 'wrong'];
pageDirs.forEach(d => {
  ['js','wxml','wxss','json'].forEach(ext => ok('页面文件齐全 ' + d + '.' + ext, fs.existsSync(path.join(MP, 'pages', d, d + '.' + ext))));
  const j = path.join(MP, 'pages', d, d + '.json');
  let je = null; try { JSON.parse(fs.readFileSync(j, 'utf8')); } catch (e) { je = e; }
  ok('页面 json 合法 ' + d, !je);
});
['app.json','project.config.json','project.private.config.json','sitemap.json'].forEach(f => {
  let e = null; try { JSON.parse(fs.readFileSync(path.join(MP, f), 'utf8')); } catch (x) { e = x; }
  ok('json 合法 ' + f, !e);
});
const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
eq('注册 4 个页面', appJson.pages.length, 4);
eq('tabBar 3 项', appJson.tabBar.list.length, 3);
ok('app.json 页面路径都存在', appJson.pages.every(p => fs.existsSync(path.join(MP, p + '.wxml'))));
ok('tabBar 路径都在 pages 里', appJson.tabBar.list.every(t => appJson.pages.indexOf(t.pagePath) >= 0));

const TAGS = ['view','block','button','text','image'];
ok('jxedtCats.js 存在且导出 13 类', (() => {
  const j = req('utils/jxedtCats.js');
  return Object.keys(j).length === 13 && Object.values(j).every(a => Array.isArray(a));
})());
const quizWxml = fs.readFileSync(path.join(MP, 'pages/quiz/quiz.wxml'), 'utf8');
const wrongWxml = fs.readFileSync(path.join(MP, 'pages/wrong/wrong.wxml'), 'utf8');
ok('答题页渲染图片题', /<image[^>]+src="\{\{q\.img\}\}"/.test(quizWxml));
ok('错题本渲染图片题', /<image[^>]+src="\{\{item\.img\}\}"/.test(wrongWxml));
ok('答题页有图片加载失败兜底', /binderror="onImgError"/.test(quizWxml));
ok('onImgError 在 quiz.js 有实现', /\bonImgError\s*:\s*function/.test(fs.readFileSync(path.join(MP, 'pages/quiz/quiz.js'), 'utf8')));
pageDirs.forEach(d => {
  const wxml = fs.readFileSync(path.join(MP, 'pages', d, d + '.wxml'), 'utf8');
  TAGS.forEach(t => {
    const open = (wxml.match(new RegExp('<' + t + '(?=[\\s>])', 'g')) || []).length;
    const close = (wxml.match(new RegExp('</' + t + '>', 'g')) || []).length;
    const self = (wxml.match(new RegExp('<' + t + '[^>]*/>', 'g')) || []).length;
    ok(d + '.wxml <' + t + '> 配平', open - self === close, 'open=' + open + ' close=' + close + ' self=' + self);
  });
  const js = fs.readFileSync(path.join(MP, 'pages', d, d + '.js'), 'utf8');
  const handlers = [...wxml.matchAll(/(?:bind|catch)tap="([^"]+)"/g)].map(m => m[1]);
  const missing = handlers.filter(h => !new RegExp('\\b' + h + '\\s*:\\s*function').test(js));
  eq(d + '.wxml 事件都有实现', missing, []);
  ok(d + '.wxml 不调用页面方法', !/\{\{[^}]*\w+\([^}]*\}\}/.test(wxml));
  ok(d + '.wxml style 里没有算式', !/style="[^"]*[+\-*/][^"]*"/.test(wxml.replace(/width:\{\{[^}]+\}\}%?/g, 'width:X')));

  const wxss = fs.readFileSync(path.join(MP, 'pages', d, d + '.wxss'), 'utf8');
  const badSel = [];
  wxss.split('}').forEach(rule => {
    const s = rule.trim().split('{')[0];
    if (!s || !rule.includes('{')) return;
    s.split(',').forEach(sel => {
      const t = sel.trim();
      if (/^(view|text|button|block|image|input|scroll-view|swiper)\b/.test(t)) badSel.push(t);
    });
  });
  eq(d + '.wxss 无标签选择器', badSel, []);
});

console.log('\n科目一小程序验证：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
