import { sql, type Db } from "@aihot/backend/db";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { parseAnhuiEnvelope, previewAnhuiWeekly, type AnhuiEnvelope } from "./anhui-preview.ts";
import type { Source } from "./contracts.ts";

export async function storeMonitoring(source: Source, runId: string, inputs: AnhuiEnvelope[], db: Db) {
  if (source.config.adapter !== "anhui_weekly" || !source.config.terms_confirmed)
    throw new Error("监测来源解析方式或使用范围尚未确认");
  let created = 0;
  for (const input of inputs) {
    const envelope = parseAnhuiEnvelope(input);
    const reference = previewAnhuiWeekly(envelope);
    if (reference.region.region_code !== source.region_code || !source.config.goods_codes.includes(envelope.query.goodsCode))
      throw new Error("监测数据超出配置的地区或商品范围");
    const rawHash = sha256(stableJson(envelope));
    const rows = await db`INSERT INTO market_monitoring_snapshots(id,source_id,run_id,region_code,goods_code,product_name,variant,latest_reference_date,raw_hash,payload)
      VALUES(${sha256(`${source.source_id}:${rawHash}`)},${source.source_id},${runId},${source.region_code},${envelope.query.goodsCode},${reference.product.name},${reference.product.variant},${reference.latest_reference_date},${rawHash},${db.json(JSON.parse(JSON.stringify(envelope)))}) ON CONFLICT DO NOTHING RETURNING id`;
    created += rows.length;
  }
  return { created, processed: inputs.length };
}

export async function monitoringSnapshots(sourceId: string, limit = 20, db: Db = sql) {
  const rows = await db`SELECT m.id,m.source_id,m.region_code,m.goods_code,m.product_name,m.variant,m.latest_reference_date,m.collected_at,m.payload,coalesce((s.config->>'terms_confirmed')::boolean,false) AS terms_confirmed FROM market_monitoring_snapshots m JOIN market_sources s ON s.source_id=m.source_id WHERE m.source_id=${sourceId} ORDER BY m.collected_at DESC,m.id DESC LIMIT ${limit}`;
  return rows.map(({ payload, terms_confirmed, ...row }) => ({ ...row, reference: previewAnhuiWeekly(payload, { offline: false, termsConfirmed: terms_confirmed }) }));
}
