import { randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import { audit, Conflict } from "@aihot/backend/audit";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import {
  candidateSchema,
  productSchema,
  reviewSchema,
  sourceSchema,
  type Candidate,
  type Product,
  type Source,
} from "./contracts.ts";
import { observationTime, normalizeUnit, validate } from "./normalize.ts";
import { summarize, type Sample } from "./statistics.ts";

export async function loadSource(
  id: string,
  db: Db = sql,
): Promise<Source | null> {
  const [row] = await db<
    Source[]
  >`SELECT * FROM market_sources WHERE source_id=${id}`;
  return row
    ? {
        ...row,
        trust_score: Number(row.trust_score),
        config: sourceSchema.parse(rowInput(row)).config,
      }
    : null;
}
function rowInput(row: Source) {
  const {
    source_id,
    name,
    type,
    url,
    region_code,
    market_id,
    price_type,
    interval_minutes,
    enabled,
    trust_score,
    publisher_key,
    config,
  } = row;
  return {
    source_id,
    name,
    type,
    url,
    region_code,
    market_id,
    price_type,
    interval_minutes,
    enabled,
    trust_score: Number(trust_score),
    publisher_key,
    config,
  };
}
export async function loadProducts(db: Db = sql): Promise<Product[]> {
  return db<
    Product[]
  >`SELECT p.product_id,p.name,p.category,p.subcategory,p.variant,p.default_unit,
    coalesce(array_agg(a.alias) FILTER (WHERE a.alias IS NOT NULL),'{}') AS aliases
    FROM market_products p LEFT JOIN market_product_aliases a ON a.product_id=p.product_id GROUP BY p.product_id ORDER BY p.name,p.variant`;
}
export async function saveSource(
  input: unknown,
  actor: string,
  reason: string,
) {
  const value = sourceSchema.parse(input);
  return sql.begin(async (db) => {
    const before = await loadSource(value.source_id, db);
    if (before?.config.adapter === "anhui_weekly" &&
        (before.region_code !== value.region_code || value.config.adapter !== "anhui_weekly") &&
        (await db`SELECT 1 FROM market_monitoring_snapshots WHERE source_id=${value.source_id} LIMIT 1`).length)
      throw new Conflict("已有监测记录的地区和解析方式不能改写，请创建新信源");
    if (
      !(
        await db`SELECT 1 FROM market_regions WHERE region_code=${value.region_code}`
      ).length
    )
      throw new Conflict("请先创建信源所属地区");
    if (
      value.market_id &&
      !(
        await db`SELECT 1 FROM market_markets WHERE market_id=${value.market_id} AND region_code=${value.region_code} AND price_type=${value.price_type}`
      ).length
    )
      throw new Conflict("市场与信源地区或价格类型不一致");
    const row = {
      ...value,
      config: db.json(value.config),
      next_fetch_at: value.enabled ? new Date() : null,
      updated_at: new Date(),
    };
    await db`INSERT INTO market_sources ${db(row)} ON CONFLICT(source_id) DO UPDATE SET
      name=excluded.name,type=excluded.type,url=excluded.url,region_code=excluded.region_code,market_id=excluded.market_id,price_type=excluded.price_type,
      publisher_key=excluded.publisher_key,trust_score=excluded.trust_score,interval_minutes=excluded.interval_minutes,enabled=excluded.enabled,
      config=excluded.config,next_fetch_at=excluded.next_fetch_at,updated_at=excluded.updated_at`;
    await audit(
      actor,
      "market.source.save",
      `market-source:${value.source_id}`,
      reason,
      before,
      value,
      { db },
    );
    return value;
  });
}
export async function setSourceEnabled(
  id: string,
  enabled: boolean,
  actor: string,
  reason: string,
) {
  const source = await loadSource(id);
  if (!source) throw new Conflict("信源不存在");
  return saveSource({ ...rowInput(source), enabled }, actor, reason);
}
export async function saveProduct(
  input: unknown,
  actor: string,
  reason: string,
) {
  const value = productSchema.parse(input);
  return sql.begin(async (db) => {
    const [before] =
      await db`SELECT * FROM market_products WHERE product_id=${value.product_id} FOR UPDATE`;
    if (
      before &&
      (before.name !== value.name || before.variant !== value.variant) &&
      (
        await db`SELECT 1 FROM market_observations WHERE product_id=${value.product_id} LIMIT 1`
      ).length
    )
      throw new Conflict(
        "已有观测的商品名称或规格不能直接改写，请新建商品并在审核中重新映射",
      );
    const { aliases, ...row } = value;
    await db`INSERT INTO market_products ${db(row)} ON CONFLICT(product_id) DO UPDATE SET name=excluded.name,category=excluded.category,
      subcategory=excluded.subcategory,variant=excluded.variant,default_unit=excluded.default_unit,updated_at=now()`;
    await db`DELETE FROM market_product_aliases WHERE product_id=${value.product_id}`;
    for (const alias of [...new Set([value.name, ...aliases])])
      await db`INSERT INTO market_product_aliases(product_id,alias,variant) VALUES(${value.product_id},${alias},${value.variant})`;
    await audit(
      actor,
      "market.product.save",
      `market-product:${value.product_id}`,
      reason,
      before,
      value,
      { db },
    );
    return value;
  });
}

export interface Scope {
  region_code: string;
  product_id: string;
  price_type: string;
  observation_date: string;
}
async function lockBriefInputs(scopes: Scope[], db: Db) {
  const keys = new Set<string>();
  for (const scope of scopes) {
    const next = new Date(
      Date.parse(scope.observation_date + "T00:00:00Z") + 86400000,
    )
      .toISOString()
      .slice(0, 10);
    for (const date of [scope.observation_date, next])
      keys.add(`${scope.region_code}:${date}:${scope.price_type}:brief`);
  }
  for (const key of [...keys].sort())
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
}
export async function aggregateScope(
  scope: Scope,
  db: Db = sql,
): Promise<ReturnType<typeof summarize>> {
  if (db === sql)
    return sql.begin((tx) => aggregateScope(scope, tx)) as Promise<
      ReturnType<typeof summarize>
    >;
  await lockBriefInputs([scope], db);
  await db`SELECT pg_advisory_xact_lock(hashtextextended(${stableJson(scope)},0))`;
  const samples = await db<
    Sample[]
  >`SELECT o.id,o.normalized_price,o.quote_key,s.publisher_key,o.version
    FROM market_observations o JOIN market_sources s ON s.source_id=o.source_id
    WHERE o.region_code=${scope.region_code} AND o.product_id=${scope.product_id} AND o.price_type=${scope.price_type}
      AND o.observation_date=${scope.observation_date} AND o.review_status='verified' ORDER BY o.collected_at,o.id`;
  const summary = summarize(samples);
  const updated =
    await db`INSERT INTO market_daily_prices ${db({ region_code: scope.region_code, product_id: scope.product_id, price_type: scope.price_type, date: scope.observation_date, ...summary })}
    ON CONFLICT(region_code,product_id,price_type,date) DO UPDATE SET min_price=excluded.min_price,max_price=excluded.max_price,median_price=excluded.median_price,
      reference_low=excluded.reference_low,reference_high=excluded.reference_high,sample_count=excluded.sample_count,independent_source_count=excluded.independent_source_count,
      calculated_at=now(),data_quality=excluded.data_quality,input_version=excluded.input_version,revision=market_daily_prices.revision+1
    WHERE market_daily_prices.input_version<>excluded.input_version RETURNING region_code`;
  // A brief names exact inputs; never continue serving one after a correction/retraction.
  if (updated.length)
    await db`DELETE FROM market_briefs WHERE region_code=${scope.region_code}
    AND date BETWEEN ${scope.observation_date}::date AND ${scope.observation_date}::date+1 AND price_type=${scope.price_type}`;
  return summary;
}
function scopeOf(row: Record<string, unknown>): Scope | null {
  if (!row.product_id || !row.observation_date) return null;
  const date =
    row.observation_date instanceof Date
      ? row.observation_date.toISOString().slice(0, 10)
      : String(row.observation_date).slice(0, 10);
  return {
    region_code: String(row.region_code),
    product_id: String(row.product_id),
    price_type: String(row.price_type),
    observation_date: date,
  };
}
async function refreshScopes(rows: Record<string, unknown>[], db: Db) {
  const scopes = new Map<string, Scope>();
  for (const row of rows) {
    const s = scopeOf(row);
    if (s) scopes.set(stableJson(s), s);
  }
  await lockBriefInputs([...scopes.values()], db);
  for (const [, scope] of [...scopes].sort(([a], [b]) => a.localeCompare(b)))
    await aggregateScope(scope, db);
}

/** Append evidence revisions and atomically recalculate published scopes; retries are harmless. */
export async function storeCandidates(
  source: Source,
  items: Candidate[],
  db: Db = sql,
): Promise<{
  created: number;
  revised: number;
  unchanged: number;
  pending: number;
  rejected: number;
}> {
  if (db === sql)
    return sql.begin((tx) => storeCandidates(source, items, tx)) as Promise<
      Awaited<ReturnType<typeof storeCandidates>>
    >;
  const products = await loadProducts(db);
  const changed: Record<string, unknown>[] = [];
  const result = {
    created: 0,
    revised: 0,
    unchanged: 0,
    pending: 0,
    rejected: 0,
  };
  const prepared = items
    .map((item) => ({
      item: candidateSchema.parse(item),
      initial: validate(item, source, products),
    }))
    .sort((a, b) =>
      a.initial.identity_key.localeCompare(b.initial.identity_key),
    );
  for (const { item, initial } of prepared) {
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${initial.identity_key},0))`;
    const [before] =
      await db`SELECT * FROM market_observations WHERE identity_key=${initial.identity_key} FOR UPDATE`;
    if (before?.raw_hash === initial.raw_hash) {
      result.unchanged++;
      continue;
    }
    let marketId = item.market_id;
    if (!marketId && item.market_name) {
      const [m] =
        await db`SELECT market_id FROM market_markets WHERE name=${item.market_name} AND region_code=${item.region_code} AND price_type=${item.price_type}`;
      marketId = m?.market_id ?? null;
    }
    const regionExists = !!(
      await db`SELECT 1 FROM market_regions WHERE region_code=${item.region_code} AND enabled`
    ).length;
    const marketValid =
      (!marketId && !item.market_name) ||
      !!(
        await db`SELECT 1 FROM market_markets WHERE market_id=${marketId} AND region_code=${item.region_code} AND price_type=${item.price_type}`
      ).length;
    const [previous] = initial.product_id
      ? await db`SELECT normalized_price FROM market_observations WHERE product_id=${initial.product_id} AND region_code=${item.region_code}
      AND price_type=${item.price_type} AND market_id IS NOT DISTINCT FROM ${marketId} AND review_status='verified' AND observation_date<=${initial.observation_date}
      ORDER BY observation_date DESC,collected_at DESC LIMIT 1`
      : [];
    const verified = validate(item, source, products, {
      regionExists,
      marketValid,
      previousPrice: previous?.normalized_price,
    });
    const { candidate, ...validation } = verified;
    const row = {
      id: before?.id ?? randomUUID(),
      source_id: source.source_id,
      source_record_id: item.source_record_id,
      product_id: validation.product_id,
      product_name: item.product_name,
      variant: item.variant,
      region_code: item.region_code,
      market_id: marketValid ? marketId : null,
      market_name: item.market_name,
      price_type: item.price_type,
      original_price: item.price_value,
      original_unit: item.price_unit,
      normalized_price: validation.normalized_price,
      normalized_unit: validation.normalized_unit,
      observed_at: validation.observed_at,
      observation_date: validation.observation_date,
      published_at: observationTime(item.published_at)?.instant ?? null,
      source_url: item.source_url,
      evidence_text: item.evidence_text,
      raw_payload: db.json(item),
      raw_hash: validation.raw_hash,
      identity_key: validation.identity_key,
      quote_key: validation.quote_key,
      review_status: before?.manual_override
        ? "pending"
        : validation.review_status,
      quality_flags: before?.manual_override
        ? [...validation.quality_flags, "source_revised_after_manual_review"]
        : validation.quality_flags,
      version: (before?.version ?? 0) + 1,
      manual_override: false,
      updated_at: new Date(),
    };
    if (before) {
      await db`UPDATE market_observations SET product_name=${row.product_name},original_price=${row.original_price},original_unit=${row.original_unit},normalized_price=${row.normalized_price},normalized_unit=${row.normalized_unit},
        observed_at=${row.observed_at},observation_date=${row.observation_date},published_at=${row.published_at},source_url=${row.source_url},evidence_text=${row.evidence_text},raw_payload=${row.raw_payload},raw_hash=${row.raw_hash},
        product_id=${row.product_id},market_id=${row.market_id},review_status=${row.review_status},quality_flags=${row.quality_flags},version=${row.version},manual_override=false,updated_at=now() WHERE id=${row.id}`;
      changed.push(before);
      result.revised++;
    } else {
      await db`INSERT INTO market_observations ${db(row)}`;
      result.created++;
    }
    await db`INSERT INTO market_observation_revisions(observation_id,version,actor,reason,before_data,after_data)
      VALUES(${row.id},${row.version},'collector',${before ? "source correction" : "first observation"},${before ? db.json(before) : null},${db.json({ ...row, raw_payload: item })})`;
    changed.push(row);
    if (row.review_status === "pending") result.pending++;
    if (row.review_status === "rejected") result.rejected++;
  }
  await refreshScopes(changed, db);
  return result;
}

export async function ingestBatch(
  input: { source_id: string; items: Candidate[] },
  key: string,
  verifiedActor?: string,
) {
  return sql.begin(async (db) => {
    const source = await loadSource(input.source_id, db);
    if (
      !source ||
      !source.enabled ||
      !["external", "user_report"].includes(source.type)
    )
      throw new Conflict("信源未启用或不接受外部推送");
    const hash = sha256(stableJson(input));
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`${source.source_id}:${key}`},0))`;
    const [old] =
      await db`SELECT body_hash,result FROM market_ingest_batches WHERE source_id=${source.source_id} AND idempotency_key=${key}`;
    if (old) {
      if (old.body_hash !== hash)
        throw new Conflict("同一幂等键不能对应不同数据");
      return { ...old.result, reused: true };
    }
    const items =
      source.type === "user_report"
        ? input.items.map((i) => ({
            ...i,
            price_type: "user_report" as const,
            evidence_method: "user_report" as const,
          }))
        : input.items;
    const result = {
      ok: true,
      ...(await storeCandidates(source, items, db)),
      reused: false,
    };
    await db`INSERT INTO market_ingest_batches(source_id,idempotency_key,body_hash,result) VALUES(${source.source_id},${key},${hash},${db.json(result)})`;
    await db`UPDATE market_sources SET last_success_at=now(),last_error=NULL WHERE source_id=${source.source_id}`;
    if (verifiedActor)
      await audit(
        verifiedActor,
        "market.user_report",
        `market-source:${source.source_id}`,
        "认证用户提交价格证据",
        null,
        { idempotency_key: key, ...result },
        { db },
      );
    return result;
  });
}

export async function reviewObservation(
  id: string,
  input: unknown,
  actor: string,
) {
  const action = reviewSchema.parse(input);
  return sql.begin(async (db) => {
    const [before] =
      await db`SELECT * FROM market_observations WHERE id=${id} FOR UPDATE`;
    if (!before) throw new Conflict("观测不存在");
    if (before.version !== action.expected_version)
      throw new Conflict("记录已变更，请刷新后审核");
    const after = { ...before };
    if (action.action === "undo") {
      const [review] =
        await db`SELECT action,before_data FROM market_reviews WHERE observation_id=${id} ORDER BY id DESC LIMIT 1`;
      if (!review || review.action === "undo")
        throw new Conflict("没有可撤销的审核，或上次审核已经撤销");
      Object.assign(after, review.before_data);
    } else if (action.action === "reject") after.review_status = "rejected";
    else {
      if (action.product_id) {
        const [p] =
          await db`SELECT * FROM market_products WHERE product_id=${action.product_id}`;
        if (!p) throw new Conflict("商品不存在");
        after.product_id = p.product_id;
      }
      if (action.corrected_unit) {
        if (!before.evidence_text.includes(action.unit_evidence!))
          throw new Conflict("单位证据必须逐字引用原文");
        const unit = action.corrected_unit
          .replace(/\s/g, "")
          .replace(/^元\//, "");
        if (!action.unit_evidence!.replace(/\s/g, "").includes(unit))
          throw new Conflict("更正后的单位必须出现在引用证据中");
        if (
          action.weight_grams &&
          !action.unit_evidence!.includes(`${action.weight_grams}克`) &&
          !action.unit_evidence!.includes(`${action.weight_grams}g`) &&
          !action.unit_evidence!.includes(
            `${action.weight_grams / 1000}公斤`,
          ) &&
          !action.unit_evidence!.includes(`${action.weight_grams / 1000}kg`)
        )
          throw new Conflict("包装重量缺乏原文证据");
        const normalized = normalizeUnit(
          Number(before.original_price),
          action.corrected_unit,
          action.weight_grams ?? null,
        );
        if (!normalized) throw new Conflict("该单位不能换算");
        after.normalized_price = normalized.price;
        after.normalized_unit = normalized.unit;
      }
      if (action.observed_at) {
        const observed = observationTime(action.observed_at);
        if (!observed) throw new Conflict("观测日期无效");
        const digits = observed.date.split("-").map(Number);
        if (
          !new RegExp(
            `${digits[0]}[-/.年]0?${digits[1]}[-/.月]0?${digits[2]}`,
          ).test(before.evidence_text)
        )
          throw new Conflict("更正日期必须来自原文证据");
        after.observed_at = observed.instant;
        after.observation_date = observed.date;
      }
      if (
        !after.product_id ||
        !after.normalized_price ||
        !after.observation_date ||
        after.price_type === "unknown" ||
        new Date(after.observed_at).getTime() > Date.now() + 300000
      )
        throw new Conflict("缺少商品、单位、日期或价格类型，不能发布");
      if (
        before.quality_flags.includes("unknown_region") ||
        before.quality_flags.includes("unmapped_or_wrong_region_market")
      )
        throw new Conflict("请先修复地区或市场配置再重新采集");
      after.review_status = "verified";
    }
    after.version = before.version + 1;
    after.manual_override = true;
    await db`UPDATE market_observations SET product_id=${after.product_id},normalized_price=${after.normalized_price},normalized_unit=${after.normalized_unit},
      observed_at=${after.observed_at},observation_date=${after.observation_date},review_status=${after.review_status},version=${after.version},manual_override=true,updated_at=now() WHERE id=${id}`;
    await db`INSERT INTO market_reviews(observation_id,action,actor,reason,version,before_data,after_data) VALUES(${id},${action.action},${actor},${action.reason},${after.version},${db.json(before)},${db.json(after)})`;
    await db`INSERT INTO market_observation_revisions(observation_id,version,actor,reason,before_data,after_data) VALUES(${id},${after.version},${actor},${action.reason},${db.json(before)},${db.json(after)})`;
    await audit(
      actor,
      `market.review.${action.action}`,
      `market-observation:${id}`,
      action.reason,
      before,
      after,
      { db },
    );
    await refreshScopes([before, after], db);
    return { ok: true, id, version: after.version };
  });
}
