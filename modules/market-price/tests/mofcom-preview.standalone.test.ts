import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { previewMofcomDaily } from "../backend/mofcom-preview.ts";

const html = await readFile(new URL("./fixtures/mofcom-tomato-excerpt.html", import.meta.url), "utf8");
const sourceUrl = "https://cif.mofcom.gov.cn/cif/seach.fhtml?commdityid=170120";
const options = { now: new Date("2026-10-13T12:00:00+08:00") };

test("仅取精确周谷堆当日价，其他安徽市场与全国行不成为合肥样本", () => {
  const extraRows = `
    <tr><td>安徽省</td><td>蚌埠海吉星蔬菜批发市场</td><td>2.4</td><td>1.5</td><td>-37.5</td><td></td></tr>
    <tr><td>北京市</td><td>北京市新发地农产品股份有限公司</td><td>2.7</td><td>2.7</td><td>0</td><td></td></tr>`;
  const result = previewMofcomDaily(html.replace("</table>", `${extraRows}</table>`), sourceUrl, options);
  assert.equal(result.inspected_market_rows, 3);
  assert.equal(result.observations.length, 1);
  const observation = result.observations[0];
  assert.equal(observation.candidate.region_code, "340100");
  assert.equal(observation.candidate.price_type, "wholesale");
  assert.equal(observation.candidate.price_value, 4.3);
  assert.equal(observation.validation.normalized_price, 2.15);
  assert.equal(observation.validation.normalized_unit, "元/斤");
  assert.equal(observation.evidence.previous_price_text, "4.2");
  assert.equal(observation.evidence.source_ratio_text, "-2.33");
  assert.throws(() => previewMofcomDaily(html.replace("enterid=3994", "enterid=3995"), sourceUrl, options), /市场/);
  assert.equal(previewMofcomDaily(html.replace("<td>安徽省</td>", "<td>江苏省</td>"), sourceUrl, options).observations.length, 0);
});

test("缺少规格的数据保持待审核，本地预览标识不冒充上游记录", () => {
  const result = previewMofcomDaily(html, sourceUrl, options);
  const observation = result.observations[0];
  assert.equal(observation.candidate.variant, "");
  assert.equal(observation.candidate.source_record_id, null);
  assert.equal(observation.validation.product_id, null);
  assert.equal(observation.validation.review_status, "pending");
  assert.ok(observation.validation.quality_flags.includes("unknown_product_or_variant"));
  assert.ok(observation.validation.quality_flags.includes("source_terms_unconfirmed"));
  assert.equal(observation.identity_origin, "local_preview_only");
  assert.match(observation.preview_identity, /^preview:[a-f0-9]{64}$/);
  assert.match(observation.evidence.row_html, /<td>4\.3<\/td>/);
  assert.equal(result.source_terms_confirmed, false);
  assert.equal(result.read_only, true);
});

test("观测日期来自标题与表单，不采用来源URL日期或运行当天", () => {
  const result = previewMofcomDaily(html, `${sourceUrl}&searchDate=2099-01-01`, options);
  const observation = result.observations[0];
  assert.equal(observation.candidate.observed_at, "2026-10-11");
  assert.equal(observation.candidate.published_at, null);
  assert.equal(observation.validation.observation_date, "2026-10-11");
  assert.match(observation.candidate.evidence_text, /2026-10-11西红柿批发价格行情/);
  assert.match(observation.evidence.unit_text, /元\/公斤/);
});

test("非法日期、单位、来源与结构变动明确失败，不兜底生成报价", () => {
  for (const changed of [
    html.replaceAll("2026-10-11", "2026-02-30"),
    html.replace('name="searchDate" value="2026-10-11"', 'name="searchDate" value="2026-10-10"'),
    html.replace("元/公斤", "元/箱"),
    html.replace("<td>当日价格</td>", "<td>价格指数</td>"),
    html.replace('id="goaler"', 'id="other"'),
    html.replace("<td>4.3</td>", "<td>4.3–4.8</td>"),
  ]) assert.throws(() => previewMofcomDaily(changed, sourceUrl, options));
  assert.throws(() => previewMofcomDaily(html, sourceUrl.replace("cif.mofcom.gov.cn", "example.org"), options), /来源 URL/);
});
