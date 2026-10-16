import { readFile } from "node:fs/promises";
import { previewMofcomDaily } from "../backend/mofcom-preview.ts";

const [inputPath, sourceUrl, ...extra] = process.argv.slice(2);
if (!inputPath || !sourceUrl || extra.length) {
  console.error(
    "用法：node modules/market-price/scripts/preview-mofcom.ts <本地 UTF8 HTML 文件> <原页面 URL>\n仅离线解析，不联网、不读取 .env、不入库。",
  );
  process.exitCode = 1;
} else {
  try {
    const html = await readFile(inputPath, "utf8");
    console.log(JSON.stringify(previewMofcomDaily(html, sourceUrl), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "离线解析失败");
    process.exitCode = 1;
  }
}
