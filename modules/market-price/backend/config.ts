export function marketConfig() {
  const token = process.env.MARKET_INGEST_TOKEN ?? "";
  if (token && token.length < 32) throw new Error("MARKET_INGEST_TOKEN 至少需要 32 位");
  const region = process.env.MARKET_DEFAULT_REGION ?? "340100";
  if (!/^\d{6}$/.test(region)) throw new Error("MARKET_DEFAULT_REGION 必须为六位地区代码");
  return {
    collectEnabled: process.env.MARKET_COLLECT_ENABLED === "true",
    aiReviewEnabled: process.env.MARKET_AI_REVIEW_ENABLED !== "false",
    ingestToken: token, defaultRegion: region,
  };
}
