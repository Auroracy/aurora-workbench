# -*- coding: utf-8 -*-
"""补抓剩余题目：移动版 g.asp 返回非严格 JSON（裸反斜杠 / 换行），做容错解析。"""
import json, re, time, sys, urllib.request

_D = os.path.dirname(os.path.abspath(__file__))

RAW = _D + '/questions_raw.json'
IDS = _D + '/all_ids.json'
UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'


def loose_json(txt):
    # 把字符串值里非法的 \X 转义成 \\X（保留 \" \\ \/ \b \f \n \r \t \u）
    def fix(m):
        s = m.group(0)
        return re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', s)
    txt = re.sub(r'"(?:[^"\\]|\\.)*"', fix, txt)
    return json.loads(txt, strict=False)


def m_detail(qid):
    url = 'https://m.jxedt.com/mnksnew/g.asp?id=' + qid
    req = urllib.request.Request(url, headers={
        'User-Agent': UA_M,
        'Referer': 'https://m.jxedt.com/mnks/ckm1/zxlx/',
        'Accept': 'application/json,text/plain,*/*',
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        txt = r.read().decode('utf-8', 'ignore')
    d = loose_json(txt)
    if not d.get('question') or str(d.get('id', '')).startswith('$'):
        raise ValueError('empty/template')
    return {
        'id': int(qid), 'question': d.get('question', ''),
        'a': d.get('an1', ''), 'b': d.get('an2', ''), 'c': d.get('an3', ''),
        'd': d.get('an4', ''), 'e': '', 'f': '', 'g': '',
        'right': d.get('answertrue', ''), 'ta': d.get('answertrue', ''),
        'type': d.get('type', ''), 'chapter': d.get('chapterid', ''),
        'imageurl': d.get('imageurl', '') or '',
        'bestanswer': d.get('explain', '') or '',
        'bestanswerid': d.get('bestanswerid', ''),
        'options': '', '_src': 'mobile-tolerant',
    }


def main():
    data = json.load(open(RAW, encoding='utf-8'))
    ids = json.load(open(IDS))
    todo = [q for q in ids if q not in data]
    print('todo', len(todo), todo, flush=True)
    ok = 0
    for q in todo:
        for attempt in range(3):
            try:
                data[q] = m_detail(q)
                ok += 1
                print('OK', q, data[q]['question'][:30], flush=True)
                break
            except Exception as e:
                if attempt == 2:
                    print('FAIL', q, repr(e), flush=True)
                time.sleep(0.8)
    json.dump(data, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False)
    print('DONE total={} added={} missing={}'.format(len(data), ok, len(ids) - len(data)), flush=True)


if __name__ == '__main__':
    main()
