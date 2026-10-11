import { stub } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import test,{after} from "node:test";
import Fastify from "fastify";
import { sql,closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { seedDictionary } from "../scripts/seed.ts";
import { ingestBatch,loadSource,saveSource,storeCandidates,reviewObservation } from "../backend/repository.ts";
import { registerMarket } from "../api/routes.ts";
import { extractDocument } from "../backend/extract.ts";
import { validateQueue } from "../backend/jobs.ts";
import * as publication from "../backend/publication.ts";
import { candidate,source } from "./fixtures.ts";
import { querySchema } from "../backend/contracts.ts";
import server from "../server.ts";
import { generateBrief } from "../backend/briefs.ts";
import { config } from "@aihot/backend/config";
import { passwordLogin,sessionPrincipal } from "@aihot/backend/admin/auth";
import { submitAuthenticatedReport } from "../backend/user-report.ts";

await seedDictionary();installModules([server]);
await saveSource({...source,type:'external'},'test','固定样本');
const external=(await loadSource(source.source_id))!;
const q=(extra:Record<string,unknown>={})=>querySchema.parse(extra);
after(async()=>{await stopBoss();await closeDb();});

test('入库、重复幂等键及同报价不重复统计',async()=>{
  const result=await ingestBatch({source_id:source.source_id,items:[candidate]},'offline-batch-001');assert.equal(result.created,1);
  const repeated=await ingestBatch({source_id:source.source_id,items:[candidate]},'offline-batch-001');assert.equal(repeated.reused,true);
  assert.equal((await storeCandidates(external,[candidate])).unchanged,1);
  const [daily]=await sql`SELECT * FROM market_daily_prices WHERE product_id='tomato' AND date='2026-02-05'`;assert.equal(daily.sample_count,1);assert.equal(daily.reference_low,null);assert.equal(daily.median_price,2.4);
  await assert.rejects(()=>ingestBatch({source_id:source.source_id,items:[{...candidate,price_value:5}]},'offline-batch-001'),/不同数据/);
});
test('同链接不同日期独立，历史价格不进入今天，批发零售价隔离',async()=>{
  await storeCandidates(external,[{...candidate,observed_at:'2026-02-06'},{...candidate,price_type:'wholesale',price_value:3}]);
  const rows=await sql`SELECT price_type,observation_date FROM market_observations WHERE source_id=${source.source_id}`;assert.equal(rows.length,3);
  assert.equal((await publication.prices(q({date:publication.beijingToday(),product_id:'tomato'}))).data.length,0);
  const wholesale=await publication.prices(q({date:'2026-02-05',price_type:'wholesale'}));assert.equal(wholesale.data[0].price,1.5);
  const retail=await publication.prices(q({date:'2026-02-05'}));assert.equal(retail.data[0].price,2.4);
  assert.equal(retail.data[0].freshness,'historical_reference');
  assert.match(retail.data[0].notice,/往期/);
});

test('源修订保留原文版本，异常待审核，不继续公开旧价',async()=>{
  const result=await storeCandidates(external,[{...candidate,price_value:8,evidence_text:'2026年02月05日，普通番茄8.00元/公斤'}]);assert.equal(result.revised,1);assert.equal(result.pending,1);
  const [obs]=await sql`SELECT * FROM market_observations WHERE source_id=${source.source_id} AND observation_date='2026-02-05' AND price_type='retail'`;
  const revisions=await sql`SELECT * FROM market_observation_revisions WHERE observation_id=${obs.id} ORDER BY version`;assert.equal(revisions.length,2);assert.equal(revisions[0].after_data.raw_payload.price_value,4.8);
  assert.equal((await publication.prices(q({date:'2026-02-05'}))).data.length,0);
  await reviewObservation(obs.id,{action:'approve',expected_version:obs.version,reason:'核对源修订证据'},'test');
  assert.equal((await publication.prices(q({date:'2026-02-05'}))).data[0].price,4);
});
test('撤回重聚合、撤销审核恢复；旧版本审核冲突',async()=>{
  const [obs]=await sql`SELECT * FROM market_observations WHERE source_id=${source.source_id} AND observation_date='2026-02-05' AND price_type='retail'`;
  const rejected=await reviewObservation(obs.id,{action:'reject',expected_version:obs.version,reason:'暂时撤回核查'},'test');
  assert.equal((await publication.prices(q({date:'2026-02-05'}))).data.length,0);
  await assert.rejects(()=>reviewObservation(obs.id,{action:'approve',expected_version:obs.version,reason:'过期审核'},'test'),/已变更/);
  await reviewObservation(obs.id,{action:'undo',expected_version:rejected.version,reason:'核查后撤销上次拒绝'},'test');
  assert.equal((await publication.prices(q({date:'2026-02-05'}))).data[0].price,4);
});
test('7、30、90 天历史严格按观测日期窗口读取',async()=>{
  for(const date of ['2026-02-12','2026-02-20','2026-03-05','2026-04-01'])await storeCandidates(external,[{...candidate,observed_at:date}]);
  const seven=await publication.history('tomato',q({to:'2026-03-05',days:7}));assert.equal(seven.data.length,1);
  const thirty=await publication.history('tomato',q({to:'2026-03-05',days:30}));assert.equal(thirty.data.length,5);
  const ninety=await publication.history('tomato',q({to:'2026-04-01',days:90}));assert.equal(ninety.data.length,6);
});
test('无法换算的单位拒绝，证据充分的重量更正后重新聚合',async()=>{
  const item={...candidate,source_record_id:'boxed',observed_at:'2026-02-07',price_value:12,price_unit:'元/盒',evidence_text:'2026年02月07日，普通番茄12元/盒，每盒1000克'};
  assert.equal((await storeCandidates(external,[item])).rejected,1);
  const [obs]=await sql`SELECT * FROM market_observations WHERE source_record_id='boxed'`;
  await assert.rejects(()=>reviewObservation(obs.id,{action:'correct',expected_version:obs.version,corrected_unit:'元/盒',weight_grams:800,unit_evidence:item.evidence_text,reason:'假设重量'},'test'),/重量/);
  await reviewObservation(obs.id,{action:'correct',expected_version:obs.version,corrected_unit:'元/盒',weight_grams:1000,unit_evidence:item.evidence_text,reason:'核对包装标注1000克'},'test');
  assert.equal((await publication.prices(q({date:'2026-02-07'}))).data[0].price,6);
  const [afterRow]=await sql`SELECT * FROM market_observations WHERE id=${obs.id}`;assert.equal(afterRow.original_unit,'元/盒');assert.equal(afterRow.raw_payload.weight_grams,null);
});
test('用户上报强制独立类型和人工审核',async()=>{
  await saveSource({...source,source_id:'user-fixture',type:'user_report',publisher_key:'user-fixture'},'test','用户认证适配测试');
  await ingestBatch({source_id:'user-fixture',items:[candidate]},'offline-user-001');
  const [row]=await sql`SELECT * FROM market_observations WHERE source_id='user-fixture'`;assert.equal(row.price_type,'user_report');assert.equal(row.review_status,'pending');
});
test('校验队列整批重试安全，不重复创建观测',async()=>{
  const payload={source_id:source.source_id,items:[{...candidate,source_record_id:'queue-fixture',observed_at:'2026-02-09'}],run_id:'absent-log'};
  await validateQueue.run([payload]);await validateQueue.run([payload]);
  const [count]=await sql`SELECT count(*) AS count FROM market_observations WHERE source_record_id='queue-fixture'`;assert.equal(count.count,1);
});
test('AI 失败不改变已发布数据，付费接口替身可重复验证',async()=>{
  const before=await publication.prices(q({date:'2026-02-05'}));
  await assert.rejects(()=>extractDocument({text:'普通番茄现价为人民币8元一公斤，报价日期2026年02月05日',source_url:'https://example.org/article',published_at:null},external,[],async()=>{throw new Error('fixed model failure');}),/fixed model failure/);
  assert.deepEqual(await publication.prices(q({date:'2026-02-05'})),before);
});
test('真实 HTTP 推送与公开端点连通，后台不能绕过鉴权',async()=>{
  process.env.MARKET_INGEST_TOKEN='offline-test-token-32-characters-long';
  const app=Fastify();registerMarket(app);
  try{
    assert.equal((await app.inject('/api/admin/market/sources')).statusCode,401);
    const res=await app.inject({method:'POST',url:'/api/market/ingest',headers:{authorization:'Bearer '+process.env.MARKET_INGEST_TOKEN,'idempotency-key':'offline-http-001'},payload:{source_id:source.source_id,items:[{...candidate,product_name:'土豆',variant:'普通土豆',source_record_id:'http',observed_at:'2026-02-10'}]}});
    assert.equal(res.statusCode,200,res.body);assert.equal(res.json().created,1);
    const publicRes=await app.inject('/api/market/v1/products/potato?date=2026-02-10');assert.equal(publicRes.statusCode,200);assert.equal(publicRes.json().current.price,2.4);
    assert.equal((await app.inject('/api/market/v1/cities')).json().data[0].region_code,'340100');
  }finally{await app.close();delete process.env.MARKET_INGEST_TOKEN;}
});

test('别名和镜像同一报价只计一个样本，独立来源数不虚增',async()=>{
  const item={...candidate,product_name:'鸡蛋',variant:'普通鸡蛋',source_record_id:'mirror-egg',observed_at:'2026-02-15'};
  await storeCandidates(external,[item]);
  await saveSource({...source,source_id:'mirror-fixture',type:'external'},'test','镜像去重测试');
  await storeCandidates((await loadSource('mirror-fixture'))!,[{...item,source_url:'https://example.org/mirror'}]);
  const [daily]=await sql`SELECT sample_count,independent_source_count FROM market_daily_prices WHERE product_id='egg' AND date='2026-02-15'`;
  assert.equal(daily.sample_count,1);assert.equal(daily.independent_source_count,1);
  const alias={...candidate,source_record_id:'alias-only',observed_at:'2026-02-16'};
  await storeCandidates(external,[alias]);await storeCandidates(external,[{...alias,product_name:'西红柿'}]);
  assert.equal((await sql`SELECT id FROM market_observations WHERE source_record_id='alias-only'`).length,1);
});
test('简报由真实指标生成，重复复用，前日修订同时撤回次日比较简报',async()=>{
  const enabled=config.modelCallsEnabled;config.modelCallsEnabled=false;
  try {
    const today=await generateBrief('340100','2026-02-05','retail');
    assert.equal((await generateBrief('340100','2026-02-05','retail')).reused,true);
    assert.ok('text' in today&&today.text.includes('数据不足'));
    await generateBrief('340100','2026-02-06','retail');
    const [obs]=await sql`SELECT id,version FROM market_observations WHERE source_id=${source.source_id} AND observation_date='2026-02-05' AND price_type='retail'`;
    await reviewObservation(obs.id,{action:'reject',expected_version:obs.version,reason:'测试撤回简报依赖'},'test');
    assert.equal((await publication.dailyBrief(q({date:'2026-02-05'}))).data,null);
    assert.equal((await publication.dailyBrief(q({date:'2026-02-06'}))).data,null);
  } finally {config.modelCallsEnabled=enabled;}
});
test('真实管理员会话仍要求 CSRF，人工操作保留审计',async()=>{
  const password=config.adminPassword;config.adminPassword='offline-admin-password-123';
  const app=Fastify();registerMarket(app);
  try {
    const {token}=await passwordLogin(config.adminPassword,'/admin',undefined);
    const cookie=`aihot_admin=${token}`;const principal=(await sessionPrincipal(cookie))!;
    const payload={source:{...source,source_id:'admin-created',type:'external',enabled:false},reason:'管理员表单测试'};
    assert.equal((await app.inject({method:'POST',url:'/api/admin/market/sources',headers:{cookie},payload})).statusCode,403);
    const response=await app.inject({method:'POST',url:'/api/admin/market/sources',headers:{cookie,'x-csrf-token':principal.csrf},payload});
    assert.equal(response.statusCode,200,response.body);
    assert.ok((await sql`SELECT id FROM audit_log WHERE action='market.source.save' AND subject='market-source:admin-created'`).length);
  } finally {config.adminPassword=password;await app.close();}
});
test('用户会话适配必须由服务端验证，拒绝伪造身份，成功后仍待审',async()=>{
  const input={credential:'fake-session',source_id:'user-fixture',idempotency_key:'report-test-key',item:candidate};
  await assert.rejects(()=>submitAuthenticatedReport({...input,verifySession:async()=>null}),/登录已失效/);
  const result=await submitAuthenticatedReport({...input,verifySession:async()=>({provider:'fixture-session',subject:'test-user'})});
  assert.equal(result.pending,1);
  assert.equal((await sql`SELECT id FROM audit_log WHERE action='market.user_report'`).length,1);
});
test('价格 AI 复用原有调用回执，重复提取只请求本地替身一次，公开 GET 不调用模型',async()=>{
  const provider=await stub(()=>({id:'market-fixture-answer',choices:[{message:{content:JSON.stringify({items:[candidate]})}}],usage:{prompt_tokens:10,completion_tokens:10}}));
  const saved={LLM_BASE_URL:process.env.LLM_BASE_URL,LLM_API_KEY:process.env.LLM_API_KEY,LLM_MODEL:process.env.LLM_MODEL};
  Object.assign(process.env,{LLM_BASE_URL:provider.url+'/v1',LLM_API_KEY:'fixture-only',LLM_MODEL:'fixture-model'});
  const app=Fastify();registerMarket(app);
  try {
    const doc={text:candidate.evidence_text,source_url:'https://example.org/model-fixture',published_at:null};
    const first=await extractDocument(doc,external,[]);const second=await extractDocument(doc,external,[]);
    assert.equal(first.receiptId,second.receiptId);assert.equal(provider.hits(),1);assert.equal(first.items[0]!.evidence_method,'ai');
    const [receipt]=await sql`SELECT purpose FROM receipts WHERE id=${first.receiptId}`;assert.equal(receipt.purpose,'market_extract');
    assert.equal((await app.inject('/api/market/v1/prices')).statusCode,200);assert.equal(provider.hits(),1);
  } finally {await app.close();await provider.close();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
