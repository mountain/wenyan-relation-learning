# 《太玄》：情境结构与进程位置 v0.1

2026-09-23。方向：苑明理。实现、暂定监督标注与自审：Codex（OpenAI），通过苑明理账号提交。
本轮只改关系数据仓库；未改文言编译器或 adva。研究入口是一种独立问句语法。

## 来源和版本

作者是扬雄。固定来源为中文维基文库《太玄經》修订 **2651096**，时间 2026-02-23T02:04:43Z：
https://zh.wikisource.org/w/index.php?title=太玄經&oldid=2651096

`data/taixuan/source.wiki` 保存该修订 API 主槽返回的完整 wikitext，未改字、标点或章节。
SHA-256：`22573659dec9e3bbf8a6001c9ad07a275fb76ab4b5e42b01bc1fd91aa7626258`。
`source.json` 保留修订、页面、历史和许可：古典原作为公有领域；转录、标点等保守沿用站点
CC BY-SA 4.0，并保留维基文库贡献者署名链。派生索引同样保留这些来源信息，MIT 不覆盖古籍转录。
仅使用此一转录版本，未做校勘；没有收入 ctext 内容或 Unicode 图表文件。

原始 API 的 JSON 转义方式不是正文的一部分；快照是解码后的 main-slot content 的 UTF-8 字节。
离线检查不访问网络。可用 `node tools/taixuan/fetch-source.mjs` 从官方 API 重新核对固定修订，
`--write` 只在修订号与摘要完全一致时恢复该文件，不取最新修订。
哈希校验提供完整性证据，不独立证明来源真实性。

## 结构、文本、解释

| 对象 | 表示 | 已核对范围 |
|---|---|---|
| 首 | 方、州、部、家四个三值位置；从上到下 | 81 首；原文 Unicode 首符号与篇序、三方边界互核 |
| 赞位 | 独立的 1..9 位置 | 729 个普通地址 |
| 六坐标 | 首的四位＋赞位减一的两位三进制 | 729 个唯一地址可往返 |
| 文本 | 首辞、完整赞段、可分隔的赞辞／测辞 | 每段绑定原始快照的 UTF-16 起止跨度 |
| 额外文本 | 踦、嬴二赞；两序与九传 | 保留并索引，不挤入 729 个地址 |
| 现代读法 | 监督者、任务、标签、理由、原文来源 | 与赞辞、测辞分别保存 |

传统一、二、三在代码中编码为 0、1、2。篇序按原文《玄数》的“推玄筭”权重：
`ordinal = 1 + 27*方 + 9*州 + 3*部 + 家`（右端各位为零基值）。
Unicode 符号参考：https://www.unicode.org/charts/PDF/U1D300.pdf 。这里只检查符号码点与顺序，不读取字体几何。

九赞在编码中是位置，并不自动成为九条可执行指令。`nextZan` 只声明同一首内的后继，
第九位返回 Boundary，不自动跳首或模拟历法。81 首中共有 162 次后继涉及两位三进制进位。
因此六坐标的编址双射不等于保持邻接、运算或意义的同构，更不证明与 Adva 六芽对应。
三值数字 2 是已知值；Unknown 则是查询／学习结果的证据边界，两者没有被混同。

### 37 处格式异常与异写

- **达次二**没有“测曰”分隔：完整段仍可查询，`statement` 与 `commentary` 为 null，
  `segmentation=unresolved-missing-marker`。不擅自断句、补字或说测辞不存在。
- **礼次二**写“侧曰”；**众上九**用“测曰，”：按明确标记分层，同时保留实际写法。
- 34 个末赞题作“次九”：索引为第九位，原标签不改成“上九”。

因此本版是 **729 个完整赞段、728 对可明确分隔的赞辞／测辞、一处待辨**。
正文中的 `{{!|字|字形说明}}` 仅渲染第一个参数；原模板始终保存在快照跨度内。
未识别标记会报错，不静默删除。其余字形和标点不归一化，标题与正文中的异体字分别保留。

## 学习机制与旧证据

`tools/context-learning/engine.mjs` 是既有六爻学习器的类型适配版，保留 profile/example/retract、
哈希链、具名来源、局部分歧、特征假设反驳和条件读法机制。适配器是受信任的程序配置，
提供情境校验、身份键、特征及来源记录；不从用户日志加载可执行适配器。

太玄情境固定为 `{system:"taixuan",digits:"0000",zan:1}`，另有自己的事件 schema。
支持 `digits/zan/fang/zhou/bu/jia/phaseGroup/phaseWithin` 特征；两个 phase 特征只是赞位的
三进制商、余数，没有预设“计算／验证／学习”等意义。原文、测辞、标签和标注理由不能作为
这些结构特征输入，以避免答案泄漏。

每个特征组建立部分查表；相同特征键出现不同标签便否决该特征组。所有存活特征组都覆盖
查询、且读法一致时才输出 CandidateReading。同一完整情境的分歧返回 Contested，不投票；
未覆盖、候选组全被反驳、存活组意见不一、预算不足分别返回有原因的 Unknown。
`qualified` 是监督者提出的“有条件／未充分明示”标签，不是程序的 Unknown 状态。

新增特征组须显式追加新 profile；只有同任务、相同标签清单的监督例子可以沿用。
来源原文由固定 catalog 提供，监督标签不是原文蕴涵的事实。纯函数接口信任调用者提供的
catalog；CLI 从已固定快照重新构建。输出 IndexedText 不意味着已解释原文。

旧 `tools/changes/learning.mjs` 及其证据摘要保持原字节。本版先保留旧实现作为冻结参照，
新增引擎通过周易适配器，在三个旧 profile 的全部 384 个情境上逐项比较，**1152 个结果一致**，
旧事件也能逐条重建成相同哈希。尚未将旧入口切换到新引擎。

日志为单写者追加；多进程需要上层加锁。fuel 计量特征组与活动例子的比较次数，不含日志
读取、校验与归组成本。未保证无限学习、固定资源下无限历史或跨进程事务。

## 固定整首留出实验

协议在运行预测前写入 `contract.json`，18 条标注在预测前写入 `annotations.json`。
标注者为 Codex，**尚待明理审定**。标签是 affirming / adverse / qualified，定义和逐条理由均可查。
这不是盲测：实现者可以阅读完整语料；这是固定小样本诊断，不是古文理解基准。

- 依篇序取前六首，每首取一、五、九赞。
- 训练首：中、周、礥，共九条；整首留出：闲、少、戾，共九条。
- 先只加入中，再加入周、礥；所有阶段使用同一份留出标注，不根据留出成绩修改特征组。
- 比较只看赞位、三位结构前缀＋赞位、完整首境＋赞位三个预先固定的 profile。
- 留出标注只参与报告评分，**不写入学习日志**；每次检查训练和留出首零交集。

实测结果（暂定标注口径）：

| 训练证据 | 只看赞位 | 结构前缀＋赞位 | 完整首境＋赞位 |
|---|---|---|---|
| 中的三条 | 回答 9，正确 3、错误 6 | 9 条 Unknown，未覆盖 | 9 条 Unknown，未覆盖 |
| 加入周，共六条 | 粗规则被反驳，9 条 Unknown | 粗规则被反驳，9 条 Unknown | 9 条 Unknown，未覆盖 |
| 加入礥，共九条 | 粗规则被反驳，9 条 Unknown | 粗规则被反驳，9 条 Unknown | 9 条 Unknown，未覆盖 |

完整首境能复现训练九条，但留出覆盖为 0；没有把弃答算成回答正确，零回答时条件准确率为 null。
这里没有发现语义迁移。观察到的是：新证据能纠正过度推广，但纯结构细化可以退化为记忆。
完整逐例结果、反例引用和阶段日志头见 `holdout.json`。

下一步应先审定这些读法，再提出可共享的关系特征（例如主体、行为、条件、时机），并预先
选定新的留出首。不能把本轮测试首反复用作调参对象后，继续称其为独立测试。

## 运行与修改标注

Node 24/26，无第三方依赖：

```sh
node tools/taixuan/ask.mjs text '觀「中」之五贊。'
node tools/taixuan/ask.mjs text '觀「達」之二贊。'
node tools/taixuan/ask.mjs address 000022
node tools/taixuan/ask.mjs next 000002
node tools/taixuan/ask.mjs predict taixuan-context-v1 --store knowledge/taixuan/learning.jsonl --digits 0000 --zan 5
node tools/taixuan/ask.mjs learn /path/to/event-input.json --store /path/to/session.jsonl
node --max-old-space-size=256 tools/taixuan/selftest.mjs
```

learn 输入沿用 `{id,payload,provenance:{by,basis}}`。例如在包含初始日志的个人会话中撤回一条标注：

```json
{"id":"review-withdraw-1-1","payload":{"kind":"retract","target":"taixuan-1-1","reason":"填写审定理由"},"provenance":{"by":"填写审定者","basis":"说明本次审定依据"}}
```

修订读法应追加撤证和新例子，保留旧事件；不编辑已发布的标注快照来改写本轮成绩。
新的 corpus example 使用 `{kind:"corpus",reference:record.passage.source,text:record.passage.text}`。
需要人工几何夹具时明确使用 `authored` 来源，不冒称古籍读法。

CLI 的 Unknown / Refused / Contested 退出码分别为 3 / 4 / 5。`selftest --write` 显式重建
本轮派生 catalog、holdout 与 evidence，并幂等追加本轮十二条种子事件（三 profile＋九例子）。
日常检查用不带 `--write` 的命令；它验证来源、源代码摘要和派生数据，不修改历史结果。

本輪校验包括 729 地址往返与查询、2279 原文跨度、729 次后继检查、反例否决、分歧与撤证、
来源和哈希链篡改拒绝、幂等追加、旧学习器等价性及旧证据字节不变。CI 在 Node 24/26 下执行
上述检查及既有六爻／三段论、关系、知识、语法、对话和语义回归。
