# 菜价雷达 API

基础路径 `/api/market/v1`。公开读取无需采集 Token，仅查询 PostgreSQL 中已核验样本的汇总，不调用模型。价格单位 `元/斤` 指元/市斤（500g），不是公斤。

## 公开接口

| GET 路径 | 返回 |
| --- | --- |
| `/cities` | 启用地区、实际覆盖商品数、最后观测日期 |
| `/products` | 标准商品及规格、分类、分页 |
| `/prices` | 指定地区、日期、类型的日度参考与质量 |
| `/products/:id` | 商品、最近已核验报价、来源和三个时间 |
| `/products/:id/history` | 7/30/90 天实际历史日汇总 |
| `/briefs/daily` | 指定地区、日期、类型的已生成简报；无则 `data:null` |

通用查询参数：`region_code` 六位代码，默认 `MARKET_DEFAULT_REGION`；`price_type` 默认 `retail`；`date` 为实际日历 `YYYY-MM-DD`、默认北京时间今天；`category`、`product_id` 可筛选；`page` 1–10000、`limit` 1–100 默认 30。价格类型仅 `wholesale/retail/supermarket/user_report/unknown`，严格隔离。

历史接口支持 `days=7|30|90`（默认 7），或 `from/to`，按日期升序分页。`to` 优先于 `date`，没有 `from` 时按窗口回溯；起止必须有序且差值不超过 90 天。未采集日期不填充、不插值。不存在商品的详情返回 404，历史读取为空。

```http
GET /api/market/v1/prices?region_code=340100&price_type=retail&date=2026-10-11
GET /api/market/v1/products/tomato/history?region_code=340100&price_type=retail&days=30&to=2026-10-11&limit=100
```

实际本地无报价时价格列表返回：

```json
{
  "data": [],
  "region_code": "340100",
  "price_type": "retail",
  "date": "2026-10-11",
  "page": 1,
  "limit": 30,
  "has_more": false,
  "has_data": false,
  "notice": "所选地区和日期暂无已核验价格"
}
```

有报价时各行包含 `product_id/name/variant/date/price_type/unit`、`min_price/max_price/median_price/reference_low/reference_high`、`sample_count/independent_source_count/data_quality`、`input_version/revision/calculated_at`、`price/freshness/sufficient/price_label/notice`。

`data_quality` 为 `no_data/single_source/insufficient/sufficient`。样本不足时参考上下界为空；`price` 仅一个实际样本时有值。不得将 `null` 显示成零、默认价格或凭空区间。

价格列表只返回所选当天数据，不自动用旧报价填今天。商品详情的 `current` 是不晚于所选日期的最近可用报价，可能是历史参考；必须检查其 `date/freshness/notice`，不能因字段名当作实时市况。`freshness` 始终相对真实北京时间今天计算：当日 `current`，过去 7 天 `recent_reference`，更早 `historical_reference`。来源包含原单位、原报价、标准值、观测时间 `observed_at`、发布时间 `published_at`、采集时间 `collected_at` 和原文 URL。

成功响应有 `Cache-Control: public, max-age=30, must-revalidate`。每 IP 每分钟最多 120 个公开请求，超限 429 和 `Retry-After:60`。审核事务立即更新数据库；客户端缓存最多可能延后 30 秒。缓存与公开头复用原策略。

## 服务端推送

```http
POST /api/market/ingest
Authorization: Bearer <服务端 MARKET_INGEST_TOKEN>
Idempotency-Key: fixture-batch-20260205
Content-Type: application/json
```

以下是固定测试结构，**不是市场实价，也不应导入运行库冒充行情**：

```json
{
  "source_id": "trusted-script",
  "items": [{
    "product_name": "番茄",
    "variant": "普通番茄",
    "region_code": "340100",
    "price_value": 4.8,
    "price_unit": "元/公斤",
    "price_type": "retail",
    "observed_at": "2026-02-05",
    "published_at": "2026-02-05T09:00:00+08:00",
    "source_url": "https://example.org/prices",
    "source_record_id": "fixture-20260205-tomato",
    "evidence_text": "固定测试样本：2026-02-05 普通番茄每公斤4.8元"
  }]
}
```

信源必须先在后台配置为启用的 `external` 或 `user_report`。每批 1–100 条，大小不超过 512KiB。幂等键 8–120 个字母、数字、下划线或连字符；同信源同键同载荷返回原结果，同键不同载荷返回 409。结果含真实创建/更新/未变化与审核状态计数。

候选 Schema 严格拒绝未知字段。`observed_at` 必填但允许 `null`（进入待审核，不能猜日期）；可选 `market_id/market_name`、`weight_grams`、`evidence_method` 等定义见 `backend/contracts.ts`。身份只由服务端认证适配器建立，不能靠上传字段认证。

Token 未配置即拒绝，非空但不足 32 位时服务启动失败。鉴权使用固定长度哈希的常量时间比较。每 IP 每分钟 10 次，全进程每分钟 100 次。此 Token **只供可信服务器脚本使用，禁止放进小程序包**。

用户上报采用 `backend/user-report.ts` 的 `submitAuthenticatedReport` 适配器。宿主传入凭据和真实 `verifySession` 回调；认证失败拒绝，成功仍强制 `user_report` 与待审核，并记录认证主体审计。没有注册一个无真实微信会话验证的公开上报路由。

## 管理接口

基础路径 `/api/admin/market`，复用原管理员会话和写操作 CSRF；隐藏页面不代替后端鉴权。生产禁止 `DEV_AUTH_ROLE`。变更必须提交非空 `reason`。

| 路径 | 操作 |
| --- | --- |
| `GET /overview` | 真实覆盖、任务、待审、模型费用及开关状态 |
| `GET/POST /sources`、`PUT /sources/:id` | 配置价格信源 |
| `POST /sources/:id/enabled`、`DELETE /sources/:id` | 启停；删除是保留证据的停用 |
| `POST /sources/:id/collect` | 有限队列采集，需 `Idempotency-Key`；关闭开关时拒绝 |
| `POST /sources/:id/test` | `{sample:"..."}` 离线预览；没有 sample 时真实预览受采集开关限制 |
| `GET /runs`、`GET /reviews` | 任务/批次/失败文章与审核池，支持分页 |
| `GET /observations/:id` | 原始证据、观测修订、审核和审计 |
| `POST /observations/:id/review` | approve/reject/correct/undo、原因及 `expected_version` |
| `POST /documents/:id/retry` | 管理员显式重试失败提取，保留原因与审计 |
| `GET/POST /products` | 商品和别名字典 |
| `PUT /regions/:id`、`PUT /markets/:id` | 地区/市场保存；已存在市场不迁移地区与类型 |
| `GET /publish` | 所选作用域的实际价格、简报、商品和接口预览 |
| `POST /aggregate`、`POST /brief` | `{region_code,date,price_type,reason}` 手动重算/生成 |

新商品及信源请求分别使用 `{product,reason}`、`{source,reason}`；具体字段以严格 Schema 和后台表单为准。审核更正可提交 `product_id/corrected_unit/weight_grams/unit_evidence/observed_at`；更正单位需证据。期望版本过时返回 409，原始数字与正文不覆盖。

价格类型是有约束的五项字典，后台支持选择和查看，不能随意添加新的统计类型；扩充类型需要新的迁移与相应验证。

## 错误

复用 `application/problem+json`，包含 `type/title/status/detail/code/requestId`。输入 400、无认证 401、CSRF/权限失败 403、不存在 404、版本/幂等冲突 409、请求体过大 413、限流 429。内部失败 500 提供请求标识，详细错误留在服务端日志；不回传密钥或数据库错误。

例如 `date=2026-02-30` 会返回 400，而不是纠正成另一日期。前端框架导航的 `_routes/index` 在 Web loader 中删除后再转发，不削弱业务 API 的严格查询校验。
