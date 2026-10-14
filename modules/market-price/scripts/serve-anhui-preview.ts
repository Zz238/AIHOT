import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { monitoringReference, monitoringResponse, monitoringQuerySchema } from "../backend/publication.ts";
import { anhuiRegions } from "../backend/anhui-regions.ts";
import { previewAnhuiWeekly } from "../backend/anhui-preview.ts";

// 有限读取的真实样本仅用于本机联调；不启用采集、修改来源许可或写入运行数据库。
const file = process.argv[2];
if (!file) throw new Error("提供已保存的安徽查询样本文件路径（envelopes数组与captured_at）");
const capture = JSON.parse(await readFile(file, "utf8"));
if (!Array.isArray(capture.envelopes) || !Number.isFinite(Date.parse(capture.captured_at)))
  throw new Error("本地样本文件格式无效");
const references = capture.envelopes.map((envelope: unknown) => ({
  region: previewAnhuiWeekly(envelope).region.region_code,
  product: monitoringReference(envelope, capture.captured_at),
}));
const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") { res.writeHead(405); res.end(JSON.stringify({ error: "只读本地预览" })); return; }
  try {
    const url = new URL(req.url!, "http://127.0.0.1:3020");
    if (url.pathname === "/api/market/v1/monitoring/cities") {
      res.end(JSON.stringify({ data: anhuiRegions.map(region => ({ ...region,
        product_coverage: references.filter((row: { region: string }) => row.region === region.region_code).length,
      })), local_preview: true })); return;
    }
    if (url.pathname !== "/api/market/v1/monitoring") { res.writeHead(404); res.end("{}"); return; }
    const query = monitoringQuerySchema.parse(Object.fromEntries(url.searchParams));
    const data = references.filter((row: { region: string; product: ReturnType<typeof monitoringReference> }) => row.region === query.region_code && (!query.goods_code || row.product.goods_code === query.goods_code))
      .map((row: { product: ReturnType<typeof monitoringReference> }) => row.product);
    res.end(JSON.stringify({ ...monitoringResponse(query.region_code, data), local_preview: true }));
  } catch { res.writeHead(400); res.end(JSON.stringify({ error: "地区或商品筛选无效" })); }
});
server.listen(3020, "127.0.0.1", () => console.log("安徽监测本机预览已就绪 http://127.0.0.1:3020，仅使用已保存样本，无持续采集"));
