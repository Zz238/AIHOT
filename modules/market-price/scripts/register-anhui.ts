import { sql, closeDb } from "@aihot/backend/db";
import { loadSource, saveSource } from "../backend/repository.ts";
import { anhuiSourcePresets } from "../backend/anhui-source.ts";
import { anhuiRegion } from "../backend/anhui-regions.ts";

try {
  for (const preset of anhuiSourcePresets()) {
    const existing = await loadSource(preset.source_id);
    if (!existing) {
      await sql`INSERT INTO market_regions(region_code,name) VALUES(${preset.region_code},${anhuiRegion(preset.region_code)!.name}) ON CONFLICT DO NOTHING`;
      await saveSource(preset, "setup", "登记用户指定的安徽监测信息源；默认停用，未确认持续采集许可");
    }
    console.log({ source_id: preset.source_id, created: !existing, enabled: existing?.enabled ?? false, terms_confirmed: existing?.config.terms_confirmed ?? false });
  }
} finally {
  await closeDb();
}
