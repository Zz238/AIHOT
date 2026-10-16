import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseHtml, parseJson, robotsAllowed } from "../backend/collectors.ts";
import {
  normalizeUnit,
  observationTime,
  findProduct,
  validate,
} from "../backend/normalize.ts";
import { extractRules, verifyExtracted } from "../backend/extract.ts";
import { summarize } from "../backend/statistics.ts";
import { candidate, fullSource, products } from "./fixtures.ts";
import { querySchema } from "../backend/contracts.ts";
const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("固定 JSON 字段映射及 HTML 表格解析", () => {
  const json = parseJson(JSON.parse(fixture("prices.json")), fullSource);
  assert.equal(json.length, 2);
  assert.equal(json[0].price_value, 4.8);
  assert.equal(json[0].observed_at, "2026-02-05");
  const html = parseHtml(fixture("prices.html"), {
    ...fullSource,
    type: "html_table",
    config: {
      ...fullSource.config,
      date_selector: "#quote-date",
      fields: {
        product_name: ".name",
        variant: ".variant",
        price_value: ".price",
        price_unit: ".unit",
        market_name: ".market",
      },
    },
  });
  assert.equal(html.items[0].price_value, 4.8);
  assert.equal(html.items[0].observed_at, "2026-02-05");
  assert.throws(() => parseHtml("<html>无表格</html>", fullSource), /未匹配/);
});
test("中文自然语言报价只读取明示的观测日期、价格与规格", () => {
  const items = extractRules(
    {
      text: fixture("article.txt"),
      source_url: candidate.source_url,
      published_at: "2026-10-10T00:00:00Z",
    },
    fullSource,
    products,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].price_value, 4.8);
  assert.equal(items[0].observed_at, "2026年02月05日");
  assert.equal(
    extractRules(
      {
        text: "普通番茄西红柿每公斤4.80元",
        source_url: candidate.source_url,
        published_at: "2026-10-10T00:00:00Z",
      },
      fullSource,
      products,
    )[0].observed_at,
    null,
  );
  assert.equal(
    extractRules(
      {
        text: "市场供应稳定，无价格",
        source_url: candidate.source_url,
        published_at: null,
      },
      fullSource,
      products,
    ).length,
    0,
  );
});
test("别名映射保持规格隔离，公斤转市斤，包装无重量拒绝转换", () => {
  assert.equal(
    findProduct({ ...candidate, product_name: "西红柿" }, products)?.product_id,
    "tomato",
  );
  assert.equal(
    findProduct({ ...candidate, product_name: "圣女果" }, products),
    null,
  );
  assert.equal(
    findProduct({ ...candidate, variant: "水果番茄" }, products),
    null,
  );
  assert.deepEqual(normalizeUnit(4.8, "元/千克"), {
    price: 2.4,
    unit: "元/斤",
  });
  assert.equal(normalizeUnit(4.8, "元/500g")?.price, 4.8);
  assert.equal(normalizeUnit(12, "元/盒"), null);
  assert.equal(normalizeUnit(12, "元/盒", 1000)?.price, 6);
  assert.equal(normalizeUnit(-2, "元/斤"), null);
});
test("日期按北京时间解析并拒绝不存在或含糊日期", () => {
  assert.equal(
    observationTime("2026-02-05")?.instant,
    "2026-02-04T16:00:00.000Z",
  );
  assert.equal(observationTime("2026-02-30"), null);
  assert.equal(observationTime("02-05"), null);
  assert.equal(observationTime("2026-02-30T10:00:00+08:00"), null);
  assert.throws(() => querySchema.parse({ date: "2026-02-30" }));
});
test("同一文章的分段日期不串用，多个价格的歧义句交给 AI 或人工", () => {
  const doc = {
    text: "观测日期：2026年02月05日。普通番茄每公斤4.80元。\n观测日期：2026年02月06日。普通土豆每公斤4.20元。",
    source_url: candidate.source_url,
    published_at: null,
  };
  const items = extractRules(doc, fullSource, products);
  assert.deepEqual(
    items.map((item) => item.observed_at),
    ["2026年02月05日", "2026年02月06日"],
  );
  assert.equal(
    extractRules(
      { ...doc, text: "普通番茄去年每公斤4元，今年每公斤8元。" },
      fullSource,
      products,
    ).length,
    0,
  );
});
test("历史不当今日、异常波动待审核、未知规格与日期待审核", () => {
  const old = validate(candidate, fullSource, products, {
    now: new Date("2026-10-11"),
  });
  assert.ok(old.quality_flags.includes("historical_reference"));
  assert.equal(old.observation_date, "2026-02-05");
  assert.equal(
    validate({ ...candidate, price_value: 50 }, fullSource, products, {
      previousPrice: 2.4,
    }).review_status,
    "pending",
  );
  assert.equal(
    validate({ ...candidate, price_unit: "元/袋" }, fullSource, products)
      .review_status,
    "rejected",
  );
  assert.equal(
    validate({ ...candidate, observed_at: null }, fullSource, products)
      .review_status,
    "pending",
  );
  assert.equal(
    validate({ ...candidate, region_code: "310100" }, fullSource, products)
      .review_status,
    "pending",
  );
});
test("同 URL 不同日期有独立身份，批发零售独立", () => {
  const one = validate(candidate, fullSource, products);
  const next = validate(
    { ...candidate, observed_at: "2026-02-06" },
    fullSource,
    products,
  );
  assert.notEqual(one.identity_key, next.identity_key);
  assert.notEqual(
    one.identity_key,
    validate({ ...candidate, price_type: "wholesale" }, fullSource, products)
      .identity_key,
  );
});
test("低样本不造区间，镜像同报价只计一次，多源采用 P20–P80", () => {
  const sample = {
    id: "1",
    normalized_price: 2,
    quote_key: "one",
    publisher_key: "one",
    version: 1,
  };
  assert.equal(summarize([sample]).reference_low, null);
  assert.equal(
    summarize([sample, { ...sample, id: "mirror" }]).sample_count,
    1,
  );
  const s = summarize([
    sample,
    {
      ...sample,
      id: "2",
      quote_key: "two",
      publisher_key: "two",
      normalized_price: 3,
    },
    {
      ...sample,
      id: "3",
      quote_key: "three",
      publisher_key: "three",
      normalized_price: 4,
    },
  ]);
  assert.equal(s.reference_low, 2.4);
  assert.equal(s.reference_high, 3.6);
  assert.equal(s.independent_source_count, 3);
});
test("AI 输出数字、原文片段及日期缺乏证据时拒绝", () => {
  const original = "2026年02月05日，普通番茄4.80元/公斤";
  assert.equal(verifyExtracted([candidate], original).length, 1);
  assert.throws(
    () => verifyExtracted([{ ...candidate, price_value: 99 }], original),
    /价格数字/,
  );
  assert.throws(
    () =>
      verifyExtracted([{ ...candidate, observed_at: "2026-10-11" }], original),
    /日期/,
  );
  assert.throws(
    () =>
      verifyExtracted([{ ...candidate, evidence_text: "模型猜测" }], original),
    /证据片段/,
  );
  assert.throws(
    () => verifyExtracted([{ ...candidate, price_value: 2026 }], original),
    /价格数字/,
  );
  assert.throws(
    () =>
      verifyExtracted(
        [{ ...candidate, price_unit: "元/盒", weight_grams: 1000 }],
        original,
      ),
    /单位/,
  );
  assert.throws(
    () =>
      verifyExtracted(
        [
          {
            ...candidate,
            price_unit: "元/盒",
            weight_grams: 1000,
            evidence_text: "普通番茄4.80元/盒",
            observed_at: null,
          },
        ],
        "普通番茄4.80元/盒",
      ),
    /重量/,
  );
});
test("robots 禁止路径及非法分页结构明确失败", () => {
  assert.equal(
    robotsAllowed(
      "User-agent: *\nUser-agent: other\nDisallow: /private",
      "/private/prices",
    ),
    false,
  );
  assert.equal(
    robotsAllowed("User-agent: *\nDisallow: /private", "/private/prices"),
    false,
  );
  assert.equal(robotsAllowed("User-agent: *\nDisallow:", "/prices"), true);
  assert.throws(() => parseJson({ data: {} }, fullSource), /数组/);
});
