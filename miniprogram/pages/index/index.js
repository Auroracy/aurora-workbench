const store = require('../../utils/store.js');
const W = require('../../utils/word.js');
const cloudApi = require('../../utils/cloudApi.js');

Page({
  data: {
    today: '',
    wordDone: 0, wordKnown: 0, wordPct: 0,
    reviewTotal: 0, reviewRemain: 0,
    level: 1, rankName: '', streak: 0,
    importText: '', importMode: 'merge',
    dbBytes: 0,
    netState: '', netBusy: false, netTitle: '未测试 · 点右侧「测一下」', netMsg: '', netRaw: '',
    coming: [
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
  goEarlyEd() {
    wx.navigateTo({ url: '/pages/earlyed/earlyed' });
  },
  goFitness() {
    wx.navigateTo({ url: '/pages/fitness/fitness' });
  },

  /* ===== 联网自检 =====
   * 走云函数 auroraProxy 转发新浪行情（GBK 编码），
   * 用来验证「云开发已开通 + 云函数已部署 + 白名单放行」整条链路。 */
  checkCloud() {
    if (this.data.netBusy) return;
    const self = this;

    if (!cloudApi.ready()) {
      this.setData({
        netState: 'err',
        netTitle: '云开发未启用',
        netMsg: 'app.js 的 CLOUD_ENV 为空，或当前环境不支持 wx.cloud。本地模块（单词/复习）不受影响，可正常使用。',
        netRaw: ''
      });
      return;
    }

    this.setData({
      netBusy: true, netState: 'run',
      netTitle: '正在请求新浪行情…', netMsg: '', netRaw: ''
    });
    const t0 = Date.now();

    cloudApi
      .text('https://hq.sinajs.cn/list=sh000001', 'gbk', { Referer: 'https://finance.sina.com.cn' })
      .then(function (body) {
        const ms = Date.now() - t0;
        self.setData({
          netBusy: false, netState: 'ok',
          netTitle: '联网成功 · ' + ms + 'ms',
          netMsg: self.parseSina(body),
          netRaw: String(body || '').slice(0, 160)
        });
      })
      .catch(function (e) {
        self.setData({
          netBusy: false, netState: 'err',
          netTitle: '联网失败',
          netMsg: String((e && e.message) || e),
          netRaw: ''
        });
      });
  },

  /* 新浪行情字段布局（指数与个股同一套，实测 sh000001 共 34 段）：
     0 名称 | 1 今开 | 2 昨收 | 3 当前 | 4 最高 | 5 最低 | 8 成交量 | 9 成交额 | 30 日期 | 31 时间
     ※ 涨跌额/涨跌幅没有现成字段，用「当前 - 昨收」自己算，避免字段错位 */
  parseSina(body) {
    const m = String(body || '').match(/"([^"]*)"/);
    if (!m || !m[1]) return '接口通了，但内容为空（可能非交易时段，或需重试一次）。';
    const a = m[1].split(',');
    const pre = parseFloat(a[2]);
    const cur = parseFloat(a[3]);
    if (a.length < 6 || isNaN(cur) || isNaN(pre) || !pre) {
      return '返回内容：' + m[1].slice(0, 80);
    }
    const chg = cur - pre;
    const pct = chg / pre * 100;
    const sign = function (n) { return (n >= 0 ? '+' : '') + n.toFixed(2); };
    const when = a[30] ? '　' + a[30] + ' ' + a[31] : '';
    return a[0] + '　' + cur.toFixed(2) + '　' + sign(chg) + '　' + sign(pct) + '%' + when;
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
