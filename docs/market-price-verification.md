# 交付验收记录（2026-10-11）

## 交付位置

- Repository：`https://github.com/Zz238/AIHOT`，用户账户下的 Fork；上游 `KKKKhazix/AIHOT` 没有推送或合并。
- Branch：`feat/market-price-backend`，没有修改 main/master。
- Base Commit：`931a4eb5edf344b12b9e65f0d039f7c52a2e0792`。
- 本次功能验证对应代码提交：`7d00513`；文档提交之后的 Latest Commit 以 `git rev-parse HEAD` 为准。草稿 PR：[Zz238/AIHOT #1](https://github.com/Zz238/AIHOT/pull/1)，目标为 Fork 的 `main`，尚未合并。
- 本地代码：`E:/市场价/AIHOT-backend`；运行页面 `http://localhost:3000/admin/market/overview`。
- 原 Taro 目录的未提交修改仍保留，没有为本次后台开发覆盖、暂存或提交它们。

## 已实现功能和修改范围

独立 Market Price 模块：JSON、HTML、RSS 和受鉴权的外部推送；规则/AI 证据提取；标准商品及规格、单位和日期校验；去重和原文修订；管理员审核、纠正与撤销；样本约束的每日聚合；7/30/90 天历史和六个小程序公开接口；客观简报；五个持久队列、有限重试、任务批次结果、失败/恢复告警；六类真实后台页面；经过服务端认证回调的用户上报适配器。

修改集中在 `modules/market-price/**`，以及模块注册、工作区依赖/锁文件、Docker manifest、Compose Setup、`.env.example`、`site/site.ts` 的业务名称和 `docs/market-price-*.md`。原新闻表、采集类型、评分流程、历史迁移和原有失败测试不变。没有用删测试、跳过或放宽断言制造通过。

## 执行环境与结果

Windows、Node 24.19、npm 11.17、隔离 PostgreSQL 17.9（本地 55432）。数据库测试使用一次性 `_test` 模板及逐文件副本；运行库使用独立 `market_dev`。开发时外部采集、模型总开关和通知全部关闭。网络/模型测试仅请求本地 HTTP fixtures 和接口替身。

| 检查 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 通过；最后导航修复后再执行 Web 类型检查也通过 |
| `npm run build -w @aihot/web` | 通过；导航修复后重新构建 Client 与 SSR |
| 市场模块 + 原架构检查 | **36/36 通过：市场 28 项，架构 8 项** |
| `npm test` 完整回归 | **未通过**；最后一轮 769 项，752 通过、12 失败、5 取消/超时，0 跳过 |
| `node --test apps/web/tests/*.test.ts` | **未通过**；50 项，32 通过、18 失败，缺 Playwright 浏览器可执行文件 |
| `node scripts/smoke.ts --base http://localhost:3000` | **30/30 通过**；最新服务重启后再次通过 |
| 新模块数据库迁移 | 通过；隔离空库执行全部 77 文件，18 个市场迁移已实际执行 |
| 运行中市场 API 与后台 | 六个公开 GET、六个后台页面、非法日期 400、无 Token 推送 401 均已验证 |
| 前端导航数据请求 | `.data?_routes=market-admin` 与带地区/类型/日期参数的请求均为 200 |
| 本地运行库真实性 | observations/daily_prices/briefs/enabled_sources 均为 0；没有写入假行情 |
| Docker 构建/Compose 运行 | **未验证**；本机没有 Docker/WSL，不将本地 Node 运行当 Docker 成功 |

市场与架构的实际命令（测试数据库连接通过环境传入，不能指向生产库）：

```sh
node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-reporter=tap --test-timeout=120000 "modules/market-price/tests/*.test.ts" tests/architecture.test.ts
```

完整回归执行过 `npm test`，最后保存结果的命令与 package.json 脚本相同，增加 TAP reporter 便于记录：

```sh
node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-concurrency=6 --test-timeout=120000 --test-reporter=tap "tests/*.test.ts" "modules/*/tests/*.test.ts"
```

本地原始执行记录保留于 `.git/market-final.log`、`.git/final-regression.log`、`.git/web-tests.log` 及对应结果文件，不提交缓存或环境内容。以上数字是执行器最终汇总；父测试文件失败和子测试不是按错误行数重复计算。

## 必需场景对应证据

| 验收场景 | 测试/运行证据 |
| --- | --- |
| JSON 与 HTML 解析 | `parsing.standalone.test.ts` 固定字段映射及表格 |
| 中文价格、分段日期、无价文章 | parsing + pipeline，保留原文证据，歧义不强行拆价 |
| 别名和不同番茄规格 | parsing + pipeline，标准 ID 隔离 |
| 公斤转斤、无重量包装拒绝 | parsing + 单位审核测试 |
| 重复采集/同 URL 不同日期 | pipeline 的身份、不可变修订及幂等批次 |
| 历史不当今天/批发零售隔离 | parsing + publication HTTP 测试 |
| 低样本不造区间/异常待审 | statistics + pipeline |
| 审核更正/撤回/撤销立即重算 | pipeline 与审计、版本冲突测试 |
| 未授权推送、CSRF、大小和限流 | security + 真实 HTTP 与真实管理员会话测试 |
| 有限队列重试、整批重放 | queues，真实 PostgreSQL pg-boss 和任务批次结果 |
| 模型失败不发布、重复回执 | pipeline，本地模型替身；重复提取只请求一次 |
| 7/30/90 天历史 | publication/pipeline；浏览器实际执行 30 天查询 |
| RSS 正文补抓及原能力复用 | queues，同源本地 RSS/HTML fixtures、robots 和 SSRF 防护 |
| 原新闻能力 | 原运行 smoke 30 项通过，完整原回归大量通过但存在下述失败，不能宣称全量回归通过 |

后台通过实际浏览器验证：总览、商品字典、采集记录/审核空状态、信源保存与离线预览、发布 API 预览、从侧栏进入发布页、普通番茄 30 天历史无数据提示。离线预览使用历史固定样本但没有入库。运行库保留一条名称明确为“离线解析验证（停用）”的测试信源，未启用、未访问其外部 URL。

浏览器发现并修复了原本的导航错误：内部 `_routes` 被转发到严格价格查询 Schema。Web loader 现在只移除框架 `_routes/index`，业务参数仍由 API 严格校验；刷新和客户端跳转均实际复验通过。

## 失败与复测

1. 完整回归中的 8 个 `backup.test.ts` 用例失败：其中 6 个为 `spawn pg_dump ENOENT`，2 个打包重试用例为 `spawn sh ENOENT`。当前测试进程找不到 PostgreSQL 备份工具和 POSIX shell，不是数据库密码或对象存储密钥错误；对象存储由本地替身接收。未修改备份实现或测试，**真实备份恢复仍未验收**。
2. 网络相关的 3 项失败需要分开说明：`outbound-headers.standalone.test.ts` 的 direct/proxy 两项输出 Windows Node/libuv 断言 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`，进程退出码 3221226505；`outbound-protocol.standalone.test.ts` 则在文件初始化时 `spawn openssl ENOENT`，尚未进入其四个协议子用例。OpenSSL 用于生成本地临时测试证书，不需要生产 HTTPS 证书或私钥。进程崩溃的具体根因尚未通过基线及 Linux 对比确认，不报告成已确定的上游缺陷。
3. `timeline-day-counts.test.ts` 在完整并发运行中，测试初始化报临时数据库 `market_final_test_f39356_test` 已存在（42P04）。单独运行同一原测试文件，**3/3 通过**；完整那一轮的失败数保持原值，不据此改称全套通过。
4. 分析退出 3 项和翻译退出 2 项 SIGTERM 测试超过 120 秒，执行器标为 cancelled。当前判断与 Windows 信号/进程语义有关，但没有 Linux 复验，不作为已确定根因。
5. Web 浏览器类测试的 18 项在启动/前置阶段失败，日志为 `Executable doesn't exist ... ms-playwright/chromium-1228/chrome-win64/chrome.exe` 等。尝试安装 Chromium/WebKit 后下载极慢，未完成；系统浏览器和实际页面验证不能替代这些原测试。32 个不依赖缺失浏览器的用例通过。

2026-10-12 重新逐项核对原日志，修正了此前把备份失败全部概括为 pg_dump、把协议与响应头测试合并为进程崩溃的归类。完整回归的 12 项为：6 个 pg_dump 缺失 + 2 个 sh 缺失 + 2 个响应头测试进程崩溃 + 1 个 openssl 缺失的协议测试文件 + 1 个测试数据库重名。5 项超时与 18 项网页测试失败另外计数。以上都不依赖真实价格信源或付费模型 Key。

后续应在原 Linux CI 或具备 PostgreSQL 17 客户端、POSIX shell、Playwright Chromium/WebKit 的环境重跑原命令。保留原 GitHub workflow，没有削减其 typecheck、浏览器、完整测试、Docker 和 smoke 检查。最终报告单独给出 PR/CI 状态，未跑完或没有启动都不能算通过。

PR 创建后实际核对：Fork 的 main 仍为上述基线，`.github/workflows/check.yml` 存在；GitHub Actions API 返回空工作流和运行列表，按文件名查询及手动 dispatch 都返回 404。因此本次没有获得远端 Linux/Docker 检查结果。没有修改主分支或合并 PR 来触发执行，也没有据此宣称 Docker 验证通过。

## 未验证和已知限制

- 真实公开报价源、授权、生产模型服务及预算、真实告警发送、真实微信登录会话尚未接入；用户上报交付的是可验证适配层，不是已部署的微信身份系统。
- Docker 构建、生产迁移、备份恢复、公网代理/限流、生产部署均未完成。
- JS 动态表格不支持；RSS 正文默认不追抓、可选同源最多 10 篇；转载缺稳定共同记录 ID 时不跨 URL 猜测合并。
- 历史样本不显示为今日报价；零数据时用户只能看到明确无数据状态，不提供演示价作为运行行情。
- 统计是已核验样本的参考，不代表全市总体抽样。价格类型固定五项；限流进程内生效；原文投影清理不等于彻底删除修订证据。
- 原公开新闻能力保留，后台以菜价雷达命名；无需求授权的前台新闻大规模改造没有执行。

启动、开关、真实信源配置、日志、非破坏回滚及备份步骤见 [部署说明](market-price-deployment.md)。技术规则见 [架构说明](market-price-architecture.md)，小程序对接字段见 [API 文档](market-price-api.md)。
