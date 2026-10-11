import { sql, closeDb } from "@aihot/backend/db";
import { saveProduct } from "../backend/repository.ts";

export async function seedDictionary() {
  await sql`INSERT INTO market_regions(region_code,name) VALUES('340100','合肥市') ON CONFLICT DO NOTHING`;
  const products = [
    {
      product_id: "tomato",
      name: "番茄",
      category: "蔬菜",
      variant: "普通番茄",
      aliases: ["西红柿"],
    },
    {
      product_id: "cherry-tomato",
      name: "圣女果",
      category: "蔬菜",
      variant: "圣女果",
      aliases: ["小番茄"],
    },
    {
      product_id: "fruit-tomato",
      name: "水果番茄",
      category: "蔬菜",
      variant: "水果番茄",
      aliases: [],
    },
    {
      product_id: "potato",
      name: "土豆",
      category: "蔬菜",
      variant: "普通土豆",
      aliases: ["洋芋", "马铃薯"],
    },
    {
      product_id: "pork-belly",
      name: "猪肉",
      category: "肉蛋",
      variant: "五花肉",
      aliases: ["五花肉"],
    },
    {
      product_id: "egg",
      name: "鸡蛋",
      category: "肉蛋",
      variant: "普通鸡蛋",
      aliases: ["鲜鸡蛋"],
    },
  ];
  const existing = await sql`SELECT product_id FROM market_products`;
  for (const product of products)
    if (!existing.some((row) => row.product_id === product.product_id))
      await saveProduct(product, "setup", "初始化商品字典，不包含报价样本");
  return { products: products.length, region: "340100" };
}
if (import.meta.main) {
  try {
    console.log(await seedDictionary());
  } finally {
    await closeDb();
  }
}
