import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "node:http";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import {
  getBoss,
  stopBoss,
  ensureQueue,
  enqueueOn,
} from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { seedDictionary } from "../scripts/seed.ts";
import { saveSource } from "../backend/repository.ts";
import {
  requestCollection,
  collectQueue,
  validateQueue,
  extractQueue,
  aggregateQueue,
  briefQueue,
} from "../backend/jobs.ts";
import { querySchema } from "../backend/contracts.ts";
import { prices } from "../backend/publication.ts";
import { source, candidate } from "./fixtures.ts";
import market from "../server.ts";
import { marketFindings } from "../backend/alerts.ts";

installModules([market]);
await seedDictionary();
after(async () => {
  await stopBoss();
  await closeDb();
});
test("真实 PostgreSQL 队列串联本地采集、校验、聚合、简报和 RSS 提取，重放安全", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.end("User-agent: *\nDisallow:");
      return;
    }
    if (req.url === "/article") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        "<html><title>固定价格文章</title><article><p>观测日期：2026年02月05日。</p><p>普通番茄每公斤4.80元。</p><p>" +
          "固定本地文章，仅用于解析验证。".repeat(40) +
          "</p></article></html>",
      );
      return;
    }
    if (req.url === "/rss") {
      res.setHeader("Content-Type", "application/rss+xml");
      res.end(
        `<?xml version="1.0"?><rss version="2.0"><channel><title>固定测试</title><link>http://127.0.0.1</link><description>固定历史报价</description><item><title>本地报价</title><link>http://127.0.0.1:${(server.address() as { port: number }).port}/article</link><description>查看原文的明确报价。</description></item></channel></rss>`,
      );
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([candidate]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const originalPrivate = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  process.env.MARKET_COLLECT_ENABLED = "true";
  try {
    await saveSource(
      {
        ...source,
        source_id: "queue-json",
        url: base + "/prices",
        config: { terms_confirmed: true },
      },
      "test",
      "仅本地样本",
    );
    const boss = await getBoss();
    const requested = await requestCollection(
      "queue-json",
      "test",
      "queue-local-001",
    );
    const collectJobs = await boss.fetch<{
      source_id: string;
      run_id: string;
      trigger: string;
    }>(collectQueue.name);
    assert.equal(collectJobs.length, 1);
    await collectQueue.run(collectJobs.map((job) => job.data));
    await boss.complete(collectQueue.name, collectJobs[0]!.id);
    const validateJobs = await boss.fetch<{
      source_id: string;
      items: (typeof candidate)[];
      run_id: string;
    }>(validateQueue.name);
    assert.equal(validateJobs.length, 1);
    await validateQueue.run(validateJobs.map((job) => job.data));
    await validateQueue.run(validateJobs.map((job) => job.data));
    const [run] =
      await sql`SELECT * FROM market_source_runs WHERE id=${requested.run_id}`;
    assert.equal(run.created_count, 1);
    assert.equal(run.parsed_count, 1);
    assert.equal(run.status, "ok");
    assert.equal(
      (
        await sql`SELECT result FROM market_run_batches WHERE run_id=${requested.run_id}`
      ).length,
      1,
    );
    await ensureQueue(aggregateQueue.name, aggregateQueue.options);
    const scope = {
      region_code: "340100",
      product_id: "tomato",
      price_type: "retail",
      observation_date: "2026-02-05",
    };
    await enqueueOn(aggregateQueue, scope);
    const aggregates = await boss.fetch<typeof scope>(aggregateQueue.name);
    await aggregateQueue.run(aggregates.map((job) => job.data));
    assert.equal(
      (await prices(querySchema.parse({ date: "2026-02-05" }))).data[0]!.price,
      2.4,
    );
    const originalModels = config.modelCallsEnabled;
    config.modelCallsEnabled = false;
    try {
      await enqueueOn(briefQueue, {
        region_code: "340100",
        date: "2026-02-05",
        price_type: "retail",
      });
      const briefs = await boss.fetch<{
        region_code: string;
        date: string;
        price_type: string;
      }>(briefQueue.name);
      await briefQueue.run(briefs.map((job) => job.data));
    } finally {
      config.modelCallsEnabled = originalModels;
    }
    assert.equal((await sql`SELECT * FROM market_briefs`).length, 1);
    await saveSource(
      {
        ...source,
        source_id: "queue-rss",
        type: "rss_article",
        url: base + "/rss",
        config: {
          terms_confirmed: true,
          fetch_article_body: true,
          page_delay_ms: 250,
        },
      },
      "test",
      "本地 RSS 样本",
    );
    await requestCollection("queue-rss", "test", "queue-rss-001");
    const rssJobs = await boss.fetch<{
      source_id: string;
      run_id: string;
      trigger: string;
    }>(collectQueue.name);
    await collectQueue.run(rssJobs.map((job) => job.data));
    const extracts = await boss.fetch<{ document_id: string }>(
      extractQueue.name,
    );
    assert.equal(extracts.length, 1);
    await extractQueue.run(extracts.map((job) => job.data));
    await extractQueue.run(extracts.map((job) => job.data));
    const [doc] =
      await sql`SELECT * FROM market_documents WHERE source_id='queue-rss'`;
    assert.equal(doc.status, "complete");
    assert.equal(doc.extracted_count, 1);
    const [observation] =
      await sql`SELECT review_status,observation_date FROM market_observations WHERE source_id='queue-rss'`;
    assert.equal(observation.review_status, "pending");
    assert.equal(
      observation.observation_date.toISOString().slice(0, 10),
      "2026-02-05",
    );
  } finally {
    delete process.env.MARKET_COLLECT_ENABLED;
    config.allowPrivateNetworkFetch = originalPrivate;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("价格失败接入已有告警总线，暂停采集后不误报警", async () => {
  process.env.MARKET_COLLECT_ENABLED = "true";
  try {
    await sql`INSERT INTO market_source_runs(id,source_id,trigger,status,error) VALUES('alert-fixture','queue-json','test','failed','固定解析失败')`;
    assert.ok(
      (await marketFindings(Date.now())).some(
        (finding) => finding.key === "market.source:queue-json",
      ),
    );
  } finally {
    delete process.env.MARKET_COLLECT_ENABLED;
  }
  assert.deepEqual(await marketFindings(Date.now()), []);
});
