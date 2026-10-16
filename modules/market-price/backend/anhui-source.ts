import { load } from "cheerio";
import { z } from "zod";
import { setTimeout } from "node:timers/promises";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { sourceSchema, type Source } from "./contracts.ts";
import { parseAnhuiEnvelope, previewAnhuiWeekly, type AnhuiEnvelope } from "./anhui-preview.ts";
import { anhuiRegion, anhuiRegions } from "./anhui-regions.ts";
import catalog from "../anhui-catalog.json" with { type: "json" };

const origin = "https://ahjgxx.in.ah.cn";
const page = `${origin}/jfcx/sp/`;
const scriptPath = "/js/jiafeichaxun_ShiPin.js";
const endpointPath = "/prod-api/dataservice/PublicInterface/publicInterfaceInfo";
const functions = {
  categories: "53bdb205-12b5-4c16-bc99-1e78843494f8",
  goods: "944b1654-0072-4beb-b87a-091016de5e79",
  regions: "d317555d-69de-446e-9751-df7d03b7ccaa",
  prices: "b220af28-a95c-4101-a749-df2dad00c665",
};
const catalogResponse = z.object({ success: z.literal(true), data: z.array(z.record(z.string(), z.unknown())).max(500) });
const text = z.string().trim().min(1).max(200);
const categorySchema = z.object({ code: text, name: text });
const productSchema = z.object({ code: text, name: text, standard: text, unit: text });
const regionSchema = z.object({ regionCode: text, regionName: text });

export function anhuiSourcePreset(regionCode = "340100") {
  const region = anhuiRegion(regionCode);
  if (!region || regionCode.length !== 6) throw new Error("安徽来源未提供该地区");
  return sourceSchema.parse({
    source_id: regionCode === "340100" ? "anhui-hefei-monitoring" : `anhui-${regionCode}-monitoring`, name: `安徽价格信息 · ${region.name}每周监测`,
    type: "html_table", url: page, region_code: regionCode, price_type: "unknown",
    publisher_key: "anhui-price-monitoring-bureau", interval_minutes: 10080,
    enabled: false, config: { adapter: "anhui_weekly", goods_codes: catalog.goods.map(product => product.code) },
  });
}

export const anhuiSourcePresets = () => anhuiRegions.map(region => anhuiSourcePreset(region.region_code));

/** Read the site's public query flow; its page-provided access parameters stay in memory only. */
export async function collectAnhuiWeekly(
  source: Source,
  allowedPath: (path: string) => boolean,
  read: typeof fetchListing = fetchListing,
) {
  sourceSchema.parse(sourceInput(source));
  if (source.config.adapter !== "anhui_weekly") throw new Error("未选择安徽监测解析方式");
  for (const path of ["/jfcx/sp/", scriptPath, endpointPath])
    if (!allowedPath(path)) throw new Error("robots.txt 禁止安徽查询所需路径");
  const request = async (url: string, label: string, method = "GET") => {
    let response;
    try {
      response = await read(url, { method, timeoutMs: 15000, maxBytes: 1024 * 1024, maxRedirects: 0, redirectPolicy: "same-origin" });
    } catch {
      // Do not expose the source's page-provided access parameters in errors, runs or logs.
      throw new Error(`安徽${label}读取失败，请检查来源可访问性`);
    }
    if (response.status !== 200) throw new Error(`安徽${label} HTTP ${response.status}`);
    return response.text();
  };
  const urls = [page, `${origin}${scriptPath}`];
  const html = await request(page, "查询页");
  const doc = load(html);
  if (!doc(`script[src='${scriptPath}']`).length || !html.includes(`${origin}/prod-api`))
    throw new Error("安徽查询页结构变化，未找到已核实的公开查询脚本");
  const script = await request(`${origin}${scriptPath}`, "查询脚本");
  const match = /publicInterfaceInfo\?([^"`]+)"/.exec(script);
  const access = new URLSearchParams(match?.[1] ?? "");
  if (!access.get("username") || !access.get("password") || access.get("function") !== functions.categories || access.get("classId") !== "-1")
    throw new Error("安徽公开查询参数结构改变，需重新核实");
  const query = async (name: keyof typeof functions, params: Record<string, string>) => {
    const search = new URLSearchParams({ username: access.get("username")!, password: access.get("password")!, function: functions[name], ...params });
    urls.push(`${origin}${endpointPath}?${new URLSearchParams({ function: functions[name], ...params })}`);
    await setTimeout(source.config.page_delay_ms);
    const label = name === "prices" ? `商品 ${params.goodsCode} 价格` : name === "goods" ? `类别 ${params.classId} 商品目录` : name === "regions" ? "地区目录" : "类别目录";
    const body = await request(`${origin}${endpointPath}?${search}`, label, "POST");
    try { return JSON.parse(body); } catch { throw new Error("安徽查询未返回有效 JSON"); }
  };
  const categories = catalogResponse.parse(await query("categories", { classId: "100000" })).data.map((row) => categorySchema.parse(row));
  const expectedRegion = anhuiRegion(source.region_code)!;
  const sourceRegionCode = expectedRegion.source_region_code;
  const regionRows = catalogResponse.parse(await query("regions", {})).data.map((row) => regionSchema.parse(row));
  const region = sourceRegionCode === "340000000"
    ? { regionCode: sourceRegionCode, regionName: "安徽省" }
    : regionRows.find((row) => row.regionCode === sourceRegionCode && row.regionName === expectedRegion.name);
  if (!region) throw new Error("安徽来源目录没有对应的已核实地区");
  const goods = new Map<string, z.infer<typeof productSchema>>();
  for (const code of new Set(source.config.goods_codes.map((value) => `${value.slice(0, 3)}000`))) {
    if (!categories.some((row) => row.code === code)) throw new Error("选定商品类别已不在安徽来源目录");
    const rows = catalogResponse.parse(await query("goods", { classId: code })).data;
    for (const row of rows) { const product = productSchema.parse(row); goods.set(product.code, product); }
  }
  const monitoring: AnhuiEnvelope[] = [];
  for (const goodsCode of source.config.goods_codes) {
    const product = goods.get(goodsCode);
    if (!product) throw new Error(`安徽来源未提供商品 ${goodsCode}`);
    const parameters = { tabCode: "100000", classCode: `${goodsCode.slice(0, 3)}000`, goodsCode, regionCode: sourceRegionCode, marketPrice: "0" };
    const response = await query("prices", parameters);
    if (response.code === 200 && response.message === "未找到数据" && !response.data) continue;
    const envelope = parseAnhuiEnvelope({ source_url: page, query: parameters,
      catalog: { product: { ...product, category_code: parameters.classCode }, region },
      response,
    });
    previewAnhuiWeekly(envelope);
    monitoring.push(envelope);
  }
  return { monitoring, urls };
}

function sourceInput(source: Source) {
  const { source_id, name, type, url, region_code, market_id, price_type, publisher_key, interval_minutes, enabled, trust_score, config } = source;
  return { source_id, name, type, url, region_code, market_id, price_type, publisher_key, interval_minutes, enabled, trust_score, config };
}
