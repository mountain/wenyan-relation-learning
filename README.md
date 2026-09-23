# 文言关系学习：证据、六爻与有限推理

本仓保存文言关系学习的独立实验、古籍语料及有来源的判断。文言编译器位于
[`mountain/wenyan`](https://github.com/mountain/wenyan)；这里的研究不改 adva 主库。

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

设计方向：苑明理。六爻 v0.1 实现与自审：Codex（OpenAI），通过苑明理账号提交。
新增程序采用 MIT 许可；原有程序及古籍转录的来源与许可分别保留，详见各记录及 `LICENSE.upstream`。
