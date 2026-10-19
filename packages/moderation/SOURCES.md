# 敏感词库来源

## 选型（2026-10-19）

| 仓库                                                                                  | 许可证（GitHub API + LICENSE 文件核实） | 结论                                                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| [konsheng/Sensitive-lexicon](https://github.com/konsheng/Sensitive-lexicon)           | MIT                                     | **采用**：分类清晰（Vocabulary/ 下按色情、暴恐、政治等分文件），持续维护 |
| [fwwdn/sensitive-stop-words](https://github.com/fwwdn/sensitive-stop-words)           | Apache-2.0                              | 可用，但 5 个分类文件与上者的同名经典文件基本重合，大头是网址；未采用    |
| [houbb/sensitive-word](https://github.com/houbb/sensitive-word) / sensitive-word-data | Apache-2.0                              | Java 库，词库与上述来源大量重叠；未采用                                  |
| [toolgood/ToolGood.Words](https://github.com/toolgood/ToolGood.Words)                 | Apache-2.0                              | 主要是算法库，不以词库为主；未采用                                       |
| observerss/textfilter、jkiss/sensitive-words、57ing/Sensitive-word                    | 无许可证                                | 排除（没有许可证不能用）                                                 |
| cjh0613/tencent-sensitive-words                                                       | AGPL-3.0                                | 排除（不适合闭源商用）                                                   |

## 采用的文件

来源：`https://codeload.github.com/konsheng/Sensitive-lexicon/tar.gz/refs/heads/main`（main 分支，最后推送 2026-08-17），获取日期 2026-10-19。
许可：MIT，原文见 `LICENSE-THIRD-PARTY`。

| 分类 id    | 默认启用 | 源文件                                       | 原始行数 | 清洗后 |
| ---------- | -------- | -------------------------------------------- | -------- | ------ |
| porn       | 是       | 色情类型.txt、色情词库.txt                   | 1233     | 478    |
| violence   | 是       | 暴恐词库.txt、涉枪涉爆.txt                   | 615      | 577    |
| politics   | 是       | 政治类型.txt、反动词库.txt                   | 883      | 750    |
| corruption | 是       | 贪腐词库.txt                                 | 244      | 161    |
| other      | 是       | 补充词库.txt、其他词库.txt、COVID-19词库.txt | 1298     | 1063   |
| ad         | 否       | 广告类型.txt                                 | 123      | 95     |
| livelihood | 否       | 民生词库.txt                                 | 571      | 313    |

默认启用 3029 条（按归一化后去重约 3026 词），全部 3437 条（见 `data/STATS.json`）。

**未采用**的文件：`零时-Tencent.txt`、`网易前端过滤敏感词库.txt`（看起来来自企业内部列表，来源不清，虽然仓库整体声明为 MIT，仍然排除）、`GFW补充词库.txt`（6000+ 条，噪声大）、`非法网址.txt`（网址列表）、`新思想启蒙.txt`。

## 清洗（`scripts/build-words.py`，用 `python3 -I` 运行，脚本放在下载目录之外）

- NFKC + 小写；去首尾空白；去掉含分隔符或控制字符的行；
- 长度：中文 2–20 字，纯 ASCII 3–20 字；去掉纯数字；
- 去掉放在正文里会大量误伤的常用词（如 北京、高潮、网络、拦截器、youtube、www、taiwan，完整列表见脚本里的 `COMMON` / `COMMON_ASCII`）；
- 跨分类去重（按上表顺序，先出现的分类优先）。

在本机约 46 万字的中文文档（辰记各仓库的 README 和文档）上扫描，默认词库命中 0 次。

产出：`data/<分类>.txt`（每行一词，便于审阅）和 `src/words.generated.ts`（内联到包里，运行时零依赖）。
