# 六爻与三段论：显式研究接口

本文件自上游 `mountain/wenyan` 的 `2377c2c`
（`bcd05ba` 合并 `research/changes-grammar-v0.1`）移入并**适配本仓**：
本仓库只含 `src/inscription/` 子树、没有编译器本体，故上游示例里的
`from "../parser"` 在此改为直接引用本目录模块，编译器侧的再导出段落不适用、已略去。
除此以外内容照录，包括上游对本仓职责的指定。

设计：苑明理；实现与自审：Codex（OpenAI），2026-09-23，通过苑明理账号提交。
新增程序为 MIT 许可。现有编译器语法与叙事评分保持原行为。

`changes.ts` 提供六爻位置、64 配置、变爻、三种分开的变换与古籍索引读取。
字符串自下而上，阴 0、阳 1。三才配对与上下卦对应配对形成交替六环；
64 配置上的变化图则是六维立方体。这两个图和原文含义分开处理。

`syllogism.ts` 提供 A/E/I/O 三段论、六位编码、四种格、两种明确存在假设的完全有限判定。
语法和 API 不把 64 候选式称为 64 个重言式。

```ts
import { readSyllogism, changeLines, judgeSyllogism } from "./syllogism";
import { readChanges } from "./changes";
import { runInscriptionPipeline } from "./pipeline";

readSyllogism("凡「人」皆「动物」。凡「学者」皆「人」。故凡「学者」皆「动物」。");
// Parsed + judgment.Valid, with figure=1 and policy=boolean retained

readSyllogism("凡「猫」皆「动物」。凡「狗」皆「动物」。故凡「狗」皆「猫」。");
// Same mood AAA, figure=2: Refuted + explicit countermodel

changeLines("111111", [1]); // "011111"

// catalog is loaded explicitly by the caller from this repository's data tree.
readChanges("觀「乾」之初爻。", catalog);
runInscriptionPipeline("觀「乾」之初爻。", { changes: { catalog }, steps: 2 });
```

`readChanges` 验证 catalog 结构，不替调用者证明文本来源；返回 caller-supplied-catalog 标记。
原文、许可、来源跨度校验及可修订的读法学习由**本仓库**
（[`wenyan-relation-learning`](https://github.com/mountain/wenyan-relation-learning)）管理。
上游只提供数据注入接口，不捆绑古籍或访问网络，不自动训练。

存在假设 `boolean` 允许项空，`terms-nonempty` 要求 S/M/P 各非空；两者都要求论域非空。
检查 255 个非空 Venn 区占据掩码即可完全判定这一片段：每个非空原子区保留一个代表，
不会改变 A/E/I/O 的真值。预算不足返回 Unknown，反例返回 Refuted，完全覆盖才返回 Valid。
它不涵盖一般一阶逻辑，也不赋予卦象逻辑有效性。

Node 24/26 的零依赖研究回归：

```sh
node --max-old-space-size=256 tools/changes/selftest.mjs
```

这项测试覆盖 64 编码、4096 变化往返、512 逻辑契约、256 受控语句和 pipeline opt-in；
研究测试不替代项目已有 TypeScript/Jest/build 流程，新增独立 CI 保留两条验证路径。

## 本仓库补记：两处与上游不同的状态（2026-09-23 实测）

1. **上游的 CI 只跑 changes 一项；本仓的 CI 跑六项**
   （changes、taixuan、experiments/relations、knowledge、grammar、dialogue、semantics）。
   本仓 `.github/workflows/changes-grammar.yml` 是上游同名文件的超集。

2. **本仓的 `tools/changes/selftest.mjs` 是上游版本的超集**（172 行对 26 行）：
   上游那份是合成 catalog 的冒烟测试，本仓这份额外覆盖语料编目、九个留出读数、
   十八项比较、学习事件的哈希链与撤回、以及来源绑定策略。

上游本文件的 `src/parser.ts` 再导出段落（把 `readChanges`/`readSyllogism` 等
挂到编译器入口）在本仓**不适用**：本仓不含编译器，`src/` 只有 `inscription/` 子树。
