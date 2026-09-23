# 文言关系学习：证据、六爻与有限推理

本仓保存文言关系学习的独立实验、古籍语料及有来源的判断。文言编译器位于
[`mountain/wenyan`](https://github.com/mountain/wenyan)；这里的研究不改 adva 主库。

**秦九韶大衍术与《易》 v0.1**：[文献补证、算例复核及 adva 解读](experiments/qin-dayan/README.md)。
区分秦氏原文、现代 CRT 重述与辅助位格提议，复算五十／四十九及三十三根算例，
并登记 adva 已有的 CRT 与来源投影校准。原术递推及跨体系语义映射仍未完成。

新的 **六爻语法 v0.1** 将结构、原文、推理、监督解释分成四个可检查的层次：

| 层 | 已实现 | 界限 |
|---|---|---|
| 六爻结构 | 64 配置、双配对六环、单爻及多爻变化、三种显式变换 | 六位不等于六个独立 Adva 原始词 |
| 文本索引 | 64 卦辞、384 爻辞、用九与用六，原文跨度和版本 | 原文不直接授权现代解释 |
| 三段论 | 64 式 × 4 格 × 2 存在假设，有限完全判定和反模型 | 六位编码不决定有效性 |
| 上下文学习 | 有限特征假设筛选、具名分歧、追加式撤回、显式版本扩展 | 输出是有条件的读法提议；不宣称理解整部《周易》 |

Node 24 或 26，无外部依赖：

```sh
node tools/changes/ask.mjs text '觀「乾」之初爻。'
node tools/changes/ask.mjs syllogism '凡「人」皆「动物」。凡「学者」皆「人」。故凡「学者」皆「动物」。'
node tools/changes/ask.mjs predict advice-context-v2 --store knowledge/changes/learning.jsonl --bits 111111 --position 1
node --max-old-space-size=256 tools/changes/selftest.mjs
```

读法学习与版本扩展见 [完整契约、算法与限制](experiments/changes/README.md)。
64 卦与三段论的逐项对应位于 `knowledge/changes/syllogisms.json`，每行明确保留格、存在假设、
证明范围或反模型。它是可重建的派生视图。

原有入口：[角色关系实验](experiments/relations/README.md)、[语料](tools/corpus/README.md)、
[证据与撤回](tools/knowledge/README.md)、[报道语法](tools/grammar/README.md)、
[受约束对话](tools/dialogue/README.md)、[语义分歧](tools/semantics/README.md)。

**《太玄》情境实验 v0.1**：扬雄《太玄》固定修订的 81 首、729 普通赞位及踦／嬴二赞，
分开保存可明确分隔的赞辞、测辞和现代监督解释。六个三值坐标只用来编址，第三值不等于 Unknown。
“达”次二缺少“测曰”标记，完整原文保留，分层待辨。

```sh
node tools/taixuan/ask.mjs text '觀「少」之九贊。'
node tools/taixuan/ask.mjs address 000022
node tools/taixuan/ask.mjs predict taixuan-context-v1 --store knowledge/taixuan/learning.jsonl --digits 0000 --zan 5
node --max-old-space-size=256 tools/taixuan/selftest.mjs
```

首轮跨首实验使用 Codex 提出的 18 条暂定标注（尚待明理审定）。仅凭“中”的赞位推广，在
9 条整首留出标注上正确 3 条；新反例否决粗规则后，细规则能复现训练标注，但留出覆盖为 0。
这不是语义迁移成功。详见[结构、来源、协议与完整结果](experiments/taixuan/README.md)。

设计方向：苑明理。六爻 v0.1 实现与自审：Codex（OpenAI），通过苑明理账号提交。
《太玄》v0.1 实现、暂定监督标注与自审：Codex（OpenAI），通过苑明理账号提交。
新增程序采用 MIT 许可；原有程序及古籍转录的来源与许可分别保留，详见各记录及 `LICENSE.upstream`。
