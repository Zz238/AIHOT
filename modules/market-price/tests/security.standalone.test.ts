import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerMarket } from "../api/routes.ts";

test("推送鉴权、大小限制及 Schema 在访问数据库前拒绝非法请求", async () => {
  process.env.MARKET_INGEST_TOKEN = "offline-test-token-32-characters-long";
  const app = Fastify({ logger: false });
  registerMarket(app);
  try {
    const missing = await app.inject({
      method: "POST",
      url: "/api/market/ingest",
      payload: {},
    });
    assert.equal(missing.statusCode, 401);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/market/ingest",
      headers: {
        authorization: "Bearer " + process.env.MARKET_INGEST_TOKEN,
        "idempotency-key": "test-key1",
      },
      payload: { source_id: "x", items: [] },
    });
    assert.equal(invalid.statusCode, 400);
    const large = await app.inject({
      method: "POST",
      url: "/api/market/ingest",
      payload: { text: "x".repeat(600000) },
    });
    assert.equal(large.statusCode, 413);
    assert.equal(
      (await app.inject("/api/market/v1/prices?price_type=invalid")).statusCode,
      400,
    );
    assert.equal(
      (await app.inject("/api/market/v1/prices?date=2026-02-30")).statusCode,
      400,
    );
    assert.equal(
      (await app.inject("/api/market/v1/products/x/history?days=8")).statusCode,
      400,
    );
  } finally {
    await app.close();
    delete process.env.MARKET_INGEST_TOKEN;
  }
});
