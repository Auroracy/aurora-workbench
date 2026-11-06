/* 本地数据 + 「按考点归类、重复出题、加强记忆」的出题引擎
   设计：每道题都挂在 point 上；记录每个考点的 对/错/连对/最近练习时间；
   抽题时用加权轮盘：新考点↑、错过↑、连对↓、久未复习↑ —— 错题和生疏考点会被反复抽到。 */
var Q = require('./questions.js');
var P = require('./points.js');

var KEY = 'km1_db_v1';
var DAY = 86400000;
var cache = null;

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr(ts) {
  var d = ts ? new Date(ts) : new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function defaultDb() {
  return {
    ver: 1,
    font: 1,                                  /* 0 标准 / 1 大字 / 2 超大字 */
    stats: { total: 0, right: 0, rounds: 0, today: '', todayTotal: 0 },
    points: {},                               /* pointId -> {right,wrong,streak,lastAt} */
    wrong: {},                                /* qid -> {times,cleared,picked,lastAt,point} */
    history: []                               /* 最近 20 组练习 */
  };
}

function loadDb() {
  if (cache) return cache;
  var raw = null;
  try { if (typeof wx !== 'undefined' && wx.getStorageSync) raw = wx.getStorageSync(KEY); } catch (e) { raw = null; }
  var db = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : defaultDb();
  var d = defaultDb();
  db.ver = 1;
  if (typeof db.font !== 'number') db.font = d.font;
  db.font = Math.max(0, Math.min(2, db.font));
  db.stats = Object.assign({}, d.stats, db.stats || {});
  if (db.stats.today !== todayStr()) { db.stats.today = todayStr(); db.stats.todayTotal = 0; }
  db.points = db.points && typeof db.points === 'object' ? db.points : {};
  db.wrong = db.wrong && typeof db.wrong === 'object' ? db.wrong : {};
  if (!Array.isArray(db.history)) db.history = [];
  cache = db;
  return db;
}

function saveDb(db) {
  cache = db || cache;
  try { if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(KEY, cache); } catch (e) {}
  return cache;
}

function resetAll() { cache = defaultDb(); return saveDb(); }
function clearWrong() { var db = loadDb(); db.wrong = {}; return saveDb(); }
function setFont(n) { var db = loadDb(); db.font = Math.max(0, Math.min(2, Number(n) || 0)); return saveDb().font; }
function getFont() { return loadDb().font; }

/* ---------- 掌握度 ---------- */
function pointStat(db, pid) {
  return db.points[pid] || { right: 0, wrong: 0, streak: 0, lastAt: 0 };
}
function isMastered(s) {
  var n = (s.right || 0) + (s.wrong || 0);
  return n >= 2 && s.right >= 2 && s.right / n >= 0.75;
}
function activePointIds() {
  /* 只统计真正有题目的考点：纯口诀考点（没有对应真题）不该算进掌握度分母 */
  return Object.keys(Q.BY_POINT);
}
function masteredCount(db) {
  var n = 0;
  activePointIds().forEach(function (pid) { if (isMastered(pointStat(db, pid))) n++; });
  return n;
}

/* ---------- 出题权重：新考点 / 错过 / 久未练 优先，连对降权 ---------- */
function pointWeight(db, pid, now) {
  var s = pointStat(db, pid);
  var w = 1;
  if (!s.right && !s.wrong) w += 1.2;                 /* 完全没练过：先见一面 */
  w += Math.min(s.wrong || 0, 6) * 0.7;              /* 错过越多，越要重复 */
  if (s.streak >= 2) w *= 0.45;                      /* 连对两次，暂时少出 */
  if (s.streak >= 4) w *= 0.6;                       /* 已经很熟，再降 */
  var days = s.lastAt ? (now - s.lastAt) / DAY : 0;  /* 间隔重复：越久没练越该复习 */
  w *= 1 + Math.min(Math.max(days, 0), 7) * 0.12;
  return Math.max(w, 0.05);
}

function pickWeighted(items, weights, rnd) {
  var total = 0, i;
  for (i = 0; i < weights.length; i++) total += weights[i];
  var r = rnd() * total, acc = 0;
  for (i = 0; i < items.length; i++) { acc += weights[i]; if (r <= acc) return items[i]; }
  return items[items.length - 1];
}
function shuffle(arr, rnd) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* 组卷：opts = {cat, point, mode:'normal'|'wrong', size, rnd}
   - 同考点有多道变式题时优先不重复；题出完了会循环再出（这正是「重复出题加强记忆」）
   - 尽量不让相邻两题来自同一考点 */
function buildPaper(opts) {
  opts = opts || {};
  var db = loadDb();
  var now = opts.now || Date.now();
  var rnd = opts.rnd || Math.random;
  var size = Math.max(1, opts.size || 10);
  var mode = opts.mode || 'normal';

  var pool;
  if (mode === 'wrong') {
    var ids = Object.keys(db.wrong);
    var byId = {};
    Q.QUESTIONS.forEach(function (q) { byId[q.id] = q; });
    pool = ids.map(function (id) { return byId[id]; }).filter(Boolean);
    pool.sort(function (a, b) { return (db.wrong[b.id].times || 0) - (db.wrong[a.id].times || 0); });
  } else if (opts.point) {
    pool = (Q.BY_POINT[opts.point] || []).slice();
  } else if (opts.cat && Q.BY_CAT[opts.cat]) {
    pool = Q.BY_CAT[opts.cat].slice();
  } else {
    pool = Q.QUESTIONS.slice();
  }
  if (!pool.length) return [];

  /* 按考点分桶 */
  var groups = {}, pids = [];
  pool.forEach(function (q) {
    if (!groups[q.point]) { groups[q.point] = []; pids.push(q.point); }
    groups[q.point].push(q);
  });

  var paper = [], used = {}, guard = 0;
  while (paper.length < size && guard++ < size * 60) {
    var cand = pids.slice();
    /* 上一题的考点降权，避免连续两题撞在同一考点 */
    var last = paper.length ? paper[paper.length - 1].point : '';
    var weights = cand.map(function (pid) {
      var w = pointWeight(db, pid, now);
      if (pid === last && cand.length > 1) w *= 0.25;
      /* 该考点的变式题都出过了 → 权重降低但仍可重复出 */
      var fresh = groups[pid].filter(function (q) { return !used[q.id]; }).length;
      if (!fresh) w *= 0.35;
      return w;
    });
    var pid = pickWeighted(cand, weights, rnd);
    var freshList = groups[pid].filter(function (q) { return !used[q.id]; });
    var list = freshList.length ? freshList : groups[pid];
    var q = list[Math.floor(rnd() * list.length)];
    used[q.id] = 1;
    paper.push(q);
  }
  return paper;
}

/* ---------- 答题记录 ---------- */
function recordAnswer(q, picked, correct) {
  var db = loadDb();
  var now = Date.now();
  if (db.stats.today !== todayStr(now)) { db.stats.today = todayStr(now); db.stats.todayTotal = 0; }
  db.stats.total++;
  db.stats.todayTotal++;
  if (correct) db.stats.right++;

  var s = db.points[q.point] || { right: 0, wrong: 0, streak: 0, lastAt: 0 };
  if (correct) { s.right++; s.streak++; } else { s.wrong++; s.streak = 0; }
  s.lastAt = now;
  db.points[q.point] = s;

  if (!correct) {
    var w = db.wrong[q.id] || { times: 0, cleared: 0, picked: picked, lastAt: now, point: q.point };
    w.times++; w.cleared = 0; w.picked = picked; w.lastAt = now; w.point = q.point;
    db.wrong[q.id] = w;
  } else if (db.wrong[q.id]) {
    /* 错题要连着答对 2 次才「毕业」，避免蒙对一次就放过 */
    db.wrong[q.id].cleared = (db.wrong[q.id].cleared || 0) + 1;
    if (db.wrong[q.id].cleared >= 2) delete db.wrong[q.id];
  }
  saveDb(db);
  return { mastered: isMastered(s), stat: s };
}

/* 一组练习结束：写历史，返回复盘信息 */
function finishRound(paper, answers) {
  var db = loadDb();
  var right = 0, cats = {}, wrongPoints = {};
  paper.forEach(function (q, i) {
    var ok = !!answers[i] && answers[i].correct;
    if (ok) right++;
    cats[q.catName] = (cats[q.catName] || 0) + (ok ? 0 : 1);
    if (!ok) wrongPoints[q.pointName] = (wrongPoints[q.pointName] || 0) + 1;
  });
  db.stats.rounds++;
  var rec = { date: todayStr(), time: Date.now(), total: paper.length, right: right };
  db.history.unshift(rec);
  if (db.history.length > 20) db.history = db.history.slice(0, 20);
  saveDb(db);
  var catList = Object.keys(cats).filter(function (k) { return cats[k] > 0; })
    .map(function (k) { return { name: k, wrong: cats[k] }; })
    .sort(function (a, b) { return b.wrong - a.wrong; });
  var pointList = Object.keys(wrongPoints)
    .map(function (k) { return { name: k, wrong: wrongPoints[k] }; })
    .sort(function (a, b) { return b.wrong - a.wrong; });
  return { total: paper.length, right: right, rate: paper.length ? Math.round(right * 100 / paper.length) : 0, catList: catList, pointList: pointList };
}

/* ---------- 页面取数 ---------- */
function overview() {
  var db = loadDb();
  var st = db.stats;
  return {
    font: db.font,
    total: st.total,
    todayTotal: st.todayTotal,
    right: st.right,
    rate: st.total ? Math.round(st.right * 100 / st.total) : 0,
    rounds: st.rounds,
    mastered: masteredCount(db),
    pointTotal: activePointIds().length,
    wrongCount: Object.keys(db.wrong).length,
    history: db.history.slice(0, 5)
  };
}

function catList() {
  var db = loadDb();
  return P.CATS.map(function (c) {
    var total = 0, done = 0, right = 0, wrong = 0;
    c.points.forEach(function (p) {
      if (!Q.BY_POINT[p.id] || !Q.BY_POINT[p.id].length) return;  /* 纯口诀考点不计入掌握度 */
      var s = pointStat(db, p.id);
      total++;
      if (isMastered(s)) done++;
      right += s.right || 0; wrong += s.wrong || 0;
    });
    return {
      id: c.id, no: c.no, name: c.name, sub: c.sub, mnemonic: c.mnemonic,
      notes: c.notes, pointTotal: total, mastered: done,
      practiced: right + wrong, wrong: wrong,
      pct: total ? Math.round(done * 100 / total) : 0,
      questionCount: (Q.BY_CAT[c.id] || []).length
    };
  });
}

function wrongList() {
  var db = loadDb();
  var byId = {};
  Q.QUESTIONS.forEach(function (q) { byId[q.id] = q; });
  return Object.keys(db.wrong).map(function (id) {
    var w = db.wrong[id], q = byId[id];
    if (!q) return null;
    return {
      id: id, q: q.q, pointName: q.pointName, catName: q.catName,
      options: q.options, answer: q.answer, tip: q.tip, key: q.key, img: q.img || '',
      picked: w.picked, times: w.times,
      pickedText: q.options[w.picked] || '未作答',
      answerText: q.options[q.answer]
    };
  }).filter(Boolean).sort(function (a, b) { return b.times - a.times; });
}

module.exports = {
  KEY: KEY,
  loadDb: loadDb, saveDb: saveDb, resetAll: resetAll, clearWrong: clearWrong,
  setFont: setFont, getFont: getFont,
  buildPaper: buildPaper, recordAnswer: recordAnswer, finishRound: finishRound,
  overview: overview, catList: catList, wrongList: wrongList,
  pointWeight: pointWeight, isMastered: isMastered, pointStat: pointStat,
  todayStr: todayStr
};
