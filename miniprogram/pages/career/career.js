const store = require('../../utils/store.js');
const CD = require('../../utils/careerData.js');

const CAREER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const BOOK_CATS = ['公共基础', '计算机专业', '考情专项'];
const EXAM_SUBJECTS = [
  { key: '公共基础知识', aliases: ['公共基础知识', '公基'] },
  { key: '计算机专业知识', aliases: ['计算机专业知识', '计算机'] },
  { key: '职业能力测验', aliases: ['职业能力测验', '职测'] },
  { key: '考情专项', aliases: ['考情专项'] }
];

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function optView(options) {
  return (options || []).map((text, i) => ({ L: CAREER_LABELS[i] || String(i + 1), text }));
}
function optText(letter, options) {
  const i = CAREER_LABELS.indexOf(letter);
  if (i < 0 || !options || !options[i]) return '';
  return '. ' + options[i];
}
function subjectMatch(q, key) {
  const cfg = EXAM_SUBJECTS.find(s => s.key === key);
  return cfg ? cfg.aliases.indexOf(q.subject) !== -1 : false;
}
function isZk(q) { const t = q.source || ''; return t.indexOf('真题') !== -1 && t.indexOf('模拟') === -1; }
function dateLabel(d) {
  if (d === today()) return '今天 · ' + d.slice(5);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yd = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
  if (d === yd) return '昨天 · ' + d.slice(5);
  return d.slice(5);
}
function statusOf(q) {
  if (q.mastered) return 'mastered';
  if ((q.wrongCount || 0) > 0) return 'wrong';
  return 'todo';
}

Page({
  data: {
    activeMod: 'today',
    todayHint: '每天 30 分钟，碎片时间也能上岸',
    stats: { books: 0, chapters: 0, points: 0, total: 0, wrong: 0 },

    // 知识书
    booksView: [],
    bookCats: BOOK_CATS,
    bookCatIdx: 0,

    // 历年真题
    qList: [],
    qSubjects: [],
    qYears: [],
    qSubjectIdx: 0,
    qYearIdx: 0,

    // 自测记录
    quizHistory: [],

    // 模拟自测起始
    quizSubjects: [],
    quizYears: [],
    quizSubjectIdx: 0,
    quizYearIdx: 0,
    quizSubjectKey: '',
    quizYearVal: '',
    quizAvail: '',

    // 自测面板
    quizEmpty: true,
    quizPanel: false,
    quizTitle: '✏️ 自测模式',
    quizProgress: '',
    quizQuestion: '',
    quizSource: '',
    quizPerScore: 0,
    quizOptions: [],
    quizFeedback: { show: false, correct: false, text: '', explain: '', scoreText: '' },
    quizNext: false,
    quizResult: { show: false, isMock: false, score: 0, grade: '', gcolor: '', correct: 0, total: 0, accuracy: 0, timeSpent: 0, review: [] },

    // 错题本
    wrongSeg: 'log',
    wrongSummary: { today: 0, pend: 0, notes: 0 },
    wrongGroups: [],
    wrongDates: [],
    wrongDateIdx: 0,
    reviewList: [],
    notesList: []
  },

  onLoad() {
    this.db = store.loadDb();
    this.quizState = null;
    this.ensureSeed();
    this.setData({
      bookCats: BOOK_CATS,
      todayHint: '每天 30 分钟，碎片时间也能上岸'
    });
    this.renderAll();
    this.renderQuizStart();
  },

  onShow() { /* 数据可能被同步覆盖，重新渲染保持最新 */ },

  ensureSeed() {
    const db = this.db;
    if (!db.career.books || !db.career.books.length) {
      const books = JSON.parse(JSON.stringify(CD.books));
      if (CD.refined) {
        books.forEach(b => {
          const ref = CD.refined[b.id];
          if (ref && ref.chapters) { b.chapters = JSON.parse(JSON.stringify(ref.chapters)); b._refinedV2 = true; }
        });
      }
      db.career.books = books;
    }
    if (!db.career.questions || !db.career.questions.length) {
      db.career.questions = JSON.parse(JSON.stringify(CD.questions));
    }
    store.saveDb(db);
  },

  renderAll() {
    this.renderStats();
    this.renderBooks();
    this.renderFilters();
    this.renderQuestions();
    this.renderQuizHistory();
    this.renderWrong();
  },

  /* ============ 模块切换 ============ */
  switchMod(e) {
    const name = e.currentTarget.dataset.mod;
    this.setData({ activeMod: name });
    if (name === 'wrong') this.renderWrong();
    if (name === 'quiz') this.renderQuizStart();
  },

  /* ============ 统计 ============ */
  renderStats() {
    const db = this.db;
    const q = db.career.questions || [];
    let chapters = 0, points = 0;
    (db.career.books || []).forEach(b => (b.chapters || []).forEach(c => { chapters++; points += (c.points || []).length; }));
    this.setData({
      stats: {
        books: (db.career.books || []).length,
        chapters, points,
        total: q.length,
        wrong: q.filter(x => (x.wrongCount || 0) > 0).length
      }
    });
  },

  /* ============ 知识书 ============ */
  renderBooks() {
    const db = this.db;
    const filter = this.data.bookCats[this.data.bookCatIdx] || '';
    let list = (db.career.books || []).slice();
    if (filter) list = list.filter(b => b.category === filter);
    this.setData({ booksView: list });
  },
  onBookCatChange(e) {
    this.setData({ bookCatIdx: Number(e.detail.value) }, () => this.renderBooks());
  },
  toggleBook(e) {
    const b = this.findBook(e.currentTarget.dataset.bid);
    if (b) { b.expanded = !b.expanded; store.saveDb(this.db); this.renderBooks(); }
  },
  toggleChapter(e) {
    const d = e.currentTarget.dataset;
    const c = this.findChapter(d.bid, d.cid);
    if (c) { c.expanded = !c.expanded; store.saveDb(this.db); this.renderBooks(); }
  },
  findBook(bid) { return (this.db.career.books || []).find(b => b.id === bid); },
  findChapter(bid, cid) { const b = this.findBook(bid); return b ? (b.chapters || []).find(c => c.id === cid) : null; },

  addBook() {
    wx.showModal({
      title: '书名（含《》）', editable: true, placeholderText: '如：《公共基础知识》',
      success: r => {
        if (!r.confirm || !r.content || !r.content.trim()) return;
        const title = r.content.trim();
        wx.showModal({
          title: '作者 / 编著', editable: true, placeholderText: '可留空',
          success: r2 => {
            const author = (r2.confirm ? r2.content : '').trim();
            wx.showModal({
              title: '出版社', editable: true, placeholderText: '可留空',
              success: r3 => {
                const press = (r3.confirm ? r3.content : '').trim();
                wx.showModal({
                  title: '分类', editable: true, placeholderText: '公共基础 / 计算机专业 / 考情专项',
                  success: r4 => {
                    const cat = (r4.confirm && r4.content) ? r4.content.trim() : '公共基础';
                    this.db.career.books.push({ id: 'bk_' + Date.now(), title, author, press, category: cat, emoji: '📖', desc: '', expanded: true, chapters: [] });
                    store.saveDb(this.db); this.renderBooks(); this.renderStats();
                  }
                });
              }
            });
          }
        });
      }
    });
  },
  addChapter(e) {
    const bid = e.currentTarget.dataset.bid;
    wx.showModal({ title: '章节名称', editable: true, placeholderText: '如：第7章 xxx', success: r => {
      if (!r.confirm || !r.content || !r.content.trim()) return;
      const b = this.findBook(bid); if (!b) return;
      b.chapters = b.chapters || [];
      b.chapters.push({ id: 'ch_' + Date.now(), name: r.content.trim(), expanded: true, points: [] });
      store.saveDb(this.db); this.renderBooks(); this.renderStats();
    } });
  },
  addPoint(e) {
    const d = e.currentTarget.dataset;
    wx.showModal({ title: '要点标题', editable: true, placeholderText: '知识点标题', success: r => {
      if (!r.confirm || !r.content || !r.content.trim()) return;
      const title = r.content.trim();
      wx.showModal({ title: '要点内容总结', editable: true, placeholderText: '内容', success: r2 => {
        if (!r2.confirm) return;
        const content = (r2.content || '').trim();
        wx.showModal({ title: '背诵提示（可留空）', editable: true, placeholderText: '口诀/记忆法', success: r3 => {
          const tip = (r3.confirm ? r3.content : '') || '';
          wx.showModal({ title: '重要级别', editable: true, placeholderText: 'high=重点 / mid=常考 / 留空=普通', success: r4 => {
            let level = (r4.confirm ? r4.content : '') || '';
            if (level !== 'high' && level !== 'mid') level = '';
            const c = this.findChapter(d.bid, d.cid); if (!c) return;
            c.points = c.points || [];
            c.points.push({ id: 'pt_' + Date.now(), title, content, tip: tip.trim(), level });
            store.saveDb(this.db); this.renderBooks(); this.renderStats();
          } });
        } });
      } });
    } });
  },
  editPoint(e) {
    const d = e.currentTarget.dataset;
    const c = this.findChapter(d.bid, d.cid); if (!c) return;
    const p = (c.points || []).find(x => x.id === d.pid); if (!p) return;
    wx.showModal({ title: '要点标题', editable: true, placeholderText: '标题', content: p.title, success: r => {
      if (!r.confirm || !r.content) return;
      p.title = r.content.trim();
      wx.showModal({ title: '要点内容', editable: true, placeholderText: '内容', content: p.content, success: r2 => {
        if (!r2.confirm) return;
        p.content = r2.content.trim();
        wx.showModal({ title: '背诵提示', editable: true, placeholderText: '提示', content: p.tip || '', success: r3 => {
          p.tip = (r3.confirm ? r3.content : '') || '';
          store.saveDb(this.db); this.renderBooks();
        } });
      } });
    } });
  },
  deletePoint(e) {
    const d = e.currentTarget.dataset;
    wx.showModal({ title: '删除这条知识点？', content: '删除后不可恢复', success: r => {
      if (!r.confirm) return;
      const c = this.findChapter(d.bid, d.cid); if (!c) return;
      c.points = (c.points || []).filter(x => x.id !== d.pid);
      store.saveDb(this.db); this.renderBooks(); this.renderStats();
    } });
  },

  /* ============ 历年真题 ============ */
  renderFilters() {
    const db = this.db;
    // 与网页一致：按规范的 4 个科目（带别名合并 公基/公共基础知识 等）分组
    const qSubjects = EXAM_SUBJECTS.map(s => ({ value: s.key, label: s.key }));
    const years = {};
    (db.career.questions || []).forEach(q => { years[String(q.year)] = 1; });
    const qYears = Object.keys(years).sort().reverse().map(y => ({ value: y, label: y + ' 年' }));
    this.setData({ qSubjects, qYears });
  },
  onQSubjectChange(e) { this.setData({ qSubjectIdx: Number(e.detail.value) }, () => this.renderQuestions()); },
  onQYearChange(e) { this.setData({ qYearIdx: Number(e.detail.value) }, () => this.renderQuestions()); },
  renderQuestions() {
    const db = this.db;
    const sub = this.data.qSubjects[this.data.qSubjectIdx] ? this.data.qSubjects[this.data.qSubjectIdx].value : '';
    const year = this.data.qYears[this.data.qYearIdx] ? this.data.qYears[this.data.qYearIdx].value : '';
    const picks = db.career.picks || {};
    const notes = db.career.qNotes || {};
    const list = (db.career.questions || []).filter(q => (!sub || subjectMatch(q, sub)) && (!year || String(q.year) === year));
    const qList = list.map((q, idx) => ({
      id: q.id, year: q.year, subject: q.subject, chapter: q.chapter,
      question: q.question, answer: q.answer,
      options: optView(q.options),
      picked: picks[q.id] || '',
      showAnswer: false,
      status: statusOf(q),
      wrongCount: q.wrongCount || 0,
      answerText: q.answer + optText(q.answer, q.options),
      note: (notes[q.id] || {}).text || ''
    }));
    this.setData({ qList });
  },
  pickOption(e) {
    const d = e.currentTarget.dataset;
    const qid = d.qid, letter = d.letter;
    const q = (this.db.career.questions || []).find(x => x.id === qid); if (!q) return;
    const picks = this.db.career.picks = this.db.career.picks || {};
    const firstPick = !picks[qid];
    picks[qid] = letter;
    const correct = letter === q.answer;
    if (firstPick) {
      if (correct) q.mastered = (q.wrongCount || 0) === 0;
      else { q.wrongCount = (q.wrongCount || 0) + 1; q.mastered = false; this.logWrong(q, letter); }
    } else if (correct && (q.wrongCount || 0) === 0) { q.mastered = true; }
    store.saveDb(this.db); this.renderStats(); this.renderWrongSummary(); this.renderQuestions();
  },
  toggleAnswer(e) {
    const qid = e.currentTarget.dataset.qid;
    const qList = this.data.qList.map(q => q.id === qid ? Object.assign({}, q, { showAnswer: !q.showAnswer }) : q);
    this.setData({ qList });
  },
  onNoteInput(e) {
    const qid = e.currentTarget.dataset.qid;
    const text = e.detail.value || '';
    const notes = this.db.career.qNotes = this.db.career.qNotes || {};
    if (text.trim()) notes[qid] = { text, updatedAt: Date.now() };
    else delete notes[qid];
    store.saveDb(this.db); this.renderWrongSummary();
  },
  addQuestion() {
    wx.showModal({ title: '题目', editable: true, placeholderText: '题干', success: r => {
      if (!r.confirm || !r.content || !r.content.trim()) return;
      const question = r.content.trim();
      wx.showModal({ title: '选项（用 / 分隔，如 A/B/C/D）', editable: true, placeholderText: '选项', success: r2 => {
        if (!r2.confirm || !r2.content) return;
        const options = r2.content.split('/').map(o => o.trim()).filter(Boolean);
        wx.showModal({ title: '正确答案（A/B/C/D）', editable: true, placeholderText: '答案', success: r3 => {
          if (!r3.confirm || !r3.content) return;
          const answer = r3.content.trim().toUpperCase();
          wx.showModal({ title: '解析', editable: true, placeholderText: '解析', success: r4 => {
            const explanation = (r4.confirm ? r4.content : '') || '';
            wx.showModal({ title: '所属科目', editable: true, placeholderText: '公共基础知识', content: '公共基础知识', success: r5 => {
              const subject = (r5.confirm && r5.content) ? r5.content.trim() : '未分类';
              wx.showModal({ title: '所属章节', editable: true, placeholderText: '章节', success: r6 => {
                const chapter = (r6.confirm ? r6.content : '') || '';
                wx.showModal({ title: '年份', editable: true, placeholderText: '2026', content: '2026', success: r7 => {
                  const year = (r7.confirm && r7.content) ? r7.content.trim() : '2026';
                  this.db.career.questions.push({
                    id: 'cq_' + Date.now(), type: 'single', subject, chapter: chapter.trim(), year, source: '自定义',
                    question, options, answer, explanation: explanation.trim(), mastered: false, wrongCount: 0
                  });
                  store.saveDb(this.db); this.renderFilters(); this.renderQuestions(); this.renderStats();
                } });
              } });
            } });
          } });
        } });
      } });
    } });
  },
  deleteQuestion(e) {
    const qid = e.currentTarget.dataset.qid;
    wx.showModal({ title: '删除这道题？', content: '删除后不可恢复', success: r => {
      if (!r.confirm) return;
      this.db.career.questions = (this.db.career.questions || []).filter(x => x.id !== qid);
      store.saveDb(this.db); this.renderFilters(); this.renderQuestions(); this.renderStats(); this.renderWrongSummary();
    } });
  },

  /* ============ 模拟自测 ============ */
  subjectStats() {
    return EXAM_SUBJECTS.map(s => {
      const all = (this.db.career.questions || []).filter(q => subjectMatch(q, s.key));
      return { key: s.key, label: s.key, total: all.length, zk: all.filter(isZk).length };
    });
  },
  yearsFor(key) {
    const all = (this.db.career.questions || []).filter(q => key === '__all__' || subjectMatch(q, key));
    const map = {};
    all.forEach(q => {
      const y = String(q.year == null ? '' : q.year).trim();
      if (!y) return;
      if (!map[y]) map[y] = { year: y, total: 0, zk: 0 };
      map[y].total++; if (isZk(q)) map[y].zk++;
    });
    return Object.keys(map).sort((a, b) => Number(b) - Number(a)).map(y => map[y]);
  },
  buildYearPaper(key, year) {
    const all = (this.db.career.questions || []).filter(q => (key === '__all__' || subjectMatch(q, key)) && String(q.year == null ? '' : q.year).trim() === String(year));
    const zk = all.filter(isZk);
    return shuffleArray((zk.length ? zk : all).slice());
  },
  renderQuizStart() {
    const stats = this.subjectStats();
    const totZk = stats.reduce((a, s) => a + s.zk, 0);
    const quizSubjects = stats.map(s => ({ key: s.key, label: s.key + '（真题 ' + s.zk + ' / 共 ' + s.total + '）' }))
      .concat([{ key: '__all__', label: '全部科目（真题 ' + totZk + '）' }]);
    const key = this.data.quizSubjectKey || stats[0].key;
    const years = this.yearsFor(key);
    const quizYears = years.map(y => ({ year: y.year, label: y.year + ' 年（' + y.total + ' 题' + (y.zk ? ' · 真题 ' + y.zk : ' · 无真题') + '）' }));
    const yr = this.data.quizYearVal || (years[0] && years[0].year) || '';
    const o = years.find(x => x.year === yr);
    let avail = '';
    if (o) {
      const paper = this.buildYearPaper(key, yr);
      const subjTxt = key === '__all__' ? '全部科目' : key;
      avail = '「' + subjTxt + '」' + o.year + ' 年：共 ' + o.total + ' 题（历年真题 ' + o.zk + ' 道）→ 本次测 ' + paper.length + ' 道' +
        (o.zk ? '真题' : '题（该年暂无真题，用该年题目代替）') + '；满分 100 分，每题约 ' + (paper.length ? (100 / paper.length).toFixed(1) : '0') + ' 分。';
    } else { avail = '该科目暂无可测年份。'; }
    const quizSubjectIdx = Math.max(0, quizSubjects.findIndex(s => s.key === key));
    const quizYearIdx = Math.max(0, quizYears.findIndex(y => y.year === yr));
    this.setData({ quizSubjects, quizSubjectIdx, quizSubjectKey: key, quizYears, quizYearIdx, quizYearVal: yr, quizAvail: avail });
  },
  onQuizSubjectChange(e) {
    this.setData({ quizSubjectKey: this.data.quizSubjects[Number(e.detail.value)].key, quizYearVal: '' }, () => this.renderQuizStart());
  },
  onQuizYearChange(e) { this.setData({ quizYearVal: this.data.quizYears[Number(e.detail.value)].year }, () => this.renderQuizStart()); },

  startMock() {
    const key = this.data.quizSubjectKey, year = this.data.quizYearVal;
    if (!year) { wx.showToast({ title: '请先选择年份', icon: 'none' }); return; }
    const paper = this.buildYearPaper(key, year);
    if (!paper.length) { wx.showToast({ title: '该年份暂无题目', icon: 'none' }); return; }
    const label = (key === '__all__' ? '全部科目' : key) + ' · ' + year + ' 年';
    this.quizState = { mode: 'mock', subject: key, year, label, questions: paper, i: 0, correct: 0, wrong: 0, score: 0, perScore: 100 / paper.length, answers: [], startedAt: Date.now(), _answered: false };
    this.setData({ activeMod: 'quiz', quizEmpty: false, quizPanel: true, quizResult: { show: false } });
    this.renderQuizQuestion();
  },
  startQuiz(e) {
    const mode = e.currentTarget.dataset.mode;
    const all = this.db.career.questions || [];
    let pool = [];
    if (mode === 'random') pool = shuffleArray(all.slice()).slice(0, Math.min(10, all.length));
    else if (mode === 'wrong') pool = shuffleArray(all.filter(q => (q.wrongCount || 0) > 0));
    else if (mode === 'pub') pool = shuffleArray(all.filter(q => subjectMatch(q, '公共基础知识')));
    else if (mode === 'computer') pool = shuffleArray(all.filter(q => subjectMatch(q, '计算机专业知识')));
    if (!pool.length) { wx.showToast({ title: '该模式暂无可用题目', icon: 'none' }); return; }
    this.quizState = { mode, questions: pool.slice(0, Math.min(20, pool.length)), i: 0, correct: 0, wrong: 0, answers: [], startedAt: Date.now(), _answered: false };
    this.setData({ activeMod: 'quiz', quizEmpty: false, quizPanel: true, quizResult: { show: false } });
    this.renderQuizQuestion();
  },
  renderQuizQuestion() {
    const s = this.quizState;
    if (!s || s.i >= s.questions.length) { this.finishQuiz(); return; }
    const q = s.questions[s.i];
    s._answered = false;
    const tmap = { random: '随机抽题', wrong: '错题重练', pub: '公基专项', computer: '计算机专项', mock: '模拟自测' };
    let title = tmap[s.mode] || '自测';
    if (s.mode === 'mock' && s.label) title = '模拟自测 · ' + s.label;
    let progress = '第 ' + (s.i + 1) + ' / ' + s.questions.length + ' 题';
    if (s.mode === 'mock') progress += ' · 已得 ' + (Math.round(s.score * 10) / 10) + ' 分';
    this.setData({
      quizTitle: '✏️ ' + title, quizProgress: progress,
      quizQuestion: q.question,
      quizSource: (s.mode === 'mock' ? (q.source || '历年真题') : ''),
      quizPerScore: (s.mode === 'mock' ? (Math.round(s.perScore * 10) / 10) : 0),
      quizOptions: optView(q.options),
      quizFeedback: { show: false, correct: false, text: '', explain: '', scoreText: '' },
      quizNext: false
    });
  },
  submitAnswer(e) {
    const s = this.quizState;
    if (!s || s.i >= s.questions.length || s._answered) return;
    s._answered = true;
    const letter = e.currentTarget.dataset.letter;
    const q = s.questions[s.i];
    const correct = letter === q.answer;
    if (correct) {
      s.correct++;
      if (s.mode === 'mock') s.score += (s.perScore || 0);
      if (s.mode === 'wrong') { q.wrongCount = Math.max(0, (q.wrongCount || 0) - 1); this.markReviewed(q.id); }
    } else {
      s.wrong++; q.wrongCount = (q.wrongCount || 0) + 1; this.logWrong(q, letter);
    }
    s.answers.push({ qid: q.id, choice: letter, correct });
    q.mastered = correct && (q.wrongCount || 0) === 0;
    let text = correct ? '✅ 回答正确' : ('❌ 正确答案：' + q.answer);
    if (correct && s.mode === 'wrong') text += '（错题计数已减 1）';
    let scoreText = '';
    if (s.mode === 'mock') scoreText = '本题' + (correct ? ('得 ' + (Math.round((s.perScore || 0) * 10) / 10) + ' 分') : '不得分') + ' · 当前累计 ' + (Math.round(s.score * 10) / 10) + ' 分';
    this.setData({
      quizFeedback: { show: true, correct, text, explain: q.explanation, scoreText },
      quizNext: true
    });
    if (s.mode === 'mock') this.setData({ quizProgress: '第 ' + (s.i + 1) + ' / ' + s.questions.length + ' 题 · 已得 ' + (Math.round(s.score * 10) / 10) + ' 分' });
    store.saveDb(this.db); this.renderStats(); this.renderWrongSummary();
  },
  nextQuiz() {
    if (!this.quizState) return;
    this.quizState.i++;
    this.renderQuizQuestion();
  },
  finishQuiz() {
    const s = this.quizState; if (!s) return;
    const total = s.questions.length;
    const accuracy = total ? Math.round(s.correct / total * 100) : 0;
    const timeSpent = Math.round((Date.now() - s.startedAt) / 1000);
    const isMock = s.mode === 'mock';
    const score = isMock ? Math.round(s.score) : null;
    const record = { date: today(), mode: s.mode, subject: s.label || '', total, correct: s.correct, wrong: s.wrong, accuracy, timeSpent };
    if (isMock) record.score = score;
    this.db.career.quiz.history.unshift(record);
    if (this.db.career.quiz.history.length > 50) this.db.career.quiz.history.length = 50;
    const review = s.answers.map((a, idx) => ({ n: idx + 1, question: s.questions[idx].question, choice: a.choice, answer: s.questions[idx].answer, correct: a.correct }));
    let result = { show: true, isMock, correct: s.correct, total, accuracy, timeSpent, review };
    if (isMock) {
      const gcolor = score >= 80 ? 'green' : (score >= 60 ? 'amber' : 'red');
      const grade = score >= 80 ? '优秀' : (score >= 60 ? '及格' : '需加强');
      result.score = score; result.grade = grade; result.gcolor = gcolor;
    }
    this.setData({
      quizTitle: '✅ 模拟自测完成' + (isMock && s.label ? ' · ' + s.label : ''),
      quizProgress: '',
      quizQuestion: '', quizSource: '', quizOptions: [], quizNext: false,
      quizFeedback: { show: false },
      quizResult: result
    });
    store.saveDb(this.db); this.renderStats(); this.renderQuizHistory(); this.renderWrong();
  },
  closeQuiz() {
    this.quizState = null;
    this.setData({ quizEmpty: true, quizPanel: false, quizResult: { show: false }, quizFeedback: { show: false }, quizOptions: [], quizQuestion: '' });
  },

  /* ============ 自测记录 ============ */
  renderQuizHistory() {
    const h = (this.db.career.quiz && this.db.career.quiz.history) || [];
    const modeTxt = { random: '随机', wrong: '错题', pub: '公基', computer: '计算机', mock: '模拟' };
    const list = h.slice(0, 8).map(r => {
      const isMock = r.mode === 'mock';
      const sc = isMock ? Math.round(r.score || 0) : r.accuracy;
      const color = sc >= 80 ? 'green' : (sc >= 60 ? 'amber' : 'red');
      let label = modeTxt[r.mode] || r.mode;
      if (isMock && r.subject) label = '模拟·' + r.subject;
      const accText = isMock ? (sc + ' 分') : (r.accuracy + '%');
      return { label, color, accText, meta: r.date + ' · 对 ' + r.correct + '/' + r.total + ' · ' + r.timeSpent + 's' };
    });
    this.setData({ quizHistory: list });
  },

  /* ============ 错题本 ============ */
  wrongLog() {
    const db = this.db;
    if (!db.career) return [];
    if (!Array.isArray(db.career.wrongLog)) db.career.wrongLog = [];
    return db.career.wrongLog;
  },
  qNotes() {
    const db = this.db;
    if (!db.career) return {};
    if (!db.career.qNotes || typeof db.career.qNotes !== 'object' || Array.isArray(db.career.qNotes)) db.career.qNotes = {};
    return db.career.qNotes;
  },
  findQuestion(qid) { return (this.db.career.questions || []).find(x => x.id === qid) || null; },
  pendingList() { return (this.db.career.questions || []).filter(q => (q.wrongCount || 0) > 0); },
  wrongTodayCount() { const d = today(); return this.wrongLog().filter(e => e.date === d && !e.cleared).length; },
  noteCount() {
    const nt = this.qNotes(); let n = 0;
    Object.keys(nt).forEach(k => { if (nt[k] && (nt[k].text || '').trim()) n++; });
    return n;
  },
  logWrong(q, choice) {
    const log = this.wrongLog(); const d = today();
    let ex = null;
    for (let i = 0; i < log.length; i++) { if (log[i].qid === q.id && log[i].date === d && !log[i].cleared) { ex = log[i]; break; } }
    if (ex) {
      ex.times = (ex.times || 1) + 1; ex.choice = choice || ''; ex.ts = Date.now();
      ex.answer = q.answer || ''; ex.question = q.question || ''; ex.options = (q.options || []).slice();
    } else {
      log.unshift({
        id: 'wl_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        qid: q.id, date: d, ts: Date.now(),
        subject: q.subject || '', chapter: q.chapter || '', year: q.year || '', source: q.source || '',
        question: q.question || '', options: (q.options || []).slice(),
        answer: q.answer || '', choice: choice || '',
        times: 1, reviewed: false, reviewCount: 0, lastReview: '', cleared: false
      });
      if (log.length > 500) log.length = 500;
    }
    store.saveDb(this.db);
  },
  markReviewed(qid) {
    this.wrongLog().forEach(e => { if (e.qid === qid && !e.cleared) { e.reviewed = true; e.reviewCount = (e.reviewCount || 0) + 1; e.lastReview = today(); } });
  },
  renderWrongSummary() {
    const todayN = this.wrongTodayCount(), pend = this.pendingList().length, notes = this.noteCount();
    this.setData({ wrongSummary: { today: todayN, pend, notes } });
  },
  switchWrongSeg(e) {
    const seg = e.currentTarget.dataset.seg;
    this.setData({ wrongSeg: seg });
    if (seg === 'log') this.renderWrongLog();
    else if (seg === 'review') this.renderReview();
    else this.renderNotes();
  },
  renderWrongLog() {
    const log = this.wrongLog().filter(e => !e.cleared);
    const dates = [];
    log.forEach(e => { if (dates.indexOf(e.date) < 0) dates.push(e.date); });
    dates.sort().reverse();
    const pick = this.data.wrongDates[this.data.wrongDateIdx] ? this.data.wrongDates[this.data.wrongDateIdx].value : '';
    const list = pick ? log.filter(e => e.date === pick) : log;
    const notes = this.qNotes();
    const groupsMap = {}, order = [];
    list.forEach(e => { if (!groupsMap[e.date]) { groupsMap[e.date] = []; order.push(e.date); } groupsMap[e.date].push(e); });
    order.sort().reverse();
    const wrongGroups = order.map(d => ({
      date: d, label: dateLabel(d), count: groupsMap[d].length,
      items: groupsMap[d].map(e => ({
        id: e.id, qid: e.qid, subject: e.subject, chapter: e.chapter, year: e.year,
        times: e.times, reviewed: !!e.reviewed,
        question: e.question, answer: e.answer, choice: e.choice,
        options: optView(e.options),
        answerText: e.answer + optText(e.answer, e.options),
        choiceText: (e.choice ? (e.choice + optText(e.choice, e.options)) : '未作答'),
        note: (notes[e.qid] || {}).text || ''
      }))
    }));
    const wrongDates = dates.map(d => ({ value: d, label: dateLabel(d) }));
    this.setData({ wrongGroups, wrongDates });
  },
  onWrongDateChange(e) { this.setData({ wrongDateIdx: Number(e.detail.value) }, () => this.renderWrongLog()); },
  onWrongNoteInput(e) {
    const qid = e.currentTarget.dataset.qid;
    const text = e.detail.value || '';
    const notes = this.qNotes();
    if (text.trim()) notes[qid] = { text, updatedAt: Date.now() };
    else delete notes[qid];
    store.saveDb(this.db); this.renderWrongSummary();
  },
  renderReview() {
    const reviewList = this.pendingList().map(q => ({
      id: q.id, subject: q.subject, chapter: q.chapter, wrongCount: q.wrongCount || 0,
      question: q.question, answer: q.answer,
      answerText: q.answer + optText(q.answer, q.options),
      options: optView(q.options), explanation: q.explanation
    }));
    this.setData({ reviewList });
  },
  renderNotes() {
    const notes = this.qNotes();
    const ids = Object.keys(notes).filter(k => notes[k] && (notes[k].text || '').trim());
    ids.sort((a, b) => (notes[b].updatedAt || 0) - (notes[a].updatedAt || 0));
    const notesList = ids.map(qid => {
      const n = notes[qid], q = this.findQuestion(qid);
      return {
        qid, updatedAt: n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('zh-CN') : '',
        subject: q ? q.subject : '', chapter: q ? q.chapter : '',
        question: q ? q.question : '', text: n.text
      };
    });
    this.setData({ notesList });
  },
  renderWrong() {
    this.renderWrongSummary();
    this.renderWrongLog();
    this.renderReview();
    this.renderNotes();
  },
  masterQuestion(e) {
    const qid = e.currentTarget.dataset.qid;
    const q = this.findQuestion(qid); if (!q) return;
    q.wrongCount = 0; q.mastered = true; this.markReviewed(qid);
    store.saveDb(this.db); this.renderStats(); this.renderWrong();
    wx.showToast({ title: '已标记掌握 · ' + (q.chapter || q.subject || '') });
  },
  masterWrong(e) {
    const logId = e.currentTarget.dataset.id;
    const en = this.wrongLog().find(x => x.id === logId); if (!en) return;
    this.masterQuestion(en.qid);
  },
  clearWrong(e) {
    const logId = e.currentTarget.dataset.id;
    wx.showModal({ title: '删除这条错题记录？', content: '只删记录，题库里的题目保留', success: r => {
      if (!r.confirm) return;
      const en = this.wrongLog().find(x => x.id === logId); if (!en) return;
      en.cleared = true; store.saveDb(this.db); this.renderWrong();
    } });
  },
  editNote(e) {
    const qid = e.currentTarget.dataset.qid;
    const cur = (this.qNotes()[qid] || {}).text || '';
    wx.showModal({ title: '编辑笔记', editable: true, placeholderText: '笔记内容', content: cur, success: r => {
      if (!r.confirm) return;
      const notes = this.qNotes();
      if ((r.content || '').trim()) notes[qid] = { text: r.content, updatedAt: Date.now() };
      else delete notes[qid];
      store.saveDb(this.db); this.renderWrongSummary(); this.renderNotes();
    } });
  },
  deleteNote(e) {
    const qid = e.currentTarget.dataset.qid;
    wx.showModal({ title: '删除这条笔记？', content: '删除后不可恢复', success: r => {
      if (!r.confirm) return;
      delete this.qNotes()[qid];
      store.saveDb(this.db); this.renderWrongSummary(); this.renderNotes();
    } });
  }
});
