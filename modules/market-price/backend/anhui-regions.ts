/** 地区代码与名称来自安徽价格信息的地区目录，不包含区县。 */
export const anhuiRegions = [
  { region_code: "340000", source_region_code: "340000000", name: "安徽省", scope: "province" },
  { region_code: "340100", source_region_code: "340100000", name: "合肥市", scope: "city" },
  { region_code: "340200", source_region_code: "340200000", name: "芜湖市", scope: "city" },
  { region_code: "340300", source_region_code: "340300000", name: "蚌埠市", scope: "city" },
  { region_code: "340400", source_region_code: "340400000", name: "淮南市", scope: "city" },
  { region_code: "340500", source_region_code: "340500000", name: "马鞍山市", scope: "city" },
  { region_code: "340600", source_region_code: "340600000", name: "淮北市", scope: "city" },
  { region_code: "340700", source_region_code: "340700000", name: "铜陵市", scope: "city" },
  { region_code: "340800", source_region_code: "340800000", name: "安庆市", scope: "city" },
  { region_code: "341000", source_region_code: "341000000", name: "黄山市", scope: "city" },
  { region_code: "341100", source_region_code: "341100000", name: "滁州市", scope: "city" },
  { region_code: "341200", source_region_code: "341200000", name: "阜阳市", scope: "city" },
  { region_code: "341300", source_region_code: "341300000", name: "宿州市", scope: "city" },
  { region_code: "341500", source_region_code: "341500000", name: "六安市", scope: "city" },
  { region_code: "341600", source_region_code: "341600000", name: "亳州市", scope: "city" },
  { region_code: "341700", source_region_code: "341700000", name: "池州市", scope: "city" },
  { region_code: "341800", source_region_code: "341800000", name: "宣城市", scope: "city" },
] as const;

export function anhuiRegion(code: string) {
  return anhuiRegions.find(region => region.region_code === code || region.source_region_code === code);
}
