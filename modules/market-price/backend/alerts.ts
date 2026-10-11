import {sql} from '@aihot/backend/db';
import type {Finding} from '@aihot/backend/notify/feishu';
import {marketConfig} from './config.ts';

/** Findings join the engine's existing deduplicated alert/recovery delivery; no new sender. */
export async function marketFindings(now:number):Promise<Finding[]> {
  if(!marketConfig().collectEnabled || process.env.COLLECT_ENABLED!=='true')return [];
  const failures=await sql`SELECT s.source_id,s.name,r.started_at,r.error FROM market_sources s
    JOIN LATERAL (SELECT status,started_at,error FROM market_source_runs WHERE source_id=s.source_id ORDER BY started_at DESC LIMIT 1) r ON true
    WHERE s.enabled AND r.status='failed' AND r.started_at>=${new Date(now-86400000)}`;
  const findings:Finding[]=failures.map(row=>({key:`market.source:${row.source_id}`,level:'today',title:`价格信源“${row.name}”更新失败`,
    impact:'该来源的新报价暂时无法进入已核验价格；往期数据仍按实际观测日期显示。',heals:'任务会有限重试，持续失败需要人工检查。',
    action:'在价格后台查看采集记录，核对来源结构、访问许可和解析配置。',detail:String(row.error??'未记录原因').slice(0,300),since:row.started_at}));
  const [documents]=await sql`SELECT count(*) AS count,min(d.created_at) AS oldest FROM market_documents d JOIN market_sources s ON s.source_id=d.source_id WHERE d.status='failed' AND s.enabled`;
  if(documents.count)findings.push({key:'market.extract.failed',level:'today',title:'部分市场报价文章未能提取',impact:`${documents.count} 篇文章的提取失败，尚未发布未经审核的价格。`,
    heals:'超过有限重试后需要手动处理。',action:'查看价格采集记录中的失败原因，修复后选择重试提取。',since:documents.oldest});
  return findings;
}
