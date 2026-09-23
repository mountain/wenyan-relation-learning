# wenyan.corpus.v1 — 诸子与儒家经典核心集

从**中文维基文库（zh.wikisource.org）**取回的诸子与儒家经典核心集，整理为本项目
既有的 `schema` + 溯源 + 哈希清单约定（与 `experiments/relations/contract.json`、
`evidence.json` 同风格）。

**规模**：16 部、877 篇、**8138 段**、**906,678 字**（按 Unicode 码位计）。
其中 70 段被识别为结构性标记并从正文移出（保留在 `extraction.structuralMarkers`）。

## 为什么不是 ctext.org

原始要求是从 ctext.org 下载。**这件事没有做，也不应做**：

- `ctext.org/robots.txt` 对 `GPTBot`、`ChatGPT-User`、`Amazonbot`、`IRLbot` 等直接
  `Disallow: /`；
- 站点对 `GET /`、`/faq`、`/terms`、`/tools/subscribe/` 一律返回同一张反抓取拦截页
  （2781 字节），其中明确写道 automated processes *"do not have authorization to
  scrape this page"*，并要求研究者改由机构订阅；
- `api.ctext.org` 无凭据时返回 `ERR_REQUIRES_AUTHENTICATION`。

因此本仓库**未从 ctext.org 获取任何内容**，也未尝试绕过任何限制。合规路径是订阅
（见 `https://ctext.org/tools/subscribe`），该路径已实现在
`tools/corpus/fetch-ctext.mjs`，需要一个真实的 API key，无 key 时**拒绝运行**（exit 2）。

> **需要向 CTP 反馈的一个缺陷**：开发期间探测参数名时，`gettext?urn=…&apikey=TEST`
> （占位 key）竟返回了正文。这看起来是该端点的**认证绕过缺陷**，不是授权。该响应未被
> 落盘、也未进入语料；本仓库的任何工具都不依赖它。建议报告给 CTP，而不是使用它。

## 授权：原典公有领域，转录另有页面标签

**先秦两汉原典本身属公有领域**，这一点没有疑问。需要留意的是另一件事：从 Wikisource
取来的是它的**转录**（版本选择、现代标点、分段、字形），而每一页自己挂了什么标签是
可以直接查证的——本工具把它查了下来，逐部记入 `manifest.json`。

实测各书所用页面上的授权/版权模板：

| 有明确公有领域标签（9 部） | 标签 |
|---|---|
| 論語 | 先秦作品×5, PD-old×14 |
| 孟子 | PD-old×14 |
| 大學 | PD-old×1（`禮記/大學`） |
| 中庸 | PD-old×1（`禮記/中庸`） |
| 尚書 | PD-old×26 |
| 禮記 | PD-old×48 |
| 老子 | 曹魏作品×1 |
| 荀子 | PD-old×11 |
| 墨子 | pd-old×34 |

**无授权标签、适用站点默认的 7 部**：詩經、周易、莊子、韓非子、管子、列子、孫子兵法。
站点默认即 `manifest.json` 的 `source.license.siteDefault`（构建时由 `siteinfo` 接口
**实时取回**，未作人工改写）：`Creative Commons Attribution-Share Alike 4.0`。
这 7 部若要严格限 PD，需自行核对底本，或改用挂有 PD 标签的版本页。

- **署名**：逐篇记录 `sourcePage` + `sourceRevid`（具体修订号），可据此回溯与署名。
- 另外，**本构建自身也做了修改与编选**：删除站点模板与注文、重新分段、选定版本
  （老子取王弼本、大學/中庸取《禮記》篇）、异文取首读、排除六笙诗与〈答話〉。
  这些决定记录在 `textEdition`、`extraction`、`limitations` 中，不藏在流程里。

## 目录结构

```
data/corpus/
  manifest.json          总清单：来源、授权（实时取回）、逐部 sha256、计数、限制、non-claims
  works/<id>.json        每部一个文件（16 部，共约 3.4 MB）
  .cache/wikisource/     原始 wikitext 与前缀列表磁盘缓存（构建产物，可删；重跑会自动重取）
tools/corpus/
  works.config.mjs       16 部定义：篇目发现路由、排除规则、版本说明
  lib/client.mjs         Wikisource API 客户端：合规 UA、重试退避、磁盘缓存、固定 revid
  lib/discover.mjs       篇目发现（五条路由）
  lib/wikitext.mjs       wikitext → 正文清洗与分段
  lib/ctext.mjs          CTP 官方 API 客户端（订阅制，无凭据即拒绝）
  build.mjs              构建 data/corpus
  validate.mjs           格式与完整性校验
  check-fixtures.mjs     内容夹具校验（正向保留 / 反向剔除）
  smoke-pipeline.mjs     与项目自身 TypeScript 的集成检查
  fetch-ctext.mjs        CTP 接入层 CLI（--check / --probe / build）
```

## 格式

### `manifest.json`

| 字段 | 含义 |
|---|---|
| `schema` / `format` | `"wenyan.corpus.manifest.v1"` / `"wenyan.corpus.v1"` |
| `generatedAt` | 构建时间（ISO 8601） |
| `source.license.siteDefault` | **实时取回**的站点默认授权（见上节） |
| `source.license.classicsArePublicDomain` | 明确记录原典公有领域这一事实 |
| `source.ctextNotice` | 记录 ctext.org 未被使用及其原因 |
| `counts` | 部/篇/段/字 总数 |
| `works[]` | 每部：`id`、`zh`、`en`、`tradition`、`file`、`sha256`、`counts`、`discoveryRoute`、**`licenseTemplates`/`licenseStatus`**、`limitations` |
| `nonclaims` / `limitations` | 明确的非声称与限制 |

### `works/<id>.json`

| 字段 | 含义 |
|---|---|
| `schema` | `"wenyan.corpus.work.v1"` |
| `id` / `title{zh,en}` / `tradition` | `tradition` ∈ `confucian` \| `philosophers` |
| `textEdition` | 有版本歧义时记录所选版本（如「王弼本（页面另附王弼注）」） |
| `source.discovery` | 发现路由与依据；另含 `chainStopReason`、`chainSubstitutions`、`chainExcluded` |
| `counts` | 该部的篇/段/字计数 |
| `extraction.removed` | **被删除内容的分类计数**（见下表） |
| `extraction.droppedSubsections` | 被整节排除的小节（如 `孫子兵法#答話`、`詩經#毛詩序`） |
| `extraction.droppedFrontMatter` | 被排除的卷首题记（如老子页的「華亭張氏原本／晉王弼注」） |
| `extraction.droppedLines` | 被按行模式排除的行数（毛詩序、章句注） |
| `extraction.skippedNoText` | 无正文而未收的页（六笙詩） |
| `sections[]` | `id`、`ordinal`、`title`、`sourcePage`、`sourceRevid`、`sourcePages[]`、`passages[]` |
| `passages[]` | `id`（`篇.段`）、`sourceAnchor`（可选）、`text` |

约定：

- `text` **保留换行**（诗句分行不丢）；项目自身的 `normalizeInscriptionText` 视文本为
  空白不敏感，故对其无损。
- `sourceRevid` 固定到**具体修订号**，页面日后被编辑仍可核对。
- `sourceAnchor` 是维基自带的句锚点（《論語》的 `一之一` 等）。它不属经文，已从 `text`
  提出存入该字段，全集共 501 个。
- 计数按 **Unicode 码位**（`[...text].length`），非 UTF-16 单元。

## 清洗做了什么

`lib/wikitext.mjs` 是针对本项目实际体例的**窄用途**清洗器，不是通用 MediaWiki 解析器。
所有删除都有计数；所有保留都有理由。

| 处理 | 计数键 |
|---|---|
| 站点模板（`header*`/`footer`/`Textquality`/`PD-old`/导航框/`reflist`…） | `templates` |
| 夹注 `{{*|…}}`（《荀子》后人注、《老子》王弼注等） | `annotations` |
| **内容型模板**（首参即正文，**保留**） | `contentTemplates` |
| 未识字符 `{{？\|IDS}}`（保留 IDS 描述以标记阙文） | `uncertainGlyphs` |
| `<ref>…</ref>` 脚注（**连内容一并删除**） | `refFootnotes` |
| `<onlyinclude>` 界定正文区 | — |
| HTML（`<poem>`/`<div>`/`<span>`/`<u>`/`<templatestyles/>`…） | `htmlTags` |
| 文件/分类链接；外链 | `files` / `externalLinks` |
| 语言转换标记（`-{T\|…}-` 删除；`-{乾}-` → `乾`） | `conversionMarkers` |
| 站内句锚点（提出为 `sourceAnchor`） | `anchorsLifted` |
| 行首 `:` `*` `#` `;`（列表/诗句层级**被摊平**）；各级 `=` 标题行 | — |

### 内容型模板白名单（关键）

**不能一律删除模板**：`采采芣{{另|苢|苡}}` 若整块删除会变成 `采采芣`，即**静默删字**。
每个条目都经实际用法核对后加入白名单，**只保留首参**（次数为缓存原始页面中的实测出现数）：

| 模板 | 实例 | 结果 | 原页面出现次数 |
|---|---|---|---|
| `另` / `另2` | `{{另\|耄\|眊、旄}}` | `耄` | 343 |
| `參` / `参` | `{{參\|來格汝說\|有學者…}}` | `來格汝說` | 92 |
| `ProperNoun` | `{{ProperNoun\|帝堯}}` | `帝堯` | 146 |
| `!` / `僻字` | `{{!\|𱯇\|⿰王叕}}` | `𱯇` | 19 |
| `+` / `-` | `{{+\|國風‧邶}}` | `國風‧邶` | 3 |
| `ruby` | `{{ruby\|杕\|dì}}` | `杕` | 1 |
| `？` | `{{？\|⿰耒殳}}` | `⿰耒殳`（阙文标记，另计） | 8 |

嵌套参数会被递归清洗；未识别的模板一律按元数据删除。各部的
`extraction.removed.contentTemplates`（全集 590）计数的是**实际参与清洗**的个数，低于上表
顶层出现数之和，因为位于 `header*` 等元数据模板内部的那些会随外层一并丢弃、不被单独计数。

### 结构性标记：从正文移出，但不丢弃

语料里有**非正文**的短标记，它们是结构记号而不是文本。识别规则**按形式声明，绝不按长度**：

| 规则 | 形式 | 移出数 | 例 |
|---|---|---:|---|
| `right-colophon` | `^右[^\n]{0,8}$` | **50** | 管子 `右國頌`、`右四維`、`右四順`；韓非子 `右經` |
| `numbered-heading` | `^[^\n]{1,4}[一二三四五六七八九十]$` | **12** | 韓非子/內儲說 `參觀一`、`必罰二`、`權借一` |
| `heading-after-numbered` | `^[^\n]{2,4}$` 且**紧接**以 `N。` 起首的段落 | **8** | 韓非子/八經 `因情`、`主道`、`起亂` |

「右」即「以上为」，是篇末题记；`因情` 这类则夹在「一。凡治天下…」与「二。力不敵衆…」之间，
是该经的名称。三者都**从正文段落中移出**，但**完整保留**在 `extraction.structuralMarkers`
（含原文、所在小节、来源页与判定理由），所以信息没有丢失，只是换了位置。合计 **70 段**：
韓非子 22、管子 48。

**为什么不能用长度做判据。** 老子有 **21 段 ≤4 字**，全是**真经文**——源站按自己的换行把
经文在逗号处切断：

```
生之，/ 畜之。        知常容，/ 容乃公，/ 公乃全，/ 全乃天，
曲則全，/ 枉則直，    用其光，/ 朝甚除，/ 解其分，/ 和其光，
```

**按长度过滤会删掉这些经文。** 我是在实施前逐条查看才发现的，这条教训写在 `build.mjs`
的规则注释里。

由此还留了一类**只标记、不删除**的段落：墨子/經說上的 `'卧。'`、`'夢。'`（2 字，疑为残缺
转录，前后是 `'生，楹之生，商不可必也。'` 与 `'平，惔然。'`）。我无法确定它们非正文，
所以**只登记待审**，记于 `extraction.flaggedShortPassages`，共 **23 条**（老子 21、墨子 2）。
宁可让人看一眼，也不静默删除。

### 引用以文本为准，不以位置编号为准

段落 id（如 `30.38`）是**位置编号**：任何段落增减都会让其后的编号整体前移。而**判断的对象
是文本，不是位置号**。这一点在首次重建后被真实触发——韓非子移出 22 段后，一条语料证据记录
被报为「passage text changed」。

因此 `verifySources()` 改为**以文本匹配**，id 只作定位线索：若被标注的文本仍在原作品中，
标注仍然成立，编号移动被报为**移动**而非失效；只有**文本本身消失**才算真漂移。修复后实测
**29/29 可回查、1 处编号移动、0 处真漂移**。

### 标题存在性：先解析变体，再判缺失

`client.exists()` 用三件事判定一个标题是否存在，缺一不可：

1. **按调用方传入的标题回报**，不按 API 回显的标题。`redirects=0` 在实测中**并未阻止**跟随
   重定向（响应仍带 `query.redirects`），于是唐詩三百首的 320 首里有 25 首被当成不存在
   （`長干行之一` 回显为 `長干曲 (君家何處住)`），而 `missing` 却是空的——静默丢掉选集 8%。
   现改为经 API 自身的 `normalized` / `redirects` 映射解析。
2. **简繁变体**：`converttitles=1` 有效，`variant=zh-hant` 无效（实测 5/8 对 0/8）。
   子部清单 668 条因此从「533 存在／135 缺失」纠正为「**551 存在／117 缺失**」，
   救回 18 部。转换是**双向**的（`韓擒虎話本 → 韩擒虎话本`），故不可假设站上一律繁体。
   映射记于返回值的 `variantResolved`，供清单如实区分「变体救回」与「确实缺失」。
3. **不可把缺失一律当红链**：子部那 117 条里混着索引页、后人辑录与 20 世纪作品，
   逐条分类见 `knowledge/corpus-expansion/zibu-feasibility.md` §1.2。

### 安全性

- 模板剥离使用真正的括号配对扫描器。未配对的 `{{` **绝不删除其后文本**，只丢两个括号字符
  并计入 `unbalancedTemplates`。早期版本用「删除到字符串结尾」，实测静默吞掉《論語》3 段，
  已修复并有回归夹具。
- 内容型模板白名单避免了上面那类删字；`check-fixtures.mjs` 对两类失败都设了断言。

## 构建与校验

```sh
node tools/corpus/build.mjs                  # 全量构建（可中断，重跑自动续传）
node tools/corpus/build.mjs --only liezi     # 只构建某几部
node tools/corpus/build.mjs --refresh        # 忽略缓存重取
node tools/corpus/validate.mjs               # 格式/计数/哈希/残留标记（错误→非零退出）
node tools/corpus/validate.mjs --strict      # 连同限制告警一并视为失败
node tools/corpus/check-fixtures.mjs         # 内容夹具：应保留的仍在、应剔除的已无
node tools/corpus/smoke-pipeline.mjs         # 项目自身代码能否读取语料
```

需 Node 22+（用全局 `fetch`），**无第三方依赖**。

当前状态：`validate` 无格式错误；`check-fixtures` 39/39 通过；`smoke-pipeline` 抽样 300 段
0 异常。

## 逐部来源与版本

| 部 | 篇 | 段 | 字 | 出处 | 路由 | 版本/说明 |
|---|---:|---:|---:|---|---|---|
| 論語 | 20 | 507 | 21779 | `論語/全覽` | index | 二十篇正序；501 个句锚点存于 `sourceAnchor` |
| 孟子 | 14 | 742 | 44974 | `孟子/全覽` | index | 十四篇正序 |
| 大學 | 1 | 11 | 2209 | `禮記/大學` | single | 「大學」为版本页，取《禮記》篇（未分經傳） |
| 中庸 | 1 | 34 | 4522 | `禮記/中庸` | single | 「中庸」为版本页，取《禮記》篇（未分經傳） |
| 詩經 | 305 | 663 | 38242 | `詩經/關雎` 起 next 链 | nextChain | 305 篇；毛詩序/章句注/三家詩說/註解已排除；`===詩文===` 为正文故保留；六笙詩有目無辭，未收 |
| 尚書 | 68 | 412 | 39271 | `尚書` 主页面目录 | mainPageLinks | 今文/伪古文/清华简并存，**未做真伪取舍**；`<ref>` 脚注已删 |
| 周易 | 64 | 324 | 19863 | `周易/乾` 起 next 链 | nextChain | 第32卦站上作「恒」而非「恆」，需 `nextFix` 否则链断；清单层级已摊平 |
| 禮記 | 49 | 1332 | 123056 | `禮記` 主页面目录 | mainPageLinks | 通行四十九篇；异本（證釋本）不收 |
| 老子 | 81 | 434 | 7052 | `道德經 (王弼本)` | single | 王弼本；王弼注、音義附录、卷首题记均已剔除 |
| 莊子 | 33 | 903 | 80075 | `莊子/逍遙遊` 起 next 链 | nextChain | 三十三篇（內七、外十五、雜十一） |
| 荀子 | 32 | 481 | 90763 | `荀子/勸學篇` 起 next 链 | nextChain | 夹注已剔除；链在离开作品前缀处停止，避免收入卷末书目页 |
| 韓非子 | 55 | 744 | 128553 | 卷页 `韓非子/01` 起的嵌入目录 | containerChain | 卷页仅为目录，正文取自各篇页 |
| 墨子 | 53 | 650 | 91830 | `墨子/全覽` | index | 五十三篇正序 |
| 管子 | 80 | 688 | 169106 | `管子/` 前缀 | allpages | 取零填充「第NN篇」故 wiki 排序即篇序；两组异体重复页（權修/權脩、國準/國准）取通行字形 |
| 列子 | 8 | 139 | 37948 | `列子/天瑞篇` 起 next 链 | nextChain | 八篇 |
| 孫子兵法 | 13 | 74 | 7435 | `孫子兵法` 单页 | single | 〈答話〉属《吳越春秋》系统佚文，非十三篇本文，已排除 |

## 限制与不声称

- **不是校勘本**：未比对简帛、无异文校记、无版本对校。异文模板只取维基页面标注的**首读**，
  另一读被丢弃（`{{另|A|B}}` → `A`），丢弃数量记于 `contentTemplates`。
- **未与印刷本或 ctext.org 核对**。
- 标点与分段沿袭维基页面，非学术整理本的标点。
- 未分词、未标注词性或训释。
- 《尚書》未做今文/伪古文/清华简的真伪取舍，照录站上篇目。
- 《管子》篇序依赖站上零填充命名；该部 `discoveryRoute` 为 `allpages`，其顺序限制已显式记录。
- 阙文以 IDS 描述出现（如 `⿰耒殳`），非原字；数量记于 `uncertainGlyphs`。
- 篇数与预期不符时**只标注、不擅改**，逐部记录于 `limitations`（当前 16 部篇数均与预期一致，
  《管子》《尚書》无预设篇数）。
- 《周易》等处以清单标记分层的结构**已摊平**，层级信息不保留。
