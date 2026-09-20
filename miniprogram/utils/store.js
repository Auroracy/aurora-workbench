/* 本地存储层 —— 替代网页版的 localStorage
   数据结构与网页版完全一致，方便两边互导 */
const KEY = 'aurora_db';

function defaultDb() {
  return {
    earlyEd: { totalHours: 48, records: [], customCourses: [] },
    fitness: {
      fastStart: '08:00', fastEnd: '16:00',
      meals: [], weights: [], exercises: [], recipeIdx: 0
    },
    words: {
      dailyRecords: {},
      game: {
        xp: 0, level: 1, combo: 0, bestCombo: 0, streak: 0, lastDay: '', clears: 0,
        totalCorrect: 0, totalWrong: 0, badges: [], masteredWords: [], questBest: {},
        quest: null, mode: 'study', reviewQ: {}, reviewCfg: { fuzzy: 2, unknown: 3 }, reviewMastered: 0
      }
    },
    recipes: { items: [] },
    reading: { books: [] },
    xwlb: { cache: {} }
  };
}

/* 补齐缺失字段，保证旧数据在版本升级后仍可用 */
function normalize(db) {
  const d = defaultDb();
  const out = db && typeof db === 'object' ? db : {};
  for (const k in d) {
    if (out[k] === undefined) out[k] = d[k];
  }
  if (!out.words || typeof out.words !== 'object') out.words = d.words;
  if (!out.words.dailyRecords || typeof out.words.dailyRecords !== 'object') out.words.dailyRecords = {};
  if (!out.words.game || typeof out.words.game !== 'object') out.words.game = d.words.game;
  const g = out.words.game;
  const dg = d.words.game;
  for (const k in dg) {
    if (g[k] === undefined) g[k] = dg[k];
  }
  if (!Array.isArray(g.badges)) g.badges = [];
  if (!Array.isArray(g.masteredWords)) g.masteredWords = [];
  if (!g.reviewQ || typeof g.reviewQ !== 'object') g.reviewQ = {};
  if (!g.reviewCfg || typeof g.reviewCfg !== 'object') g.reviewCfg = { fuzzy: 2, unknown: 3 };
  return out;
}

function loadDb() {
  let raw = null;
  try {
    raw = wx.getStorageSync(KEY);
  } catch (e) {
    raw = null;
  }
  return normalize(raw);
}

function saveDb(db) {
  try {
    wx.setStorageSync(KEY, db || {});
    return true;
  } catch (e) {
    console.error('[Aurora] 保存失败', e);
    wx.showToast({ title: '本地存储写入失败', icon: 'none' });
    return false;
  }
}

/* 导出 JSON 字符串（供网页版/备份使用） */
function exportDb() {
  try {
    return JSON.stringify(loadDb(), null, 2);
  } catch (e) {
    return '';
  }
}

/* 从 JSON 字符串导入（把网页版数据搬过来 / 恢复备份）
   mode: 'merge' 合并覆盖同名 key；'replace' 整体替换 */
function importDb(text, mode) {
  if (!text) return { ok: false, msg: '内容为空' };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, msg: '不是合法的 JSON' };
  }
  if (!obj || typeof obj !== 'object') return { ok: false, msg: '数据格式不正确' };
  try {
    let next;
    if (mode === 'replace') {
      next = normalize(obj);
    } else {
      const cur = loadDb();
      for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) cur[k] = obj[k];
      }
      next = normalize(cur);
    }
    saveDb(next);
    return { ok: true, msg: '导入成功' };
  } catch (e) {
    return { ok: false, msg: '导入失败：' + (e.message || e) };
  }
}

function resetDb() {
  saveDb(defaultDb());
  return loadDb();
}

module.exports = { KEY, defaultDb, normalize, loadDb, saveDb, exportDb, importDb, resetDb };
