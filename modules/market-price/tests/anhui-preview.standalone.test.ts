import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { previewAnhuiWeekly } from "../backend/anhui-preview.ts";
import { anhuiRegions } from "../backend/anhui-regions.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/anhui-weekly-excerpt.json", import.meta.url), "utf8"));
const sample = () => structuredClone(fixture);

test("安徽16个市地区隔离，不接受区县或跨地区目录", () => {
  const cities = anhuiRegions.filter(region => region.scope === "city");
  assert.equal(cities.length, 16);
  for (const region of cities) {
    const value = sample(); value.query.regionCode = value.catalog.region.regionCode = region.source_region_code;
    value.catalog.region.regionName = region.name;
    assert.equal(previewAnhuiWeekly(value).region.region_code, region.region_code);
    value.catalog.region.regionName = "不对应的地区";
    assert.throws(() => previewAnhuiWeekly(value), /地区/);
  }
  const district = sample(); district.query.regionCode = district.catalog.region.regionCode = "340102000";
  assert.throws(() => previewAnhuiWeekly(district));
});

test("每周地区均价保留两个价格类型与实际日期，不补齐日价或重复计算图表", () => {
  const result = previewAnhuiWeekly(sample());
  assert.equal(result.region.region_code, "340100");
  assert.equal(result.region.scope, "city");
  assert.equal(result.publication_frequency, "weekly");
  assert.equal(result.statistic_kind, "regional_monitoring_mean");
  assert.equal(result.statistic_period, null);
  assert.equal(result.direct_observation_import_allowed, false);
  assert.equal(result.reference_series.length, 2);
  const retail = result.reference_series.find((series) => series.price_type === "retail")!;
  assert.deepEqual(retail.points.map((point) => point.reference_date), ["2026-10-06", "2026-10-13"]);
  assert.equal(retail.points[1].normalized_price, 2.99);
  assert.equal(result.reference_series[1].points[1].normalized_price, 2);
  assert.equal(retail.points[1].source_record_id, null);
});

test("省级数据不会映射为合肥，响应必须携带对应查询和商品目录", () => {
  const province = sample();
  province.query.regionCode = province.catalog.region.regionCode = "340000000";
  province.catalog.region.regionName = "安徽省";
  const result = previewAnhuiWeekly(province);
  assert.equal(result.region.region_code, "340000");
  assert.equal(result.region.scope, "province");
  assert.notEqual(result.reference_series[0].points[0].preview_identity, previewAnhuiWeekly(sample()).reference_series[0].points[0].preview_identity);
  province.catalog.region.regionName = "合肥市";
  assert.throws(() => previewAnhuiWeekly(province), /地区/);
  const wrongProduct = sample(); wrongProduct.query.goodsCode = "101005";
  assert.throws(() => previewAnhuiWeekly(wrongProduct), /商品/);
  assert.throws(() => previewAnhuiWeekly(fixture.response));
});

test("商品相关的动态字段按列标签解析，零值保持缺报", () => {
  const changed = sample();
  for (const section of [changed.response.data.tablePrice, changed.response.data.echartPrice]) {
    section.map.otherProductRetail = section.map.retailField; delete section.map.retailField;
    section.data.forEach((row: Record<string, unknown>) => { row.otherProductRetail = row.retailField; delete row.retailField; });
    section.data.find((row: Record<string, unknown>) => row.dateTime === "2026-10-06").otherProductRetail = "0";
  }
  const points = previewAnhuiWeekly(changed).reference_series[0].points;
  assert.equal(points[0].status, "missing");
  assert.equal(points[0].normalized_price, null);
  assert.equal(points[1].normalized_price, 2.99);
});

test("日期、规格、图表或最新价冲突明确失败，不猜测不发布", () => {
  for (const change of [
    (value: typeof fixture) => { value.response.data.date = "2026-10-14"; },
    (value: typeof fixture) => { value.response.data.standardName = "普通青椒"; },
    (value: typeof fixture) => { value.response.data.echartPrice.data[0].retailField = "99"; },
    (value: typeof fixture) => { value.response.data.newPrice[0].value = 99; },
    (value: typeof fixture) => { value.response.data.tablePrice.data[0].dateTime = "2026-02-30"; },
    (value: typeof fixture) => { value.query.marketPrice = "1"; },
    (value: typeof fixture) => { value.source_url += "?password=not-a-real-secret"; },
  ]) { const value = sample(); change(value); assert.throws(() => previewAnhuiWeekly(value)); }
});
