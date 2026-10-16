import {
  Badge,
  Card,
  DataTable,
  Stat,
  Time,
} from "@aihot/web/features/admin/ui";

import type { OverviewView } from "../contracts.ts";

export function Overview({ data }: { data: OverviewView }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="启用信源" value={data.sources.active_sources} />
        <Stat label="今日采集" value={data.observations.collected_today} />
        <Stat label="今日有效观测" value={data.observations.valid_today} />
        <Stat
          label="待人工审核"
          value={data.observations.pending}
          tone={data.observations.pending ? "warn" : "ok"}
        />
        <Stat
          label="今日采集失败"
          value={data.runs.failed_today}
          tone={data.runs.failed_today ? "bad" : "ok"}
        />
        <Stat label="已覆盖地区" value={data.observations.region_coverage} />
      </div>
      <Card title="运行状态">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={data.config.collect_enabled ? "ok" : "muted"}>
            外部采集{data.config.collect_enabled ? "已开启" : "已关闭"}
          </Badge>
          <Badge tone={data.config.model_calls_enabled ? "warn" : "muted"}>
            真实模型调用{data.config.model_calls_enabled ? "已开启" : "已关闭"}
          </Badge>
          <Badge>
            推送密钥{data.config.ingest_configured ? "已配置" : "未配置"}
          </Badge>
          <span className="text-sm text-ink-3">
            最近采集成功：
            <Time at={data.sources.latest_success} />
          </span>
        </div>
        <p className="mt-3 text-sm text-ink-3">
          没有报价时保持空白。可先管理商品字典，粘贴固定样本预览解析结果，再配置可信信源。
        </p>
      </Card>
      <Card title="今日采集开销">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="采集任务" value={data.runs.runs_today} />
          <Stat label="已记录页面" value={data.runs.fetched_pages} />
          <Stat label="采集耗时（毫秒）" value={data.runs.total_duration_ms} />
        </div>
        <p className="mt-3 text-sm text-ink-3">
          HTTP 采集暂无计费回执，人民币费用未知；不会用估算零元替代实际费用。
        </p>
      </Card>
      <Card title="最近 24 小时模型费用与回执">
        {data.costs.length ? (
          <DataTable
            rows={data.costs}
            rowKey={(r) => `${r.service}:${r.currency}:${r.cost_basis}`}
            columns={[
              { key: "service", label: "服务", render: (r) => r.service },
              { key: "calls", label: "调用次数", render: (r) => r.calls },
              {
                key: "cost",
                label: "费用",
                render: (r) =>
                  r.cost == null
                    ? "未定价"
                    : `${r.cost} ${r.currency ?? ""}（${r.cost_basis === "actual" ? "实际" : "估算"}）`,
              },
            ]}
          />
        ) : (
          <p className="text-sm text-ink-3">尚无价格模块付费调用记录。</p>
        )}
      </Card>
    </div>
  );
}
