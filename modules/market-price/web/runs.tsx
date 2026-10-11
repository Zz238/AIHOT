import {
  Badge,
  Button,
  Card,
  DataTable,
  Json,
  Pager,
  ReasonDialog,
  Time,
} from "@aihot/web/features/admin/ui";
import { useAdminAction } from "@aihot/web/features/admin/action";

import { useState } from "react";
import type { RunView, DocumentView } from "../contracts.ts";

export function Runs({
  data,
}: {
  data: {
    data: RunView[];
    page: number;
    has_more: boolean;
    documents: DocumentView[];
  };
}) {
  const { run, busy } = useAdminAction();
  const [retry, setRetry] = useState<DocumentView | null>(null);
  return (
    <div className="space-y-5">
      <Card title="真实采集任务">
        <DataTable
          rows={data.data}
          rowKey={(r) => r.id}
          columns={[
            {
              key: "source",
              label: "信源",
              render: (r) => (
                <div>
                  {r.name}
                  <div className="text-xs text-ink-3">{r.trigger}</div>
                </div>
              ),
            },
            {
              key: "time",
              label: "开始 / 耗时",
              render: (r) => (
                <div>
                  <Time at={r.started_at} />
                  <div>
                    {r.duration_ms == null ? "—" : `${r.duration_ms} ms`}
                  </div>
                </div>
              ),
            },
            {
              key: "status",
              label: "状态 / 阶段",
              render: (r) => (
                <div>
                  <Badge
                    tone={
                      r.status === "failed"
                        ? "bad"
                        : r.status === "ok"
                          ? "ok"
                          : "warn"
                    }
                  >
                    {r.status}
                  </Badge>
                  <div className="text-xs">{r.stage}</div>
                </div>
              ),
            },
            {
              key: "counts",
              label: "解析 / 新增",
              render: (r) => (
                <div>
                  {r.parsed_count} / {r.created_count}
                  <p className="text-xs text-ink-3">
                    待审 {r.pending_count} · 拒绝 {r.rejected_count} · 修订{" "}
                    {r.revised_count}
                  </p>
                  <Time at={r.latest_validation} />
                </div>
              ),
            },
            {
              key: "evidence",
              label: "访问地址 / 失败原因",
              render: (r) => (
                <div className="max-w-md break-words">
                  {r.error && <p className="mb-2 text-hot">{r.error}</p>}
                  <Json value={r.fetched_urls} label="访问地址" />
                </div>
              ),
            },
          ]}
        />
        <Pager page={data.page} hasMore={data.has_more} />
      </Card>
      <Card title="待提取与失败文章">
        <DataTable
          rows={data.documents}
          rowKey={(doc) => doc.id}
          columns={[
            {
              key: "url",
              label: "原文 / 信源",
              render: (doc) => (
                <div className="max-w-md break-all">
                  {doc.source_url}
                  <p className="text-xs text-ink-3">{doc.source_id}</p>
                </div>
              ),
            },
            {
              key: "error",
              label: "状态 / 错误",
              render: (doc) => (
                <div>
                  {doc.status}
                  <p className="text-sm text-hot">{doc.error}</p>
                </div>
              ),
            },
            {
              key: "retry",
              label: "操作",
              render: (doc) => (
                <Button size="sm" busy={busy} onClick={() => setRetry(doc)}>
                  重试提取
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <ReasonDialog
        open={!!retry}
        title="重试文章提取"
        busy={busy}
        onClose={() => setRetry(null)}
        onSubmit={async (reason) => {
          if (
            retry &&
            !(await run(
              "POST",
              `/api/admin/market/documents/${retry.id}/retry`,
              { reason },
              { success: "已加入提取队列" },
            ))
          )
            return false;
          setRetry(null);
        }}
      />
    </div>
  );
}
