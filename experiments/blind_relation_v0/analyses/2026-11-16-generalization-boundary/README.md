# 文言关系学习器的词汇与句法边界

对照基线为 `mountain/wenyan-relation-learning@cba40627ca9ce49dcbd89527f1d904debad14009`。原预测来自 #12 合并提交 `a75492d914d09524d8e8220ac80e196d8ad73ce7`，揭盲记录来自 #13 合并提交 `016aeca493881fd55fbf7c347069fd8b69586659`。本包的 48 条已揭盲查询和 61 条对照均作开发数据，其中 6 条原改写被用作对照矩阵的端点。

## 拒答发生的位置

worker 首先对查询全文执行精确匹配。槽内是 1–32 个字符的引号字面量，排除角引号及换行，整句上限 256 字符。三个规则同时固定了词形、标记、引号和句号。匹配失败直接返回 `Unknown/outside-profile`。在通过匹配之后，worker 才使用训练所得的槽位排列。训练固定为每个构式一条示例，三个构式分别枚举六种槽位排列，18 次检查后训练返回 `Accepted`。

| 冻结构式 | 表面槽位顺序 | 按施事、受领者、转交物取槽位 |
| --- | --- | --- |
| `「A」授「R」「T」。` | A、R、T | 1、2、3 |
| `「A」把「T」交给「R」。` | A、T、R | 1、3、2 |
| `「R」获「A」所授「T」。` | R、A、T | 2、1、3 |

外层请求 `wenyan.external-role-inference.v0.1` 的字段是 `schema`、`task`、`observer`、`training`、`queries`、`fuel`。worker 把带标签的训练行和 fuel 交给 learner。查询是字符串数组，语义预期留在评分端。任意训练句也须先通过同一套句式匹配。维持训练角色及其他训练行不变，仅换成 `「乙」得「甲」所授「书」。` 或 `「乙」获「甲」所授之「书」。`，两次分别在训练入口报 `ValueError: training outside profile`。

在三个固定构式内，任何仍满足槽位约束的实体换名都会随同一槽位排列传到输出。这是可直接从实现推出的性质。三种排列由有标签训练求出，三个句式预先写入程序。相关实现见 [worker.py](https://github.com/mountain/wenyan-relation-learning/blob/cba40627ca9ce49dcbd89527f1d904debad14009/experiments/postfreeze_relation_v0/worker.py) 和 [learner.py](https://github.com/mountain/wenyan-relation-learning/blob/cba40627ca9ce49dcbd89527f1d904debad14009/experiments/external_relation_v0/learner.py)。

## 六条原改写

| 原句 | 揭盲角色（施事，受领者，转交物） |
| --- | --- |
| 「石泉」得「兰舟」所赠之「玉筹」。 | 兰舟，石泉，玉筹 |
| 「兰舟」得「石泉」所赠之「玉筹」。 | 石泉，兰舟，玉筹 |
| 「沧弦」付「银钥」于「墨川」。 | 沧弦，墨川，银钥 |
| 「墨川」付「银钥」于「沧弦」。 | 墨川，沧弦，银钥 |
| 「岑渚」以「玄印」予「洛衡」。 | 岑渚，洛衡，玄印 |
| 「洛衡」以「玄印」予「岑渚」。 | 洛衡，岑渚，玄印 |

这六条是三种表达方式各测试两个方向。每对交换的是施事与受领者。原评分中的 18 对反转另有定义，交换的是施事与转交物（预注册中操作化为 patient）。见 [查询文本](https://github.com/mountain/wenyan-relation-learning/blob/016aeca493881fd55fbf7c347069fd8b69586659/experiments/blind_relation_v0/batches/2026-10-19-agent01/queries.json)、[结果](https://github.com/mountain/wenyan-relation-learning/blob/016aeca493881fd55fbf7c347069fd8b69586659/experiments/blind_relation_v0/reveals/2026-10-19-agent01/results.json) 和 [监督者声明](https://github.com/mountain/wenyan-relation-learning/blob/016aeca493881fd55fbf7c347069fd8b69586659/experiments/blind_relation_v0/batches/2026-10-19-agent01/supervisor-attestation.md)。

## 受控对照

每行固定一个有向三元组。动词替换时保留槽顺序和构式标记。句式变换时保留动词，必要时移动受领者和转交物并用 `于` 或 `以` 标出其角色。下表为每个家族的一个方向，另一个方向使用同样的变换。含 `付` 的双宾语过渡句等按设定的有限语义赋值，只承担程序诊断。

| 预期角色 | 冻结原式 | 只换词 | 只改句式 | 两项都改 |
| --- | --- | --- | --- | --- |
| 兰舟，石泉，玉筹 | 「石泉」获「兰舟」所授「玉筹」。 | 「石泉」得「兰舟」所赠「玉筹」。 | 「石泉」获「兰舟」所授之「玉筹」。 | 「石泉」得「兰舟」所赠之「玉筹」。 |
| 沧弦，墨川，银钥 | 「沧弦」授「墨川」「银钥」。 | 「沧弦」付「墨川」「银钥」。 | 「沧弦」授「银钥」于「墨川」。 | 「沧弦」付「银钥」于「墨川」。 |
| 岑渚，洛衡，玄印 | 「岑渚」授「洛衡」「玄印」。 | 「岑渚」予「洛衡」「玄印」。 | 「岑渚」以「玄印」授「洛衡」。 | 「岑渚」以「玄印」予「洛衡」。 |

| 对照 | 冻结 worker 实测 |
| --- | --- |
| 词与句式均维持原状 | 6/6 `KnownFiniteGrammar`，有序角色全对 |
| 只换词 | 6/6 `Unknown/outside-profile` |
| 只改句式 | 6/6 `Unknown/outside-profile` |
| 两项都改（六条原改写） | 6/6 `Unknown/outside-profile` |
| 收得式只换 `获→得` 或只换 `授→赠` | 4/4 `Unknown/outside-profile` |
| 上一组再分别加 `之` | 4/4 `Unknown/outside-profile` |
| 三冻结构式 × 「青岫、澄浦、白圭」的六种角色赋值 | 18/18 `KnownFiniteGrammar`，有序角色全对 |
| 否定、意图、问句、所指未定、并列候选、多事件、展示等负对照 | 9/9 `Unknown/outside-profile`，错误接受 0/9 |
| 保持构式、将 `其` 或 `洛衡或疏钟` 整体放进引号 | 2/2 `KnownFiniteGrammar`，按字面返回 |

在选定的对照里，词形变化和句式变化各自足以触发同一个匹配失败。以收得式为例，单改 `获→得`、单改 `授→赠`、单加 `之`，三步分别独立失败。worker 只有一道同时约束词与句式的查询匹配，因此实验无法给两种因素排重要性。

`「岑渚」授其「玄印」。` 因缺少字面受领者而拒答。`「岑渚」授「其」「玄印」。` 返回 `[岑渚, 其, 玄印]`。冻结接口将后一个 `其` 当作显式实体名。若扩展到把引号内文本解释成自然语言表达，须另外处理代词和候选集合，否则引号足以改变拒答行为。两条字面量探针与 9 条负对照分别计数。

## 实现和最终评价方案

1. 将这组用例作为开发回归。三个构式、两种单因素变化、两项同时变化、有序角色和无唯一肯定交付的拒答，各自保留独立断言。已有 worker 与严格接收器可直接复用做冻结基线。
2. 增加构式或同义词表时，将显式覆盖作为对照。若要测试组合泛化，将动词的关系义与构式的槽位映射分别提供证据并冻结，然后留出二者的组合。若主张对未见词或未见句式有迁移，分别按词、按构式家族留出，并记录独立语料或其他可用的词义和句法证据。照录本包三种改写的完整模板只能检验新增覆盖。新的接口版本还须写明哪些带引号的字符串仍是实体 ID，以及何时要求解指或拒答。
3. 最终评价另建全新冻结批次。监督者先提交查询及标签承诺，候选系统和公开评分协议固定后运行，预测摘要锁定后才揭盲。由于本包中的 48 条原数据和派生对照均已公开，新增批次应避开这些确切句子及近重复。分别报告原式、只换词、只换句式和组合留出组的覆盖率、全组有序角色准确率、已接受项准确率，以及负例错误接受、成对角色反转和执行失败。正例拒答计入全组准确率分母，已接受项为空时其准确率记作未定义。

## 复现与证据等级

在解压目录运行以下命令。需要 Python 3，无第三方依赖或联网步骤。

```sh
python3 replay.py > replayed.json
cmp outcome.json replayed.json
```

- **冻结实现可核验。** `sources.json` 标出固定提交里的每个原文件，重放前校验 Git blob SHA-1 与 SHA-256。按 #12 请求重跑，48 条预测输出与原锁定文件逐字节相同，SHA-256 为 `c084a7072c4f91f6c8015eef499a07f7c62a98cf3b64bcc68d07150d6d7d5d74`。原预测及 61 条对照均经冻结的严格接收器独立重算。本地使用 CPython 3.12.14，默认和 `-O` 运行所得报告逐字节一致。[预测锁](https://github.com/mountain/wenyan-relation-learning/pull/12)
- **有限开发证据。** 过渡例句使用合成的角色预期。原批次的宣称范围为冻结三构式，其中监督者是同一模型家族的任务隔离 agent。认证揭盲与原 CI 见 [PR #13](https://github.com/mountain/wenyan-relation-learning/pull/13) 和 [运行记录](https://github.com/mountain/wenyan-relation-learning/actions/runs/43594564927)。
- **待检验假设。** 词义与构式能否组合到未见文本，要由冻结候选在新批次上的精确角色、拒答和错误接受共同判定。

对照设计与重放由 Codex 完成。冻结代码和原始预测的来源逐项记录在 `sources.json`。
