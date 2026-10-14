import { sql, closeDb } from "@aihot/backend/db";
import { loadSource, saveSource } from "../backend/repository.ts";
import { anhuiSourcePreset } from "../backend/anhui-source.ts";

try {
  const preset = anhuiSourcePreset();
  const existing = await loadSource(preset.source_id);
  if (!existing) {
    await sql`INSERT INTO market_regions(region_code,name) VALUES('340100','合肥市') ON CONFLICT DO NOTHING`;
    await saveSource(preset, "setup", "登记用户指定的安徽监测信息源；默认停用，未确认持续采集许可");
  }
  console.log({ source_id: preset.source_id, created: !existing, enabled: existing?.enabled ?? false, terms_confirmed: existing?.config.terms_confirmed ?? false });
} finally {
  await closeDb();
}
