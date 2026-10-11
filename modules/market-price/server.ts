import { defineServerModule } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";
import { registerMarket } from "./api/routes.ts";
import { queues, scheduleSources, scheduleBriefs } from "./backend/jobs.ts";
import { marketConfig } from "./backend/config.ts";
import { marketFindings } from "./backend/alerts.ts";

export default defineServerModule({
  name: "market-price",
  http: registerMarket,
  queues,
  models: {
    marketExtract: {
      label: "价格证据提取",
      env: "MARKET_EXTRACT_MODEL",
      purposes: ["market_extract"],
    },
    marketBrief: {
      label: "价格简报措辞",
      env: "MARKET_BRIEF_MODEL",
      purposes: ["market_brief"],
    },
  },
  schedules: [
    {
      name: "market.collect.due",
      cron: "* * * * *",
      run: scheduleSources,
      when: () => marketConfig().collectEnabled,
    },
    { name: "market.brief.daily", cron: "15 * * * *", run: scheduleBriefs },
  ],
  admin: {
    counts: {
      "market.pending": async () =>
        Number(
          (
            await sql`SELECT count(*) AS count FROM market_observations WHERE review_status='pending'`
          )[0].count,
        ),
    },
  },
  alerts: marketFindings,
  retention: async (now) => {
    const result =
      await sql`UPDATE market_observations o SET raw_payload=NULL FROM market_sources s WHERE o.source_id=s.source_id AND o.collected_at<${now}::timestamptz-(coalesce((s.config->>'retention_days')::integer,180))*interval '1 day' AND o.review_status<>'pending' AND o.raw_payload IS NOT NULL`;
    return { market_raw_payloads_cleared: result.count };
  },
});
