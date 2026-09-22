# 语义验收：判断型证据与 Contested

Author/self-review: DSH agent session, 2026-09-22. Direction: Mingli Yuan.

这一层回答的问题：**语义验收有办法做到吗？**

答案：**能，但只在把「语义」钉到被声明且可证伪的主张类型上时才成立**；对「这句话是什么
意思」（gloss）与「这句话的深意」（interpretation）不能——这两类已在
`tools/dialogue/` 的 Q6 里按契约声明出局。所以问题从来不是「有没有办法」，
而是**把语义缩小到哪一类主张**。

## 为什么语法层的机制不能照搬

| | 语法层 | 语义层 |
|---|---|---|
| 凭据是什么 | 你可以**指着跨度**：这段文字扮演这个角色 | **文本不作证**「两句同义」——不同串可同义，同串在不同语境可不同义 |
| 凭据的终点 | 文本本身 | **人的判断** |
| 冲突意味着 | 有一条**错了** → `replay` 抛错 | 可能**两条都对** → 是分歧，不是错误 |

第三行是关键。语法层里两条冲突标注等于仓库损坏，而损坏是**全局**的——我实测过：一条坏
记录让四个构式**全部**抛错。语义层如果照搬，就会在**最需要它的那些文本上**（有真争议的
文本）彻底不可用。

所以引入了 **`Contested`**：一个**局部**的、**具名分歧双方**的状态。

## `Contested` 的定义与不变量

- **定义**：就同一主张，已记录的判断彼此不一致。答案必须具名双方（各自的判断者与依据），
  并说明分歧点是什么。
- **局部性（I8）**：它只关系**一条主张**，**绝不能**阻碍其他主张或其他问题。
  仓库级的问题仍然是 `Inconsistent`，且**`Inconsistent` 优先于 `Contested`**。
- **不投票**：多数不裁决主张。2 条 holds 对 1 条 fails 仍然是 `Contested`（自测已验证）。
  一旦按多数裁决，分歧就被抹掉，这层也就失去了意义。

## 声明的主张类型

| 类型 | 问什么 | 已知的边界 |
|---|---|---|
| `coreference` | 该跨度与哪个前文成分同指？ | 两条站得住的读法是 **Contested**，不是仓库损坏 |
| `construction-meaning` | 该构式在此处是否携带所声明的构式义？ | 弱可证伪：一个反例即可否决 holds |
| `speech-act` | 该跨度的言语行为是否为所声明者？ | **限定于文本显式标记者**（如「决定的是：」），不读语气与意图 |
| `layer-sense-relation` | 词 W 在层 A 与层 B 的义项之间是否为所声明的关系？ | 这是**传承边上的主张**；两侧证据分离 |

**声明出局**：`gloss`（需要词典，判断记录造不出词典）、`interpretation`（**不是可证伪的
主张**——没有任何观察能反驳它，所以它不是本系统可以持有的主张）。

未声明的主张类型一律 `Refused`（S6），**绝不用类比去答**。

## 判断记录

`knowledge/semantics/judgments.jsonl`，一行一条，追加式：

```json
{
  "schema": "wenyan.semantics.judgment.v1",
  "id": "coreference:cbc011eda9b8:…:holds",
  "claimHash": "cbc011eda9b8…",
  "claim": { "type": "coreference", "text": "…", "span": "他们", "link": "我的怨敌" },
  "verdict": "holds",
  "judge": { "kind": "declared-reading", "by": "…", "at": "…", "basis": "…" },
  "evidence": { "textSource": { "attribution": "…", "verified": false } },
  "contentHash": "…"
}
```

三条纪律：**S5** 判断必须具名判断者与依据，否则**无法入库**；主张身份由
`claimHash` 固定（只哈希身份字段，键在每一层排序）；`contentHash` 覆盖主张 + 结论 + 判断者，
所以改动可被检出。规范化序列化复用了 `knowledge/store.mjs` 的 `canonicalJson`
——**刻意复用，因为我自己在那里犯过一次 `JSON.stringify` 数组参数递归白名单的 bug**，
重写一遍就是重犯一次。

## 第一条夹具：鲁迅那句话

> 我的怨敌可谓多矣，倘有新式的人问起我来，怎么回答呢？我想了一想，决定的是：让他们怨恨去，我也一个都不宽恕。

选它是因为它包含一个**真实存在**的可争议主张，而不是我编造的冲突：
**「他们」有两个复数先行语**（我的怨敌、新式的人），两种读法都站得住。

| 主张 | 状态 |
|---|---|
| `coreference`「我」→「我的」 | **Answered**（holds） |
| **`coreference`「他们」→「我的怨敌」** | **Contested** —— 最近先行语读法 vs 语篇话题读法 |
| `construction-meaning`「一个都不+V」= 全量否定 | **Answered**（holds） |
| `speech-act`「决定的是：…」= 决断 | **Answered**（holds，文本显式标记） |
| `layer-sense-relation` 恕（先秦）→ 宽恕（白话）= 义项转移 | **Answered**（holds） |
| `construction-meaning`「可謂…矣」 | **Unknown** —— 刻意不判定 |
| `gloss` / `interpretation` / 未声明类型 | **Refused** |

那个传承边的依据是**测出来的**：先秦「恕」为推己及人的德目（禮記「忠恕違道不遠。
施諸己而不願，亦勿施於人」，语料 14 段可证），而「寬恕／宽恕」在先秦语料 **0 段**——
字形连续，词形与义项不连续。**这正是「传承边」要负责的那类主张，而它可被两侧的证词分别检验。**

关于权威性，我说清楚：**每一条判断都是本会话的「声明读法」并附依据**，不是学术共识，
效力不超过此。语义契约的 nonclaims 写明了这一点，每条记录也具名判断者。该句为用户引述，
**其出处在本工作区无法核实**，这一点记在每条判断的 `evidence.textSource` 上（`verified: false`）。

## 我在这层又抓到的一个漏洞（留档）

`verifyAnswer` 原先对**所有非 Answered 状态**直接返回「nothing to recompute」，
于是 `Contested` **从未被独立重算**——而 I5 存在的意义恰是在这种状态上提供凭据。
现在 `Contested` 会被重算并要求双方记录数一致，并有专门的自测项守住它
（断言 `verified.note` 必须含 `reproduce`，而不是「nothing to recompute」）。

## 用法

```sh
node tools/semantics/seed-luxun.mjs              # 播种第一条语义夹具（幂等）
node tools/semantics/selftest.mjs                # 五种状态 + 强制 + 局部性（12/12）
node tools/dialogue/ask.mjs Q7 --claim '<json>'  # exit 0 Answered / 3 Unknown / 4 Refused / 5 Contested
```

## 不声称

- **不是理解**：这层记录并调和判断，**不从不文本推导意义**。
- **不是学习**：每条主张都需要一条人工判断，覆盖面靠人力增长，不靠推断。
- **不是共识机器**：多数不裁决主张，分歧以 `Contested` 保持可见。
- 不声称 `Contested` 是缺陷：**在真实文本上它往往是诚实的答案**。
- 本会话记录的判断是**有依据的声明读法**，效力不超过此。
- 覆盖率目前是**一条夹具、5 条主张**。这不是「语义层已建成」，是**它真的能用**的最小证明。
