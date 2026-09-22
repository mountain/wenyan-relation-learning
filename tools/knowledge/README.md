# 语义解释网络该怎么存、怎么判断够不够用

Author/self-review: DSH agent session, 2026-09-22. Direction: Mingli Yuan.

## 先看清一件事：现在被「学到」的是什么

`RelationModel` **只存证据，不存网络**：

```ts
type Example      = { id: string; text: string; expected: Roles };
type RelationModel = { schema: "wenyan.relations.v1"; examples: Example[] };
```

而「网络」——每个构式下角色的存活排列——由私有的 `replay(model)` 在**每次读取和每次更新时**
从 `examples` 重新推导，**从不存储**：

```
model = { schema, examples[] }     ← 原子：证据
rules = replay(model)              ← 纯函数：派生视图
```

这个既有事实直接决定了答案：**要持久化的是证据，不是网络。** 把派生网络存下来，等于存一个
可能悄悄偏离自己输入的缓存。存证据则带来三个可用的性质：

1. 网络永远可重算 —— 模式变更只需重新投影，不需要数据迁移；
2. `replay()` 本身就是校验器 —— **任何能 replay 的证据集，按构造即自洽**；
3. 新证据与旧证据冲突时**可被发现**，而不是被藏在一个过期的派生图里
   （`replay` 对矛盾证据直接抛错，`learnRelations` 返回 `Conflict` 且不改模型）。

## 三层分离

只有中间一层需要持久化。

| 层 | 内容 | 性质 |
|---|---|---|
| L1 来源 | `data/corpus` 的篇/段 + `sourceRevid` + 授权 | 已建成，带修订号可回溯 |
| **L2 证据** | 标注过的记录（文本 + 角色标注 + 出处 + 谁标的 + 哈希） | **追加式、必须不丢** |
| L3 派生视图 | 存活排列、reading、比较结果、就绪度报告 | 可随时重算，可丢弃 |

```
knowledge/relations/
  evidence.jsonl     L2：一行一条记录，追加式；不重写整个文件
  readiness.json     L3：就绪度报告（可删可重算）
```

### 记录格式（实际落盘示例）

```json
{
  "schema": "wenyan.relations.evidence.v1",
  "id": "authored:train-0",
  "grammar": "wenyan.relations.v1",
  "text": "「甲」授「乙」「书」。",
  "expected": { "agent": "甲", "recipient": "乙", "theme": "书" },
  "label": { "kind": "supervisor", "by": "…", "at": null, "note": "…" },
  "source": { "kind": "authored", "note": "未取自任何文本" },
  "contentHash": "5be8e391…",
  "textHash": "69d2c23f…"
}
```

几个字段不是装饰，各自堵一个具体的漏洞：

- **`grammar`（语法版本）**：没有它，将来语法一改，**所有历史标注会被静默重新解释**。
  这是持久化里最容易出事、也最难事后补救的一点。
- **`label`（谁标的、何时）**：代码注释已经写明标注是「declared supervisor constraint,
  not an inferred historical fact」。既然是**声明**，就必须记住**谁**声明的。
- **`source`**：语料派生记录带 `work/section/passageId/sourcePage/sourceRevid/
  passageTextAtLabel`，可回查原文；`authored` 记录明说「不涉及任何文本」。
- **`contentHash`**：对**主张**（grammar+text+expected）取哈希，
  于是重复追加同一条主张是幂等的（学习会话中断重跑不会重复积累），
  而**同句不同标注**会产生不同哈希、被显式报为冲突而不是被去重掉。
- **`textHash`**：用于检出「同一句话被两个来源标成了不同角色」。

### 一个容易忽略的约束：模型是投影，不是仓库

内存里的模型有 **32 条证据上限**，而仓库可以远大于 32 条。所以
`projectModel(records, {grammar, constructionIds})` 是一次**投影**，不是加载。
32 是**单个模型的预算**，不是仓库的容量。

### 授权随证据走，不随仓库走

前面已经确定：语料里 9 部有 PD 标签、7 部落到站点默认 CC BY-SA。因此**从语料派生的证据
必须逐条记录授权**，不能只在仓库级写一次 —— 否则从 7 部无标签作品学来的东西会和从
PD 作品学来的混在一起，事后无法分开。`store.mjs` 的 `source.license` 与
`verifySources()` 就是为此存在。

## 怎么判断「够不够用」：门槛，不是分数

一个标量「丰富度」有两个毛病：说不出**对什么**够用，而且往往只增不减。所以我做成
**分任务的门槛**，每条都要求：可证伪、指名缺口的度量、**且可回退**。

因为网络是 `replay(evidence)`，**矛盾证据能把存活排列推回 6 个、把已通过的门重新关上。
所以这里的成熟度按构造就不是单调的。**

| 门 | 判定 | 现状 |
|---|---|---|
| G1 良构 | 证据可 replay、哈希自洽、标注有出处 | **PASS**（11 条，0 问题，replay ok） |
| G2 已确定 | **逐语法**：每个构式存活排列 = 1，且标注数 ≥ 2 | **FAIL（系统级）** —— experimental 3 个构式各仅 1 条；**reporting 4 个构式均按标准通过** |
| G3 可泛化 | **逐语法**：留出自身证据后仍读对 | **FAIL（系统级）** —— experimental accuracy **0**；**reporting accuracy 1**（核心 8 条，0 失败） |
| G4 失败关闭 | 声明的 6 个非语法输入全部 Unknown | **PASS**（6/6） |
| G5 语料落地 | **逐语法**报告，最好的语法命中率 ≥ 1% | **PASS**（reporting 367/8208 = 4.47%；v1 为 0） |
| G6 可持久可重推 | 内容哈希自洽、语料派生来源可回查 | **PASS**（corpus-derived 来源 **8/8** 可回查） |
| G7 对话契约存在且被强制 | 契约有 schema、不变量各自注明强制者、无违规记录 | **PASS** |
| G8 声明的问句能答目标语料 | 语料可答率 ≥ **0.5**（声明值） | **FAIL**（4.47%，远低于门槛） |
| G9 每条记录都有着落 | 进模型 + 具名留出 + 声明越界 = 池总量 | **PASS**（v1 3/3；reporting 8+21+0 = 29/29） |

结论：**`readyForComputation = true`（按语法归属 — 经由 reporting）**，
**`readyForConversationalReasoning = false`**。

### 为什么「可计算就绪」要按语法归属，而不是全系统一个布尔

G2/G3 现在**逐语法**判读，因为「系统能读」只有在说清「用哪个语法读」时才有意义：

```
G2  experimental/grant: labels=1  ... FAIL      reporting/wei-quote: survivors=1/6, labels=8  ✓
    experimental/hand-over: labels=1 ... FAIL   reporting/wen-quote: survivors=1/6, labels=8  ✓
    experimental/receive: labels=1 ... FAIL     reporting/gao-quote: survivors=1/6, labels=8  ✓
                                                reporting/yu-quote:  survivors=1/6, labels=5  ✓
G3  experimental: core 3, accuracy=0, failures=3     reporting: core 8, accuracy=1, failures=0
```

**reporting 语法在自身留出证据下 accuracy = 1**：把核心 8 条中的任意一条留出，
剩余证据仍能唯一确定该构式的角色映射。这是真实的泛化证据，而非自洽性。

判读规则与 G5 一致（G5 也是「最好的语法」）：**某个语法同时通过「已确定」与「可泛化」
即视为就绪**，且该语法名进入 `verdict.readingReadyGrammars`；其余语法的失败逐条照录，
不因另一个语法的健康而被掩盖。门槛还按**主题分组**，避免用一个布尔把不相干的门绑在一起：
`reading`（G1/G2/G3/G4/G6/G9）与 `dialogue`（G7/G8）。

作用域必须一直跟着结论走：`readyForComputation: true` 说的是
**「用 reporting 语法可以读，且这一结论经留出验证」**——它对 4.47% 的语料成立，
不是对整个语料的断言。G5 与 G8 就在旁边写着这个 4.47%。

### 关于 32 条上限与投影（第 ③ 步）

32 是**受验证模块内部**对**单个模型**的硬预算（`learnRelations` 到 32 抛错、`replay` 拒绝
超过 32），本步不改它；改的是投影层。实测与策略见 **`CAP-REVIEW.md`**，要点：

- **最小可证伪集 = 每构式 2 条**：1 条即可确定映射，第 2 条才让「第一条标错」可被检出。
  故四个构式只需 8 条，上限的 1/4。
- **静默丢弃已根治**：`projectModel` 原本 `slice(0, cap)`，合成 40 条池会静默丢 8 条；
  且缺陷扩散到 3 个调用点。现在默认**拒绝**，显式选择才允许，且必须回报被丢的 id；
  三个调用点全部改走 `selectOperationalCore()`（**按角色选取，不按位置切**）。
- **最关键的发现**：给 reporting 模型加入**一条**与 `wei-quote` 矛盾的记录后，
  **四个构式全部抛错**——包括与它无关的三个。`replay` 遇矛盾即抛且先于每次读取运行，
  所以**在模型全有全无的前提下，证据越多越脆弱**。
- **因此留出集不当模型输入，而当矛盾检测器**：实测 21 条留出记录与 8 条核心**全部相容、
  0 冲突**，而它们一条都没进入回答问题的模型。
- **可按来源过滤，也可撤回**：合成检测句（`authored`）不进入语料学习路径（被排除者具名，
  无可用证据时如实报 `complete: false` 而非回退）；失效记录用**追加式撤回记录**使其退出
  活动集，不编辑也不删除。详见 `CAP-REVIEW.md`。
- 全量标注语料内段落需 367 条 = 上限的 **11.5 倍**，且不会增加任何映射信息。

### 关于 G7/G8：这一节重建过

原先这里只有一条 G7，写着「本仓库没有对话契约 —— 没有问题类型、没有对话状态、没有答案
校验程序」。**那句话在写下时是真的，之后就不再成立**：对话契约已在既定三步的第 ① 步建成
（`tools/dialogue/`），并由执行器强制。一个门槛必须**从工作区重新推导**，而不是记住它
写下那天的样子。

所以拆成两条，各司其职：

- **G7（结构门）**：契约是否存在、是否被强制、是否有违规记录。现在 **PASS**。
  这一条**可以靠把契约写好而达成**。
- **G8（丰富度门）**：声明的问句能否回答**目标语料**。门槛 **0.5** 是声明参数，
  且**刻意不因现值而调低** —— 现值 4.47%，如实 FAIL。

这正是「够不够做会话性推理」的可校验形式：不是「有没有东西叫对话」，而是
**对真实文本提问，能得到有凭据答案的比例是多少**。今天这个数是 4.47%。

G8 的分母是「对语料每一个段落提一次 Q1」。4.47% 意味着**绝大多数段落仍问不出答案**，
原因是语法覆盖面，不是会话机制或证据机制 —— 那两项的检查（Q3 凭据、Q4 撤证、Q5 自洽）
都是 100%。

`G5` 已经**通过**，但通过的方式值得看清：它不是靠调低门槛，而是靠第 ② 步加了一个
**在真实文本里确实会出现**的语法（报道框架，见 `tools/grammar/README.md`）。原实验语法
至今仍是 0/8208。

```
G5  wenyan.relations.v1: 0/8208 (0, evidence 3)
    wenyan.relations.reporting.v1: 367/8208 (0.044712, evidence 8)
```

门槛改成**逐语法报告**是必要的一步：只报一个数字会正好掩盖掉「哪个语法能落地」这件事。
同理，`seed.mjs` 早已测出语料**无法**喂养原语法；第 ② 步的 `seed-reporting.mjs`
则第一次从真实语料取到了监督证据（8 条，逐条带篇号、页面、修订号与授权），
使 `verifySources()` 第一次有东西可查（8/8）。

## 缺口清单（由工具算出，非人写死）

```
G2 三个实验构式各只有 1 条标注（需 ≥2），且只在实验自造句上成立
G3 留一法 accuracy = 0：留出后实验构式退化为 6 个候选
G8 语料可答率 4.47%，低于声明门槛 0.5
```

## 我在实现这套东西时抓到的两个 bug（留档）

两个都是我自己写的，且都**朝「看起来更好」的方向错**。留档是因为它们正好说明：
存储与门槛的价值完全取决于细节是否正确，而错误的实现往往给出更漂亮的数字。

### bug 1：内容哈希没覆盖角色标注（严重）

`contentHash` 本该固化「主张」= 文本 + 角色标注。第一版写成：

```js
const stable = (o) => JSON.stringify(o, Object.keys(o).sort());
```

`JSON.stringify` 的第二参数是**数组时是递归白名单**，对嵌套对象同样生效。于是
`expected` 的键（agent/recipient/theme）不在白名单里，被静默压成 `{}` —— **哈希完全不看角色标注**。
两个后果都直接击中本设计：

- 记录被改动无法被检出；
- `appendEvidence()` 会把**同一句话、相反标注**当成「同一主张已存在」而**静默丢弃** ——
  恰好违背「矛盾必须保留并可被发现」这一初衷。

改法是递归排序键的规范化序列化。修复后实测：同句同标注 `ccee78bb…`、同句反标注
`d6fdc0de…`（不同），追加相反标注返回 `appended:true` 而非被去重。

### bug 2：留一法根本没留出（虚高评分）

G3 第一版写成：

```js
const others = records.filter(x => x.id !== r.id || x.contentHash !== r.contentHash);
```

排除条件要求 id 与 contentHash **同时**相等，而投影出的 example 不带 `contentHash`
（为 `undefined`），于是 `x.contentHash !== undefined` 恒真、OR 短路，**没有任何记录被排除**：
所谓「留出」的读取其实用了完整训练集，报出 **accuracy = 1** 这个毫无意义的满分。

改成按 id 排除后，真实结果是 **accuracy = 0、3 个失败**。

另外，仓库一旦出现矛盾证据，`replay()` 会抛错，而工具当时未加保护、
**直接崩溃而不是报告**。现在所有读取点都走 `safeRead()`：
实测篡改一条证据后，输出的是 `G1 FAIL … parse issues=1, replay=threw: contradictory evidence`，
即把「仓库矛盾」当作头等发现报出来。

这三点合起来是对第二个问题的直接回答：**门槛的价值完全取决于测量是否正确**，
一个会虚高评分的门、或一个会崩溃的门，都比没有门更危险。

## 用法

```sh
node tools/knowledge/seed.mjs                    # 播种（幂等）；并统计语料能供多少证据
node tools/knowledge/readiness.mjs --write       # 算门槛并写 readiness.json（未就绪则 exit 1）
node tools/knowledge/readiness.mjs --store /path/to/other.jsonl
```

## 不声称

- 不声称现在存在「语义解释网络」：现有的是 3 个自造构式上的角色排列排除表，
  在真实语料上命中率 0/8208。
- 不声称本设计可扩展到一般语义：它依赖 `replay` 是纯函数、证据是有限标注集这两个前提；
  若将来引入权重、嵌入或不可复现的推理，第 2 条性质（可 replay 即自洽）不再成立。
- 不声称门槛数值本身有理论依据：`FLOORS` 是可调的**声明值**，应当随任务契约一起评审。
- 不评价 `learnRelations` 的既有设计：本设计只是给它补上存储与就绪判定，未改其语义。
