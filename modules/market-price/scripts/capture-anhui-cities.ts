import { writeFile } from "node:fs/promises";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { anhuiSourcePresets, collectAnhuiWeekly } from "../backend/anhui-source.ts";

// Explicit, finite local experiment: no scheduling, settings changes, database writes or model calls.
const output = process.argv[2];
if (!output) throw new Error("提供本地输出文件路径，仅执行一次安徽16市目录采样");
const metadata = new Map<string, Awaited<ReturnType<typeof fetchListing>>>();
const read: typeof fetchListing = async (url, options) => {
  const isPrice = new URL(url).searchParams.has("goodsCode");
  if (!isPrice && metadata.has(url)) return metadata.get(url)!;
  const response = await fetchListing(url, options);
  if (!isPrice && response.status === 200) metadata.set(url, response);
  return response;
};
const robots = await fetchListing("https://ahjgxx.in.ah.cn/robots.txt", { timeoutMs: 15000, maxBytes: 1024 * 1024 });
if (robots.status !== 404) throw new Error("robots状态改变，需先核实允许的查询路径");
const capture: { captured_at: string; envelopes: unknown[]; failures: { region_code: string; reason: string }[] } = { captured_at: new Date().toISOString(), envelopes: [], failures: [] };
for (const preset of anhuiSourcePresets().filter(source => source.region_code !== "340000")) {
  try {
    const result = await collectAnhuiWeekly({ ...preset, last_success_at: null, next_fetch_at: null, last_error: null }, () => true, read);
    capture.envelopes.push(...result.monitoring);
    console.log({ region_code: preset.region_code, products: result.monitoring.length });
  } catch {
    capture.failures.push({ region_code: preset.region_code, reason: "来源读取或结构校验失败，未生成该市新记录" });
  }
  await writeFile(output, JSON.stringify(capture, null, 2));
}
if (capture.failures.length) process.exitCode = 1;
