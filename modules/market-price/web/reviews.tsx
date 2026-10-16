import {
  Badge,
  Button,
  Card,
  FilterChips,
  Input,
  Json,
  Pager,
  ReasonDialog,
  Select,
  Textarea,
} from "@aihot/web/features/admin/ui";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { toast } from "@aihot/web/features/admin/toast";

import { useState } from "react";
import type { Product, ObservationView } from "../contracts.ts";
import { Field, typeNames, money } from "./controls.tsx";

export function Reviews({
  data,
}: {
  data: {
    data: ObservationView[];
    products: Product[];
    page: number;
    has_more: boolean;
  };
}) {
  const { run, busy } = useAdminAction();
  const [selected, setSelected] = useState<ObservationView | null>(null);
  const [action, setAction] = useState("approve");
  const [product, setProduct] = useState("");
  const [unit, setUnit] = useState("");
  const [weight, setWeight] = useState("");
  const [evidence, setEvidence] = useState("");
  const [date, setDate] = useState("");
  const [history, setHistory] = useState<unknown>(null);
  const open = (row: ObservationView, kind: string) => {
    setSelected(row);
    setAction(kind);
    setProduct(row.product_id ?? "");
    setUnit("");
    setWeight("");
    setEvidence("");
    setDate("");
  };
  return (
    <div className="space-y-5">
      <FilterChips
        param="status"
        options={[
          { value: "pending", label: "待审核" },
          { value: "verified", label: "已核验" },
          { value: "rejected", label: "已拒绝" },
        ]}
      />
      {data.data.length === 0 && (
        <Card>
          <p className="text-sm text-ink-3">此状态下暂无报价记录。</p>
        </Card>
      )}
      {data.data.map((row) => (
        <Card
          key={row.id}
          title={`${row.product_name} · ${row.variant || "未标规格"}`}
          right={
            <Badge
              tone={
                row.review_status === "verified"
                  ? "ok"
                  : row.review_status === "rejected"
                    ? "bad"
                    : "warn"
              }
            >
              {row.review_status}
            </Badge>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-2 text-sm">
              <p className="text-xl font-semibold num">
                {money(row.normalized_price)}{" "}
                <span className="text-sm font-normal text-ink-3">
                  {row.normalized_unit ?? "单位未核验"}
                </span>
              </p>
              <p>
                原始报价：{money(row.original_price)} {row.original_unit}
              </p>
              <p>
                {row.source_name} · {row.region_code} ·{" "}
                {row.market_name ?? "未命名市场"} · {typeNames[row.price_type]}
              </p>
              <p className="text-ink-3">
                观测：{row.observation_date?.slice(0, 10) ?? "缺失"}
                <br />
                报道：{row.published_at ?? "缺失"}
                <br />
                采集：{row.collected_at}
              </p>
              <div className="flex flex-wrap gap-1">
                {row.quality_flags.map((flag) => (
                  <Badge key={flag} tone="warn">
                    {flag}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <blockquote className="mb-2 whitespace-pre-wrap rounded-control bg-bg-sunk p-3 text-sm leading-relaxed">
                {row.evidence_text}
              </blockquote>
              <a
                href={row.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-accent"
              >
                打开原文 ↗
              </a>
              <div className="mt-3">
                <Json value={row.raw_payload} label="不可改写的原始数据" />
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              tone="primary"
              disabled={busy}
              onClick={() => open(row, "approve")}
            >
              核验通过
            </Button>
            <Button disabled={busy} onClick={() => open(row, "correct")}>
              更正映射 / 单位
            </Button>
            <Button
              tone="danger"
              disabled={busy}
              onClick={() => open(row, "reject")}
            >
              拒绝 / 撤回
            </Button>
            <Button disabled={busy} onClick={() => open(row, "undo")}>
              撤销上次审核
            </Button>
            <Button
              onClick={async () => {
                const response = await fetch(
                  `/api/admin/market/observations/${row.id}`,
                );
                if (response.ok) setHistory(await response.json());
                else toast("无法读取修订记录", "error");
              }}
            >
              修订与审计
            </Button>
          </div>
        </Card>
      ))}
      <Pager page={data.page} hasMore={data.has_more} />
      {history != null && (
        <Card title="原始证据版本与审核记录">
          <Button onClick={() => setHistory(null)}>关闭</Button>
          <Json value={history} collapsed={false} />
        </Card>
      )}
      <ReasonDialog
        open={!!selected}
        title={
          {
            approve: "核验并发布",
            reject: "拒绝 / 撤回报价",
            correct: "更正后重新发布",
            undo: "撤销上次审核",
          }[action]
        }
        busy={busy}
        onClose={() => setSelected(null)}
        onSubmit={async (reason) => {
          if (!selected) return false;
          const result = await run(
            "POST",
            `/api/admin/market/observations/${selected.id}/review`,
            {
              action,
              expected_version: selected.version,
              reason,
              ...(action === "correct"
                ? {
                    ...(product ? { product_id: product } : {}),
                    ...(unit
                      ? {
                          corrected_unit: unit,
                          unit_evidence: evidence,
                          ...(weight ? { weight_grams: Number(weight) } : {}),
                        }
                      : {}),
                    ...(date ? { observed_at: date } : {}),
                  }
                : {}),
            },
            { success: "审核已保存，相关日期价格已重算" },
          );
          if (!result) return false;
          setSelected(null);
        }}
      >
        {action === "correct" && (
          <>
            <Field label="商品规格映射">
              <Select
                value={product}
                onChange={(e) => setProduct(e.target.value)}
              >
                <option value="">选择商品规格</option>
                {data.products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>
                    {p.name} · {p.variant}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="更正单位（留空保持）">
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="元/公斤、元/斤、元/盒"
              />
            </Field>
            <Field label="包装重量（克，原文必须明确写明）">
              <Input
                type="number"
                min={1}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </Field>
            <Field label="逐字引用单位及重量证据">
              <Textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </Field>
            <Field label="更正观测日期（原文必须存在）">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </>
        )}
      </ReasonDialog>
    </div>
  );
}
