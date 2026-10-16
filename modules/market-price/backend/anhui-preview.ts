import { z } from "zod";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { calendarDate } from "./contracts.ts";
import { normalizeUnit } from "./normalize.ts";
import { anhuiRegion } from "./anhui-regions.ts";

const sourcePage = "https://ahjgxx.in.ah.cn/jfcx/sp/";
/** Weight and five-litre packages are separate dimensions; never infer oil density. */
export function monitoringUnit(unit: string) {
  if (normalizeUnit(1, unit)) return "元/斤";
  if (["元/5升", "元/桶（5升）"].includes(unit)) return "元/桶（5升）";
  throw new Error("监测单位尚未核实");
}
const text = z.string().trim().min(1).max(200);
const envelopeSchema = z.strictObject({
  source_url: z.literal(sourcePage),
  query: z.strictObject({
    tabCode: z.literal("100000"),
    classCode: z.enum(["101000", "102000", "103000", "104000", "105000"]),
    goodsCode: z.string().regex(/^10[1-5]\d{3}$/),
    regionCode: z.string().refine(code => !!anhuiRegion(code) && code.length === 9, "安徽来源未提供该地区"),
    marketPrice: z.literal("0"),
  }),
  catalog: z.strictObject({
    product: z.strictObject({ category_code: text, code: text, name: text, standard: text, unit: text }),
    region: z.strictObject({ regionCode: text, regionName: text }),
  }),
  response: z.object({
    code: z.literal(200),
    message: z.string().optional(),
    data: z.object({
      title: text,
      date: calendarDate,
      unit: text,
      standardName: text,
      newPrice: z.array(z.object({ name: text, value: z.unknown() })).max(10),
      tablePrice: z.object({ map: z.record(z.string(), z.string()), data: z.array(z.record(z.string(), z.unknown())).min(1).max(1000) }),
      echartPrice: z.object({ map: z.record(z.string(), z.string()), data: z.array(z.record(z.string(), z.unknown())).min(1).max(1000) }),
    }),
  }),
});
export type AnhuiEnvelope = z.infer<typeof envelopeSchema>;
export const parseAnhuiEnvelope = (input: unknown) => envelopeSchema.parse(input);

function price(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)))
    throw new Error("监测价格不是明确的数字或缺报值");
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error("监测价格无效");
  // The source's chart treats zero as a missing report rather than a free product.
  return result === 0 ? null : result;
}

function rows(map: Record<string, string>, data: Record<string, unknown>[]) {
  const columns = ["零售价格", "批发价格"].map((label) => {
    const keys = Object.keys(map).filter((key) => map[key] === label);
    if (keys.length > 1) throw new Error("零售或批发列重复，需重新核实源结构");
    return { key: keys[0] ?? null, label, type: label === "零售价格" ? "retail" as const : "wholesale" as const };
  });
  if (columns.every(column => column.key === null)) throw new Error("监测表没有价格列");
  const dates = new Set<string>();
  return data.map((row) => {
    const date = calendarDate.parse(row.dateTime);
    if (dates.has(date)) throw new Error("同一监测日期重复，不能增加样本数");
    dates.add(date);
    return { date, values: columns.map((column) => {
      if (column.key !== null && !Object.hasOwn(row, column.key)) throw new Error("监测行缺少已声明的价格字段");
      const raw = column.key === null ? null : row[column.key];
      return { ...column, raw, value: price(raw) };
    }) };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Interprets a local response and its saved query context; no fetch, database or publication. */
export function previewAnhuiWeekly(input: unknown, options: { offline?: boolean; termsConfirmed?: boolean } = {}) {
  const envelope = envelopeSchema.parse(input);
  const { query, catalog, response } = envelope;
  const data = response.data;
  if (response.message) throw new Error(`来源查询未成功：${response.message}`);
  const region = anhuiRegion(query.regionCode)!;
  if (catalog.region.regionCode !== query.regionCode || catalog.region.regionName !== region.name)
    throw new Error("查询地区和来源地区目录冲突");
  const compact = (value: string) => value.replace(/\s/g, "");
  // The live apple price response is more specific than its own goods directory.
  const standardMatches = compact(catalog.product.standard) === compact(data.standardName) ||
    query.goodsCode === "105002" && catalog.product.standard === "红富士一级" && compact(data.standardName) === "红富士一级75mm";
  if (catalog.product.code !== query.goodsCode || catalog.product.category_code !== query.classCode ||
      !query.goodsCode.startsWith(query.classCode.slice(0, 3)) ||
      catalog.product.name !== data.title || !standardMatches ||
      monitoringUnit(catalog.product.unit) !== monitoringUnit(data.unit))
    throw new Error("查询商品、来源目录、规格或单位冲突");
  const displayUnit = monitoringUnit(data.unit);
  if (data.tablePrice.map.dateTime !== "时间") throw new Error("监测表日期列定义已改变");
  const table = rows(data.tablePrice.map, data.tablePrice.data);
  const chart = rows(data.echartPrice.map, data.echartPrice.data);
  const comparisons = (list: ReturnType<typeof rows>) => list.map(({ date, values }) => [date, values.map(({ type, value }) => [type, value])]);
  if (stableJson(comparisons(table)) !== stableJson(comparisons(chart)))
    throw new Error("监测表格与图表数据冲突");
  const latest = table.at(-1)!;
  if (data.date !== latest.date) throw new Error("页头日期和最新监测表行不一致");
  for (const column of latest.values) {
    const headers = data.newPrice.filter((entry) => entry.name === column.label);
    if (column.key === null ? headers.length !== 0 : headers.length !== 1 || price(headers[0].value) !== column.value)
      throw new Error("页头价格和最新监测表行不一致");
  }

  return {
    offline: options.offline ?? true,
    read_only: true,
    source_url: sourcePage,
    source_terms_confirmed: options.termsConfirmed ?? false,
    direct_observation_import_allowed: false,
    query,
    region: { ...region, source_region_code: query.regionCode },
    product: { source_goods_code: query.goodsCode, name: data.title, variant: data.standardName, unit: displayUnit, source_unit: data.unit },
    publication_frequency: "weekly",
    statistic_kind: "regional_monitoring_mean",
    statistic_period: null,
    latest_reference_date: data.date,
    reference_series: latest.values.map(({ type, label }) => ({
      price_type: type,
      source_label: label,
      points: table.map(({ date, values }) => {
        const column = values.find((value) => value.type === type)!;
        const normalized = column.value === null ? null : normalizeUnit(column.value, data.unit);
        return {
          reference_date: date,
          source_record_id: null,
          raw_price: column.raw ?? null,
          raw_unit: data.unit,
          normalized_price: normalized?.price ?? null,
          normalized_unit: displayUnit === "元/斤" ? "元/斤" : null,
          display_price: normalized?.price ?? column.value,
          display_unit: displayUnit,
          status: column.value !== null ? "reference_only" : "missing",
          preview_identity: `preview:${sha256(stableJson([query.regionCode, query.goodsCode, query.marketPrice, type, date]))}`,
          evidence_text: `${region.name} | ${data.title} | ${data.standardName} | ${date} | ${label}: ${column.raw ?? "缺报"} ${data.unit} | 地区均价，具体采样方法未说明`,
        };
      }),
    })),
    warnings: [
      "地区来自保存的查询参数与来源目录；原价格响应没有回显地区，参数与响应必须一同留存。",
      "原站注明全省或各市均价；每周发布不代表已确认按整周交易计算的平均价。",
      "只保留实际监测日期，不补齐日价；图表和表格为同一数据，不增加独立样本。",
      "原站图表将零值按缺报显示；缺报保留空值，不插值。",
      "地区监测均价独立保存，不进入单条报价样本池；经确认使用范围后通过独立监测接口展示。",
      ...((options.termsConfirmed ?? false) ? [] : ["网站使用许可尚未确认；当前只做解析预览。"]),
    ],
  };
}
