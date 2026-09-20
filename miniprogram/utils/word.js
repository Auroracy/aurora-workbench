/* ===== 每日英语：核心逻辑层 =====
   从 aurora-workbench.html 迁移，替掉所有 DOM 操作，改为纯数据函数，
   页面层只负责 setData 渲染。 */
const store = require('./store.js');
const { WORD_BANK, WORD_EXTRA } = require('./words.js');

const WORD_RANKS = [
  [1, '见习学徒'], [3, '词汇新秀'], [5, '单词猎人'],
  [7, '词林高手'], [10, '词汇大师'], [15, '词海行者']
];
const WORD_BADGES = [
  { id: 'first_blood', icon: '🌱', name: '初出茅庐', desc: '答对第 1 个单词' },
  { id: 'combo10', icon: '🔥', name: '十连击', desc: '连击达到 10' },
  { id: 'streak3', icon: '📅', name: '三日不辍', desc: '连续学习 3 天' },
  { id: 'streak7', icon: '🗓️', name: '七日成习', desc: '连续学习 7 天' },
  { id: 'lv5', icon: '⭐', name: '五级学者', desc: '等级达到 Lv.5' },
  { id: 'master50', icon: '📚', name: '词汇五十', desc: '累计掌握 50 词' },
  { id: 'revive10', icon: '🔁', name: '强化达人', desc: '强化复习掌握 10 词' }
];
const REVIEW_MIN = 1, REVIEW_MAX = 6;

/* ---------- 日期与选词 ---------- */
function dayOfYear() {
  const d = new Date();
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
}
function dateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function startIdx(offset) {
  const base = dayOfYear() + (offset || 0);
  const n = WORD_BANK.length;
  return ((base * 10) % n + n) % n;
}
/* 某天对应的 10 个词 */
function wordsForOffset(offset) {
  const s = startIdx(offset);
  const out = [];
  for (let i = 0; i < 10; i++) {
    const w = WORD_BANK[(s + i) % WORD_BANK.length];
    out.push({ en: w[0], posCn: w[1], sent: w[2] });
  }
  return out;
}

/* ---------- 词形与挖空 ---------- */
function esc(s) {
  return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/* 常见屈折形式：abandon→abandoned / apply→applied / commit→committed */
function wordForms(w) {
  const lower = (w || '').toLowerCase();
  const f = [lower];
  if (/e$/.test(lower)) f.push(lower.slice(0, -1) + 'es', lower.slice(0, -1) + 'ed', lower.slice(0, -1) + 'ing');
  if (/y$/.test(lower)) f.push(lower.slice(0, -1) + 'ies', lower.slice(0, -1) + 'ied', lower.slice(0, -1) + 'ying');
  const last = lower.slice(-1);
  f.push(lower + 's', lower + 'es', lower + 'ed', lower + 'd', lower + 'ing', lower + last + 'ed', lower + last + 'ing');
  const seen = {};
  const out = [];
  for (let i = 0; i < f.length; i++) {
    if (!seen[f[i]]) { seen[f[i]] = 1; out.push(f[i]); }
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}
function _splitBy(text, pattern) {
  const re = new RegExp(pattern, 'gi');
  const parts = [];
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index) });
    parts.push({ t: m[0], blank: true });
    last = m.index + m[0].length;
    if (!m[0].length) re.lastIndex++;
  }
  if (last < text.length) parts.push({ t: text.slice(last) });
  return parts;
}
/* 例句挖空：返回片段数组 [{t}, {t, blank:true}]，供 WXML 逐个渲染 */
function blankParts(sent, word) {
  const text = sent || '';
  if (!word) return [{ t: text }];
  const alt = wordForms(word).map(esc).join('|');
  let parts = _splitBy(text, '\\b(?:' + alt + ')\\b');
  /* 兜底：同词根的长单词（facilitate→facilitates 之外的变形） */
  if (!parts.some(p => p.blank)) {
    const stem = word.slice(0, Math.max(3, word.length - 3)).toLowerCase();
    if (stem.length >= 3) {
      parts = _splitBy(text, '\\b' + esc(stem) + '[a-z]*\\b');
    }
  }
  return parts.length ? parts : [{ t: text }];
}
/* 释义 / 常用搭配遮罩：只认精确词形（不兜底，避免 criterion 被 criteria 误伤） */
function maskParts(text, word) {
  const s = text || '';
  if (!word) return [{ t: s }];
  const alt = wordForms(word).map(esc).join('|');
  const parts = _splitBy(s, '\\b(?:' + alt + ')\\b');
  return parts.length ? parts : [{ t: s }];
}

/* ---------- 词信息 ---------- */
function parsePosCn(posCn) {
  const m = (posCn || '').match(/^([^.;]+[.;])\s*(.*)$/);
  if (m) return { pos: m[1], cn: m[2] };
  return { pos: '', cn: posCn || '' };
}
function senses(word, fallbackPosCn) {
  const ex = WORD_EXTRA[word];
  if (ex && ex.s && ex.s.length) return ex.s;
  const pc = parsePosCn(fallbackPosCn);
  return pc.cn ? [[pc.pos || '', pc.cn]] : [];
}
function briefCn(word, fallbackPosCn) {
  const s = senses(word, fallbackPosCn);
  return (s.length ? s[0][1] : parsePosCn(fallbackPosCn).cn) || '';
}
function usage(word) {
  const ex = WORD_EXTRA[word];
  return (ex && ex.u) || '';
}
/* 例句：主例句 + 该词自己的更多用法（带中文翻译） */
function examplesOf(word, fallbackSent) {
  const list = [{ text: fallbackSent || '', cn: '', main: true }];
  const ex = WORD_EXTRA[word];
  if (ex && ex.x && ex.x.length) {
    for (let i = 0; i < ex.x.length; i++) {
      list.push({ text: ex.x[i][0], cn: ex.x[i][1], main: false });
    }
  }
  return list;
}
function findBankIdx(word) {
  if (!word) return -1;
  for (let i = 0; i < WORD_BANK.length; i++) {
    if (WORD_BANK[i][0] === word) return i;
  }
  return -1;
}

/* ---------- 等级 / XP / 徽章 ---------- */
function ensureGame(db) {
  db = db || store.loadDb();
  return ensure(db);
}
function ensure(db) {
  if (!db.words) db.words = { dailyRecords: {}, game: {} };
  if (!db.words.dailyRecords) db.words.dailyRecords = {};
  const g = db.words.game && typeof db.words.game === 'object' ? db.words.game : {};
  const dflt = {
    xp: 0, level: 1, combo: 0, bestCombo: 0, streak: 0, lastDay: '', clears: 0,
    totalCorrect: 0, totalWrong: 0, badges: [], masteredWords: [], questBest: {},
    quest: null, mode: 'study', reviewQ: {}, reviewCfg: { fuzzy: 2, unknown: 3 }, reviewMastered: 0
  };
  for (const k in dflt) {
    if (g[k] === undefined) g[k] = dflt[k];
  }
  if (!Array.isArray(g.badges)) g.badges = [];
  if (!Array.isArray(g.masteredWords)) g.masteredWords = [];
  if (!g.reviewQ || typeof g.reviewQ !== 'object') g.reviewQ = {};
  if (!g.reviewCfg || typeof g.reviewCfg !== 'object') g.reviewCfg = { fuzzy: 2, unknown: 3 };
  if (g.reviewCfg.fuzzy === undefined) g.reviewCfg.fuzzy = 2;
  if (g.reviewCfg.unknown === undefined) g.reviewCfg.unknown = 3;
  db.words.game = g;
  return db;
}
function xpNeed(lv) { return 100 + (lv - 1) * 60; }
function rankName(lv) {
  let name = WORD_RANKS[0][1];
  for (let i = 0; i < WORD_RANKS.length; i++) {
    if (lv >= WORD_RANKS[i][0]) name = WORD_RANKS[i][1];
  }
  return name;
}
function touchStreak(db) {
  ensure(db);
  const g = db.words.game;
  const today = dateStr(0);
  if (g.lastDay === today) return false;
  const fresh = (g.lastDay === dateStr(-1)) ? (g.streak || 0) + 1 : 1;
  g.streak = fresh;
  g.lastDay = today;
  return true;
}
function addXp(db, n) {
  ensure(db);
  const g = db.words.game;
  g.xp += n;
  let need = xpNeed(g.level);
  let up = false;
  let guard = 0;
  while (g.xp >= need && guard++ < 50) {
    g.xp -= need;
    g.level += 1;
    need = xpNeed(g.level);
    up = true;
  }
  return { up: up, level: g.level, name: rankName(g.level) };
}
function checkBadges(db) {
  ensure(db);
  const g = db.words.game;
  const got = [];
  const add = id => {
    if (g.badges.indexOf(id) >= 0) return;
    g.badges.push(id);
    const b = WORD_BADGES.filter(x => x.id === id)[0];
    if (b) got.push(b);
  };
  if ((g.totalCorrect || 0) >= 1) add('first_blood');
  if ((g.bestCombo || 0) >= 10) add('combo10');
  if ((g.streak || 0) >= 3) add('streak3');
  if ((g.streak || 0) >= 7) add('streak7');
  if (g.level >= 5) add('lv5');
  if ((g.masteredWords || []).length >= 50) add('master50');
  if ((g.reviewMastered || 0) >= 10) add('revive10');
  return got;
}
/* 答对：连击 +1 并累计积分（返回本次获得 XP） */
function hitCorrect(db) {
  ensure(db);
  const g = db.words.game;
  g.combo = (g.combo || 0) + 1;
  if (g.combo > (g.bestCombo || 0)) g.bestCombo = g.combo;
  g.totalCorrect = (g.totalCorrect || 0) + 1;
  const bonus = 10 + Math.min(10, Math.floor((g.combo - 1) / 2) * 2);
  return addXp(db, bonus);
}
function hitWrong(db) {
  ensure(db);
  const g = db.words.game;
  g.combo = 0;
  g.totalWrong = (g.totalWrong || 0) + 1;
  return addXp(db, 2);
}

/* ---------- 每日记录 ---------- */
function getDaily(db, ds) {
  ensure(db);
  if (!db.words.dailyRecords[ds]) db.words.dailyRecords[ds] = {};
  const rec = db.words.dailyRecords[ds];
  if (!rec.perWord) rec.perWord = {};
  return rec;
}
function dayProgress(db, ds) {
  const rec = db.words && db.words.dailyRecords ? (db.words.dailyRecords[ds] || {}) : {};
  const perWord = rec.perWord || {};
  let known = 0, fuzzy = 0, unknown = 0;
  for (let i = 0; i < 10; i++) {
    const m = perWord[i] || {};
    if (m.mark === 'known') known++;
    else if (m.mark === 'fuzzy') fuzzy++;
    else if (m.mark === 'unknown') unknown++;
  }
  return { known, fuzzy, unknown, marked: known + fuzzy + unknown };
}
/* 标记某天某个位置的词 */
function setMark(db, ds, pos, word, val) {
  ensure(db);
  const rec = getDaily(db, ds);
  const g = db.words.game;
  if (val) {
    if (pos >= 0) rec.perWord[pos] = { mark: val };
    if (val === 'known') dequeue(db, word);
    else enqueue(db, word, val);
    trackMastered(db, word, val);
  } else {
    if (pos >= 0) delete rec.perWord[pos];
    dequeue(db, word);
    trackMastered(db, word, '');
  }
  return db;
}
function trackMastered(db, word, mark) {
  ensure(db);
  const g = db.words.game;
  const pos = g.masteredWords.indexOf(word);
  if (mark === 'known') {
    if (pos < 0) g.masteredWords.push(word);
  } else if (pos >= 0) {
    g.masteredWords.splice(pos, 1);
  }
}

/* ---------- 强化复习队列（按单词名存储，可跨天延续） ---------- */
function reviewNeed(db, mark) {
  ensure(db);
  const cfg = db.words.game.reviewCfg;
  return mark === 'unknown' ? (cfg.unknown || 3) : (cfg.fuzzy || 2);
}
function setReviewCfg(db, mark, val) {
  ensure(db);
  const n = parseInt(val, 10);
  const v = (n >= REVIEW_MIN && n <= REVIEW_MAX) ? n : (mark === 'unknown' ? 3 : 2);
  db.words.game.reviewCfg[mark] = v;
  /* 已入队的词同步套用新次数 */
  const q = db.words.game.reviewQ;
  for (const w in q) {
    if (q[w] && q[w].mark === mark) {
      q[w].need = reviewNeed(db, mark);
      if ((q[w].done || 0) > q[w].need) q[w].done = q[w].need;
    }
  }
  return db;
}
function enqueue(db, word, mark) {
  if (!word || (mark !== 'fuzzy' && mark !== 'unknown')) return db;
  ensure(db);
  const g = db.words.game;
  const need = reviewNeed(db, mark);
  const cur = g.reviewQ[word];
  if (cur) {
    cur.mark = mark;
    cur.need = need;
    if ((cur.done || 0) > need) cur.done = need;
  } else {
    g.reviewQ[word] = { mark: mark, need: need, done: 0, ts: Date.now() };
  }
  return db;
}
function dequeue(db, word) {
  ensure(db);
  if (db.words.game.reviewQ[word]) delete db.words.game.reviewQ[word];
  return db;
}
function reviewQueue(db) {
  ensure(db);
  const q = db.words.game.reviewQ;
  const out = [];
  for (const w in q) {
    const e = q[w];
    const bi = findBankIdx(w);
    if (!e || bi < 0) continue;
    out.push({
      word: w, idx: bi, mark: e.mark,
      need: e.need || reviewNeed(db, e.mark),
      done: e.done || 0, ts: e.ts || 0,
      posCn: WORD_BANK[bi][1]
    });
  }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}
function reviewStats(db) {
  const list = reviewQueue(db);
  let fuzzy = 0, unknown = 0, remain = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i].mark === 'unknown') unknown++; else fuzzy++;
    remain += Math.max(0, list[i].need - list[i].done);
  }
  return { list, total: list.length, fuzzy, unknown, remain };
}
/* 该词在"某天 10 词"里的位置 */
function findTodayPos(word, offset) {
  const words = wordsForOffset(offset || 0);
  for (let i = 0; i < words.length; i++) {
    if (words[i].en === word) return i;
  }
  return -1;
}
function reviewHit(db, word, curOffset) {
  ensure(db);
  const g = db.words.game;
  const e = g.reviewQ[word];
  if (!e) return { ok: false, done: 0, need: 1, mastered: false };
  e.need = e.need || reviewNeed(db, e.mark);
  e.done = (e.done || 0) + 1;
  if (e.done >= e.need) {
    delete g.reviewQ[word];
    const pos = findTodayPos(word, curOffset);
    if (pos >= 0) {
      const rec = getDaily(db, dateStr(curOffset || 0));
      rec.perWord[pos] = { mark: 'known' };
    }
    if (g.masteredWords.indexOf(word) < 0) g.masteredWords.push(word);
    g.reviewMastered = (g.reviewMastered || 0) + 1;
    return { ok: true, mastered: true, done: e.need, need: e.need };
  }
  return { ok: true, mastered: false, done: e.done, need: e.need };
}
function reviewMiss(db, word) {
  ensure(db);
  const e = db.words.game.reviewQ[word];
  if (!e) return db;
  e.done = Math.max(0, (e.done || 0) - 1);
  e.ts = Date.now();
  return db;
}
function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
/* 铺一轮复习序列：每词"还差几次"就出现几次 */
function buildReviewQueue(db, focusWord) {
  const list = reviewQueue(db);
  const queue = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (focusWord && it.word !== focusWord) continue;
    const times = Math.max(1, it.need - it.done);
    for (let t = 0; t < times; t++) queue.push(it.idx);
  }
  return shuffle(queue);
}

module.exports = {
  WORD_RANKS, WORD_BADGES, REVIEW_MIN, REVIEW_MAX,
  dayOfYear, dateStr, startIdx, wordsForOffset,
  esc, wordForms, blankParts, maskParts,
  parsePosCn, senses, briefCn, usage, examplesOf, findBankIdx,
  ensureGame: ensure, xpNeed, rankName, touchStreak, addXp, checkBadges, hitCorrect, hitWrong,
  getDaily, dayProgress, setMark, trackMastered,
  reviewNeed, setReviewCfg, enqueue, dequeue, reviewQueue, reviewStats,
  reviewHit, reviewMiss, findTodayPos, buildReviewQueue, shuffle
};
