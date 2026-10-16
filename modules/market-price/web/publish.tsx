import {
  Button,
  Card,
  DataTable,
  Input,
  Json,
  Pager,
  ReasonDialog,
  Select,
} from "@aihot/web/features/admin/ui";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { toast } from "@aihot/web/features/admin/toast";
import { Form, useSearchParams } from "react-router";
import { useState } from "react";
import type {
  Product,
  PriceList,
  BriefView,
  HistoryView,
} from "../contracts.ts";
import { TypeOptions, money, type Command } from "./controls.tsx";
import { HistoryPlot } from "./history.tsx";
export function Publish({
  data,
}: {
  data: {
    prices: PriceList;
    brief: BriefView;
    products: Product[];
    api_base: string;
  };
}) {
  const [sp] = useSearchParams();
  const { run, busy } = useAdminAction();
  const [command, setCommand] = useState<Command | null>(null);
  const [history, setHistory] = useState<HistoryView | null>(null);
  const [days, setDays] = useState("7");
  const [historyProduct, setHistoryProduct] = useState(
    data.products[0]?.product_id ?? "",
  );
  const scope = {
    region_code: sp.get("region_code") ?? "340100",
    date: sp.get("date") ?? data.prices.date,
    price_type: sp.get("price_type") ?? "retail",
  };
  const readHistory = async (id: string) => {
    const query = new URLSearchParams({
      ...scope,
      to: scope.date,
      days,
      limit: "100",
    });
    const res = await fetch(`${data.api_base}/products/${id}/history?${query}`);
    if (res.ok) setHistory(await res.json());
    else toast("历史价格查询失败", "error");
  };
  return (
    <div className="space-y-5">
      <Card title="发布价格与趋势">
        <Form
          method="get"
          className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
          preventScrollReset
        >
          <Input
            aria-label="地区代码"
            name="region_code"
            defaultValue={scope.region_code}
          />
          <Input
            aria-label="观测日期"
            type="date"
            name="date"
            defaultValue={scope.date}
          />
          <Select
            aria-label="价格类型"
            name="price_type"
            defaultValue={scope.price_type}
          >
            <TypeOptions />
          </Select>
          <Button type="submit">查询</Button>
        </Form>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            busy={busy}
            onClick={() =>
              setCommand({
                title: "重新聚合所选日期",
                path: "/api/admin/market/aggregate",
                data: scope,
              })
            }
          >
            重新聚合
          </Button>
          <Button
            busy={busy}
            onClick={() =>
              setCommand({
                title: "生成客观价格简报",
                path: "/api/admin/market/brief",
                data: scope,
              })
            }
          >
            生成简报
          </Button>
          <Select
            aria-label="历史窗口"
            className="!w-auto"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
            <option value="90">近 90 天</option>
          </Select>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Select
            aria-label="历史商品规格"
            className="!w-auto"
            value={historyProduct}
            onChange={(e) => setHistoryProduct(e.target.value)}
          >
            {data.products.map((p) => (
              <option key={p.product_id} value={p.product_id}>
                {p.name} · {p.variant}
              </option>
            ))}
          </Select>
          <Button
            disabled={!historyProduct}
            onClick={() => readHistory(historyProduct)}
          >
            查询该规格历史
          </Button>
        </div>
        <DataTable
          rows={data.prices.data}
          rowKey={(r) => r.product_id}
          columns={[
            {
              key: "name",
              label: "商品规格",
              render: (r) => `${r.name} · ${r.variant}`,
            },
            {
              key: "range",
              label: "参考区间（元/斤）",
              render: (r) =>
                r.reference_low == null ? (
                  <div>
                    {r.price == null ? "—" : money(r.price)}
                    <div className="text-xs text-ink-3">{r.notice}</div>
                  </div>
                ) : (
                  `${money(r.reference_low)}–${money(r.reference_high)}`
                ),
            },
            {
              key: "sample",
              label: "样本 / 独立来源",
              render: (r) =>
                `${r.sample_count} / ${r.independent_source_count}`,
            },
            {
              key: "quality",
              label: "质量 / 版本",
              render: (r) => (
                <div>
                  {r.data_quality}
                  <div className="text-xs text-ink-3">
                    修订 {r.revision} ·{" "}
                    {r.freshness === "current" ? "今日" : "往期参考"}
                  </div>
                </div>
              ),
            },
            {
              key: "history",
              label: "趋势",
              render: (r) => (
                <Button size="sm" onClick={() => readHistory(r.product_id)}>
                  查看历史
                </Button>
              ),
            },
          ]}
        />
        {data.prices.notice && (
          <p className="mt-3 text-sm text-ink-3">{data.prices.notice}</p>
        )}
        <Pager page={data.prices.page} hasMore={data.prices.has_more} />
      </Card>
      {history != null && (
        <Card title="实际历史价格样本">
          <HistoryPlot history={history} />
          <Json value={history} label="历史接口数据" />
          <Button onClick={() => setHistory(null)}>关闭历史</Button>
        </Card>
      )}
      <Card title="每日简报">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {data.brief.data?.text ?? data.brief.notice}
        </p>
        {data.brief.data && (
          <div className="mt-3">
            <Json value={data.brief.data.metrics} label="客观输入指标" />
            <p className="mt-2 text-xs text-ink-3">
              生成于 {data.brief.data.generated_at} ·{" "}
              {data.brief.data.model_version}
            </p>
          </div>
        )}
      </Card>
      <Card title="小程序接口预览">
        <p className="mb-3 text-sm text-ink-3">
          下列数据来自同一个公开读取层。小程序无需模型密钥或推送凭据。
        </p>
        <a
          className="mb-3 block break-all text-sm text-accent"
          href={`${data.api_base}/prices?${new URLSearchParams(scope)}`}
          target="_blank"
          rel="noreferrer"
        >
          打开实际价格 API ↗
        </a>
        <Json value={data.prices} collapsed={false} label="公开接口返回" />
      </Card>
      <ReasonDialog
        open={!!command}
        title={command?.title}
        busy={busy}
        onClose={() => setCommand(null)}
        onSubmit={async (reason) => {
          if (
            command &&
            !(await run(
              "POST",
              command.path,
              { ...command.data, reason },
              {
                success: command.path.endsWith("/aggregate")
                  ? "已加入聚合队列，完成后刷新查看"
                  : "简报已生成",
              },
            ))
          )
            return false;
          setCommand(null);
        }}
      />
    </div>
  );
}
