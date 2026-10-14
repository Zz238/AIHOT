import { z } from "zod";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { calendarDate } from "./contracts.ts";
import { normalizeUnit } from "./normalize.ts";

const sourcePage = "https://ahjgxx.in.ah.cn/jfcx/sp/";
const text = z.string().trim().min(1).max(200);
const envelopeSchema = z.strictObject({
  source_url: z.literal(sourcePage),
  query: z.strictObject({
    tabCode: z.literal("100000"),
    classCode: z.enum(["101000", "102000", "103000", "104000", "105000"]),
    goodsCode: z.string().regex(/^10[1-5]\d{3}$/),
    regionCode: z.enum(["340100000", "340000000"]),
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
    if (keys.length !== 1) throw new Error("零售或批发列缺失、重复，需重新核实源结构");
    return { key: keys[0], label, type: label === "零售价格" ? "retail" as const : "wholesale" as const };
  });
  const dates = new Set<string>();
  return data.map((row) => {
    const date = calendarDate.parse(row.dateTime);
    if (dates.has(date)) throw new Error("同一监测日期重复，不能增加样本数");
    dates.add(date);
    return { date, values: columns.map((column) => {
      if (!Object.hasOwn(row, column.key)) throw new Error("监测行缺少已声明的价格字段");
      return { ...column, raw: row[column.key], value: price(row[column.key]) };
    }) };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Interprets a local response and its saved query context; no fetch, database or publication. */
export function previewAnhuiWeekly(input: unknown) {
  const envelope = envelopeSchema.parse(input);
  const { query, catalog, response } = envelope;
  const data = response.data;
  if (response.message) throw new Error(`来源查询未成功：${response.message}`);
  const region = query.regionCode === "340100000"
    ? { region_code: "340100", name: "合肥市", scope: "city" as const }
    : { region_code: "340000", name: "安徽省", scope: "province" as const };
  if (catalog.region.regionCode !== query.regionCode || catalog.region.regionName !== region.name)
    throw new Error("查询地区和来源地区目录冲突");
  if (catalog.product.code !== query.goodsCode || catalog.product.category_code !== query.classCode ||
      !query.goodsCode.startsWith(query.classCode.slice(0, 3)) ||
      catalog.product.name !== data.title || catalog.product.standard !== data.standardName || catalog.product.unit !== data.unit)
    throw new Error("查询商品、来源目录、规格或单位冲突");
  if (!normalizeUnit(1, data.unit)) throw new Error("监测单位不能明确换算为元/斤");
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
    if (headers.length !== 1 || price(headers[0].value) !== column.value)
      throw new Error("页头价格和最新监测表行不一致");
  }

  return {
    offline: true,
    read_only: true,
    source_url: sourcePage,
    source_terms_confirmed: false,
    direct_observation_import_allowed: false,
    query,
    region: { ...region, source_region_code: query.regionCode },
    product: { source_goods_code: query.goodsCode, name: data.title, variant: data.standardName },
    publication_frequency: "weekly",
    statistic_kind: "regional_monitoring_mean",
    statistic_period: null,
    latest_reference_date: data.date,
    reference_series: latest.values.map(({ type, label }) => ({
      price_type: type,
      source_label: label,
      points: table.map(({ date, values }) => {
        const column = values.find((value) => value.type === type)!;
        const normalized = column.value === null ? null : normalizeUnit(column.value, data.unit)!;
        return {
          reference_date: date,
          source_record_id: null,
          raw_price: column.raw ?? null,
          raw_unit: data.unit,
          normalized_price: normalized?.price ?? null,
          normalized_unit: "元/斤",
          status: normalized ? "reference_only" : "missing",
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
      "网站使用许可尚未确认；仅用于本地验证，不进入单条报价样本池或公开价格接口。",
    ],
  };
}
