// The price module's only public read layer: no raw payloads, secrets or pending observations escape.
import { sql, type Db } from "@aihot/backend/db";
import { z } from "zod";
import type { MarketQuery } from "./contracts.ts";
import { marketConfig } from "./config.ts";
import { anhuiRegion, anhuiRegions } from "./anhui-regions.ts";
import { previewAnhuiWeekly } from "./anhui-preview.ts";

export const monitoringQuerySchema = z.strictObject({
  region_code: z.string().length(6).refine(code => !!anhuiRegion(code)),
  goods_code: z.string().regex(/^10[1-5]\d{3}$/).optional(),
});

/** 仅返回展示字段，均价不转换成日价样本，不输出原始响应或查询访问参数。 */
export function monitoringReference(input: unknown, collectedAt: string | Date) {
  const ref = previewAnhuiWeekly(input);
  const retail = ref.reference_series.find(series => series.price_type === "retail")!;
  const wholesale = ref.reference_series.find(series => series.price_type === "wholesale")!;
  const history = retail.points.map((point, index) => ({
    date: point.reference_date, retail: point.display_price, wholesale: wholesale.points[index].display_price,
  }));
  return {
    goods_code: ref.product.source_goods_code, name: ref.product.name, variant: ref.product.variant,
    category_code: ref.query.classCode, region_code: ref.region.region_code,
    latest_reference_date: ref.latest_reference_date, unit: ref.product.unit, source_unit: ref.product.source_unit,
    latest: { retail: history.at(-1)!.retail, wholesale: history.at(-1)!.wholesale }, history,
    collected_at: new Date(collectedAt).toISOString(),
  };
}

export function monitoringResponse(regionCode: string, data: ReturnType<typeof monitoringReference>[]) {
  const region = anhuiRegion(regionCode)!;
  return {
    source_name: "安徽价格信息", source_url: "https://ahjgxx.in.ah.cn/jfcx/sp/",
    region_code: region.region_code, region_name: region.name, scope: region.scope,
    publication_frequency: "weekly", data: data.filter(product => product.history.some(point => point.retail !== null || point.wholesale !== null)),
    notice: "各市监测均价，按原始监测日期展示；仅供参考，不作为交易依据。缺报留空，不补齐日价。",
  };
}

export async function monitoringCities(db: Db = sql) {
  const rows = await db`SELECT m.region_code,count(DISTINCT m.goods_code)::int AS product_coverage
    FROM market_monitoring_snapshots m JOIN market_sources s ON s.source_id=m.source_id
    WHERE s.enabled AND s.config->>'adapter'='anhui_weekly' AND s.config->>'terms_confirmed'='true'
    GROUP BY m.region_code`;
  return { data: anhuiRegions.map(region => ({ ...region,
    product_coverage: rows.find(row => row.region_code === region.region_code)?.product_coverage ?? 0,
  })), notice: "来源提供安徽省及16个地级市；未提供区县级价格。可选地区不代表全部商品均有数据。" };
}

export async function monitoring(raw: unknown, db: Db = sql) {
  const query = monitoringQuerySchema.parse(raw);
  // 每地区、商品只取最新版本。停用或撤销使用范围后，旧快照不再公开。
  const rows = await db`SELECT DISTINCT ON (m.goods_code) m.payload,m.collected_at
    FROM market_monitoring_snapshots m JOIN market_sources s ON s.source_id=m.source_id
    WHERE m.region_code=${query.region_code} AND s.region_code=m.region_code AND s.enabled
      AND s.config->>'adapter'='anhui_weekly' AND s.config->>'terms_confirmed'='true'
      AND (${query.goods_code ?? null}::text IS NULL OR m.goods_code=${query.goods_code ?? null})
    ORDER BY m.goods_code,m.collected_at DESC,m.id DESC`;
  return monitoringResponse(query.region_code, rows.map(row => monitoringReference(row.payload, row.collected_at)));
}

export const beijingToday = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export async function cities() {
  return {
    data: await sql`SELECT r.region_code,r.name,r.enabled,max(p.date) AS latest_observation_date,
    count(DISTINCT p.product_id) FILTER (WHERE p.sample_count>0) AS product_coverage
    FROM market_regions r LEFT JOIN market_daily_prices p ON p.region_code=r.region_code WHERE r.enabled GROUP BY r.region_code ORDER BY r.name`,
  };
}
export async function products(query: MarketQuery) {
  const data =
    await sql`SELECT product_id,name,category,subcategory,variant,default_unit FROM market_products
    WHERE (${query.category ?? null}::text IS NULL OR category=${query.category ?? null})
    ORDER BY name,variant,product_id LIMIT ${query.limit + 1} OFFSET ${(query.page - 1) * query.limit}`;
  return {
    data: data.slice(0, query.limit),
    page: query.page,
    limit: query.limit,
    has_more: data.length > query.limit,
  };
}
function serializePrice(row: Record<string, unknown>) {
  const observed =
    row.date instanceof Date
      ? row.date.toISOString().slice(0, 10)
      : String(row.date).slice(0, 10);
  const distance = Math.round(
    (Date.parse(beijingToday() + "T00:00:00Z") -
      Date.parse(observed + "T00:00:00Z")) /
      86400000,
  );
  const freshness =
    distance <= 0
      ? "current"
      : distance <= 7
        ? "recent_reference"
        : "historical_reference";
  return {
    ...row,
    date: observed,
    revision: row.revision,
    reference_low: row.reference_low ?? null,
    reference_high: row.reference_high ?? null,
    price: row.sample_count === 1 ? row.median_price : null,
    unit: "元/斤",
    freshness,
    sufficient: row.data_quality === "sufficient",
    price_label:
      row.data_quality === "single_source" ? "单一信源报价" : "市场参考",
    notice:
      distance > 0
        ? "此为往期参考，不能作为当前购买价格"
        : row.data_quality === "sufficient"
          ? "本地已核验价格参考区间"
          : "样本不足，未生成市场价格区间",
  };
}
export async function prices(query: MarketQuery) {
  const date = query.date ?? beijingToday();
  const data =
    await sql`SELECT p.*,d.name,d.category,d.variant FROM market_daily_prices p JOIN market_products d ON d.product_id=p.product_id
    WHERE p.region_code=${query.region_code} AND p.price_type=${query.price_type} AND p.date=${date} AND p.sample_count>0
      AND (${query.product_id ?? null}::text IS NULL OR p.product_id=${query.product_id ?? null})
      AND (${query.category ?? null}::text IS NULL OR d.category=${query.category ?? null})
    ORDER BY d.name,d.variant,p.product_id LIMIT ${query.limit + 1} OFFSET ${(query.page - 1) * query.limit}`;
  return {
    data: data.slice(0, query.limit).map((row) => serializePrice(row)),
    region_code: query.region_code,
    price_type: query.price_type,
    date,
    page: query.page,
    limit: query.limit,
    has_more: data.length > query.limit,
    has_data: !!data.length,
    notice: data.length ? null : "所选地区和日期暂无已核验价格",
  };
}
export async function productDetail(id: string, query: MarketQuery) {
  const [product] =
    await sql`SELECT product_id,name,category,subcategory,variant,default_unit FROM market_products WHERE product_id=${id}`;
  if (!product) return null;
  const date = query.date ?? beijingToday();
  const [current] =
    await sql`SELECT * FROM market_daily_prices WHERE product_id=${id} AND region_code=${query.region_code}
    AND price_type=${query.price_type} AND date<=${date} AND sample_count>0 ORDER BY date DESC LIMIT 1`;
  const sources = current
    ? await sql`SELECT DISTINCT s.name,s.publisher_key,o.market_name,o.source_url,o.observed_at,o.published_at,o.collected_at,
    o.original_price,o.original_unit,o.normalized_price,o.normalized_unit,o.price_type
    FROM market_observations o JOIN market_sources s ON s.source_id=o.source_id
    WHERE o.product_id=${id} AND o.region_code=${query.region_code} AND o.price_type=${query.price_type}
      AND o.observation_date=${current.date} AND o.review_status='verified' ORDER BY o.observed_at DESC LIMIT 100`
    : [];
  return {
    data: product,
    current: current ? serializePrice(current) : null,
    sources,
    notice: current ? null : "暂无已核验报价",
  };
}
export async function history(id: string, query: MarketQuery) {
  const to = query.to ?? query.date ?? beijingToday();
  const from =
    query.from ??
    new Date(Date.parse(to + "T00:00:00Z") - (query.days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  if (
    Date.parse(to) < Date.parse(from) ||
    Date.parse(to) - Date.parse(from) > 90 * 86400000
  )
    throw Object.assign(new Error("历史窗口必须在 90 天内且起止日期有序"), {
      statusCode: 400,
    });
  const data =
    await sql`SELECT * FROM market_daily_prices WHERE product_id=${id} AND region_code=${query.region_code} AND price_type=${query.price_type}
    AND date BETWEEN ${from} AND ${to} AND sample_count>0 ORDER BY date LIMIT ${query.limit + 1} OFFSET ${(query.page - 1) * query.limit}`;
  return {
    data: data.slice(0, query.limit).map((row) => serializePrice(row)),
    product_id: id,
    region_code: query.region_code,
    price_type: query.price_type,
    from,
    to,
    page: query.page,
    limit: query.limit,
    has_more: data.length > query.limit,
    notice: "未采集日期不填充、不插值",
  };
}
export async function dailyBrief(query: MarketQuery) {
  const date = query.date ?? beijingToday();
  const [data] =
    await sql`SELECT region_code,date,price_type,text,metrics,input_version,model_version,generated_at FROM market_briefs WHERE region_code=${query.region_code} AND date=${date} AND price_type=${query.price_type}`;
  return {
    data: data ?? null,
    notice: data ? null : "当前日期数据不足或简报尚未生成",
  };
}
export function publicQuery(raw: Record<string, unknown>) {
  return {
    ...raw,
    region_code: raw.region_code ?? marketConfig().defaultRegion,
  };
}
