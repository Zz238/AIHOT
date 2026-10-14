import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { anhuiSourcePreset, collectAnhuiWeekly } from "../backend/anhui-source.ts";
import { collect } from "../backend/collectors.ts";
import { sourceSchema } from "../backend/contracts.ts";
import type { fetchListing } from "@aihot/backend/sources/listing-fetch";

const fixture = JSON.parse(await readFile(new URL("./fixtures/anhui-weekly-excerpt.json", import.meta.url), "utf8"));
const source = { ...anhuiSourcePreset(), last_success_at: null, next_fetch_at: null, last_error: null };
source.config.goods_codes = ["101001"];
const calls: { url: string; method: string }[] = [];
const reader: typeof fetchListing = async (input, options) => {
  const url = new URL(input); calls.push({ url: input, method: options?.method ?? "GET" });
  let body: unknown;
  if (url.pathname === "/jfcx/sp/") body = '<script src="/js/jiafeichaxun_ShiPin.js"></script>https://ahjgxx.in.ah.cn/prod-api';
  else if (url.pathname.endsWith(".js")) body = 'publicInterfaceInfo?username=publicFixture&password=fixture-access-only&function=53bdb205-12b5-4c16-bc99-1e78843494f8&classId=-1"';
  else if (url.searchParams.get("function") === "53bdb205-12b5-4c16-bc99-1e78843494f8") body = { success: true, data: [{ code: "101000", name: "蔬菜" }] };
  else if (url.searchParams.get("function") === "d317555d-69de-446e-9751-df7d03b7ccaa") body = { success: true, data: [fixture.catalog.region] };
  else if (url.searchParams.get("function") === "944b1654-0072-4beb-b87a-091016de5e79") body = { success: true, data: [fixture.catalog.product] };
  else { assert.equal(url.searchParams.get("regionCode"), "340100000"); body = fixture.response; }
  return { status: 200, url: input, headers: new Headers(), body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)), text: () => typeof body === "string" ? body : JSON.stringify(body) };
};

test("在线适配执行地区和商品查询，返回独立监测内容且不记录访问参数", async () => {
  calls.length = 0;
  const result = await collectAnhuiWeekly(source, () => true, reader);
  assert.equal(result.monitoring.length, 1);
  assert.equal(result.monitoring[0].query.regionCode, "340100000");
  assert.ok(calls.slice(2).every((call) => call.method === "POST"));
  assert.ok(!JSON.stringify(result).includes("fixture-access-only"));
  assert.ok(result.urls.every((url) => !url.includes("password=")));
  assert.equal(source.config.terms_confirmed, false);
  await assert.rejects(collect(source), /条款/);
});

test("所需路径被禁止时不发请求；读取错误不泄露前端访问参数", async () => {
  calls.length = 0;
  await assert.rejects(collectAnhuiWeekly(source, (path) => !path.includes("prod-api"), reader), /robots/);
  assert.equal(calls.length, 0);
  const failing: typeof fetchListing = async (input, options) => {
    if (input.includes("publicInterfaceInfo")) throw new Error(input);
    return reader(input, options);
  };
  await assert.rejects(collectAnhuiWeekly(source, () => true, failing), (error: Error) => !error.message.includes("password") && /读取失败/.test(error.message));
  assert.throws(() => sourceSchema.parse({ ...anhuiSourcePreset(), region_code: "310100" }));
});
