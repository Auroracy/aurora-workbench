const store = require('../../utils/store.js');
const W = require('../../utils/word.js');
const { WORD_BANK } = require('../../utils/words.js');

Page({
  data: {
    /* 头部 HUD */
    level: 1, xp: 0, xpNeed: 100, xpPct: 0, rankName: '见习学徒',
    combo: 0, streak: 0, dateStr: '', offsetTip: '',

    /* 今日进度 */
    prog: { marked: 0, known: 0, fuzzy: 0, unknown: 0 },
    wordsPreview: '',

    /* 强化复习队列 */
    stats: { total: 0, fuzzy: 0, unknown: 0, remain: 0 },
    cfgFuzzy: 2, cfgUnknown: 3,
    cfgRange: [1, 2, 3, 4, 5, 6],
    queueList: [],

    /* 当前词 */
    noText: '1 / 10',
    pos: '', status: '', statusCls: '',
    mainParts: [],     // 首个义项（大字），已挖空
    moreSenses: [],    // 其余义项 [{pos, parts}]
    usageParts: [],    // 常用搭配，已挖空
    en: '',
    examples: [],      // [{parts, cn, main}]
    hasMore: false,

    /* 交互状态 */
    revealedEn: false,
    revealedAll: false,
    blankState: 'hidden',   // hidden | ok | err
    spell: '', hint: '', hintType: '', inputCls: '',
    mark: '',
    inReview: false, reviewBanner: '',

    /* 列表展开 */
    queueOpen: false
  },

  /* 会话级状态（不进 setData） */
  db: null,
  offset: 0,
  idx: 0,
  review: null,      // { queue:[bankIdx], i:0, answeredAt:-1, right:0, wrong:0 }
  awardKey: '',

  onLoad() {
    this.db = store.loadDb();
    W.touchStreak(this.db);
    store.saveDb(this.db);
    this.render();
  },
  onShow() {
    if (this.db) {
      this.db = store.loadDb();
      this.render();
    }
  },
  onPullDownRefresh() {
    this.db = store.loadDb();
    this.render();
    wx.stopPullDownRefresh();
  },

  /* ============ 渲染总入口：把 db + 会话状态算成一个新的 data ============ */
  render() {
    const db = this.db;
    W.ensureGame(db);
    const g = db.words.game;
    const inReview = !!(this.review && this.review.queue.length);

    /* --- 定位当前词 --- */
    let word, posCn, sent, noText = '', reviewBanner = '';
    if (inReview) {
      const i = Math.min(this.review.i, this.review.queue.length - 1);
      const bi = this.review.queue[i];
      const wb = WORD_BANK[bi];
      word = wb[0]; posCn = wb[1]; sent = wb[2];
      noText = '强化 ' + (i + 1) + ' / ' + this.review.queue.length;
      const e = g.reviewQ[word];
      if (e) {
        const need = e.need || W.reviewNeed(db, e.mark);
        const left = Math.max(0, need - (e.done || 0));
        reviewBanner = left
          ? '还需答对 ' + left + ' 次即标记「已掌握」（进度 ' + Math.min(e.done || 0, need) + ' / ' + need + '）'
          : '已达标记线，答对一次即可标记「已掌握」';
      }
    } else {
      const words = W.wordsForOffset(this.offset);
      if (this.idx < 0) this.idx = 0;
      if (this.idx > 9) this.idx = 9;
      const w = words[this.idx];
      word = w.en; posCn = w.posCn; sent = w.sent;
      noText = (this.idx + 1) + ' / 10';
    }

    /* --- 当前标记 --- */
    let mark = '';
    if (inReview) {
      const e = g.reviewQ[word];
      mark = e ? e.mark : (g.masteredWords.indexOf(word) >= 0 ? 'known' : '');
    } else {
      const rec = db.words.dailyRecords[W.dateStr(this.offset)] || {};
      mark = ((rec.perWord || {})[this.idx] || {}).mark || '';
    }

    /* --- 词内容（全部先占位隐藏，再按需揭示） --- */
    const all = W.senses(word, posCn);
    const mainParts = all.length ? W.maskParts(all[0][1], word) : [];
    const moreSenses = [];
    for (let i = 1; i < all.length; i++) {
      moreSenses.push({ pos: all[i][0] || '', parts: W.maskParts(all[i][1] || '', word) });
    }
    const usg = W.usage(word);
    const usageParts = usg ? W.maskParts(usg, word) : [];

    const examples = W.examplesOf(word, sent).map(ex => ({
      parts: W.blankParts(ex.text, word),
      cn: ex.cn || '',
      main: ex.main
    }));

    /* --- 统计 --- */
    const prog = W.dayProgress(db, W.dateStr(this.offset));
    const stats = W.reviewStats(db);
    const queueList = stats.list.map(it => ({
      word: it.word,
      cn: W.briefCn(it.word, it.posCn),
      markCls: it.mark === 'unknown' ? 'red' : 'amber',
      markName: it.mark === 'unknown' ? '不认识' : '模糊',
      done: it.done, need: it.need,
      left: Math.max(0, it.need - it.done)
    }));
    const words = W.wordsForOffset(this.offset);

    /* --- 金币/XP --- */
    const need = W.xpNeed(g.level);
    const prevNeed = W.xpNeed(Math.max(1, g.level - 1));

    this.setData({
      level: g.level, xp: g.xp, xpNeed: need,
      xpPct: Math.max(0, Math.min(100, Math.round(g.xp / need * 100))),
      rankName: W.rankName(g.level),
      combo: g.combo || 0, streak: g.streak || 0,
      dateStr: W.dateStr(this.offset),
      offsetTip: this.offset === 0 ? '今天' : (this.offset < 0 ? '往前 ' + (-this.offset) + ' 天' : '往后 ' + this.offset + ' 天'),
      prog: prog,
      wordsPreview: '今日词：' + words.slice(0, 3).map(w => w.en).join(' · ') + ' …',
      stats: stats, cfgFuzzy: g.reviewCfg.fuzzy, cfgUnknown: g.reviewCfg.unknown,
      queueList: queueList,
      noText: noText, reviewBanner: reviewBanner, inReview: inReview,
      pos: all.length && all[0][0] ? all[0][0] : (W.parsePosCn(posCn).pos || 'word'),
      status: mark === 'known' ? '已掌握' : mark === 'fuzzy' ? '模糊' : mark === 'unknown' ? '不认识' : '',
      statusCls: 'mark-' + (mark || 'none'),
      mainParts: mainParts, moreSenses: moreSenses, usageParts: usageParts,
      en: word, examples: examples, hasMore: examples.length > 1,
      mark: mark
    });

    /* 保存当前词，供后续判定使用 */
    this._cur = { word: word, inReview: inReview };
  },

  /* 切词 / 切天时重置答题状态 */
  resetAnswer() {
    this.setData({
      revealedEn: false, revealedAll: false, blankState: 'hidden',
      spell: '', hint: '', hintType: '', inputCls: ''
    });
  },

  /* ============ 交互 ============ */
  onSpellInput(e) {
    this.setData({ spell: e.detail.value });
  },

  revealAnswer() {
    if (this.data.revealedAll) return;
    const w = this._cur.word;
    this.setData({
      revealedEn: true, revealedAll: true,
      blankState: this.data.blankState === 'hidden' ? 'ok' : this.data.blankState,
      spell: this.data.spell || w,
      inputCls: this.data.spell ? this.data.inputCls : 'ok',
      hint: this.data.hint || ('已显示答案：' + w),
      hintType: this.data.hint ? this.data.hintType : 'ok'
    });
  },

  checkSpell() {
    const w = this._cur.word;
    const typed = (this.data.spell || '').trim();
    if (!typed) {
      wx.showToast({ title: '请先输入拼写', icon: 'none' });
      return;
    }
    /* 同一次出现只判定一次，防止反复点刷进度 */
    if (this._cur.inReview && this.review.answeredAt === this.review.i) {
      this.setData({ hint: '这次已经判定过了，点「下一个 →」继续', hintType: '' });
      return;
    }
    W.touchStreak(this.db);

    if (typed.toLowerCase() === w.toLowerCase()) {
      let award = null, mastered = false, hint = '✓ 拼写正确！' + w;
      if (this._cur.inReview) {
        const r = W.reviewHit(this.db, w, this.offset);
        this.review.answeredAt = this.review.i;
        this.review.right++;
        if (r.mastered) {
          mastered = true;
          this.review.mastered = (this.review.mastered || 0) + 1;
          hint = '✓ 正确！「' + w + '」强化到位 → 已标记「已掌握」🎉';
        } else {
          hint = '✓ 正确！进度 ' + r.done + ' / ' + r.need + '，再答对 ' + (r.need - r.done) + ' 次即标记「已掌握」';
        }
      } else {
        /* 精练模式：答对直接标记已掌握（并把模糊/不认识升级） */
        const pos = W.findTodayPos(w, this.offset);
        W.setMark(this.db, W.dateStr(this.offset), pos, w, 'known');
      }
      award = W.hitCorrect(this.db);
      const badges = W.checkBadges(this.db);
      store.saveDb(this.db);
      this.setData({
        revealedEn: true, revealedAll: true, blankState: 'ok',
        inputCls: 'ok', hint: hint, hintType: 'ok'
      });
      this.render();
      if (mastered) wx.showToast({ title: '🎉 「' + w + '」已掌握', icon: 'none' });
      if (award && award.up) wx.showToast({ title: '升级！Lv.' + award.level + ' · ' + award.name, icon: 'none' });
      else if (badges.length) wx.showToast({ title: '🏆 解锁：' + badges[0].name, icon: 'none' });
    } else {
      if (this._cur.inReview) {
        W.reviewMiss(this.db, w);
        this.review.answeredAt = this.review.i;
        this.review.wrong++;
        /* 排到队尾：它还会再出现，直到掌握 */
        const bi = W.findBankIdx(w);
        if (bi >= 0) this.review.queue.push(bi);
        store.saveDb(this.db);
        this.setData({
          revealedEn: true, revealedAll: true, blankState: 'err', inputCls: 'err',
          hint: '✗ 拼写错误，正确答案是：' + w + '（进度回退，稍后还会再出现）', hintType: 'err'
        });
        W.hitWrong(this.db);
        store.saveDb(this.db);
        this.render();
        return;
      }
      const pos = W.findTodayPos(w, this.offset);
      const prev = ((this.db.words.dailyRecords[W.dateStr(this.offset)] || {}).perWord || {})[pos] || {};
      W.setMark(this.db, W.dateStr(this.offset), pos, w, prev.mark === 'known' ? 'known' : 'fuzzy');
      W.hitWrong(this.db);
      store.saveDb(this.db);
      this.setData({
        revealedEn: true, revealedAll: true, blankState: 'err', inputCls: 'err',
        hint: '✗ 拼写错误，正确答案是：' + w, hintType: 'err'
      });
      this.render();
    }
  },

  tapMark(e) {
    let val = e.currentTarget.dataset.val;
    /* 再点一次同一个标记 = 取消 */
    if (this.data.mark === val) val = '';
    const w = this._cur.word;
    if (this._cur.inReview) {
      /* 复习中的词：只更新队列里的程度，位置可能不在今日窗口 */
      if (val === 'known') { W.dequeue(this.db, w); W.trackMastered(this.db, w, 'known'); }
      else { W.enqueue(this.db, w, val); W.trackMastered(this.db, w, val); }
      store.saveDb(this.db);
      this.render();
      wx.showToast({ title: val === 'known' ? '已标记「已掌握」' : (val === 'fuzzy' ? '已加入强化队列' : '已加入强化队列'), icon: 'none' });
      return;
    }
    const pos = W.findTodayPos(w, this.offset);
    W.setMark(this.db, W.dateStr(this.offset), pos, w, val);
    store.saveDb(this.db);
    this.render();
    wx.showToast({
      title: val === 'known' ? '已标记「已掌握」' : (val === 'fuzzy' ? '标记「模糊」· 需再答对 ' + this.data.cfgFuzzy + ' 次' : '标记「不认识」· 需再答对 ' + this.data.cfgUnknown + ' 次'),
      icon: 'none'
    });
  },

  prevWord() {
    if (this._cur.inReview) return this.exitReview();
    if (this.idx > 0) { this.idx--; this.resetAnswer(); this.render(); }
    else wx.showToast({ title: '已经是第 1 个单词', icon: 'none' });
  },
  nextWord() {
    if (this._cur.inReview) return this.reviewNext();
    if (this.idx < 9) { this.idx++; this.resetAnswer(); this.render(); }
    else {
      const st = W.reviewStats(this.db);
      wx.showToast({
        title: st.total ? ('还有 ' + st.total + ' 个词待强化 · 点上方「开始强化」继续练') : '已经是最后一个单词',
        icon: 'none'
      });
    }
  },
  prevDay() { this.offset--; this.idx = 0; this.exitReview(true); this.resetAnswer(); this.render(); },
  nextDay() { this.offset++; this.idx = 0; this.exitReview(true); this.resetAnswer(); this.render(); },
  goToday() { this.offset = 0; this.idx = 0; this.exitReview(true); this.resetAnswer(); this.render(); },

  /* ============ 强化复习 ============ */
  toggleQueue() { this.setData({ queueOpen: !this.data.queueOpen }); },
  onCfg(e) {
    const m = e.currentTarget.dataset.mark;
    /* picker 返回的是下标，映射到实际次数 */
    const list = this.data.cfgRange;
    const val = list[parseInt(e.detail.value, 10)];
    W.setReviewCfg(this.db, m, val);
    store.saveDb(this.db);
    this.render();
  },
  startReview() {
    const st = W.reviewStats(this.db);
    if (!st.total) {
      wx.showToast({ title: '暂无待强化单词：先标记「模糊 / 不认识」', icon: 'none' });
      return;
    }
    const queue = W.buildReviewQueue(this.db);
    this.review = { queue: queue, i: 0, answeredAt: -1, right: 0, wrong: 0, mastered: 0, total: queue.length };
    this.resetAnswer();
    this.render();
    wx.showToast({ title: '🔁 强化复习开始 · 本轮 ' + queue.length + ' 次', icon: 'none' });
  },
  startReviewOne(e) {
    const w = e.currentTarget.dataset.word;
    const queue = W.buildReviewQueue(this.db, w);
    if (!queue.length) {
      wx.showToast({ title: '这个词已经强化到位了', icon: 'none' });
      return;
    }
    this.review = { queue: queue, i: 0, answeredAt: -1, right: 0, wrong: 0, mastered: 0, total: queue.length };
    this.resetAnswer();
    this.render();
  },
  reviewNext() {
    if (!this.review) return;
    if (this.review.i + 1 >= this.review.queue.length) {
      const g = this.db.words.game;
      const r = this.review;
      wx.showModal({
        title: '本轮强化完成',
        content: '练习 ' + (r.total || 0) + ' 次 · 答对 ' + r.right + ' 次 · 答错 ' + r.wrong + ' 次\n掌握 ' + (r.mastered || 0) + ' 个词',
        showCancel: false
      });
      this.exitReview();
      return;
    }
    this.review.i++;
    this.review.answeredAt = -1;
    this.resetAnswer();
    this.render();
  },
  exitReview(silent) {
    if (this.review) {
      this.review = null;
      if (!silent) wx.showToast({ title: '已退出强化复习', icon: 'none' });
    }
    this.resetAnswer();
    this.render();
  },

  speak() {
    wx.showToast({ title: '发音需接入 https 音频源，待配置', icon: 'none' });
  }
});
