import {
  Badge,
  Button,
  Card,
  DataTable,
  Input,
  Select,
} from "@aihot/web/features/admin/ui";
import { useAdminAction } from "@aihot/web/features/admin/action";

import { useState } from "react";
import type { Product, DictionaryView } from "../contracts.ts";
import { Field, TypeOptions, typeNames } from "./controls.tsx";

export function Dictionary({ data }: { data: DictionaryView }) {
  const { run, busy } = useAdminAction();
  const [product, setProduct] = useState<Product>({
    product_id: "",
    name: "",
    category: "蔬菜",
    subcategory: "",
    variant: "",
    default_unit: "元/斤",
    aliases: [],
  });
  const [aliases, setAliases] = useState("");
  const [reason, setReason] = useState("");
  const [regionReason, setRegionReason] = useState("");
  const [marketReason, setMarketReason] = useState("");
  const [region, setRegion] = useState({ id: "", name: "", enabled: true });
  const [market, setMarket] = useState({
    id: "",
    name: "",
    region_code: "340100",
    price_type: "retail",
  });
  return (
    <div className="space-y-5">
      <Card title="商品字典" right={<Badge>{data.data.length} 个规格</Badge>}>
        <DataTable
          rows={data.data}
          rowKey={(p) => p.product_id}
          columns={[
            {
              key: "name",
              label: "商品 / 规格",
              render: (p) => (
                <div>
                  {p.name} · {p.variant}
                  <div className="text-xs text-ink-3">{p.product_id}</div>
                </div>
              ),
            },
            {
              key: "category",
              label: "分类",
              render: (p) => `${p.category} ${p.subcategory}`,
            },
            {
              key: "aliases",
              label: "别名",
              render: (p) => p.aliases.join("、"),
            },
            {
              key: "edit",
              label: "操作",
              render: (p) => (
                <Button
                  size="sm"
                  onClick={() => {
                    setProduct(p);
                    setAliases(p.aliases.join("，"));
                  }}
                >
                  编辑
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card title="新建或编辑商品">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await run(
              "POST",
              "/api/admin/market/products",
              {
                product: {
                  ...product,
                  aliases: aliases
                    .split(/[,，、]/)
                    .map((v) => v.trim())
                    .filter(Boolean),
                },
                reason,
              },
              { success: "商品字典已保存" },
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                "product_id",
                "name",
                "variant",
                "category",
                "subcategory",
              ] as const
            ).map((key) => (
              <Field
                key={key}
                label={
                  {
                    product_id: "商品 ID",
                    name: "标准名称",
                    variant: "规格 / 品种",
                    category: "大类",
                    subcategory: "子类",
                  }[key]
                }
              >
                <Input
                  required={key === "product_id" || key === "name"}
                  value={product[key]}
                  onChange={(e) =>
                    setProduct((p) => ({ ...p, [key]: e.target.value }))
                  }
                />
              </Field>
            ))}
            <Field label="别名（逗号分隔）">
              <Input
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
              />
            </Field>
          </div>
          <Field label="保存原因">
            <Input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button type="submit" tone="primary" busy={busy}>
            保存商品
          </Button>
        </form>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="地区管理">
          <DataTable
            rows={data.regions}
            rowKey={(r) => r.region_code}
            columns={[
              { key: "code", label: "代码", render: (r) => r.region_code },
              { key: "name", label: "地区", render: (r) => r.name },
              {
                key: "enabled",
                label: "状态",
                render: (r) => (r.enabled ? "启用" : "停用"),
              },
            ]}
          />
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await run(
                "PUT",
                `/api/admin/market/regions/${region.id}`,
                {
                  name: region.name,
                  enabled: region.enabled,
                  reason: regionReason,
                },
                { success: "地区已保存" },
              );
            }}
          >
            <Field label="六位地区代码">
              <Input
                required
                pattern="[0-9]{6}"
                value={region.id}
                onChange={(e) =>
                  setRegion((r) => ({ ...r, id: e.target.value }))
                }
              />
            </Field>
            <Field label="地区名称">
              <Input
                required
                value={region.name}
                onChange={(e) =>
                  setRegion((r) => ({ ...r, name: e.target.value }))
                }
              />
            </Field>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={region.enabled}
                onChange={(e) =>
                  setRegion((r) => ({ ...r, enabled: e.target.checked }))
                }
              />
              启用地区
            </label>
            <Field label="地区保存原因">
              <Input
                required
                value={regionReason}
                onChange={(e) => setRegionReason(e.target.value)}
              />
            </Field>
            <Button type="submit" busy={busy} disabled={!regionReason}>
              保存地区
            </Button>
          </form>
        </Card>
        <Card title="市场管理">
          <DataTable
            rows={data.markets}
            rowKey={(r) => r.market_id}
            columns={[
              { key: "name", label: "市场", render: (r) => r.name },
              {
                key: "region",
                label: "地区 / 类型",
                render: (r) => `${r.region_code} · ${typeNames[r.price_type]}`,
              },
            ]}
          />
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await run(
                "PUT",
                `/api/admin/market/markets/${market.id}`,
                {
                  name: market.name,
                  region_code: market.region_code,
                  price_type: market.price_type,
                  reason: marketReason,
                },
                { success: "市场已保存" },
              );
            }}
          >
            <Field label="市场 ID">
              <Input
                required
                value={market.id}
                onChange={(e) =>
                  setMarket((m) => ({ ...m, id: e.target.value }))
                }
              />
            </Field>
            <Field label="市场名称">
              <Input
                required
                value={market.name}
                onChange={(e) =>
                  setMarket((m) => ({ ...m, name: e.target.value }))
                }
              />
            </Field>
            <Field label="所属地区">
              <Select
                value={market.region_code}
                onChange={(e) =>
                  setMarket((m) => ({ ...m, region_code: e.target.value }))
                }
              >
                {data.regions.map((r) => (
                  <option key={r.region_code} value={r.region_code}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="价格类型">
              <Select
                value={market.price_type}
                onChange={(e) =>
                  setMarket((m) => ({ ...m, price_type: e.target.value }))
                }
              >
                <TypeOptions />
              </Select>
            </Field>
            <Field label="市场保存原因">
              <Input
                required
                value={marketReason}
                onChange={(e) => setMarketReason(e.target.value)}
              />
            </Field>
            <Button type="submit" busy={busy} disabled={!marketReason}>
              保存市场
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
