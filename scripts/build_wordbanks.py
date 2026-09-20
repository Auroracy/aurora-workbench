#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建 Aurora 工作台的多套英语词库。

数据源：qwerty-learner 开源词库（jsdelivr CDN，含音标 + 中文释义）
输出：  data/wordbanks/<id>.json   单套词库（紧凑格式，供服务端按需下发）
        data/wordbanks/index.json 词库清单（名称/描述/词数/大小），前端据此渲染词库选择器

用法：
    python3 scripts/build_wordbanks.py            # 全量构建
    python3 scripts/build_wordbanks.py cet4 gre   # 只构建指定词库
"""
import json
import os
import sys
import time
import urllib.request

CDN = 'https://cdn.jsdelivr.net/gh/RealKai42/qwerty-learner@master/public/dicts/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'data', 'wordbanks')
CACHE_DIR = os.path.join(OUT_DIR, '.source-cache')

# id, 显示名, 描述, 图标, 分类, 源文件
BANKS = [
    ('cet4',     '四级词汇',   '大学英语四级核心词',        '🎯', '国内考试', ['CET4_T.json']),
    ('cet6',     '六级词汇',   '大学英语六级核心词',        '🎓', '国内考试', ['CET6_T.json']),
    ('kaoyan',   '考研词汇',   '考研英语大纲核心词',        '📕', '国内考试', ['KaoYan_3_T.json']),
    ('tem4',     '英语专四',   '英语专业四级词汇',          '📗', '国内考试', ['Level4luan_2_T.json']),
    ('ielts',    '雅思 IELTS', '雅思核心词汇',              '🌏', '出国考试', ['IELTS_3_T.json']),
    ('toefl',    '托福 TOEFL', '托福核心词汇',              '✈️', '出国考试', ['TOEFL_3_T.json']),
    ('gre',      'GRE',        'GRE 核心词汇',              '🧠', '出国考试', ['GRE_3_T.json']),
    ('gmat',     'GMAT',       'GMAT 核心词汇',             '📊', '出国考试', ['GMAT_3_T.json']),
    ('sat',      'SAT',        'SAT 核心词汇',              '📝', '出国考试', ['SAT_3_T.json']),
    ('bec',      '商务英语 BEC', '剑桥商务英语词汇',        '💼', '职场英语', ['BEC_3_T.json']),
    ('nce',      '新概念英语', '新概念英语 1-4 册词汇',     '📘', '经典教材', ['NCE_1.json', 'NCE_2.json', 'NCE_3.json', 'NCE_4.json']),
    ('oxford',   '牛津核心 3000', '牛津 3000 核心高频词',   '📖', '高频核心', ['Oxford3000.json']),
    ('longman',  '朗文高频 3000', '朗文交际 3000 高频词',   '🔤', '高频核心', ['Longman_Communication_3000.json']),
]


def fetch(name):
    """下载词库源文件（带本地缓存 + 重试）"""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache = os.path.join(CACHE_DIR, name)
    if os.path.exists(cache) and os.path.getsize(cache) > 1024:
        with open(cache, encoding='utf-8') as f:
            return json.load(f)
    last_err = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(CDN + name, headers={'User-Agent': 'aurora-workbench/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode('utf-8')
            data = json.loads(raw)
            with open(cache, 'w', encoding='utf-8') as f:
                f.write(raw)
            return data
        except Exception as e:      # noqa: BLE001
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError('下载失败 %s: %s' % (name, last_err))


def normalize(entries):
    """[{'name','trans','usphone'}] -> [[word, 释义, 例句, 音标], ...]（去重、保留顺序）
    槽位与工作台内置词库保持一致：[0]=单词 [1]=释义 [2]=例句（多词库暂无，留空）
    [3]=音标（供卡片在揭示答案时显示）"""
    out, seen = [], set()
    for e in entries:
        w = (e.get('name') or '').strip()
        if not w or w.lower() in seen:
            continue
        seen.add(w.lower())
        phone = (e.get('usphone') or e.get('ukphone') or '').strip().strip('/')
        trans = [t.strip() for t in (e.get('trans') or []) if t and t.strip()]
        cn = '；'.join(trans)
        out.append([w, cn, '', phone])
    return out


def build_one(bank_id, name, desc, icon, category, files):
    entries = []
    for fn in files:
        entries.extend(fetch(fn))
    words = normalize(entries)
    # 按字母序排列，便于“按字母浏览”，同时保持稳定顺序
    words.sort(key=lambda x: x[0].lower())
    doc = {
        'id': bank_id,
        'name': name,
        'desc': desc,
        'icon': icon,
        'category': category,
        'count': len(words),
        'words': words,
    }
    path = os.path.join(OUT_DIR, bank_id + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(path)
    print('  ✓ %-8s %5d 词  %6.1f KB  -> data/wordbanks/%s.json' % (bank_id, len(words), size / 1024, bank_id))
    return {'id': bank_id, 'name': name, 'desc': desc, 'icon': icon,
            'category': category, 'count': len(words), 'size': size}


def main():
    only = set(sys.argv[1:])
    os.makedirs(OUT_DIR, exist_ok=True)
    meta = []
    print('构建词库（数据源：qwerty-learner 开源词库）')
    for bank_id, name, desc, icon, category, files in BANKS:
        if only and bank_id not in only:
            continue
        try:
            meta.append(build_one(bank_id, name, desc, icon, category, files))
        except Exception as e:      # noqa: BLE001
            print('  ✗ %-8s 失败：%s' % (bank_id, e))
    if not only:
        index_path = os.path.join(OUT_DIR, 'index.json')
        with open(index_path, 'w', encoding='utf-8') as f:
            json.dump({'updatedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
                       'source': 'https://github.com/RealKai42/qwerty-learner (开源词库, jsdelivr CDN)',
                       'banks': meta}, f, ensure_ascii=False, indent=1)
        total = sum(m['count'] for m in meta)
        print('清单已写入 data/wordbanks/index.json：%d 套词库 / 共 %d 词' % (len(meta), total))


if __name__ == '__main__':
    main()
