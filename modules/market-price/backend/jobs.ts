import { randomUUID } from "node:crypto";
import { defineQueue } from "@aihot/backend/modules";
import { enqueueOn, ensureQueue } from "@aihot/backend/jobs/queue";
import { sql, type Db } from "@aihot/backend/db";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { collect } from "./collectors.ts";
import { extractDocument } from "./extract.ts";
import { marketConfig } from "./config.ts";
import {
  aggregateScope,
  loadProducts,
  loadSource,
  storeCandidates,
  type Scope,
} from "./repository.ts";
import { generateBrief } from "./briefs.ts";
import { beijingToday } from "./publication.ts";
import type { Candidate } from "./contracts.ts";
import { storeMonitoring } from "./monitoring.ts";

const options = {
  policy: "short" as const,
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 600,
};
async function finishRunIfComplete(runId: string, db: Db) {
  await db`UPDATE market_source_runs r SET status='ok',stage='complete',error=NULL,finished_at=now()
    WHERE r.id=${runId} AND NOT EXISTS(SELECT 1 FROM market_documents WHERE run_id=r.id AND status<>'complete')
      AND r.parsed_count <= (SELECT coalesce(sum((result->>'processed')::integer),0) FROM market_run_batches WHERE run_id=r.id)`;
}
export const collectQueue = defineQueue<{
  source_id: string;
  run_id: string;
  trigger: string;
}>({
  name: "market.collect",
  options,
  worker: { batchSize: 1 },
  run: async (data) => {
    for (const job of data) await collectJob(job);
  },
});
export const extractQueue = defineQueue<{ document_id: string }>({
  name: "market.extract",
  options,
  worker: { batchSize: 1 },
  run: async (data) => {
    for (const job of data) await extractJob(job.document_id);
  },
});
export const validateQueue = defineQueue<{
  source_id: string;
  items: Candidate[];
  run_id: string;
}>({
  name: "market.validate",
  options,
  worker: { batchSize: 1 },
  run: async (data) => {
    for (const job of data) {
      const source = await loadSource(job.source_id);
      if (!source || !source.enabled) continue;
      try {
        await sql.begin(async (db) => {
          const [run] =
            await db`SELECT id FROM market_source_runs WHERE id=${job.run_id} FOR UPDATE`;
          const batchId = sha256(stableJson(job.items));
          if (
            run &&
            (
              await db`SELECT result FROM market_run_batches WHERE run_id=${job.run_id} AND batch_id=${batchId}`
            ).length
          )
            return;
          const result = await storeCandidates(source, job.items, db);
          if (run)
            await db`INSERT INTO market_run_batches(run_id,batch_id,result) VALUES(${job.run_id},${batchId},${db.json({ ...result, processed: job.items.length })})`;
          await db`UPDATE market_source_runs SET created_count=created_count+${result.created},stage='validate',finished_at=now() WHERE id=${job.run_id}`;
          if (run) await finishRunIfComplete(job.run_id, db);
        });
      } catch (error) {
        await sql`UPDATE market_source_runs SET status='failed',stage='validate',error=${String((error as Error).message).slice(0, 1000)},finished_at=now() WHERE id=${job.run_id}`;
        throw error;
      }
    }
  },
});
export const aggregateQueue = defineQueue<Scope>({
  name: "market.aggregate",
  options,
  worker: { batchSize: 1 },
  run: async (data) => {
    for (const scope of data) await aggregateScope(scope);
  },
});
export const briefQueue = defineQueue<{
  region_code: string;
  date: string;
  price_type: string;
}>({
  name: "market.brief",
  options,
  worker: { batchSize: 1 },
  run: async (data) => {
    for (const job of data)
      await generateBrief(job.region_code, job.date, job.price_type);
  },
});
export const queues = [
  collectQueue,
  extractQueue,
  validateQueue,
  aggregateQueue,
  briefQueue,
];

export async function requestCollection(
  source_id: string,
  trigger = "manual",
  key: string = randomUUID(),
) {
  if (!marketConfig().collectEnabled || process.env.COLLECT_ENABLED !== "true")
    throw Object.assign(
      new Error(
        "外部采集已关闭，需同时启用 MARKET_COLLECT_ENABLED 和 COLLECT_ENABLED",
      ),
      { statusCode: 400 },
    );
  const source = await loadSource(source_id);
  if (!source || !source.enabled)
    throw Object.assign(new Error("信源不存在或已停用"), { statusCode: 400 });
  if (!source.config.terms_confirmed)
    throw Object.assign(new Error("请先确认来源条款允许采集"), { statusCode: 400 });
  if (["external", "user_report"].includes(source.type))
    throw Object.assign(new Error("该信源仅接受认证推送"), { statusCode: 400 });
  const run_id = sha256(`${source_id}:${key}`);
  const job_id = await enqueueOn(
    collectQueue,
    { source_id, trigger, run_id },
    { singletonKey: source_id },
  );
  return { ok: true, job_id, run_id, already_queued: !job_id };
}

async function collectJob(job: {
  source_id: string;
  run_id: string;
  trigger: string;
}) {
  if (!marketConfig().collectEnabled || process.env.COLLECT_ENABLED !== "true")
    return;
  const source = await loadSource(job.source_id);
  if (!source || !source.enabled) return;
  const session = await sql.reserve();
  const [lock] =
    await session`SELECT pg_try_advisory_lock(hashtextextended(${`market-source:${source.source_id}`},0)) AS locked`;
  if (!lock.locked) {
    session.release();
    throw new Error("该信源已有采集任务，稍后重试");
  }
  const started = Date.now();
  try {
    const [old] =
      await sql`SELECT status FROM market_source_runs WHERE id=${job.run_id}`;
    if (old?.status === "ok") return;
    await sql`INSERT INTO market_source_runs(id,source_id,trigger) VALUES(${job.run_id},${source.source_id},${job.trigger})
      ON CONFLICT(id) DO UPDATE SET status='running',started_at=now(),error=NULL,stage='collect'`;
    const result = await collect(source);
    if (result.items.length > 10000)
      throw new Error("单次采集超过 10000 条，请降低分页范围");
    await ensureQueue(extractQueue.name, extractQueue.options);
    await ensureQueue(validateQueue.name, validateQueue.options);
    await sql.begin(async (db) => {
      const monitoring = result.monitoring ?? [];
      if (monitoring.length) {
        const saved = await storeMonitoring(source, job.run_id, monitoring, db);
        await db`INSERT INTO market_run_batches(run_id,batch_id,result) VALUES(${job.run_id},${`monitoring:${sha256(stableJson(monitoring))}`},${db.json({ processed: saved.processed, monitoring_created: saved.created })}) ON CONFLICT DO NOTHING`;
        await db`UPDATE market_source_runs SET created_count=created_count+${saved.created} WHERE id=${job.run_id}`;
      }
      for (let i = 0; i < result.items.length; i += 100) {
        const items = result.items.slice(i, i + 100);
        await enqueueOn(
          validateQueue,
          { source_id: source.source_id, items, run_id: job.run_id },
          { singletonKey: `${job.run_id}:${i}` },
          db,
        );
      }
      for (const doc of result.documents) {
        const raw_hash = sha256(doc.text);
        const id = sha256(`${source.source_id}:${doc.source_url}:${raw_hash}`);
        await db`INSERT INTO market_documents(id,source_id,run_id,source_url,published_at,text,raw_hash) VALUES(${id},${source.source_id},${job.run_id},${doc.source_url},${doc.published_at},${doc.text.slice(0, 100000)},${raw_hash}) ON CONFLICT DO NOTHING`;
        await enqueueOn(
          extractQueue,
          { document_id: id },
          { singletonKey: id },
          db,
        );
      }
      await db`UPDATE market_source_runs SET status='ok',finished_at=now(),fetched_urls=${db.json(result.urls)},parsed_count=${result.items.length + monitoring.length},duration_ms=${Date.now() - started},stage='queued' WHERE id=${job.run_id}`;
      if (!result.items.length && !result.documents.length) await finishRunIfComplete(job.run_id, db);
      await db`UPDATE market_sources SET last_success_at=now(),last_error=NULL,next_fetch_at=now()+interval_minutes*interval '1 minute' WHERE source_id=${source.source_id}`;
    });
  } catch (error) {
    await sql`UPDATE market_source_runs SET status='failed',finished_at=now(),duration_ms=${Date.now() - started},error=${String((error as Error).message).slice(0, 1000)} WHERE id=${job.run_id}`;
    await sql`UPDATE market_sources SET last_error='采集失败，详见运行记录',next_fetch_at=now()+interval '15 minutes' WHERE source_id=${source.source_id}`;
    throw error;
  } finally {
    await session`SELECT pg_advisory_unlock(hashtextextended(${`market-source:${source.source_id}`},0))`;
    session.release();
  }
}
async function extractJob(id: string) {
  const [doc] = await sql`SELECT * FROM market_documents WHERE id=${id}`;
  if (!doc || doc.status === "complete") return;
  const source = await loadSource(doc.source_id);
  if (!source || !source.enabled) return;
  try {
    const result = await extractDocument(
      {
        text: doc.text,
        source_url: doc.source_url,
        published_at: doc.published_at?.toISOString() ?? null,
      },
      source,
      await loadProducts(),
    );
    await sql.begin(async (db) => {
      await db`SELECT id FROM market_source_runs WHERE id=${doc.run_id} FOR UPDATE`;
      const [current] =
        await db`SELECT status FROM market_documents WHERE id=${id} FOR UPDATE`;
      if (current?.status === "complete") return;
      const stored = await storeCandidates(source, result.items, db);
      await db`INSERT INTO market_run_batches(run_id,batch_id,result) VALUES(${doc.run_id},${`document:${id}`},${db.json({ ...stored, processed: result.items.length })}) ON CONFLICT DO NOTHING`;
      await db`UPDATE market_documents SET status='complete',extracted_count=${result.items.length},receipt_id=${result.receiptId},error=NULL WHERE id=${id}`;
      await db`UPDATE market_source_runs SET parsed_count=parsed_count+${result.items.length},created_count=created_count+${stored.created},stage='extract' WHERE id=${doc.run_id}`;
      await finishRunIfComplete(doc.run_id, db);
    });
  } catch (error) {
    const message = String((error as Error).message).slice(0, 1000);
    await sql`UPDATE market_documents SET status='failed',error=${message} WHERE id=${id}`;
    await sql`UPDATE market_source_runs SET status='failed',stage='extract',error=${message},finished_at=now() WHERE id=${doc.run_id}`;
    throw error;
  }
}
export async function scheduleSources() {
  if (!marketConfig().collectEnabled || process.env.COLLECT_ENABLED !== "true")
    return { enqueued: 0 };
  const sources =
    await sql`SELECT source_id FROM market_sources WHERE enabled AND type NOT IN ('external','user_report') AND (next_fetch_at IS NULL OR next_fetch_at<=now()) ORDER BY next_fetch_at NULLS FIRST LIMIT 100`;
  for (const source of sources)
    await requestCollection(
      source.source_id,
      "schedule",
      `${source.source_id}:${Math.floor(Date.now() / 60000)}`,
    );
  const docs =
    await sql`SELECT id FROM market_documents WHERE status='pending' ORDER BY created_at LIMIT 100`;
  for (const doc of docs)
    await enqueueOn(
      extractQueue,
      { document_id: doc.id },
      { singletonKey: doc.id },
    );
  return { enqueued: sources.length };
}
export async function retryDocument(id: string) {
  const [doc] =
    await sql`SELECT source_id,status FROM market_documents WHERE id=${id}`;
  if (!doc || doc.status === "complete")
    throw Object.assign(new Error("文档不存在或已经完成"), { statusCode: 400 });
  const source = await loadSource(doc.source_id);
  if (!source?.enabled)
    throw Object.assign(new Error("信源已经停用"), { statusCode: 400 });
  await ensureQueue(extractQueue.name, extractQueue.options);
  return {
    ok: true,
    job_id: await enqueueOn(
      extractQueue,
      { document_id: id },
      { singletonKey: id },
    ),
  };
}
export async function scheduleBriefs() {
  const scopes =
    await sql`SELECT DISTINCT region_code,price_type FROM market_daily_prices WHERE date=${beijingToday()}`;
  for (const scope of scopes)
    await enqueueOn(
      briefQueue,
      {
        region_code: scope.region_code,
        price_type: scope.price_type,
        date: beijingToday(),
      },
      {
        singletonKey: `${scope.region_code}:${scope.price_type}:${beijingToday()}`,
      },
    );
  return { enqueued: scopes.length };
}
