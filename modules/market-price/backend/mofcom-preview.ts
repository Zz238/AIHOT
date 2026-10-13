import { load } from "cheerio";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { calendarDate, candidateSchema } from "./contracts.ts";
import { normalizeUnit, validate } from "./normalize.ts";

const marketName = "合肥周谷堆农产品批发市场股份有限公司";
const expectedHeaders = [
  "地区", "市场", "当日价格", "前一日价格", "环比", "走势图",
];

/** Only interprets caller-supplied HTML. It never fetches or publishes data. */
export function previewMofcomDaily(
  html: string,
  sourceUrl: string,
  options: { now?: Date } = {},
) {
  const source = new URL(sourceUrl);
  if (
    !/^https?:$/.test(source.protocol) ||
    source.hostname !== "cif.mofcom.gov.cn" ||
    source.port || source.username || source.password ||
    source.pathname !== "/cif/seach.fhtml" ||
    source.searchParams.getAll("commdityid").length !== 1 ||
    !/^\d{1,8}$/.test(source.searchParams.get("commdityid") ?? "")
  ) throw new Error("仅支持商务部公开商品日报来源 URL");
  if (!html.trim() || Buffer.byteLength(html, "utf8") > 512 * 1024)
    throw new Error("本地 HTML 为空或超过离线预览大小限制");

  const $ = load(html);
  const titleNode = $(".zhouduzoushitu .secondbiaotitle .font25px");
  const unitNode = $(".zhouduzoushitu .secondbiaotitle .font14px000");
  const dateNode = $("input[name=searchDate]");
  const table = $("table#goaler");
  if ([titleNode, unitNode, dateNode, table].some((node) => node.length !== 1))
    throw new Error("日报标题、单位、日期或表格结构缺失或重复");

  const title = titleNode.text().trim();
  const titleMatch = /^(\d{4}-\d{2}-\d{2})([^\s]{1,80})批发价格行情$/.exec(title);
  if (!titleMatch) throw new Error("未识别日报日期、商品或批发价格类型");
  const date = calendarDate.parse(titleMatch[1]);
  if (dateNode.attr("value") !== date)
    throw new Error("标题与监测日期输入框不一致");
  const unitEvidence = unitNode.text().trim();
  const unitMatch = /^\s*[（(]\s*单位[：:]\s*([^()（）]+?)\s*[）)]\s*$/.exec(unitEvidence);
  const unit = unitMatch?.[1].trim();
  if (!unit || !normalizeUnit(1, unit))
    throw new Error("日报单位缺失或不能明确换算为元/斤");

  const rows = table.find("tr");
  const headers = rows.first().children("td").map((_i, cell) => $(cell).text().trim()).get();
  if (stableJson(headers) !== stableJson(expectedHeaders))
    throw new Error("日报列定义与已核实的公开表格不一致");
  const commodityId = source.searchParams.get("commdityid")!;
  const observations = [];
  for (const row of rows.toArray().slice(1)) {
    const cells = $(row).children("td");
    if (cells.length !== 6) throw new Error("日报数据行列数异常");
    const cellText = cells.map((_i, cell) => $(cell).text().trim()).get();
    if (cellText[0] !== "安徽省" || cellText[1] !== marketName) continue;
    const links = cells.eq(5).find("a[href]");
    if (links.length !== 1) throw new Error("周谷堆走势图来源标识缺失或重复");
    const chart = new URL(links.attr("href")!, source);
    if (
      chart.origin !== source.origin || chart.username || chart.password ||
      chart.pathname !== "/cif/seachline.fhtml" ||
      chart.searchParams.getAll("enterid").length !== 1 ||
      chart.searchParams.get("enterid") !== "3994" ||
      chart.searchParams.getAll("commdityid").length !== 1 ||
      chart.searchParams.get("commdityid") !== commodityId ||
      chart.searchParams.getAll("Edate").length !== 1 ||
      chart.searchParams.get("Edate") !== date
    ) throw new Error("周谷堆市场、商品或走势图日期证据冲突");
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cellText[2]))
      throw new Error("当日价格不是明确的单点数字");
    const price = Number(cellText[2]);
    const normalized = normalizeUnit(price, unit);
    if (!normalized) throw new Error("当日价格无效或单位不可换算");
    const rowText = cellText.join(" | ");
    const candidate = candidateSchema.parse({
      product_name: titleMatch[2],
      variant: "",
      region_code: "340100",
      market_name: marketName,
      market_id: null,
      price_value: price,
      price_unit: unit,
      price_type: "wholesale",
      observed_at: date,
      published_at: null,
      source_url: source.href,
      source_record_id: null,
      evidence_text: `${title}\n${unitEvidence}\n${rowText}`,
      evidence_method: "structured",
    });
    const checked = validate(candidate, {
      source_id: "mofcom-offline-preview",
      publisher_key: "mofcom-unconfigured",
      trust_score: 0.5,
      region_code: "340100",
    }, [], options);
    observations.push({
      candidate,
      validation: {
        review_status: checked.review_status,
        quality_flags: [...checked.quality_flags, "source_terms_unconfirmed"],
        product_id: null,
        observation_date: checked.observation_date,
        normalized_price: normalized.price,
        normalized_unit: normalized.unit,
      },
      evidence: {
        title,
        unit_text: unitEvidence,
        row_text: rowText,
        row_html: $.html(row),
        chart_url: chart.href,
        previous_price_text: cellText[3],
        source_ratio_text: cellText[4],
      },
      preview_identity: `preview:${sha256(stableJson(["3994", commodityId, date, "wholesale"]))}`,
      identity_origin: "local_preview_only",
    });
  }
  if (observations.length > 1) throw new Error("同一日报存在多条周谷堆报价，需人工核实");
  return {
    offline: true,
    read_only: true,
    source_url: source.href,
    source_terms_confirmed: false,
    quote_basis: "市场批发监测报价，具体采样方法未说明",
    inspected_market_rows: rows.length - 1,
    observations,
    warnings: [
      "来源采集与再发布许可未确认；本结果不入库、不发布，不是当前运行行情。",
      "原文未提供商品规格，未映射商品字典；待人工审核。",
      "来源环比约定未核实，仅保留原文，不计算或发布涨跌。",
      "来源可信度仅使用未配置来源的默认值，未进行正式质量评分。",
      ...(observations.length ? [] : ["未找到同时符合安徽省、周谷堆全名及市场标识的报价。"]),
    ],
  };
}
