import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { chatJson } from "@aihot/backend/providers/llm";
import { modelFor } from "@aihot/backend/editorial/models";
import { config } from "@aihot/backend/config";
import { marketConfig } from "./config.ts";

export async function generateBrief(
  region: string,
  date: string,
  type: string,
) {
  const rows =
    await sql`SELECT p.product_id,d.name,d.variant,p.median_price,p.sample_count,p.independent_source_count,p.data_quality,p.input_version,
    old.median_price AS previous_price FROM market_daily_prices p JOIN market_products d ON d.product_id=p.product_id
    LEFT JOIN market_daily_prices old ON old.region_code=p.region_code AND old.product_id=p.product_id AND old.price_type=p.price_type AND old.date=p.date-1
    WHERE p.region_code=${region} AND p.date=${date} AND p.price_type=${type} AND p.sample_count>0 ORDER BY p.product_id`;
  const metrics = {
    products: rows.length,
    samples: rows.reduce((n, r) => n + r.sample_count, 0),
    sufficient_products: rows.filter((r) => r.data_quality === "sufficient")
      .length,
    comparable_products: rows.filter(
      (r) => r.previous_price && r.data_quality === "sufficient",
    ).length,
    comparisons: rows
      .filter((r) => r.previous_price && r.data_quality === "sufficient")
      .map((r) => ({
        product_id: r.product_id,
        name: r.name,
        variant: r.variant,
        change_percent:
          Math.round((r.median_price / r.previous_price - 1) * 10000) / 100,
      })),
  };
  const inputVersion = sha256(
    stableJson(
      rows.map((r) => [r.product_id, r.input_version, r.previous_price]),
    ),
  );
  const [old] =
    await sql`SELECT input_version FROM market_briefs WHERE region_code=${region} AND date=${date} AND price_type=${type}`;
  if (old?.input_version === inputVersion) return { reused: true };
  let intro = "本地已核验价格参考";
  let model = "rules-v1";
  // AI chooses only approved wording; all numbers, comparisons and dates are computed, never invented.
  if (
    config.modelCallsEnabled &&
    marketConfig().aiReviewEnabled &&
    metrics.sufficient_products
  ) {
    const chosen = await chatJson({
      model: await modelFor("marketBrief"),
      purpose: "market_brief",
      subject: `${region}:${date}:${type}:${inputVersion}`,
      promptVersion: "market-brief-v1",
      system:
        "根据已计算的数据选择一个不含预测、供需或全国结论的开场白。只返回 {intro:...}，使用 schema 允许的文本。",
      user: JSON.stringify(metrics),
      schema: z.strictObject({
        intro: z.enum([
          "本地已核验价格参考",
          "买菜前，先了解本地参考价",
          "今日可核对的本地报价",
        ]),
      }),
      temperature: 0,
      maxTokens: 512,
    });
    intro = chosen.data.intro;
    model = chosen.model;
  }
  const text = metrics.sufficient_products
    ? `${intro}：覆盖 ${metrics.products} 个商品规格、${metrics.samples} 个去重样本，其中 ${metrics.sufficient_products} 个规格可生成参考区间。${metrics.comparable_products ? "已保存与前一日的可比价格变化，详见指标。" : "缺少可比数据，暂不判断整体涨跌。"}`
    : `数据不足：当前有 ${metrics.products} 个商品规格、${metrics.samples} 个已核验去重样本，暂不生成市场涨跌结论或购买推荐。`;
  return sql.begin(async (db) => {
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`${region}:${date}:${type}:brief`},0))`;
    const current =
      await db`SELECT p.product_id,p.input_version,old.median_price AS previous_price FROM market_daily_prices p
      LEFT JOIN market_daily_prices old ON old.region_code=p.region_code AND old.product_id=p.product_id AND old.price_type=p.price_type AND old.date=p.date-1
      WHERE p.region_code=${region} AND p.date=${date} AND p.price_type=${type} AND p.sample_count>0 ORDER BY p.product_id`;
    if (
      sha256(
        stableJson(
          current.map((r) => [r.product_id, r.input_version, r.previous_price]),
        ),
      ) !== inputVersion
    )
      throw new Error("简报输入已被修订，稍后重试");
    await db`INSERT INTO market_briefs(region_code,date,price_type,text,metrics,input_version,model_version) VALUES(${region},${date},${type},${text},${db.json(metrics)},${inputVersion},${model})
      ON CONFLICT(region_code,date,price_type) DO UPDATE SET text=excluded.text,metrics=excluded.metrics,input_version=excluded.input_version,model_version=excluded.model_version,generated_at=now()`;
    return {
      reused: false,
      text,
      metrics,
      input_version: inputVersion,
      model_version: model,
    };
  });
}
