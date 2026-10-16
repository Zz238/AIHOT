import { readFile } from "node:fs/promises";
import { previewAnhuiWeekly } from "../backend/anhui-preview.ts";

const [inputPath, ...extra] = process.argv.slice(2);
if (!inputPath || extra.length) {
  console.error("用法：node modules/market-price/scripts/preview-anhui.ts <本地 UTF8 JSON：含查询参数、目录和返回数据>");
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(previewAnhuiWeekly(JSON.parse(await readFile(inputPath, "utf8"))), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "安徽监测价格离线解析失败");
    process.exitCode = 1;
  }
}
