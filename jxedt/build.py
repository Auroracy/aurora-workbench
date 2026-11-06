# -*- coding: utf-8 -*-
"""把抓取到的驾校一点通科目一真题，生成小程序可用的 questions.js / jxedtCats.js。

设计：
  - 每个「专项分类」= 一个 point（zx<cid>），挂到原有的 13 类口诀下面
  - 一道题出现在多个专项时，选题量最少的那个（最具体）作为主考点
  - 题目 id 前缀 j，避免与旧的 q### 自编题冲突
  - 判断题强制 2 个选项；单选题取 a~g 中的非空项
"""
import json, re, html, os, collections

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('KM1_REPO', '/Users/aurora/WorkBuddy/2026-07-26-23-49-28')
MP = os.path.join(OUT, 'miniprogram', 'utils')
DATA = os.path.join(OUT, 'jxedt')

# 专项分类 cid -> 小程序原有 13 类口诀 catId
CID_CAT = {}
def put(cids, cat):
    for c in cids.split():
        CID_CAT[int(c)] = cat

put('1 2 3 4 5 33 34', 'time')        # 证件、登记、审验、扣证
put('6', 'mnemonic')                   # 扣分题 = 四句总口诀里的 12 分
put('7', 'fine')                       # 罚款行政处罚
put('8 9 28', 'score')                 # 刑事 / 酒驾 / 法律责任
put('10 11 12 13', 'sign')             # 标线 / 标志 / 信号灯 / 手势
put('14 15 16 20 65 66 67', 'yield')   # 通行条件 / 让行 / 礼让
put('17 71 72 73', 'light')            # 灯光喇叭 / 夜间灯光
put('18 19 21 22 23 27', 'distance')   # 跟车距离 / 故障处置 / 牵引 / 铁路道口
put('24 25 29 30 31 32', 'speed')      # 速度 / 高速 / 低能见度
put('35 36 37 38 39 76 77', 'aid')     # 事故处理 / 应急处置
put('40 41 42 43 44 45 46 47 48 49 50 51 52 314', 'car')  # 车上部件 / 仪表 / 英文缩写
put('54 55 57 58 59 60 61 63 64 68 69 70', 'skill')       # 安全文明驾驶
put('87 306 307 308 309 310 311 312 313', 'exam')          # 常识 / 地方题

CATS_ORDER = ['mnemonic','time','score','fine','speed','distance','light',
              'sign','yield','aid','skill','car','exam']


def clean(s, limit=0):
    if not s:
        return ''
    s = html.unescape(str(s))
    s = re.sub(r'<br\s*/?>|</p>|</div>', ' ', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ')
    s = s.replace('\u3000', ' ').replace('&nbsp;', ' ')
    s = re.sub(r'\s{2,}', ' ', s).strip()
    if limit and len(s) > limit:
        s = s[:limit].rstrip('，,。；;、 ') + '…'
    return s


def js(s):
    return json.dumps(s, ensure_ascii=False)


def main():
    raw = json.load(open(os.path.join(SRC, 'questions_raw.json'), encoding='utf-8'))
    cats = json.load(open(os.path.join(SRC, 'cat_ids_full.json'), encoding='utf-8'))
    extra = json.load(open(os.path.join(SRC, 'extra_ids.json'), encoding='utf-8'))
    for k, v in extra.items():
        cats.setdefault(k, {'name': v.get('name', ''), 'ids': []})
        cats[k]['name'] = v.get('name') or cats[k]['name']
        cats[k]['ids'] = list(dict.fromkeys(list(cats[k].get('ids', [])) + v['ids']))

    cat_name = {int(k): v['name'] for k, v in cats.items()}
    # 题目 -> 所属专项列表
    q_cats = collections.defaultdict(list)
    for cid_s, v in cats.items():
        cid = int(cid_s)
        for qid in v.get('ids', []):
            if qid in raw:
                q_cats[qid].append(cid)

    rows = []
    used_cat = collections.defaultdict(int)
    no_cat = []
    for qid in sorted(raw, key=int):
        v = raw[qid]
        cids = [c for c in q_cats.get(qid, []) if c in CID_CAT]
        if not cids:
            no_cat.append(qid)
            cids = [87]           # 兜底：常识题
        # 选题量最少的分类（最具体）作为主考点
        cid = min(cids, key=lambda c: (len(cats.get(str(c), {}).get('ids', [])) or 99999, c))
        cat = CID_CAT[cid]
        used_cat[cid] += 1

        typ = str(v.get('type'))
        r = int(str(v.get('right')).strip())
        if typ == '1':
            opts = ['正确', '错误']
        else:
            opts = [clean(v.get(x)) for x in 'abcdefg' if clean(v.get(x))]
        ans = r - 1
        if ans < 0 or ans >= len(opts):
            print('SKIP bad answer', qid, r, opts)
            continue

        q = clean(v.get('question'))
        tip = clean(v.get('bestanswer'), 160)
        if not tip:
            tip = '看清题干问的是「正确」还是「错误」，安全、减速、让行优先。'
        img = (v.get('imageurl') or '').strip()
        rows.append({
            'id': 'j' + qid,
            'point': 'zx' + str(cid),
            'cat': cat,
            'topic': cat_name.get(cid, '综合'),
            'type': 'judge' if typ == '1' else 'choice',
            'q': q,
            'options': opts,
            'answer': ans,
            'tip': tip,
            'img': img,
        })

    print('rows', len(rows), 'no_cat', len(no_cat), no_cat[:10])
    print('used cat(专项) count', len(used_cat))
    print('per 大类', dict(collections.Counter(r['cat'] for r in rows)))

    # ---------- jxedtCats.js ----------
    by_cat = collections.defaultdict(list)
    for cid_s, v in cats.items():
        cid = int(cid_s)
        if cid not in used_cat or cid not in CID_CAT:
            continue
        by_cat[CID_CAT[cid]].append({
            'id': 'zx' + str(cid),
            'name': cat_name.get(cid, '综合'),
            'n': used_cat[cid],
        })
    for k in by_cat:
        by_cat[k].sort(key=lambda x: -x['n'])

    lines = [
        '/* 驾校一点通 科目一「专项练习」分类 → 小程序考点',
        '   由 jxedt/build.py 生成，请勿手改。',
        '   每个专项分类是一个 point（zx<cid>），挂到 points.js 里对应的口诀大类下。 */',
        'module.exports = {',
    ]
    for i, c in enumerate(CATS_ORDER):
        arr = by_cat.get(c, [])
        comma = ',' if i < len(CATS_ORDER) - 1 else ''
        lines.append('  ' + js(c) + ': [')
        for j, p in enumerate(arr):
            lines.append('    { id: ' + js(p['id']) + ', name: ' + js(p['name']) +
                         ', n: ' + str(p['n']) + ' }' + (',' if j < len(arr) - 1 else ''))
        lines.append('  ]' + comma)
    lines.append('};')
    open(os.path.join(MP, 'jxedtCats.js'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')

    # ---------- questions.js ----------
    out = []
    out.append('/* 科目一真题题库 —— 整理自驾校一点通「小车科目一 · 专项练习」(mnks.jxedt.com)')
    out.append('   抓取日期：2026-11-06；共 ' + str(len(rows)) + ' 道（判断题 ' +
               str(sum(1 for r in rows if r['type'] == 'judge')) + ' / 单选题 ' +
               str(sum(1 for r in rows if r['type'] == 'choice')) + '）。')
    out.append('   题目 / 选项 / 答案 / 解析 / 配图均来自该站公开练习题，按专项分类归到考点；')
    out.append('   考点口诀来自《科目一考点大字速记手册》，用于答错时对照记忆。')
    out.append('   仅供个人学习练习使用；如用于公开发布或商业用途，请自行取得题库方授权。')
    out.append('   紧凑写法：')
    out.append("     ['id','point','cat','topic','j'|'c', '题干', [选项...], 正确项索引, '解析', '图片URL']")
    out.append('*/')
    out.append("var P = require('./points.js');")
    out.append('')
    out.append('var RAW = [')
    for i, r in enumerate(rows):
        tup = [r['id'], r['point'], r['cat'], r['topic'],
               'j' if r['type'] == 'judge' else 'c',
               r['q'], r['options'], r['answer'], r['tip'], r['img']]
        out.append('  [' + ','.join(js(x) if isinstance(x, str) else json.dumps(x, ensure_ascii=False)
                                    for x in tup) + ']' + (',' if i < len(rows) - 1 else ''))
    out.append('];')
    out.append('')
    out.append('var QUESTIONS = RAW.map(function (r) {')
    out.append('  var pt = P.POINT_MAP[r[1]] || {};')
    out.append('  return {')
    out.append('    id: r[0],')
    out.append('    point: r[1],')
    out.append('    cat: pt.cat || r[2],')
    out.append('    catName: pt.catName || \'\',')
    out.append('    pointName: pt.name || r[3],')
    out.append('    topic: r[3],')
    out.append("    type: r[4] === 'j' ? 'judge' : 'choice',")
    out.append('    q: r[5],')
    out.append('    options: r[6],')
    out.append('    answer: r[7],')
    out.append('    tip: r[8] || pt.key || \'\',')
    out.append('    key: pt.key || \'\',')
    out.append('    img: r[9] || \'\'')
    out.append('  };')
    out.append('});')
    out.append('')
    out.append('module.exports = {')
    out.append('  QUESTIONS: QUESTIONS,')
    out.append('  BY_POINT: (function () {')
    out.append('    var m = {};')
    out.append("    QUESTIONS.forEach(function (q) { (m[q.point] = m[q.point] || []).push(q); });")
    out.append('    return m;')
    out.append('  })(),')
    out.append('  BY_CAT: (function () {')
    out.append('    var m = {};')
    out.append("    QUESTIONS.forEach(function (q) { (m[q.cat] = m[q.cat] || []).push(q); });")
    out.append('    return m;')
    out.append('  })()')
    out.append('};')
    open(os.path.join(MP, 'questions.js'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')

    # ---------- 结构化题库（可复用数据源） ----------
    os.makedirs(DATA, exist_ok=True)
    json.dump(rows, open(os.path.join(DATA, 'questions.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    json.dump({'categories': [{'cid': int(k), 'name': v['name'],
                               'questionIds': v.get('ids', [])} for k, v in cats.items()],
               'catToPoint': {str(k): v for k, v in CID_CAT.items()}},
              open(os.path.join(DATA, 'categories.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('questions.js bytes', os.path.getsize(os.path.join(MP, 'questions.js')))
    print('jxedtCats.js bytes', os.path.getsize(os.path.join(MP, 'jxedtCats.js')))


if __name__ == '__main__':
    main()
