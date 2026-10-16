import { z } from "zod";
import { sha256 } from "@aihot/backend/lib/ids";
import { candidateSchema, type Candidate } from "./contracts.ts";
import { ingestBatch, loadSource } from "./repository.ts";

/** The host supplies a SERVER-SIDE session verifier (e.g. its WeChat login exchange).
 * Client-submitted openid, product type or review status is never an authentication proof.
 * No public user route is registered until that real verifier exists.
 */
export interface ReportPrincipal {
  provider: string;
  subject: string;
}
export type VerifyReportSession = (
  credential: string,
) => Promise<ReportPrincipal | null>;
export async function submitAuthenticatedReport(input: {
  credential: string;
  verifySession: VerifyReportSession;
  source_id: string;
  idempotency_key: string;
  item: Candidate;
}) {
  const principal = await input.verifySession(input.credential);
  if (!principal?.provider || !principal.subject)
    throw Object.assign(new Error("用户登录已失效"), { statusCode: 401 });
  const source = await loadSource(input.source_id);
  if (source?.type !== "user_report")
    throw Object.assign(new Error("必须使用用户上报信源"), { statusCode: 400 });
  const key = z.string().min(8).max(120).parse(input.idempotency_key);
  const identity = sha256(`${principal.provider}:${principal.subject}:${key}`);
  const item = candidateSchema.parse({
    ...input.item,
    source_record_id: identity,
    price_type: "user_report",
    evidence_method: "user_report",
  });
  return ingestBatch(
    { source_id: input.source_id, items: [item] },
    identity,
    `user:${sha256(`${principal.provider}:${principal.subject}`)}`,
  );
}
