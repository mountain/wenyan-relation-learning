/**
 * Work definitions for the wenyan.corpus.v1 core set.
 *
 * Chapter discovery is deliberately source-derived rather than hard-coded, so
 * every section traces back to a Wikisource page. Routes (see lib/discover.mjs):
 *
 *   index           an index page ("全覽"): `==篇名==` + `{{:Work/篇名}}` pairs.
 *                   Canonical order and exact page names.
 *   nextChain       follow the header template's `next=` link from a start page.
 *                   Canonical order. `startPage` must be the work's first chapter.
 *   mainPageLinks   `[[Work/...]]` links on the main page, document order.
 *   containerChain  walk the 卷 container chain; each container lists its 篇 as
 *                   `{{:Work/篇}}` transclusions. Canonical order, real text from
 *                   the leaf pages.
 *   allpages        enumerate the `<work>/` prefix. Order is the wiki's sort
 *                   order, which is canonical ONLY where names are zero-padded
 *                   (管子/第NN篇…). Reported as a limitation otherwise.
 *   single          the whole work lives on one page, split at `==` headings.
 *
 * `textEdition` records which recension a chosen page represents: several titles
 * (老子, 大學, 中庸, 孫子) are `{{versions}}` disambiguation pages, so an explicit
 * edition had to be picked rather than accepting the ambiguous title.
 */
export const WORKS = [
  // ---------------- 儒家 ----------------
  {
    id: 'analects',
    zh: '論語',
    en: 'Analects',
    tradition: 'confucian',
    discovery: { kind: 'index', index: '論語/全覽' },
    expectedChapters: 20,
  },
  {
    id: 'mencius',
    zh: '孟子',
    en: 'Mencius',
    tradition: 'confucian',
    discovery: { kind: 'index', index: '孟子/全覽' },
    expectedChapters: 14,
  },
  {
    id: 'great-learning',
    zh: '大學',
    en: 'The Great Learning',
    tradition: 'confucian',
    discovery: { kind: 'single', page: '禮記/大學' },
    textEdition: '《禮記》第四十二篇（未分經傳）',
    note: '「大學」在站上是 {{versions}} 版本頁，正文取《禮記》該篇。',
  },
  {
    id: 'doctrine-of-the-mean',
    zh: '中庸',
    en: 'The Doctrine of the Mean',
    tradition: 'confucian',
    discovery: { kind: 'single', page: '禮記/中庸' },
    textEdition: '《禮記》第三十一篇（未分經傳）',
    note: '「中庸」在站上是 {{versions}} 版本頁，正文取《禮記》該篇。',
  },
  {
    id: 'classic-of-poetry',
    zh: '詩經',
    en: 'Classic of Poetry',
    tradition: 'confucian',
    discovery: { kind: 'nextChain', startPage: '詩經/關雎' },
    expectedChapters: 305,
    // 註解/毛詩序/三家詩說 are editorial apparatus, not the 305 篇 text.
    // `詩文` is deliberately NOT dropped: it holds the poem itself.
    dropSections: ['註釋', '註解', '毛詩序', '齊詩說', '齐诗说', '魯詩說', '鲁诗说', '韓詩說', '韩诗说'],
    // 毛詩序 lines appear either as a `===毛詩序===` section or as a bare line;
    // the 章句 note is the same class of apparatus and has two attested forms:
    //   《螽斯》，三章，章四句。        《載馳》五章：一章六句，二章四句，…
    dropLinePatterns: [/^毛詩序/, /^《[^》]{1,12}》.{0,40}章.{0,30}句[。]?$/],
    // 六笙詩 have a title but no text: the pages carry only 毛詩序 and 有其義而亡其辭.
    exclude: [/^詩經\/南陔$/, /^詩經\/華黍$/, /^詩經\/由庚$/, /^詩經\/崇丘$/, /^詩經\/由儀$/,
      /^詩經\/白華 \(鹿鳴之什\)$/],
    note: '收三百零五篇本文。毛詩序、章句注、三家詩說、註解均屬後人編輯材料，已排除；===詩文=== 小節為詩篇正文本身，保留。六笙詩（南陔、白華、華黍、由庚、崇丘、由儀）有目無辭，站上僅存毛詩序與「有其義而亡其辭」，無本文可收，故不收錄並記於 exclude。',
  },
  {
    id: 'book-of-documents',
    zh: '尚書',
    en: 'Book of Documents',
    tradition: 'confucian',
    discovery: { kind: 'mainPageLinks', mainPage: '尚書' },
    exclude: [/書序$/, /^尚書\/丹朱/, /全覽/, /^尚書\/[《「]/],
    note: '尚書來源複雜：今文、偽古文與清華簡並存；本語料照錄站上篇目，未做真偽取捨。',
  },
  {
    id: 'zhouyi',
    zh: '周易',
    en: 'Zhouyi (I Ching)',
    tradition: 'confucian',
    discovery: { kind: 'nextChain', startPage: '周易/乾' },
    expectedChapters: 64,
    // The 32nd hexagram has no 周易/恆 page; the chain breaks there without this.
    nextFix: { '周易/恆': '周易/恒' },
    exclude: [/^周易\/[序附雜]/],
    note: '卦頁以清單標記分層（易經／彖／象），清洗時攤平為段落，層級資訊不保留。第32卦站上作「恒」而非「恆」，若無 nextFix 鏈會在此中斷。',
  },
  {
    id: 'book-of-rites',
    zh: '禮記',
    en: 'Book of Rites',
    tradition: 'confucian',
    discovery: { kind: 'mainPageLinks', mainPage: '禮記' },
    expectedChapters: 49,
    exclude: [/證釋本/, /目錄/, /\(/, /（/],
    note: '收通行四十九篇；異本（如證釋本）與目錄頁不收。',
  },
  // ---------------- 諸子 ----------------
  {
    id: 'laozi',
    zh: '老子',
    en: 'Laozi (Daodejing)',
    tradition: 'philosophers',
    discovery: { kind: 'single', page: '道德經 (王弼本)' },
    textEdition: '王弼本（頁面另附王弼注）',
    dropAnnotation: true,
    excludeSections: ['老子道經音義', '老子德經音義'],
    note: '「老子」與「道德經」皆為版本頁；取王弼本。站上經文與王弼注逐句交錯，注文已剔除，僅留經文。頁末〈道經音義〉〈德經音義〉為音義附錄，卷首題記（華亭張氏原本／晉王弼注）為版本題記，均非經文，已排除。',
  },
  {
    id: 'zhuangzi',
    zh: '莊子',
    en: 'Zhuangzi',
    tradition: 'philosophers',
    discovery: { kind: 'nextChain', startPage: '莊子/逍遙遊' },
    expectedChapters: 33,
    exclude: [/全覽/],
    note: '三十三篇（內七、外十五、雜十一）依站上 next 鏈正序排列。',
  },
  {
    id: 'xunzi',
    zh: '荀子',
    en: 'Xunzi',
    tradition: 'philosophers',
    discovery: { kind: 'nextChain', startPage: '荀子/勸學篇' },
    expectedChapters: 32,
    exclude: [/荀子序/, /全覽/],
    dropAnnotation: true,
    note: '站上正文夾註（{{*|…}}）為後人注解，已剔除，僅留本文。',
  },
  {
    id: 'hanfeizi',
    zh: '韓非子',
    en: 'Han Feizi',
    tradition: 'philosophers',
    discovery: { kind: 'containerChain', startPage: '韓非子/01' },
    expectedChapters: 55,
    note: '站上卷頁（韓非子/01…）僅為模板嵌入目錄；本語料依卷頁順序取各篇頁正文，卷頁不重複收錄。',
  },
  {
    id: 'mozi',
    zh: '墨子',
    en: 'Mozi',
    tradition: 'philosophers',
    discovery: { kind: 'index', index: '墨子/全覽' },
    expectedChapters: 53,
  },
  {
    id: 'guanzi',
    zh: '管子',
    en: 'Guanzi',
    tradition: 'philosophers',
    discovery: { kind: 'allpages', prefix: '管子/' },
    preferPattern: /^管子\/第\d+篇/,
    exclude: [/^管子\/七法\//, /全覽/, /^管子\/第03篇權脩$/, /^管子\/第79篇國准$/],
    note: '站上並存兩套命名（管子/第01篇牧民 與 管子/牧民）；取零填充的「第NN篇」命名，故 wiki 排序即篇序，並避免重複收錄。另有兩組異體字重複頁（權修／權脩、國準／國准），取通行字形（修、準），異體頁不收。',
  },
  {
    id: 'liezi',
    zh: '列子',
    en: 'Liezi',
    tradition: 'philosophers',
    discovery: { kind: 'nextChain', startPage: '列子/天瑞篇' },
    expectedChapters: 8,
    note: '八篇全收，依站上 next 鏈正序排列。',
  },
  {
    id: 'sunzi',
    zh: '孫子兵法',
    en: 'The Art of War',
    tradition: 'philosophers',
    discovery: { kind: 'single', page: '孫子兵法' },
    expectedChapters: 13,
    excludeSections: ['答話'],
    textEdition: '通行十三篇本',
    note: '「孫子」為重定向；正文取《孫子兵法》單頁，按 == 篇名 == 標題分章。站上另附〈答話〉一節，屬《吳越春秋》系統的問答佚文、非十三篇本文，已排除。',
  },
];
