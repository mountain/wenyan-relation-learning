# 对话契约：让「会话性推理」变成可校验的东西

Author/self-review: DSH agent session, 2026-09-22. Direction: Mingli Yuan.

这是既定三步的第 ① 步。第 ② 步（一个在真实文本里会出现的语法）与第 ③ 步（重评 32 条上限
与投影策略）尚未开始。

## 要解决的问题

「丰富到可以做会话性推理了吗？」这个问题在原来的形式下**无法回答**，因为「会话性推理」
没有被定义成可校验的东西。而流畅的文本永远能生成，所以**没有任何东西能区分「知道」与
「听起来像知道」**。

契约的全部作用就是把这条界线变机械：**每条答案都必须由仓库里已有的证据授权；没有凭据时，
唯一允许的答案就是 Unknown。**

## 七种问题类型

| 类型 | 可以问什么 | 需要什么才能答 | 无凭据时 |
|---|---|---|---|
| **Q1** reading | 这句里谁是 agent / recipient / theme？ | 文本在已声明语法内可解析，且该构式的角色排列已被证据钉到唯一 | `Unknown`（`outside-controlled-grammar` / `ambiguous-role-mapping`） |
| **Q2** comparison | 两句是同一关系、角色互换、还是不同关系？ | 两侧 Q1 均已答 | `Unknown`（带该侧原因） |
| **Q3** warrant | 这个结论依据什么？谁声明的？ | 无需额外条件 —— 这是「你怎么知道」这一问 | 不可能出现无凭据结论（见 I1） |
| **Q4** counterfactual | 撤掉证据 E，结论还成立吗？ | 该记录存在 | 撤证后结论被撤回，且**如实回报** |
| **Q5** consistency | 仓库本身自洽吗？ | 无需条件 | `Inconsistent`，且此时任何类型都不得返回 Answered |
| **Q6** gloss | 这句话是什么意思？ | —— | **`Refused`，按声明出局** |
| **Q7** judgement | 关于这条主张，已记录的判断是什么？ | 主张类型已在语义契约中声明，且至少有一条判断记录 | `Unknown`（无判断）／`Contested`（判断彼此不一致，具名双方） |

Q7 是**唯一以「判断」而非「文本跨度」作凭据**的问题类型：语法标注可以指着跨度检验，
而「这两句同义」「他们指谁」不能。详见 `tools/semantics/README.md`。

Q6 是刻意**声明出局**而非省略：回答它需要词典或义项清单，本仓库没有，而**再多的关系证据
也变不出一个**。把它写成 Refused 而不是悄悄用流畅文本糊过去，是这份契约最重要的一条。

## 契约是被强制的，不是被写在纸上的

这句话我用自测证明，而不是声称（`node tools/dialogue/selftest.mjs`，**10/10 通过**）：

```
ok  I1 rejects Answered without a warrant            rejected: I1 violated: Answered without a warrant
ok  I1 rejects a warrant without a derivation       rejected: I1 violated: warrant without a derivation string
ok  I2 rejects Unknown without reason/missing        rejected: I2 violated: Unknown without reason and missing
ok  I4 refuses an undeclared question type           Q42 -> Refused
ok  I6 withdrawal retracts a conclusion              丙=agent -> retracted: 6/6 survive, changed=true
ok  Q3 refuses to invent evidence not in the store   a warrant naming a non-existent record is reported as Inconsistent
ok  Q3 on an Unknown conclusion stays Unknown        Unknown in -> Unknown out
```

机制是：每个处理器的返回值都过 `validateAnswer()`（I1–I4），每个 Answered 都再由
`verifyAnswer()` **独立重算**比对（I5），不一致即抛错。所以「越出证据去回答」在这里是
**会大声失败的 bug**，而不是一段静默的漂亮文字。

**I6 值得单独看**：撤掉某构式唯一的证据后，存活排列从 1 回到 **6**、`changed=true`。
即早先的结论被**撤回**。所以在这个系统里，成熟度按构造**不是单调的**。

## 当前可答率（实测）

`node tools/dialogue/readiness.mjs`，共 9287 个问题（默认用原受控语法）：

| 类型 | 提问 | Answered | Unknown | Refused | **Contested** |
|---|---:|---:|---:|---:|---:|
| Q1 | 8240 | **3** | 8237 | 0 | 0 |
| Q2 | 1008 | **6** | 1002 | 0 | 0 |
| Q3 | 5 | 5 | 0 | 0 | 0 |
| Q4 | 32 | 32 | 0 | 0 | 0 |
| Q5 | 1 | 1 | 0 | 0 | 0 |
| Q6 | 1 | 0 | 0 | **1** | 0 |
| Q7 | 5 | 4 | 0 | 0 | **1** |

契约违规 0 起。Q7 的那一条 `Contested` 是**真实争议**（鲁迅句中「他们」的指代，
见 `tools/semantics/README.md`），报告中**保持可见而不被裁定**。

契约状态自检：8 条不变量各自注明强制者、7 种问题类型、出局类型已显式标注、
未声明类型一律 Refused、无自由文本答案字段。

### 按语法分开看语料可答率（这一行才是关键）

对话层现在**语法感知**：问题可以指定用哪个已声明语法读文本，答案的凭据里会写明是哪一个。

| 语法 | 语料 Q1 可答率 | 主要 Unknown 原因 |
|---|---|---|
| `wenyan.relations.reporting.v1`（报道框架） | **4.47%**（367/8208） | 7809 越界、32 同段多命中歧义 |
| `wenyan.relations.v1`（实验自造句式） | **0.00%**（0/8208） | 8208 越界 |

**读法**：对话机械本身是完整的 —— Q3/Q4/Q5 全部 100%（凭据追溯、撤证重算、自洽检查都正常），
Q1 在被教过的句子上全对。语料可答率**从 0 变成 4.47%**，是因为第 ② 步加了一个在真实
文本里确实会出现的语法（见 `tools/grammar/README.md`）。

同一句真实语料，两种语法的差别是可见的：

```
--grammar wenyan.relations.reporting.v1  → Answered: agent=或, recipient=孔子, theme=子奚不爲政？
（默认 wenyan.relations.v1）              → Unknown(outside-declared-grammar)
```

但 4.47% 仍然很低：**对真实文本的绝大多数段落，提问依然得不到答案**。知识层的 G8
门槛设为 0.5 且**刻意不因现值而调低**，所以它如实 FAIL。第 ① 步的缺口（受控语法在语料中
0/8208）已经补上；剩下的缺口是覆盖面，不是会话机制。

## 不变量

| | 规则 |
|---|---|
| I1 | Answered ⇒ warrant 有 refs，或 warrant.kind 为 `store` |
| I2 | Unknown ⇒ 必须同时给出 `reason` 与 `missing` |
| I3 | **不存在自由文本答案字段**；每个 Answered 载荷都符合该类型的答案模式 |
| I4 | 未在契约中声明的问题类型一律 `Refused`，**绝不用类比去答** |
| I5 | 每个 Answered 都必须能仅由仓库重算出来，且重算结果必须一致 |
| I6 | 答案从不作为「真值」缓存；增删证据可以改变既有答案，包括把 Answered 退回 Unknown |
| **I7** | **`Contested` 必须具名分歧双方**（各自的判断者与依据）并说明分歧点；**不得**作为一个裸状态返回 |
| **I8** | **`Contested` 是局部的，且 `Inconsistent` 优先**：仓库级失效不授权任何答案，故不得用它来报告局部争议；反之，一条争议主张不得阻碍其他任何主张或问题 |

### 五种答案状态

`Answered` · `Unknown` · `Refused` · `Inconsistent`（**全局**：仓库损坏，什么都不授权）
· **`Contested`（局部**：有凭据但凭据彼此不一致，具名双方，**不阻碍其他任何问题**）。

把 `Contested` 与 `Inconsistent` 分开，正是为了让语义层在**最需要它的文本上**（有真争议的
文本）仍然可用——照搬语法层「冲突即抛错」的做法会让整个仓库在那类文本上失效。

## 用法

```sh
node tools/dialogue/ask.mjs Q1 --text '「甲」授「乙」「书」。'   # exit 0
node tools/dialogue/ask.mjs Q1 --text '子曰：「學而時習之。」'    # exit 3 (Unknown)
node tools/dialogue/ask.mjs Q2 --a '…' --b '…'
node tools/dialogue/ask.mjs Q4 --text '…' --removeId 'authored:train-0'
node tools/dialogue/ask.mjs Q5
node tools/dialogue/ask.mjs Q6 --text '…'                       # Refused
node tools/dialogue/readiness.mjs --write                        # 可答率普查
node tools/dialogue/selftest.mjs                                 # 契约是否真有牙齿
```

退出码：`0` Answered、`3` Unknown、`4` Refused/Inconsistent —— 便于脚本按状态分支，
不必解析文本。

## 扩展契约的正确方式

**先改 `contract.json`，再实现处理器。** 不是「改个提示词让它多答一点」。
`notDeclared` 明确写着：未列出的类型一律 Refused。一个类型要进来，必须带上它的
输入模式、所需证据、答案模式、校验程序与失败关闭行为——**没有校验程序的类型不得进入**，
否则 I5 就是空的。

## 不声称

- **不是聊天机器人**：这条路径上没有任何自然语言理解。
- **不是生成**：系统从不撰写散文；每个答案都是结构化取值，或 Unknown / Refused。
- **不是开放域**：已声明的问题类型就是能被问的全部。
- 不声称有凭据的答案说明了任何真实文本 —— Q1 在语料上 3/8240 的可答率正是这句话的数字形式。
- 不声称 `Contested` 是缺陷：在真实文本上它往往是**诚实的答案**；而把它与 `Inconsistent`
  混同，会让语义层在最有争议、也最需要它的文本上整体失效。
- **Q6 释义是按声明出局，不是暂时做不到**：它需要另一份契约（词汇语义），
  含它自己的证据格式与证伪程序。
