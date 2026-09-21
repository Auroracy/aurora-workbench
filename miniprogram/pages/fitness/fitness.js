const store = require('../../utils/store.js');

/* 健康食谱（与网页版一致，7 道轮换） */
const HEALTHY_RECIPES = [
  { name: '鸡胸肉牛油果沙拉', cal: 320, ing: '鸡胸肉150g、牛油果半个、混合生菜100g、小番茄50g、橄榄油1勺', desc: '高蛋白低碳水，减脂期优选' },
  { name: '藜麦蔬菜碗', cal: 380, ing: '藜麦80g、西兰花100g、胡萝卜50g、鸡蛋1个、芝麻酱少许', desc: '营养均衡，饱腹感强' },
  { name: '香煎三文鱼配芦笋', cal: 350, ing: '三文鱼120g、芦笋150g、柠檬半个、黑胡椒、海盐', desc: '富含Omega-3，抗炎好选择' },
  { name: '番茄鸡蛋燕麦粥', cal: 280, ing: '燕麦50g、番茄1个、鸡蛋1个、葱花少许', desc: '高纤维早餐，暖胃低卡' },
  { name: '蒜蓉虾仁西蓝花', cal: 300, ing: '虾仁100g、西蓝花200g、蒜末、生抽少许', desc: '高蛋白低脂，简单快手' },
  { name: '紫薯酸奶杯', cal: 250, ing: '紫薯1个、无糖酸奶150g、坚果碎少许、蓝莓30g', desc: '抗氧化加益生菌，代餐佳选' },
  { name: '杂粮饭团配味噌汤', cal: 330, ing: '糙米饭100g、海苔、黄瓜条、味噌酱、豆腐50g', desc: '碳水控量，日式清淡风' }
];
const EX_TYPES = ['快走', '慢跑', '瑜伽', '游泳', '骑行', '力量训练', '跳绳', 'HIIT', '其他'];

function todayStr() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function timeToMin(t) {
  const a = String(t || '00:00').split(':');
  return (parseInt(a[0], 10) || 0) * 60 + (parseInt(a[1], 10) || 0);
}
function round2(n) { return Math.round(n * 100) / 100; }
function fmtRemain(nowMin, targetMin) {
  let diff = targetMin - nowMin;
  if (diff < 0) diff += 1440;
  return Math.floor(diff / 60) + '小时' + (diff % 60) + '分钟';
}

Page({
  data: {
    today: '',
    fitDate: '',

    /* 每日汇总 */
    sumIntake: 0, sumBurn: 0, sumNet: 0, sumNetClass: '', sumNetText: '0',

    /* 体重 */
    weightDate: '',
    weightVal: '',
    weightCount: 0,
    weightStats: null,

    /* 16+8 断食 */
    fastStart: '08:00',
    fastEnd: '16:00',
    fastEatLeft: 0,
    fastEatWidth: 0,
    fastNowLeft: 0,
    fastIsEating: false,
    fastStatusLabel: '',
    fastStatusText: '',

    /* 餐食 */
    mealFood: '',
    mealCal: '',
    mealList: [],

    /* 运动 */
    exTypes: EX_TYPES,
    exTypeIndex: -1,
    exTypeValue: '',
    exDur: '',
    exCal: '',
    exList: [],

    /* 食谱 */
    recipe: null,
    recipeLabel: ''
  },

  db: null,
  _timer: null,

  onLoad() {
    this.db = store.loadDb();
    const t = todayStr();
    this.setData({ today: t, fitDate: t, weightDate: t });
    this.renderAll();
  },
  onShow() {
    if (this.db) {
      this.db = store.loadDb();
      this.renderAll();
    }
    this.startClock();
  },
  onHide() { this.stopClock(); },
  onUnload() { this.stopClock(); },

  startClock() {
    this.stopClock();
    const self = this;
    this._timer = setInterval(function () { self.updateFasting(); }, 30000);
  },
  stopClock() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  renderAll() {
    this.renderSummary();
    this.renderWeight();
    this.updateFasting();
    this.renderMeals();
    this.renderExercises();
    this.renderRecipe();
  },

  /* ===== 日期 / 输入 ===== */
  onFitDate(e) {
    this.setData({ fitDate: e.detail.value });
    this.renderMeals();
    this.renderExercises();
    this.renderSummary();
  },
  onWeightDate(e) { this.setData({ weightDate: e.detail.value }); },
  onWeightVal(e) { this.setData({ weightVal: e.detail.value }); },
  onMealFood(e) { this.setData({ mealFood: e.detail.value }); },
  onMealCal(e) { this.setData({ mealCal: e.detail.value }); },
  onExDur(e) { this.setData({ exDur: e.detail.value }); },
  onExCal(e) { this.setData({ exCal: e.detail.value }); },
  onExType(e) {
    const i = e.detail.value;
    this.setData({ exTypeIndex: i, exTypeValue: EX_TYPES[i] || '' });
  },

  /* ===== 每日汇总 ===== */
  renderSummary() {
    const db = this.db;
    const date = this.data.fitDate || todayStr();
    let intake = 0, burn = 0;
    db.fitness.meals.forEach(function (m) { if (m.date === date) intake += (m.cal || 0); });
    db.fitness.exercises.forEach(function (x) { if (x.date === date) burn += (x.cal || 0); });
    const net = intake - burn;
    let cls = '';
    if (net > 500) cls = 'amber';
    else if (net < 0) cls = 'green';
    this.setData({
      sumIntake: intake, sumBurn: burn, sumNet: net, sumNetClass: cls,
      sumNetText: (net >= 0 ? '+' : '') + net
    });
  },

  /* ===== 体重 ===== */
  addWeight() {
    const db = this.db;
    const date = this.data.weightDate || todayStr();
    const val = parseFloat(this.data.weightVal);
    if (isNaN(val)) {
      wx.showToast({ title: '请输入有效体重', icon: 'none' });
      return;
    }
    const list = db.fitness.weights;
    let found = -1;
    for (let i = 0; i < list.length; i++) { if (list[i].date === date) { found = i; break; } }
    if (found >= 0) list[found].weight = val;
    else list.push({ date: date, weight: val });
    list.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    store.saveDb(db);
    this.setData({ weightVal: '' });
    this.renderWeight();
    wx.showToast({ title: '体重已记录', icon: 'success' });
  },

  renderWeight() {
    const ws = this.db.fitness.weights;
    let stats = null;
    if (ws.length) {
      const latest = ws[ws.length - 1];
      const first = ws[0];
      const diff = +(latest.weight - first.weight).toFixed(1);
      stats = {
        latestDate: latest.date ? String(latest.date).slice(5) : '',
        latest: latest.weight,
        hasDiff: ws.length > 1,
        diffStr: (diff > 0 ? '+' : '') + diff.toFixed(1),
        diffCls: diff > 0 ? 'up' : (diff < 0 ? 'down' : '')
      };
    }
    this.setData({ weightCount: ws.length, weightStats: stats });
    const self = this;
    wx.nextTick(function () { self.drawWeightChart(); });
  },

  /* canvas 2d 折线图 */
  drawWeightChart() {
    const ws = this.db.fitness.weights;
    if (ws.length < 2) return;
    wx.createSelectorQuery()
      .select('#weightChart')
      .fields({ node: true, size: true })
      .exec(function (res) {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        let dpr = 2;
        try { dpr = wx.getSystemInfoSync().pixelRatio || 2; } catch (e) { }
        const W = Math.max(200, res[0].width);
        const H = 176;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);

        const minW = Math.min.apply(null, ws.map(function (w) { return w.weight; }));
        const maxW = Math.max.apply(null, ws.map(function (w) { return w.weight; }));
        const range = (maxW - minW) || 1;
        const padX = 46, padTop = 30, padBottom = 34;
        const stepX = (W - padX * 2) / (ws.length - 1);
        const pts = ws.map(function (w, i) {
          const x = padX + i * stepX;
          const y = H - padBottom - ((w.weight - minW) / range) * (H - padTop - padBottom);
          return { x: x, y: y, w: w };
        });

        /* 折线 */
        ctx.beginPath();
        pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.strokeStyle = '#15A49B';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        /* 数据点 */
        pts.forEach(function (p) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#15A49B';
          ctx.fill();
        });

        /* 数值标签（点过多只标首尾） */
        const showVal = ws.length <= 12;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#5C7484';
        pts.forEach(function (p, i) {
          if (!showVal && i !== 0 && i !== pts.length - 1) return;
          ctx.fillText(String(p.w.weight), p.x, p.y - 10);
        });

        /* 日期标签 */
        const lblStep = Math.ceil(ws.length / 7);
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#9CB2C0';
        pts.forEach(function (p, i) {
          if (i % lblStep !== 0 && i !== pts.length - 1) return;
          ctx.fillText(String(p.w.date || '').slice(5), p.x, H - 10);
        });
      });
  },

  /* ===== 16+8 断食 ===== */
  onFastStart(e) { this.setData({ fastStart: e.detail.value }); this.saveFasting(); },
  onFastEnd(e) { this.setData({ fastEnd: e.detail.value }); this.saveFasting(); },
  saveFasting() {
    this.db.fitness.fastStart = this.data.fastStart;
    this.db.fitness.fastEnd = this.data.fastEnd;
    store.saveDb(this.db);
    this.updateFasting();
  },

  updateFasting() {
    const db = this.db;
    const start = db.fitness.fastStart || this.data.fastStart || '08:00';
    const end = db.fitness.fastEnd || this.data.fastEnd || '16:00';
    const sMin = timeToMin(start);
    const eMin = timeToMin(end);

    const sPct = sMin / 1440 * 100;
    let wPct = (eMin - sMin) / 1440 * 100;
    if (eMin < sMin) wPct = (eMin + 1440 - sMin) / 1440 * 100;

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowPct = nowMin / 1440 * 100;

    let isEating;
    if (eMin > sMin) isEating = nowMin >= sMin && nowMin < eMin;
    else isEating = nowMin >= sMin || nowMin < eMin;

    const label = isEating ? '进食时段' : '禁食时段';
    const target = isEating ? (eMin < sMin ? eMin + 1440 : eMin) : sMin;
    const tail = isEating ? ('剩余 ' + fmtRemain(nowMin, target) + ' 结束进食')
      : ('剩余 ' + fmtRemain(nowMin, target) + ' 开始进食');

    this.setData({
      fastStart: start,
      fastEnd: end,
      fastEatLeft: round2(sPct),
      fastEatWidth: round2(Math.max(0, wPct)),
      fastNowLeft: round2(nowPct),
      fastIsEating: isEating,
      fastStatusLabel: label,
      fastStatusText: tail
    });
  },

  /* ===== 餐食 ===== */
  addMeal() {
    const db = this.db;
    const date = this.data.fitDate || todayStr();
    const food = (this.data.mealFood || '').trim();
    const cal = parseInt(this.data.mealCal, 10) || 0;
    if (!food) { wx.showToast({ title: '请输入食物描述', icon: 'none' }); return; }
    db.fitness.meals.push({ date: date, food: food, cal: cal, photo: '' });
    store.saveDb(db);
    this.setData({ mealFood: '', mealCal: '' });
    this.renderMeals();
    this.renderSummary();
    wx.showToast({ title: '餐食已记录', icon: 'success' });
  },
  deleteMeal(e) {
    const idx = e.currentTarget.dataset.idx;
    const self = this;
    wx.showModal({
      title: '删除餐食', content: '确定删除这条餐食记录吗？', confirmColor: '#DB6B6B',
      success: function (res) {
        if (res.confirm) {
          self.db.fitness.meals.splice(idx, 1);
          store.saveDb(self.db);
          self.renderMeals();
          self.renderSummary();
        }
      }
    });
  },
  renderMeals() {
    const date = this.data.fitDate || todayStr();
    const all = this.db.fitness.meals;
    const items = [];
    all.forEach(function (m, i) {
      if (m.date === date) items.push({ idx: i, food: m.food, cal: m.cal || 0 });
    });
    this.setData({ mealList: items });
  },

  /* ===== 运动 ===== */
  addExercise() {
    const db = this.db;
    const date = this.data.fitDate || todayStr();
    const type = this.data.exTypeValue;
    const dur = parseInt(this.data.exDur, 10) || 0;
    const cal = parseInt(this.data.exCal, 10) || 0;
    if (!type) { wx.showToast({ title: '请选择运动类型', icon: 'none' }); return; }
    db.fitness.exercises.push({ date: date, type: type, dur: dur, cal: cal });
    store.saveDb(db);
    this.setData({ exTypeIndex: -1, exTypeValue: '', exDur: '', exCal: '' });
    this.renderExercises();
    this.renderSummary();
    wx.showToast({ title: '运动已记录', icon: 'success' });
  },
  deleteExercise(e) {
    const idx = e.currentTarget.dataset.idx;
    const self = this;
    wx.showModal({
      title: '删除运动', content: '确定删除这条运动记录吗？', confirmColor: '#DB6B6B',
      success: function (res) {
        if (res.confirm) {
          self.db.fitness.exercises.splice(idx, 1);
          store.saveDb(self.db);
          self.renderExercises();
          self.renderSummary();
        }
      }
    });
  },
  renderExercises() {
    const date = this.data.fitDate || todayStr();
    const all = this.db.fitness.exercises;
    const items = [];
    all.forEach(function (x, i) {
      if (x.date === date) items.push({ idx: i, type: x.type, dur: x.dur || 0, cal: x.cal || 0 });
    });
    this.setData({ exList: items });
  },

  /* ===== 食谱推荐 ===== */
  renderRecipe() {
    const n = HEALTHY_RECIPES.length;
    let idx = this.db.fitness.recipeIdx % n;
    if (idx < 0) idx += n;
    this.setData({ recipe: HEALTHY_RECIPES[idx], recipeLabel: '(' + (idx + 1) + '/' + n + ')' });
  },
  prevRecipe() {
    const n = HEALTHY_RECIPES.length;
    this.db.fitness.recipeIdx = ((this.db.fitness.recipeIdx - 1) % n + n) % n;
    store.saveDb(this.db);
    this.renderRecipe();
  },
  nextRecipe() {
    const n = HEALTHY_RECIPES.length;
    this.db.fitness.recipeIdx = (this.db.fitness.recipeIdx + 1) % n;
    store.saveDb(this.db);
    this.renderRecipe();
  }
});
