# 评审：32 条上限与投影/分片策略

Author/self-review: DSH agent session, 2026-09-22. Direction: Mingli Yuan.

这是既定三步的第 ③ 步。全部数字由 `node tools/knowledge/review-cap.mjs --write` 实测产出，
存于 `knowledge/cap-review.json`。

## 问题

`RelationModel` 的 32 条证据上限，到底是**单次推理的预算**，还是**知识库的容量**？
投影层应当怎么围着它工作？

## 答案：它是「单个模型」的硬预算，所以变的是投影层

实测：`learnRelations` 在 `model.examples.length >= 32` 时抛 "evidence capacity reached"；
`replay` 拒绝超过 32 的模型。它在**受验证模块内部**，而本步不允许改那个模块。

所以 32 **保持不变**。要改的是投影层围绕它的行为。

## 实测一：正确性到底需要多少证据

| 语法 | 1 条标注后 | 第 2 条**冲突**标注后 |
|---|---|---|
| `wenyan.relations.v1` | 存活 1/6，reading `KnownFiniteGrammar` | `Conflict`（**被检出**） |
| `wenyan.relations.reporting.v1` | 存活 1/6，reading `KnownFiniteGrammar` | `Conflict`（**被检出**） |

所以：**1 条即足以确定映射；第 2 条才使「第一条标错了」可被发现**，而不是被静默地当成
权威。因此**最小可证伪集 = 每个构式 2 条**。32 条里的其余部分是余量，不是需要。

对四个构式的 reporting 语法而言，最小可证伪集是 **8 条**——上限的 1/4。

## 实测二：静默丢弃（已修）

`projectModel` 原本是 `pool.slice(0, cap)`：合成 40 条池 → 模型取 32、**丢掉 8 条**，
不报错、不指名，只回一个计数。而且这个缺陷**扩散到了 3 个调用点**：
`grammar/measure.mjs`、`dialogue/ask.mjs`、`knowledge/readiness.mjs` 各自长出了自己的
`slice(0, 32)`。

现已修：`projectModel` **默认拒绝**（抛错并指路），只有显式 `onOverflow: 'prefix'`
才允许位置截断，且**必须回报被丢的 id**。三个调用点全部改走
`selectOperationalCore()`——**按角色选取，而不是按位置切**。

## 实测三：一条坏记录，全部构式遭殃（最关键的发现）

给 reporting 模型加入**一条**与 `wei-quote` 矛盾的记录：

```
干净:    wei ✓  wen ✓  gao ✓  yu ✓
投毒后:  wei 抛错  wen 抛错  gao 抛错  yu 抛错
被一条无关坏记录带崩的构式: wen-quote, gao-quote, yu-quote
```

原因：`replay` 遇矛盾即抛，而 `replay` 在**每次读取之前**运行，所以抛错使**所有**构式
都无法读取——包括与那条坏记录毫无关系的三个。

**结论：在模型是全有全无的前提下，证据越多越脆弱。** 这不是「数据质量问题」，是架构问题。
把证据无限灌进同一个模型，等于让任何一处标注失误摧毁全部能力。

## 实测四：全量标注的需求与代价

语料中在语法内的段落 **367 条 = 上限的 11.5 倍**。若把它们全部标为证据：
- 32 条上限会挡住 11.5 倍；
- 更要命的是，367 条里**任何一条**标错（或边界规则在错跨度上触发）都会让全部构式失效。

而且它们**不会增加任何映射信息**——映射早已被钉死。

## 策略（已实施，不只是建议）

1. **32 保持不动**，不改 `relations.ts`。
2. **按角色拆分仓库**：`selectOperationalCore()` 取每个构式的最小可证伪集（默认 2 条）；
   其余全部**具名留出**（`heldOut`），越界的另记（`outOfGrammar`）。
3. **投影显式且确定**：选取规则是声明的（supervisor 标注优先、corpus 来源优先、再按 id
   定序），入选与被排除都具名；**永不按位置静默切片**。
4. **留出集不当模型输入，而当矛盾检测器**：`auditHeldOut()` 分批回放留出记录与核心比对。
5. **记账不变量**：每条记录必须有着落（进模型／具名留出／声明越界），
   由门槛 **G9** 强制——这是「不得静默丢弃」的可证伪形式。

### 留出集真的做了事：实测结果

```
核心 8 条（每构式 2 条），留出 21 条（池 29）
  gao-quote 可用 8 取 2 ✓    wei-quote 可用 8 取 2 ✓
  wen-quote 可用 8 取 2 ✓    yu-quote  可用 5 取 2 ✓
留出审计: 21 条一致，0 条冲突
```

21 条来自真实语料的留出记录全部与 8 条核心相容，**而它们一条都没有进入回答问题的模型**。
这既验证了声明的读法（说话者→agent 等）在 10 部作品上自洽，又保持了模型的小与稳。

## 补充：按来源过滤，使合成检测句不进入语料学习

投影除了按**角色**选取，还必须按**来源**选取。仓库里混着两类证据：

| 来源类 | 是什么 | 现值 |
|---|---|---|
| `corpus` | 真实语料的引文，背后有篇号、页面与修订号 | **29** |
| `authored` | 为驱动机器而写的句子（`「甲」授「乙」「书」。` 家族） | **3** |

`selectOperationalCore(..., { provenance })` 现在接受 `'corpus' | 'authored' | 'any'`：

- **语料学习路径用 `'corpus'`** —— 实测 reporting 语法核心 **8 条全部为语料来源**，
  合成检测句无法进入。
- **fixture 语法声明 `'authored'`** —— v1 句式在语料中命中 0，它**只能**由自造句授权。
  这一条是**显式声明**的，所以它的答案永远不会冒充语料知识。
- 被排除者**具名**（`excludedByProvenance`），且当某语法在所需来源下**没有任何证据**时，
  如实回报 `complete: false` 并给出原因，**不静默回退到合成数据**。实测：

```
对 wenyan.relations.v1 要求 corpus 来源：
  池 3 → 可用 0 → 核心 0
  按来源排除 3 条：authored:train-0/1/2
  complete: false
  emptyReason: no corpus-derived evidence exists for wenyan.relations.v1; …
                This grammar cannot be learned from the corpus — it says so rather than
                falling back to invented sentences.
  模型 examples: 0        ← 关键：不得回退
```

G9 的记账不变量随之扩展为**四项**：
`核心 + 具名留出 + 声明越界 + 按来源排除 = 池总量`（实测 v1 3/3、reporting 29/29）。
守门人是 `tools/knowledge/selftest.mjs`（**8/8**），其中包含「无静默回退」与「被排除者具名」两项。

## 撤回：如何让一条记录停止授权，而不编辑也不删除它

`contentHash` 使任何改动都可被检出——这同时意味着记录**无法就地更正**，而删除它会毁掉
使仓库可审计的历史。所以撤回是**它自己的一条记录**：

```json
{
  "schema": "wenyan.relations.evidence-retraction.v1",
  "id": "retract:corpus:analects:2.21:wei-quote",
  "targetId": "corpus:analects:2.21:wei-quote",
  "reason": "为什么撤回（必填，且必须是一句话）",
  "retractedBy": { "kind": "operator", "by": "…", "at": "…" },
  "supersededBy": "（可选）替代它的新记录 id",
  "contentHash": "…"
}
```

与证据记录**共处同一线性日志**，因为顺序本身是信息：撤回不能先于它所撤回的东西。

| 规则 | 行为 |
|---|---|
| R1/R2/R3 | 必须指明目标、必须给出理由、必须具名撤回者（kind/by/at）——**撤回是一条判断** |
| R4 | 撤回不存在的记录被拒绝 |
| 目标须在前 | 加载时校验目标确实出现在日志中更早的位置 |
| 禁止撤回撤回 | 撤回是终局；**恢复证据靠追加新记录**，不是撤销历史 |
| 幂等 | 重复撤回同一目标是 no-op |
| 防篡改 | 撤回自身也有 `contentHash`，改动会被检出 |

**加载器默认排除已撤回记录**：`records` 是活动集（安全的那一侧），另有
`allRecords` / `retracted` / `retractedIds` / `retractions` 供审计。实测在真实仓库上
向后兼容：**32 条全部活动、0 条撤回、0 问题**。

### 撤回会被冗余吸收

撤回一条核心证据**不会**立刻让结论失效——投影会从剩余证据里重新选取最小可证伪集。
实测在沙箱中逐条撤回 `yu-quote` 的证据：

```
第 1–3 条：core 8 -> 8, complete true -> true        （冗余吸收，无影响）
第 4 条  ：core 8 -> 7, complete true -> false  <-- DOWNGRADES 预警
第 5 条  ：core 7 -> 6
```

只有在某构式的证据**被耗尽**时才会降级，且降级是**局部的**：
`孔子語弟子曰…` 退回 `Unknown(ambiguous-role-mapping)`，而 `孔子謂弟子曰…` 仍 `Answered`。
这正是 I6（答案从不缓存为真值）在起作用。

CLI 会在写入前**打印后果**（超出/不足/是否降级），并在降级时给出 `DOWNGRADES` 预警——因为它
要防止的正是「悄悄降级」。

```sh
node tools/knowledge/retract.mjs --target <id> --reason "…" --dry-run
node tools/knowledge/retract.mjs --target <id> --reason "…" --by "…"
```

### 顺带修掉的一个 bug：缺席必须让检查失败，而不是让它通过

沙箱演示暴露出最后一个撤回让 `complete` 从 false 变成 **true**。原因：某构式一条证据都不剩时
就**从 `perConstruction` 里彻底消失**，于是 `.every()` **空真**通过——reading 正确地返回了
Unknown，`complete` 却报了假。

修法是让投影接收**声明的构式清单**（`expectedConstructions`），零证据的构式照样列入并判为
不足（实测报为 `yu-quote 0/0`）。回归项：`ABSENCE FAILS A CHECK`。

## 今天的状态

```
PASS G9 每条记录都有着落  v1: 3/3;  reporting: 8 核心 + 21 留出 + 0 越界 = 29/29
```

上限今天尚未咬人（v1 用 3/32，reporting 用 8/32），但**第 ② 步把上限问题从理论变成了算术**：
每构式 2 条 × 构式数 接近 32 时，就必须分片，而分片必须显式。

## 不声称

- 不声称 32 这个数字有理论依据：它是既有模块里的一个既有常量，本次只是**测量**了它
  与正确性、可证伪性、脆弱性的关系。
- 不声称最小可证伪集「2」是普适的：它取决于「6 个候选排列、3 个槽」的结构；
  槽数或排列数变化时需重新推导。
- 不声称留出审计是完整的矛盾检测：它只回放**已标注**的记录，
  未经标注的真实文本不会被检查（那需要人力监督，不是自动化能替代的）。
- 不声称已解决脆弱性：核心仍会被自身的坏记录带崩。本次只是**把爆炸半径限制在核心内**，
  而不是让整个语料标注集都成为引信。
- 分片策略在构式数增长到接近上限时才会被真正检验；当前规模下它尚未承压。
