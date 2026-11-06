/* 答题页：一次 10 题；答完立刻看对错 + 口诀；不自动跳题，看明白再点下一题 */
var store = require('../../utils/store.js');
var P = require('../../utils/points.js');

Page({
  data: {
    fontLevel: 1,
    mode: 'normal', cat: '', point: '', title: '混合练习',
    paper: [], answers: [], total: 0, idx: 0,
    q: {}, opts: [], answerText: '', pickedText: '',
    idxText: '', progressPct: 0, nextText: '下一题',
    answered: false, picked: -1, correct: false, imgError: false,
    finished: false, result: {}, encourage: ''
  },

  onLoad: function (options) {
    var mode = options.mode || 'normal';
    var cat = options.cat || '';
    var point = options.point || '';
    var ov = store.overview();
    var size = 10;
    if (mode === 'wrong') size = Math.max(1, Math.min(ov.wrongCount, 10));

    var title = '混合练习';
    if (mode === 'wrong') title = '错题重练';
    else if (mode === 'cat' && P.CAT_MAP[cat]) title = P.CAT_MAP[cat].name;
    else if (mode === 'point' && P.POINT_MAP[point]) title = P.POINT_MAP[point].name;

    this.cfg = { mode: mode, cat: cat, point: point, size: size };
    this.setData({
      fontLevel: store.getFont(), mode: mode, cat: cat, point: point,
      title: title, size: size
    });
    this.newPaper();
  },

  onShow: function () {
    if (this.data.fontLevel !== store.getFont()) this.setData({ fontLevel: store.getFont() });
  },

  newPaper: function () {
    var s = this.cfg;
    var paper = store.buildPaper({ mode: s.mode === 'cat' ? 'normal' : s.mode, cat: s.cat, point: s.point, size: s.size });
    if (!paper.length) {
      wx.showToast({ title: '这里还没有题目', icon: 'none' });
      var self = this;
      setTimeout(function () { wx.navigateBack(); }, 1200);
      return;
    }
    this.setData({
      paper: paper, answers: [], total: paper.length,
      finished: false, result: {}, encourage: ''
    });
    this.renderCurrent(0);
  },

  renderCurrent: function (idx) {
    var q = this.data.paper[idx];
    var judge = q.type === 'judge';
    var labels = judge ? ['√', '×'] : ['A', 'B', 'C', 'D'];
    var opts = q.options.map(function (t, i) { return { label: labels[i], text: t }; });
    this.setData({
      idx: idx, q: q, opts: opts,
      answerText: q.options[q.answer],
      pickedText: '',
      idxText: '第 ' + (idx + 1) + ' / ' + this.data.total + ' 题',
      progressPct: Math.round(idx * 100 / this.data.total),
      nextText: (idx + 1 >= this.data.total) ? '看这一组的成绩' : '下一题',
      answered: false, picked: -1, correct: false, imgError: false
    });
  },

  onImgError: function () {
    this.setData({ imgError: true });
  },

  choose: function (e) {
    if (this.data.answered) return;
    var i = Number(e.currentTarget.dataset.i);
    var q = this.data.q;
    var correct = (i === q.answer);
    store.recordAnswer(q, i, correct);
    var answers = this.data.answers.slice();
    answers[this.data.idx] = { picked: i, correct: correct };
    this.setData({
      picked: i, correct: correct, answered: true,
      pickedText: q.options[i], answers: answers
    });
  },

  next: function () {
    if (!this.data.answered) return;
    if (this.data.idx + 1 >= this.data.total) { this.finish(); return; }
    this.renderCurrent(this.data.idx + 1);
  },

  finish: function () {
    var r = store.finishRound(this.data.paper, this.data.answers);
    var msg = '别着急，下面这些考点再看一遍，下次就会了。';
    if (r.rate >= 90) msg = '很稳！这个水平去考试没问题，保持住。';
    else if (r.rate >= 70) msg = '不错，再练几组就稳了。错的题我已经记下来了。';
    this.setData({ finished: true, result: r, encourage: msg, progressPct: 100 });
  },

  again: function () { this.newPaper(); },
  goHome: function () { wx.switchTab({ url: '/pages/index/index' }); },
  goWrong: function () { wx.switchTab({ url: '/pages/wrong/wrong' }); }
});
