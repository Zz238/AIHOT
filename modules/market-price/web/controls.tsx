import { Field as AdminField } from "@aihot/web/features/admin/ui";
import {
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactElement,
} from "react";
import type { SourceInput } from "../contracts.ts";
export const typeNames: Record<string, string> = {
  wholesale: "批发",
  retail: "零售",
  supermarket: "商超",
  user_report: "用户上报",
  unknown: "未判定",
};
export const sourceNames: Record<string, string> = {
  json_api: "JSON 接口",
  html_table: "HTML 表格",
  rss_article: "RSS 文章",
  external: "外部推送",
  user_report: "认证用户上报",
};
export const money = (value: number | null | undefined) =>
  value == null ? "—" : Number(value).toFixed(2);
export function Field({
  children,
  label,
  ...props
}: ComponentProps<typeof AdminField>) {
  return (
    <AdminField label={label} {...props}>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, {
            "aria-label": typeof label === "string" ? label : undefined,
          })
        : children}
    </AdminField>
  );
}
export function TypeOptions() {
  return (
    <>
      {Object.entries(typeNames).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </>
  );
}
export const emptySource: SourceInput = {
  source_id: "",
  name: "",
  type: "json_api",
  url: null,
  region_code: "340100",
  market_id: null,
  price_type: "retail",
  interval_minutes: 120,
  enabled: false,
  trust_score: 0.5,
  publisher_key: "",
  config: {
    method: "GET",
    items_path: "data",
    fields: {
      product_name: "name",
      variant: "variant",
      price_value: "price",
      price_unit: "unit",
      observed_at: "date",
    },
    row_selector: "tbody tr",
    page_param: "page",
    max_pages: 1,
    page_delay_ms: 1000,
    terms_confirmed: false,
    fetch_article_body: false,
    retention_days: 180,
  },
};
export type Command = {
  title: string;
  path: string;
  method?: "POST" | "DELETE";
  data: Record<string, unknown>;
};
