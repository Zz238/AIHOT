// The price module's only public read layer: no raw payloads, secrets or pending observations escape.
import { sql } from "@aihot/backend/db";
import type { MarketQuery } from "./contracts.ts";
import { marketConfig } from "./config.ts";

export const beijingToday = () => new Date(Date.now()+8*3600000).toISOString().slice(0,10);
export async function cities() {
  return {data:await sql`SELECT r.region_code,r.name,r.enabled,max(p.date) AS latest_observation_date,
    count(DISTINCT p.product_id) FILTER (WHERE p.sample_count>0) AS product_coverage
    FROM market_regions r LEFT JOIN market_daily_prices p ON p.region_code=r.region_code WHERE r.enabled GROUP BY r.region_code ORDER BY r.name`};
}
export async function products(query: MarketQuery) {
  const data=await sql`SELECT product_id,name,category,subcategory,variant,default_unit FROM market_products
    WHERE (${query.category??null}::text IS NULL OR category=${query.category??null})
    ORDER BY name,variant,product_id LIMIT ${query.limit+1} OFFSET ${(query.page-1)*query.limit}`;
  return {data:data.slice(0,query.limit),page:query.page,limit:query.limit,has_more:data.length>query.limit};
}
function serializePrice(row: Record<string, unknown>) {
  const observed=row.date instanceof Date?row.date.toISOString().slice(0,10):String(row.date).slice(0,10);
  const distance=Math.round((Date.parse(beijingToday()+'T00:00:00Z')-Date.parse(observed+'T00:00:00Z'))/86400000);
  const freshness=distance<=0?'current':distance<=7?'recent_reference':'historical_reference';
  return {...row,date:observed,revision:row.revision,reference_low:row.reference_low??null,reference_high:row.reference_high??null,
    price:row.sample_count===1?row.median_price:null,unit:'元/斤',freshness,
    sufficient:row.data_quality==='sufficient',price_label:row.data_quality==='single_source'?'单一信源报价':'市场参考',
    notice:distance>0?'此为往期参考，不能作为当前购买价格':row.data_quality==='sufficient'?'本地已核验价格参考区间':'样本不足，未生成市场价格区间'};
}
export async function prices(query: MarketQuery) {
  const date=query.date??beijingToday();
  const data=await sql`SELECT p.*,d.name,d.category,d.variant FROM market_daily_prices p JOIN market_products d ON d.product_id=p.product_id
    WHERE p.region_code=${query.region_code} AND p.price_type=${query.price_type} AND p.date=${date} AND p.sample_count>0
      AND (${query.product_id??null}::text IS NULL OR p.product_id=${query.product_id??null})
      AND (${query.category??null}::text IS NULL OR d.category=${query.category??null})
    ORDER BY d.name,d.variant,p.product_id LIMIT ${query.limit+1} OFFSET ${(query.page-1)*query.limit}`;
  return {data:data.slice(0,query.limit).map(row=>serializePrice(row)),region_code:query.region_code,price_type:query.price_type,date,
    page:query.page,limit:query.limit,has_more:data.length>query.limit,has_data:!!data.length,notice:data.length?null:'所选地区和日期暂无已核验价格'};
}
export async function productDetail(id:string,query:MarketQuery) {
  const [product]=await sql`SELECT product_id,name,category,subcategory,variant,default_unit FROM market_products WHERE product_id=${id}`;
  if(!product)return null;
  const date=query.date??beijingToday();
  const [current]=await sql`SELECT * FROM market_daily_prices WHERE product_id=${id} AND region_code=${query.region_code}
    AND price_type=${query.price_type} AND date<=${date} AND sample_count>0 ORDER BY date DESC LIMIT 1`;
  const sources=current?await sql`SELECT DISTINCT s.name,s.publisher_key,o.market_name,o.source_url,o.observed_at,o.published_at,o.collected_at,
    o.original_price,o.original_unit,o.normalized_price,o.normalized_unit,o.price_type
    FROM market_observations o JOIN market_sources s ON s.source_id=o.source_id
    WHERE o.product_id=${id} AND o.region_code=${query.region_code} AND o.price_type=${query.price_type}
      AND o.observation_date=${current.date} AND o.review_status='verified' ORDER BY o.observed_at DESC LIMIT 100`:[];
  return {data:product,current:current?serializePrice(current):null,sources,notice:current?null:'暂无已核验报价'};
}
export async function history(id:string,query:MarketQuery) {
  const to=query.to??query.date??beijingToday();
  const from=query.from??new Date(Date.parse(to+'T00:00:00Z')-(query.days-1)*86400000).toISOString().slice(0,10);
  if(Date.parse(to)<Date.parse(from)||Date.parse(to)-Date.parse(from)>90*86400000)throw Object.assign(new Error('历史窗口必须在 90 天内且起止日期有序'),{statusCode:400});
  const data=await sql`SELECT * FROM market_daily_prices WHERE product_id=${id} AND region_code=${query.region_code} AND price_type=${query.price_type}
    AND date BETWEEN ${from} AND ${to} AND sample_count>0 ORDER BY date LIMIT ${query.limit+1} OFFSET ${(query.page-1)*query.limit}`;
  return {data:data.slice(0,query.limit).map(row=>serializePrice(row)),product_id:id,region_code:query.region_code,price_type:query.price_type,
    from,to,page:query.page,limit:query.limit,has_more:data.length>query.limit,notice:'未采集日期不填充、不插值'};
}
export async function dailyBrief(query:MarketQuery) {
  const date=query.date??beijingToday();
  const [data]=await sql`SELECT region_code,date,price_type,text,metrics,input_version,model_version,generated_at FROM market_briefs WHERE region_code=${query.region_code} AND date=${date} AND price_type=${query.price_type}`;
  return {data:data??null,notice:data?null:'当前日期数据不足或简报尚未生成'};
}
export function publicQuery(raw:Record<string,unknown>) {return {...raw,region_code:raw.region_code??marketConfig().defaultRegion};}
