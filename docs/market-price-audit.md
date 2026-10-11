# 源码审查与实施边界

基线：`931a4eb5edf344b12b9e65f0d039f7c52a2e0792`，上游 `main`，独立分支 `feat/market-price-backend`。

真实接口已确认：ModuleDeclaration 的 apiPaths/adminPages；ServerModule 的 http/schedules/queues/models/admin；WebModule 的 admin.groups/landing。`enqueueOn` 支持与业务事务同提交；`chatJson` 使用 Zod、paidRequest 回执和原预算控制；后台路由可复用 `adminHandler` 的会话及 CSRF，操作调用 audit。

价格模块自有 migrations，执行器按完整文件名自动发现；新迁移每文件一条语句，索引并发建立。Docker npm ci 前必须复制模块 manifest。新闻表、kind、评分流程和已发布迁移不修改。

价格读取集中在模块 publication 层，匿名出口只读已核验观测重新计算的结果；不调用新闻内容读取规则，因为价格表没有新闻精选状态或全文许可字段。原新闻出口继续走原 publication 层。

关键验证：按观测日期隔离历史；product_id 含规格；price_type 隔离；重复原始记录只计一次；原始证据不可覆盖；修订、撤回和撤销审核在事务内重算相关日期。

阶段：基础注册与原功能检查；迁移与采集；标准化及审核；汇总与 API；管理页面；集成验证与文档、提交和 Draft PR。
