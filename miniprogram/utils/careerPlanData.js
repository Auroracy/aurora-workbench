/* 事业编备考 · 考试倒计时与复习计划默认值（照搬 aurora-workbench.html 的 CAREER_EXAM_DEFAULT /
   CAREER_PHASES / CAREER_PLAN_DEFAULT，勿手改） */

/* 江苏省事业单位统考笔试固定为每年 4 月第三个周六，故下一场默认 2027-04-17。
   日期可在倒计时卡右上角 ⚙ 修改；改完倒计时天数、当前阶段与各阶段建议日期会一起更新。 */
var CAREER_EXAM_DEFAULT = {
  "name": "江苏省事业单位统考 · 计算机类岗位",
  "date": "2027-04-17",
  "time": "09:00-11:30",
  "note": "笔试《综合知识和能力素质》（计算机类）"
};

/* 阶段划分：按距考天数取第一个满足 min 的阶段 */
var CAREER_PHASES = [
  {
    "phase": 1,
    "min": 121,
    "title": "基础夯实期",
    "tip": "每天 30 分钟通读知识书，先把《公共基础知识》与 5 本计算机教材走一遍"
  },
  {
    "phase": 2,
    "min": 61,
    "title": "专项突破期",
    "tip": "按科目刷真题，错题当天进错题本，每周日重练至清零"
  },
  {
    "phase": 3,
    "min": 15,
    "title": "真题冲刺期",
    "tip": "一年一年做真题，严格限时 90 分钟；计算机作图题用黑色签字笔规范作答"
  },
  {
    "phase": 4,
    "min": -99999,
    "title": "考前复盘期",
    "tip": "只看错题本与背诵口诀，考前一周做 2 次全真模考（9:00–11:30）"
  }
];

/* 默认复习计划（共 34 条）
   s / e = 距考试天数（起始 / 结束，越早数值越大）用于反推各阶段建议日期；phase = 阶段号 */
var CAREER_PLAN_DEFAULT = {
  "groups": [
    {
      "id": "cpg1",
      "name": "第1阶段 · 基础夯实",
      "s": 999,
      "e": 120,
      "phase": 1,
      "tasks": [
        {
          "id": "cpg1_t01",
          "text": "《公共基础知识》第1章 政治常识：马哲唯物论 / 辩证法 / 认识论 + 毛泽东思想活的灵魂，背熟口诀「物决意、矛动力、量变质、否前行」",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t02",
          "text": "《公共基础知识》第2章 法律常识：宪法、民法典、行政法与行政诉讼法三大块过一遍",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t03",
          "text": "《公共基础知识》第3章 经济与管理：市场经济、宏观调控、管理职能与行政决策",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t04",
          "text": "《公共基础知识》第4章 公文写作：15 种法定公文文种 + 格式要素（版头 / 主体 / 版记）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t05",
          "text": "《公共基础知识》第5章 人文与科技 + 第6章 党史国情与事业单位",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t06",
          "text": "《数据结构（C语言版）》线性表与栈队列、树与二叉树（三种遍历、哈夫曼树、二叉排序树）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t07",
          "text": "《计算机网络（第7版）》分层体系结构、网络层与传输层（TCP 三次握手 / 四次挥手、子网划分）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t08",
          "text": "《计算机操作系统（第4版）》进程与线程、内存管理（页面置换算法、死锁四个必要条件）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t09",
          "text": "《数据库系统概论（第5版）》关系模型与范式、SQL 与事务（ACID、隔离级别、日志恢复）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t10",
          "text": "《软件工程导论（第6版）》软件过程与建模、项目管理与 UML（用例图 / 类图 / 时序图）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg1_t11",
          "text": "《江苏省事业单位考试专用教材》考情专项：江苏·南京考情 + 备考策略与规划通读一遍",
          "done": false,
          "doneAt": ""
        }
      ]
    },
    {
      "id": "cpg2",
      "name": "第2阶段 · 专项突破",
      "s": 120,
      "e": 60,
      "phase": 2,
      "tasks": [
        {
          "id": "cpg2_t01",
          "text": "计算机专项｜数据结构每日 10 题：树与图、查找与排序，错题当天进错题本",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t02",
          "text": "计算机专项｜计算机网络每日 10 题：TCP/IP、子网划分、HTTP / HTTPS 与信息安全",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t03",
          "text": "计算机专项｜操作系统每日 10 题：进程调度、死锁、页面置换与文件系统",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t04",
          "text": "计算机专项｜数据库每日 10 题：范式判定、SQL 语句书写、事务与并发控制",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t05",
          "text": "计算机专项｜软件工程每日 5 题：生命周期模型、UML、测试用例与项目管理",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t06",
          "text": "公基专项｜政治 + 法律每日 15 题（结合二十大与最新修法）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t07",
          "text": "公基专项｜经济 + 管理 + 公文每日 15 题",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t08",
          "text": "公基专项｜人文科技 + 党史国情与事业单位每日 10 题",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t09",
          "text": "职测专项｜言语理解 + 判断推理每日 10 题",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t10",
          "text": "职测专项｜数量关系 + 资料分析每日 10 题（资料分析限时 25 分钟）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg2_t11",
          "text": "每周日：错题重练至清零，反复错的要点回填到知识书对应章节",
          "done": false,
          "doneAt": ""
        }
      ]
    },
    {
      "id": "cpg3",
      "name": "第3阶段 · 真题冲刺",
      "s": 60,
      "e": 14,
      "phase": 3,
      "tasks": [
        {
          "id": "cpg3_t01",
          "text": "公基真题按年份限时：2018–2022 各一套（每套 90 分钟）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg3_t02",
          "text": "计算机类真题按年份限时：2018–2022 各一套（每套 90 分钟）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg3_t03",
          "text": "职测真题按年份限时训练，资料分析单篇计时",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg3_t04",
          "text": "计算机类作图题专项：结构图 / 流程图 / E-R 图用黑色签字笔规范作答（铅笔作图不给分）",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg3_t05",
          "text": "江苏特色考点专项：省情、南京考情、《事业单位人事管理条例》",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg3_t06",
          "text": "近 3 年真题二刷，正确率低于 85% 的年份整卷重做",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg3_t07",
          "text": "每周一次全真模考（9:00–11:30 同考试时段，全程不查资料）",
          "done": false,
          "doneAt": ""
        }
      ]
    },
    {
      "id": "cpg4",
      "name": "第4阶段 · 考前复盘",
      "s": 14,
      "e": 0,
      "phase": 4,
      "tasks": [
        {
          "id": "cpg4_t01",
          "text": "错题本整体过一遍，优先看标了「重点」的要点",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg4_t02",
          "text": "所有「背诵提示」口诀默写一遍",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg4_t03",
          "text": "考前一周做 2 次全真模考，严格按考试时段与时长",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg4_t04",
          "text": "打印准考证（4 月 15 日起）+ 确认考点路线、二代身份证有效期",
          "done": false,
          "doneAt": ""
        },
        {
          "id": "cpg4_t05",
          "text": "考前一晚只看错题本与口诀，不刷新题；备好 2B 铅笔、黑色签字笔、橡皮、直尺",
          "done": false,
          "doneAt": ""
        }
      ]
    }
  ]
};

module.exports = { exam: CAREER_EXAM_DEFAULT, phases: CAREER_PHASES, plan: CAREER_PLAN_DEFAULT };
