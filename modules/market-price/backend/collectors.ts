import { load } from "cheerio";
import { setTimeout } from "node:timers/promises";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { fetchRss } from "@aihot/backend/sources/rss";
import { getPath } from "@aihot/backend/sources/json-list";
import { readable } from "@aihot/backend/content/extract";
import { SITE } from "@aihot/site";
import type { SourceRow } from "@aihot/backend/sources/types";
import { candidateSchema, type Candidate, type Source } from "./contracts.ts";
import { collectAnhuiWeekly } from "./anhui-source.ts";
import type { AnhuiEnvelope } from "./anhui-preview.ts";

export interface Document {
  source_url: string;
  published_at: string | null;
  text: string;
}
export interface Collected {
  items: Candidate[];
  documents: Document[];
  urls: string[];
  monitoring?: AnhuiEnvelope[];
}
const string = (v: unknown) =>
  v === undefined || v === null ? null : String(v).trim();

function fromFields(
  row: unknown,
  source: Source,
  field: (name: string) => unknown,
  evidence: string,
  url: string,
): Candidate {
  const value = field("price_value");
  const number =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/^[￥¥]\s*/, ""));
  return candidateSchema.parse({
    product_name: string(field("product_name")),
    variant: string(field("variant")) ?? "",
    price_value:
      value === null || value === undefined || value === "" ? NaN : number,
    price_unit: string(field("price_unit")),
    observed_at: string(field("observed_at")),
    published_at: string(field("published_at")),
    price_type: string(field("price_type")) ?? source.price_type,
    region_code: string(field("region_code")) ?? source.region_code,
    market_id: string(field("market_id")) ?? source.market_id,
    market_name: string(field("market_name")),
    source_record_id: string(field("source_record_id")),
    source_url: string(field("source_url"))
      ? new URL(String(field("source_url")), url).toString()
      : url,
    evidence_text: evidence.slice(0, 10000),
    evidence_method: "structured",
    weight_grams: field("weight_grams") ? Number(field("weight_grams")) : null,
  });
}

export function parseJson(
  payload: unknown,
  source: Source,
  url = source.url!,
): Candidate[] {
  const rows = source.config.items_path
    ? getPath(payload, source.config.items_path)
    : payload;
  if (!Array.isArray(rows))
    throw new Error("JSON items_path 未匹配数组，请检查信源结构");
  if (rows.length > 5000) throw new Error("单页记录超过 5000，必须配置分页");
  return rows.map((row) =>
    fromFields(
      row,
      source,
      (name) =>
        source.config.fields[name]
          ? getPath(row, source.config.fields[name])
          : getPath(row, name),
      JSON.stringify(row),
      url,
    ),
  );
}

export function parseHtml(
  html: string,
  source: Source,
  url = source.url!,
): { items: Candidate[]; next: string | null } {
  const $ = load(html);
  const nodes = $(source.config.row_selector).toArray();
  if (!nodes.length)
    throw new Error(
      "HTML 行选择器未匹配；页面结构改变或需要脚本渲染，当前采集器不支持",
    );
  if (nodes.length > 5000) throw new Error("HTML 单页行数超过 5000");
  const pageDate = source.config.date_selector
    ? $(source.config.date_selector).first().text().trim()
    : null;
  const items = nodes.map((node) => {
    const row = $(node);
    return fromFields(
      null,
      source,
      (name) => {
        const selector = source.config.fields[name];
        if (!selector) return name === "observed_at" ? pageDate : null;
        const split = selector.lastIndexOf("@");
        const target = row
          .find(split < 0 ? selector : selector.slice(0, split))
          .first();
        return split < 0
          ? target.text().trim() || null
          : (target.attr(selector.slice(split + 1)) ?? null);
      },
      [pageDate, row.text().replace(/\s+/g, " ").trim()]
        .filter(Boolean)
        .join("\n"),
      url,
    );
  });
  const href = source.config.next_selector
    ? $(source.config.next_selector).first().attr("href")
    : null;
  return { items, next: href ? new URL(href, url).toString() : null };
}

/** Read only an explicitly permitted source. Every page and redirect uses the engine's SSRF guard. */
export async function collect(source: Source): Promise<Collected> {
  if (!source.config.terms_confirmed)
    throw new Error("请先确认来源条款允许采集");
  if (!source.url) throw new Error("该信源只接受外部推送，不支持抓取");
  const target = new URL(source.url);
  const robots = await fetchListing(new URL("/robots.txt", target).toString(), {
    timeoutMs: 10000,
    maxBytes: 256000,
  });
  if (robots.status !== 404 && robots.status !== 200)
    throw new Error("无法核对 robots.txt，暂不采集");
  if (robots.status === 200 && !robotsAllowed(robots.text(), target.pathname))
    throw new Error("robots.txt 禁止访问该路径");
  if (source.config.adapter === "anhui_weekly") {
    const result = await collectAnhuiWeekly(source, (path) => robots.status === 404 || robotsAllowed(robots.text(), path));
    return { items: [], documents: [], ...result };
  }
  if (source.type === "rss_article") {
    const feed = await fetchRss({
      id: source.source_id,
      name: source.name,
      kind: "rss",
      config: { feedUrl: source.url, summaryIsBody: true },
      tier: "T2",
      participation_mode: "isolated",
      first_party: false,
      interval_minutes: source.interval_minutes,
      enabled: source.enabled,
      cursor: null,
      fail_count: 0,
    } satisfies SourceRow);
    const result: Collected = {
      items: [],
      urls: [source.url],
      documents: feed.candidates.slice(0, 100).map((c) => ({
        source_url: c.url,
        published_at: c.publishedAt?.toISOString() ?? null,
        text: `${c.title}\n${c.bodyText ?? c.excerpt ?? ""}`,
      })),
    };
    if (source.config.fetch_article_body) {
      const started = Date.now();
      for (const doc of result.documents.slice(0, 10)) {
        if (Date.now() - started > 240000) break;
        const article = new URL(doc.source_url);
        if (article.origin !== target.origin)
          throw new Error(
            "RSS 正文补抓仅支持同源已授权网页，请为其他来源单独配置信源",
          );
        if (
          robots.status === 200 &&
          !robotsAllowed(robots.text(), article.pathname)
        )
          throw new Error("robots.txt 禁止 RSS 正文路径");
        await setTimeout(source.config.page_delay_ms);
        const response = await fetchListing(doc.source_url, {
          timeoutMs: 15000,
          maxBytes: 2 * 1024 * 1024,
        });
        if (response.status !== 200)
          throw new Error(`RSS 正文 HTTP ${response.status}`);
        const html = response.text();
        let readableText: string | null = null;
        try {
          readableText = readable(html, response.url, "+08:00")?.text ?? null;
        } catch {
          /* Malformed HTML can still contain an explicit article element. */
        }
        const text = readableText ?? load(html)("article").text().trim();
        if (!text)
          throw new Error(
            "RSS 网页正文未能解析，请确认页面结构或提供包含全文的订阅源",
          );
        doc.text = text.slice(0, 100000);
        result.urls.push(response.url);
      }
    }
    return result;
  }
  if (source.type !== "json_api" && source.type !== "html_table")
    throw new Error("推送信源不支持主动采集");
  const headers: Record<string, string> = {
    accept: source.type === "json_api" ? "application/json" : "text/html",
  };
  if (source.config.auth_env) {
    const token = process.env[source.config.auth_env];
    if (!token) throw new Error("信源服务端认证未配置");
    headers.authorization = `Bearer ${token}`;
  }
  const out: Collected = { items: [], documents: [], urls: [] };
  const seen = new Set<string>();
  let url: string | null = source.url;
  for (let page = 1; page <= source.config.max_pages && url; page++) {
    if (page > 1) await setTimeout(source.config.page_delay_ms);
    if (source.type === "json_api" && source.config.max_pages > 1) {
      const u = new URL(source.url);
      u.searchParams.set(source.config.page_param, String(page));
      url = u.toString();
    }
    if (seen.has(url)) throw new Error("分页形成循环");
    seen.add(url);
    if (new URL(url).origin !== target.origin)
      throw new Error("分页不可跨信源域名");
    if (
      robots.status === 200 &&
      !robotsAllowed(robots.text(), new URL(url).pathname)
    )
      throw new Error("robots.txt 禁止分页路径");
    const response = await fetchListing(url, {
      method: source.config.method,
      headers,
      body: source.config.body,
      timeoutMs: 20000,
      maxBytes: 2 * 1024 * 1024,
    });
    if (response.status !== 200)
      throw new Error(`信源 HTTP ${response.status}`);
    out.urls.push(response.url);
    if (source.type === "json_api") {
      const items = parseJson(
        JSON.parse(response.text()),
        source,
        response.url,
      );
      out.items.push(...items);
      if (!items.length) break;
    } else {
      const parsed = parseHtml(response.text(), source, response.url);
      out.items.push(...parsed.items);
      url = parsed.next;
    }
  }
  return out;
}

/** Conservative interpretation: any matching Disallow holds even when a shorter Allow exists. */
export function robotsAllowed(text: string, path: string): boolean {
  let agents: string[] = [];
  let rulesStarted = false;
  const crawler = SITE.crawlerName.split("/")[0].toLowerCase();
  for (const line of text.split(/\r?\n/)) {
    const clean = line.split("#")[0].trim();
    const agent = /^user-agent:\s*(.+)$/i.exec(clean);
    if (agent) {
      if (rulesStarted) {
        agents = [];
        rulesStarted = false;
      }
      agents.push(agent[1].trim().toLowerCase());
      continue;
    }
    if (/^(disallow|allow):/i.test(clean)) rulesStarted = true;
    const applies = agents.some(
      (value) => value === "*" || crawler.startsWith(value),
    );
    const disallow = /^disallow:\s*(.*)$/i.exec(clean)?.[1];
    if (applies && disallow) {
      const anchored = disallow.endsWith("$");
      const pattern = (anchored ? disallow.slice(0, -1) : disallow)
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      if (new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path))
        return false;
    }
  }
  return true;
}
