# 菜价雷达部署与运维

代码已在 Node 24.19、PostgreSQL 17.9、Windows 隔离本地库运行，API/Worker/Web 均已启动。本次没有生产部署、真实外部价格采集、付费模型调用或外发告警。Docker CLI 和 WSL 在此机器不可用，因此 **Docker 构建/Compose 启动尚未实测**；以下是与现有 Compose 集成后的部署步骤，不能视为已验收的镜像。

## 环境配置

使用 Node ≥24.11、PostgreSQL 17，或现有 Docker Compose。先复制 `.env.example` 到 `.env`，不要提交 `.env`。原部署细节见 [deploy.md](deploy.md)。至少设置管理员密码、会话签名、数据库密码和原图片代理签名配置；部署者自行生成随机密钥。

开发验证明确覆盖模板中默认开启的开关：

```dotenv
COLLECT_ENABLED=false
MODEL_CALLS_ENABLED=false
MARKET_COLLECT_ENABLED=false
MARKET_AI_REVIEW_ENABLED=true
MARKET_DEFAULT_REGION=340100
MARKET_INGEST_TOKEN=
FEISHU_CONTENT_PUSH_ENABLED=false
FEISHU_INTERNAL_ENABLED=false
INDEXNOW_SUBMIT_ENABLED=false
```

空推送 Token 禁用服务端导入；需要导入时生成至少 32 位随机值，只放服务器环境。`MARKET_DEFAULT_REGION` 必须六位且在地区字典存在。市场采集需 `COLLECT_ENABLED=true` 与 `MARKET_COLLECT_ENABLED=true` 同时成立，并且信源启用、有许可。AI 辅助需要 `MARKET_AI_REVIEW_ENABLED=true` 和原模型总开关；程序汇总不需要模型。

可选 `MARKET_EXTRACT_MODEL/MARKET_BRIEF_MODEL` 指定现有配置支持的模型，默认沿用原模型选择机制；对应步骤会进入原预算、回执与模型管理页。生产启用前按原费用配置限定预算。未知费用保持未知，不按零元报告。

JSON 认证只配置服务器变量，例如 `MARKET_SOURCE_EXAMPLE_TOKEN`，信源 `config.auth_env` 填该变量名。不要在后台 URL、样本或配置正文中粘贴凭据。

`DEV_AUTH_ROLE/DEV_AUTH_DISPLAY_NAME` 仅用于隔离本地验证。本机运行配置为开发模式；**生产 `.env` 必须删除这两项**，使用真实管理员登录。不能把当前开发配置直接搬到公网。

## Compose

```sh
docker compose up -d --build
docker compose logs --tail=100 setup api worker web
```

Setup 自动执行原迁移器、原初始化、市场字典初始化；后者只添加合肥市与六个商品规格，不种市场价格，不创建真实信源。新模块的 18 个 DDL 全部被迁移器发现，原已发布迁移不变；空库总计实际执行了 77 个迁移文件。

默认访问 `http://localhost:3000/admin/market/overview`。API 只在 Compose 内网，Web 经 HTTP 代理访问它，Worker 执行任务；仅 Web 暴露端口。HTTPS 沿用原 Caddy profile 与域名设置。不要直接将 API 3001 发布到公网；可信代理必须清理客户端伪造的转发头，并在入口做限流。多实例的业务限流需要另设共享入口额度，本模块的计数仅进程内有效。

## 本地 Node 启动

配置自己的 `DATABASE_URL`、`API_BASE_URL=http://127.0.0.1:3001`、`SITE_URL=http://localhost:3000`、开发模式及原必需签名配置后：

```sh
npm ci
npm run db:migrate
node --env-file=.env scripts/seed.ts
node --env-file=.env modules/market-price/scripts/seed.ts
npm run build -w @aihot/web
```

分别在三个终端启动：

```sh
node --env-file=.env apps/api/src/main.ts
node --env-file=.env apps/worker/src/main.ts
node --env-file=.env apps/web/server.ts
```

本次机器使用隔离库 `market_dev`、127.0.0.1:55432，不接已有生产库。本地临时 PostgreSQL 运行文件位于 `C:/Users/Administrator/.codex/market-price-runtime`，数据位于 `C:/Users/Administrator/.codex/market-price-local-db`；它们不是仓库部署依赖，不要求其他机器复制这两个路径。当前三个服务及数据库保留运行，管理员本地免登录入口仅供开发检查。

## 初始化信源

1. 核对地区、商品规格、别名和市场所属类型。已关联报价的商品不能任意改名换规格，应新建规格。
2. 新建信源，先保持停用，配置真实发布主体 `publisher_key`；转载需共享发布主体和稳定原记录 ID。
3. 用离线样本测试 JSON 路径或 HTML 选择器。预览不入库。
4. 取得数据使用许可，核对 robots、地区、观测日期和报价类型，设置频率。只有实际授权后才确认许可并打开采集开关。
5. 启用信源，手动采集后查看任务与待审核池；审核通过后检查发布页和小程序 API。

JSON 字段映射示例（固定结构说明，不代表真实信源）：

```json
{
  "items_path": "data",
  "fields": {
    "product_name": "name",
    "variant": "variant",
    "price_value": "price",
    "price_unit": "unit",
    "observed_at": "date",
    "source_record_id": "id"
  },
  "max_pages": 1,
  "page_delay_ms": 1000,
  "terms_confirmed": false
}
```

HTML 的 `row_selector` 和 `fields` 是 CSS 选择器；`date_selector` 可指向页面明确报价日期，不能把文章发布日期当观测日期。RSS 默认用 feed 内容；仅许可明确且同源时启用 `fetch_article_body`，最多补抓 10 篇。不同来源实际 schema 和地区授权尚需部署者配置，当前没有宣称一个已验证的真实行情供应商。

## 日志与故障

后台“采集记录”显示阶段、页数、创建/修订/未变化、待审/拒绝、校验耗时和文章错误；“总览”显示真实成本与覆盖。“价格审核”保留证据、三个时间、版本和原因。“发布与接口”查询实际公开层与历史，没有数据就是空状态。

Compose 使用 `docker compose logs --tail=200 api worker setup`。本地终端直接显示日志。异常任务最多自动重试 3 次，失败文章可以从后台给原因后显式重试，不无限循环。关闭开关、信源停用或 robots 拒绝时，先修复配置再有授权地重试，不绕过防护。

- 看不到价格：检查观测日期、地区、规格、类型、审核状态和实际样本数；旧报价不会填充今天。
- 包装单位拒绝：提供可核验重量与单位证据后审核更正，不能直接假定每盒一斤。
- 汇总有样本但没有区间：至少 3 个有效样本和 2 个独立主体才有区间；单信源不是全市均价。
- 源页面结构变化或跨域分页/正文：任务明确失败，重新核对路径、选择器和授权。
- 模型禁用/预算不足/Schema 失败：文章保留错误及待处理状态，不把失败输出发布成价格。
- 备份测试找不到 `pg_dump`：为测试进程提供同版本 PostgreSQL 工具；生产容器内已有工具。原部分测试要求 POSIX shell 与信号，应在原 Linux CI 验证。

## 备份与回滚

迁移生产库前先关闭采集和模型开关，停止 Worker，按原运维机制备份数据库与 `/data` 中附件。以下命令将自定义格式 dump 写入容器文件后复制，避免旧版 PowerShell 重定向破坏二进制：

```sh
docker compose exec -T db pg_dump -U aihot -d aihot -Fc -f /tmp/market-before.dump
docker compose cp db:/tmp/market-before.dump ./market-before.dump
```

恢复须先在**新建隔离数据库**验证，不能直接覆盖生产库。例如使用事先确认不存在的 `aihot_restore_check`：

```sh
docker compose cp ./market-before.dump db:/tmp/market-before.dump
docker compose exec -T db createdb -U aihot aihot_restore_check
docker compose exec -T db pg_restore -U aihot --exit-on-error --no-owner -d aihot_restore_check /tmp/market-before.dump
```

核对恢复结果后由部署者决定切换连接；不要直接删除原库。代码回滚可切换此前发布版本，同时保留新价格表和证据；首先停调度/Worker，避免回滚时继续写入。没有提供自动 DROP 价格表的下迁移。需要撤销结构时必须另做数据备份和审批，不能删除或修改历史迁移。

本次已验证新迁移在隔离库和测试模板执行；生产备份恢复、上述 Compose 命令与 Docker 构建未实测。测试命令、失败和未验证事项见 [验收记录](market-price-verification.md)。
