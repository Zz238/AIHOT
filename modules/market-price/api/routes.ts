import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { adminHandler } from "../../../apps/api/src/routes/admin-auth.ts";
import { sendProblem,applyPublicHeaders } from "../../../apps/api/src/http/respond.ts";
import { actorOf } from "@aihot/backend/admin/auth";
import { audit } from "@aihot/backend/audit";
import { sql } from "@aihot/backend/db";
import { sha256 } from "@aihot/backend/lib/ids";
import { config } from "@aihot/backend/config";
import { ingestSchema, querySchema, regionCode, priceType, calendarDate } from "../backend/contracts.ts";
import { marketConfig } from "../backend/config.ts";
import { collect, parseHtml, parseJson } from "../backend/collectors.ts";
import { ingestBatch, loadProducts, loadSource, reviewObservation, saveProduct, saveSource, setSourceEnabled } from "../backend/repository.ts";
import { requestCollection, retryDocument, aggregateQueue } from "../backend/jobs.ts";
import { enqueueOn, ensureQueue } from "@aihot/backend/jobs/queue";
import { generateBrief } from "../backend/briefs.ts";
import * as publication from "../backend/publication.ts";

const body=(req:FastifyRequest)=>req.body as Record<string,unknown>;
const param=(req:FastifyRequest,key:string)=>(req.params as Record<string,string>)[key];
const reasonSchema=z.string().trim().min(1).max(2000);
const pager=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(30),source_id:z.string().max(120).optional(),status:z.string().max(40).optional()});
const scopesSchema=z.strictObject({region_code:regionCode,date:calendarDate,price_type:priceType,reason:reasonSchema});

function problem(req:FastifyRequest,reply:FastifyReply,status:number,code:string,detail:string) {return sendProblem(req,reply,{status,code,detail});}
const limits=new Map<string,{count:number;until:number}>();
function limited(key:string,maximum:number) {
  const now=Date.now();
  if(limits.size>10000){for(const [k,v] of limits)if(v.until<=now)limits.delete(k);if(limits.size>10000)return true;}
  const value=limits.get(key);const next=value&&value.until>now?{count:value.count+1,until:value.until}:{count:1,until:now+60000};limits.set(key,next);return next.count>maximum;
}
function tokenMatches(header:string|undefined,token:string) {return !!token&&!!header&&timingSafeEqual(Buffer.from(sha256(header)),Buffer.from(sha256(`Bearer ${token}`)));}
const idempotency=(req:FastifyRequest)=>z.string().regex(/^[a-zA-Z0-9_-]{8,120}$/).parse(req.headers['idempotency-key']);

export function registerMarket(app:FastifyInstance) {
  marketConfig();
  app.post('/api/market/ingest',{bodyLimit:512*1024},async(req,reply)=>{
    if(limited(`ingest:${req.ip}`,10)||limited('ingest:all',100)){reply.header('Retry-After','60');return problem(req,reply,429,'rate_limited','价格推送频率超限');}
    if(!tokenMatches(req.headers.authorization,marketConfig().ingestToken)){req.log.warn({path:'/api/market/ingest'},'market ingest authorization rejected');return problem(req,reply,401,'unauthorized','需要有效的服务端推送凭据');}
    try {const input=ingestSchema.parse(req.body);const result=await ingestBatch(input,idempotency(req));return reply.header('Cache-Control','no-store').send(result);}
    catch(error){if(error instanceof z.ZodError)return problem(req,reply,400,'invalid_request',error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ').slice(0,500));
      if((error as {code?:string}).code==='conflict')return problem(req,reply,409,'conflict',(error as Error).message);
      req.log.error({err:error,path:'/api/market/ingest'},'market ingest failed');return problem(req,reply,500,'ingest_failed','推送入库失败，请查服务端日志');}
  });
  const publicRoute=(fn:(req:FastifyRequest)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{
    applyPublicHeaders(reply);
    if(limited(`public:${req.ip}`,120)){reply.header('Retry-After','60');return problem(req,reply,429,'rate_limited','请求过于频繁');}
    try {const result=await fn(req);if(result===null)return problem(req,reply,404,'not_found','商品不存在');return reply.header('Cache-Control','public, max-age=30, must-revalidate').send(result);}
    catch(error){if(error instanceof z.ZodError||(error as {statusCode?:number}).statusCode===400)return problem(req,reply,400,'invalid_request','筛选条件、日期或分页无效');throw error;}
  };
  const query=(req:FastifyRequest)=>querySchema.parse(publication.publicQuery(req.query as Record<string,unknown>));
  app.get('/api/market/v1/cities',publicRoute(()=>publication.cities()));
  app.get('/api/market/v1/products',publicRoute(req=>publication.products(query(req))));
  app.get('/api/market/v1/prices',publicRoute(req=>publication.prices(query(req))));
  app.get('/api/market/v1/products/:id',publicRoute(req=>publication.productDetail(param(req,'id'),query(req))));
  app.get('/api/market/v1/products/:id/history',publicRoute(req=>publication.history(param(req,'id'),query(req))));
  app.get('/api/market/v1/briefs/daily',publicRoute(req=>publication.dailyBrief(query(req))));

  app.get('/api/admin/market/overview',adminHandler(async()=>{
    const date=publication.beijingToday();
    const [sources]=await sql`SELECT count(*) FILTER(WHERE enabled) AS active_sources,max(last_success_at) AS latest_success FROM market_sources`;
    const [observations]=await sql`SELECT count(*) FILTER(WHERE collected_at AT TIME ZONE 'Asia/Shanghai' >=${date}::date) AS collected_today,
      count(*) FILTER(WHERE review_status='verified' AND observation_date=${date}) AS valid_today,
      count(*) FILTER(WHERE review_status='pending') AS pending,count(DISTINCT region_code) FILTER(WHERE review_status='verified') AS region_coverage FROM market_observations`;
    const [runs]=await sql`SELECT count(*) FILTER(WHERE status='failed' AND started_at AT TIME ZONE 'Asia/Shanghai'>=${date}::date) AS failed_today FROM market_source_runs`;
    const costs=await sql`SELECT r.service,a.currency,a.cost_basis,count(*) AS calls,sum(a.cost) AS cost FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id WHERE r.purpose IN ('market_extract','market_brief') AND a.started_at>=now()-interval '24 hours' GROUP BY r.service,a.currency,a.cost_basis`;
    return {sources,observations,runs,costs,config:{collect_enabled:marketConfig().collectEnabled&&process.env.COLLECT_ENABLED==='true',ai_review_enabled:marketConfig().aiReviewEnabled,model_calls_enabled:config.modelCallsEnabled,ingest_configured:!!marketConfig().ingestToken},date};
  }));
  app.get('/api/admin/market/sources',adminHandler(async req=>{
    const p=pager.parse(req.query);const data=await sql`SELECT * FROM market_sources ORDER BY name,source_id LIMIT ${p.limit+1} OFFSET ${(p.page-1)*p.limit}`;
    return {data:data.slice(0,p.limit),page:p.page,has_more:data.length>p.limit};
  }));
  app.post('/api/admin/market/sources',adminHandler(async(req,_reply,admin)=>saveSource(body(req).source,actorOf(admin),reasonSchema.parse(body(req).reason))));
  app.put('/api/admin/market/sources/:id',adminHandler(async(req,_reply,admin)=>{
    const source=body(req).source as Record<string,unknown>;if(source?.source_id!==param(req,'id'))throw new SyntaxError('不能修改信源 ID');
    return saveSource(source,actorOf(admin),reasonSchema.parse(body(req).reason));
  }));
  app.post('/api/admin/market/sources/:id/enabled',adminHandler(async(req,_reply,admin)=>setSourceEnabled(param(req,'id'),z.boolean().parse(body(req).enabled),actorOf(admin),reasonSchema.parse(body(req).reason))));
  app.delete('/api/admin/market/sources/:id',adminHandler(async(req,_reply,admin)=>setSourceEnabled(param(req,'id'),false,actorOf(admin),reasonSchema.parse(body(req).reason))));
  app.post('/api/admin/market/sources/:id/collect',adminHandler(async(req,_reply,admin)=>{
    const reason=reasonSchema.parse(body(req).reason);
    const result=await requestCollection(param(req,'id'),'manual',idempotency(req));
    await audit(actorOf(admin),'market.source.collect',`market-source:${param(req,'id')}`,reason,null,result);return result;
  }));
  app.post('/api/admin/market/sources/:id/test',{bodyLimit:512*1024},adminHandler(async req=>{
    const source=await loadSource(param(req,'id'));if(!source)throw new SyntaxError('信源不存在');
    const b=z.strictObject({sample:z.string().max(500000).optional()}).parse(body(req));
    if(b.sample!==undefined){if(source.type==='json_api')return {items:parseJson(JSON.parse(b.sample),source),offline:true};if(source.type==='html_table')return {items:parseHtml(b.sample,source).items,offline:true};throw new SyntaxError('离线预览支持 JSON 或 HTML 表格信源');}
    if(!marketConfig().collectEnabled||process.env.COLLECT_ENABLED!=='true')throw new SyntaxError('真实试抓已关闭，请粘贴离线样本');
    return {...await collect(source),offline:false};
  }));
  app.get('/api/admin/market/runs',adminHandler(async req=>{
    const p=pager.parse(req.query);const data=await sql`SELECT r.*,s.name FROM market_source_runs r JOIN market_sources s ON s.source_id=r.source_id
      WHERE (${p.source_id??null}::text IS NULL OR r.source_id=${p.source_id??null}) ORDER BY started_at DESC LIMIT ${p.limit+1} OFFSET ${(p.page-1)*p.limit}`;
    const documents=await sql`SELECT id,source_id,source_url,status,extracted_count,receipt_id,error,created_at FROM market_documents WHERE status<>'complete' ORDER BY created_at DESC LIMIT 30`;
    return {data:data.slice(0,p.limit),page:p.page,has_more:data.length>p.limit,documents};
  }));
  app.get('/api/admin/market/reviews',adminHandler(async req=>{
    const p=pager.parse(req.query);const status=z.enum(['pending','verified','rejected']).parse(p.status??'pending');
    const data=await sql`SELECT o.*,s.name AS source_name FROM market_observations o JOIN market_sources s ON s.source_id=o.source_id WHERE review_status=${status}
      ORDER BY collected_at DESC,id LIMIT ${p.limit+1} OFFSET ${(p.page-1)*p.limit}`;
    return {data:data.slice(0,p.limit),page:p.page,has_more:data.length>p.limit,products:await loadProducts()};
  }));
  app.post('/api/admin/market/documents/:id/retry',adminHandler(async(req,_reply,admin)=>{
    const reason=reasonSchema.parse(body(req).reason);
    const result=await retryDocument(param(req,'id'));
    await audit(actorOf(admin),'market.document.retry',`market-document:${param(req,'id')}`,reason,null,result);
    return result;
  }));
  app.get('/api/admin/market/observations/:id',adminHandler(async req=>({
    data:(await sql`SELECT * FROM market_observations WHERE id=${param(req,'id')}`)[0]??null,
    revisions:await sql`SELECT version,actor,reason,before_data,after_data,created_at FROM market_observation_revisions WHERE observation_id=${param(req,'id')} ORDER BY version DESC LIMIT 100`,
    reviews:await sql`SELECT action,actor,reason,version,created_at FROM market_reviews WHERE observation_id=${param(req,'id')} ORDER BY id DESC LIMIT 100`,
  })));
  app.post('/api/admin/market/observations/:id/review',adminHandler(async(req,_reply,admin)=>reviewObservation(param(req,'id'),req.body,actorOf(admin))));
  app.get('/api/admin/market/products',adminHandler(async()=>({data:await loadProducts(),regions:await sql`SELECT region_code,name,enabled FROM market_regions ORDER BY region_code`,markets:await sql`SELECT market_id,name,region_code,price_type FROM market_markets ORDER BY name`,price_types:['wholesale','retail','supermarket','user_report','unknown']})));
  app.post('/api/admin/market/products',adminHandler(async(req,_reply,admin)=>saveProduct(body(req).product,actorOf(admin),reasonSchema.parse(body(req).reason))));
  app.put('/api/admin/market/regions/:id',adminHandler(async(req,_reply,admin)=>{
    const value=z.strictObject({name:z.string().trim().min(1).max(200),enabled:z.boolean(),reason:reasonSchema}).parse(req.body);const id=regionCode.parse(param(req,'id'));
    return sql.begin(async db=>{const [before]=await db`SELECT * FROM market_regions WHERE region_code=${id}`;await db`INSERT INTO market_regions(region_code,name,enabled) VALUES(${id},${value.name},${value.enabled}) ON CONFLICT(region_code) DO UPDATE SET name=excluded.name,enabled=excluded.enabled`;
      await audit(actorOf(admin),'market.region.save',`market-region:${id}`,value.reason,before,value,{db});return {ok:true};});
  }));
  app.put('/api/admin/market/markets/:id',adminHandler(async(req,_reply,admin)=>{
    const value=z.strictObject({name:z.string().trim().min(1).max(200),region_code:regionCode,price_type:priceType,reason:reasonSchema}).parse(req.body);const id=z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/).parse(param(req,'id'));
    return sql.begin(async db=>{const [before]=await db`SELECT * FROM market_markets WHERE market_id=${id}`;
      if(before&&(before.region_code!==value.region_code||before.price_type!==value.price_type))throw new SyntaxError('市场地区与类型不可改写，请创建新市场');
      await db`INSERT INTO market_markets(market_id,name,region_code,price_type) VALUES(${id},${value.name},${value.region_code},${value.price_type}) ON CONFLICT(market_id) DO UPDATE SET name=excluded.name`;
      await audit(actorOf(admin),'market.market.save',`market-market:${id}`,value.reason,before,value,{db});return {ok:true};});
  }));
  app.get('/api/admin/market/publish',adminHandler(async req=>{
    const q=query(req);return {prices:await publication.prices(q),brief:await publication.dailyBrief(q),products:await loadProducts(),api_base:'/api/market/v1',revision_notice:'审核、修订和撤回自动重算；缓存最多保留 30 秒'};
  }));
  app.post('/api/admin/market/aggregate',adminHandler(async(req,_reply,admin)=>{
    const scope=scopesSchema.parse(req.body);const rows=await sql`SELECT DISTINCT product_id FROM market_observations WHERE region_code=${scope.region_code} AND observation_date=${scope.date} AND price_type=${scope.price_type} AND product_id IS NOT NULL`;
    await ensureQueue(aggregateQueue.name,aggregateQueue.options);
    for(const row of rows)await enqueueOn(aggregateQueue,{region_code:scope.region_code,price_type:scope.price_type,product_id:row.product_id,observation_date:scope.date},{singletonKey:`${scope.region_code}:${row.product_id}:${scope.price_type}:${scope.date}`});
    await audit(actorOf(admin),'market.aggregate',`market:${scope.region_code}:${scope.date}`,scope.reason,null,{products:rows.length});return {ok:true,products:rows.length};
  }));
  app.post('/api/admin/market/brief',adminHandler(async(req,_reply,admin)=>{
    const scope=scopesSchema.parse(req.body);const result=await generateBrief(scope.region_code,scope.date,scope.price_type);
    await audit(actorOf(admin),'market.brief',`market:${scope.region_code}:${scope.date}`,scope.reason,null,result);return result;
  }));
}
