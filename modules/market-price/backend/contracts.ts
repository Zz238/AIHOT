import { z } from "zod";
import { anhuiRegion } from "./anhui-regions.ts";

export const priceTypes = [
  "wholesale",
  "retail",
  "supermarket",
  "user_report",
  "unknown",
] as const;
export const priceType = z.enum(priceTypes);
const text = (max = 200) => z.string().trim().min(1).max(max);
export const regionCode = z.string().regex(/^\d{6}$/);
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "日期不存在");
export const candidateSchema = z.strictObject({
  product_name: text(),
  variant: z.string().trim().max(200).default(""),
  region_code: regionCode,
  market_id: z.string().max(120).nullable().default(null),
  market_name: z.string().max(200).nullable().default(null),
  price_value: z.number().finite(),
  price_unit: text(80),
  price_type: priceType.default("unknown"),
  observed_at: z.string().max(80).nullable(),
  published_at: z.string().max(80).nullable().default(null),
  source_url: z
    .url()
    .max(2000)
    .refine((v) => /^https?:\/\//i.test(v)),
  source_record_id: z.string().max(300).nullable().default(null),
  evidence_text: text(10000),
  weight_grams: z.number().positive().max(1000000).nullable().default(null),
  evidence_method: z
    .enum(["structured", "ai", "user_report"])
    .default("structured"),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const sourceConfigSchema = z.strictObject({
  adapter: z.enum(["generic", "anhui_weekly"]).default("generic"),
  goods_codes: z.array(z.string().regex(/^10[1-5]\d{3}$/)).max(50).default([]),
  method: z.enum(["GET", "POST"]).default("GET"),
  auth_env: z
    .string()
    .regex(/^MARKET_SOURCE_[A-Z0-9_]+_TOKEN$/)
    .optional(),
  body: z.string().max(10000).optional(),
  items_path: z.string().max(200).default(""),
  fields: z.record(z.string(), z.string().max(200)).default({}),
  row_selector: z.string().max(200).default("tbody tr"),
  date_selector: z.string().max(200).optional(),
  next_selector: z.string().max(200).optional(),
  page_param: z.string().max(80).default("page"),
  max_pages: z.number().int().min(1).max(10).default(1),
  page_delay_ms: z.number().int().min(250).max(10000).default(1000),
  terms_confirmed: z.boolean().default(false),
  fetch_article_body: z.boolean().default(false),
  retention_days: z.number().int().min(30).max(3650).default(180),
});
export const sourceSchema = z
  .strictObject({
    source_id: text(120).regex(/^[a-zA-Z0-9_-]+$/),
    name: text(),
    type: z.enum([
      "json_api",
      "html_table",
      "rss_article",
      "external",
      "user_report",
    ]),
    url: z
      .url()
      .max(2000)
      .refine((v) => /^https?:\/\//i.test(v))
      .nullable(),
    region_code: regionCode,
    market_id: z.string().max(120).nullable().default(null),
    price_type: priceType.default("unknown"),
    interval_minutes: z.number().int().min(15).max(10080).default(120),
    enabled: z.boolean().default(false),
    trust_score: z.number().min(0).max(1).default(0.5),
    publisher_key: text(120),
    config: sourceConfigSchema.default(sourceConfigSchema.parse({})),
  })
  .refine((s) => ["external", "user_report"].includes(s.type) || !!s.url, {
    message: "采集信源必须配置 URL",
  })
  .refine((s) => s.config.adapter !== "anhui_weekly" || (
    s.type === "html_table" && s.url === "https://ahjgxx.in.ah.cn/jfcx/sp/" &&
    !!anhuiRegion(s.region_code) && !s.market_id && s.price_type === "unknown" &&
    s.config.goods_codes.length > 0 && new Set(s.config.goods_codes).size === s.config.goods_codes.length
  ), {
    message: "安徽监测源需使用官方查询页、安徽省或其16个地级市、1–10 个不重复商品代码，不设置单个市场",
  });
export type SourceInput = z.infer<typeof sourceSchema>;
export type Source = SourceInput & {
  last_success_at: Date | null;
  next_fetch_at: Date | null;
  last_error: string | null;
};
export const ingestSchema = z.strictObject({
  source_id: text(120),
  items: z.array(candidateSchema).min(1).max(100),
});
export const productSchema = z.strictObject({
  product_id: text(120).regex(/^[a-zA-Z0-9_-]+$/),
  name: text(),
  category: text(80),
  subcategory: z.string().max(80).default(""),
  variant: z.string().max(200).default(""),
  default_unit: z.literal("元/斤").default("元/斤"),
  aliases: z.array(text()).max(100).default([]),
});
export type Product = z.infer<typeof productSchema>;
export const reviewSchema = z
  .strictObject({
    action: z.enum(["approve", "reject", "correct", "undo"]),
    reason: text(2000),
    expected_version: z.number().int().positive(),
    product_id: text(120).optional(),
    corrected_unit: z.string().max(80).optional(),
    weight_grams: z.number().positive().max(1000000).optional(),
    unit_evidence: z.string().max(2000).optional(),
    observed_at: z.string().max(80).optional(),
  })
  .refine((r) => !r.corrected_unit || !!r.unit_evidence, {
    message: "更正单位必须提供原文中可核对的单位证据",
  });
export const querySchema = z.strictObject({
  region_code: regionCode.default("340100"),
  product_id: z.string().max(120).optional(),
  category: z.string().max(80).optional(),
  price_type: priceType.default("retail"),
  date: calendarDate.optional(),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  days: z.coerce
    .number()
    .pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]))
    .default(7),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type MarketQuery = z.infer<typeof querySchema>;
export type ReviewStatus = "pending" | "verified" | "rejected";
export interface Validated {
  candidate: Candidate;
  product_id: string | null;
  normalized_price: number | null;
  normalized_unit: "元/斤" | null;
  observed_at: string | null;
  observation_date: string | null;
  review_status: ReviewStatus;
  quality_flags: string[];
  identity_key: string;
  quote_key: string;
  raw_hash: string;
}
