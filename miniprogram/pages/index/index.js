const store = require('../../utils/store.js');
const W = require('../../utils/word.js');

Page({
  data: {
    today: '',
    wordDone: 0, wordKnown: 0, wordPct: 0,
    reviewTotal: 0, reviewRemain: 0,
    level: 1, rankName: '', streak: 0,
    importText: '', importMode: 'merge',
    dbBytes: 0,
    coming: [
      { ico: '👶', name: '宝宝早教 · 课时记录', desc: '课时打卡 / 自定义课程' },
      { ico: '🏃', name: '轻氧塑身日记', desc: '体重趋势 / 运动 / 16:8 断食（图表需改 canvas）' },
      { ico: '🍳', name: '食谱工坊 · 配方手记', desc: '配方与自定义食材分组' },
      { ico: '📚', name: '阅思集 · 读书札记', desc: '读书笔记与进度' },
      { ico: '📈', name: '市场瞭望 / 定投 / 新闻联播', desc: '依赖自建 API，需 https 域名后才能接入' }
    ]
  },

  db: null,

  onLoad() {
    this.loadAll();
  },
  onShow() {
    if (this.db) this.loadAll();
  },
  onPullDownRefresh() {
    this.loadAll();
    wx.stopPullDownRefresh();
  },

  loadAll() {
    const db = store.loadDb();
    W.ensureGame(db);
    W.touchStreak(db);
    store.saveDb(db);
    this.db = db;

    const g = db.words.game;
    const prog = W.dayProgress(db, W.dateStr(0));
    const stats = W.reviewStats(db);
    const text = store.exportDb();

    this.setData({
      today: W.dateStr(0),
      wordDone: prog.marked, wordKnown: prog.known,
      wordPct: Math.round(prog.marked / 10 * 100),
      reviewTotal: stats.total, reviewRemain: stats.remain,
      level: g.level, rankName: W.rankName(g.level), streak: g.streak || 0,
      dbBytes: Math.round(text.length / 1024)
    });
  },

  goEnglish() {
    wx.switchTab({ url: '/pages/english/english' });
  },

  /* ===== 数据迁移 ===== */
  onImportInput(e) {
    this.setData({ importText: e.detail.value });
  },
  doImport() {
    const t = (this.data.importText || '').trim();
    if (!t) {
      wx.showToast({ title: '请先粘贴数据', icon: 'none' });
      return;
    }
    const r = store.importDb(t, this.data.importMode);
    if (r.ok) {
      wx.showToast({ title: r.msg, icon: 'success' });
      this.setData({ importText: '' });
      this.loadAll();
    } else {
      wx.showToast({ title: r.msg, icon: 'none', duration: 2500 });
    }
  },
  pasteFromClipboard() {
    const self = this;
    wx.getClipboardData({
      success(res) {
        if (res && res.data) {
          self.setData({ importText: res.data });
          wx.showToast({ title: '已粘贴，点上方按钮导入', icon: 'none' });
        }
      }
    });
  },
  exportData() {
    const text = store.exportDb();
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '数据已复制到剪贴板', icon: 'success' });
      }
    });
  },
  switchMode(e) {
    this.setData({ importMode: e.currentTarget.dataset.mode });
  },
  resetData() {
    const self = this;
    wx.showModal({
      title: '确认清空本地数据？',
      content: '小程序内的所有学习记录会被删除，此操作不可恢复。',
      confirmColor: '#DB6B6B',
      success(res) {
        if (res.confirm) {
          store.resetDb();
          self.loadAll();
          wx.showToast({ title: '已清空', icon: 'none' });
        }
      }
    });
  }
});
