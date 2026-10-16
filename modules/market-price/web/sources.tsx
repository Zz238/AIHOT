import {
  Badge,
  Button,
  Card,
  DataTable,
  Input,
  Json,
  Pager,
  ReasonDialog,
  Select,
  Textarea,
  Time,
} from "@aihot/web/features/admin/ui";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { toast } from "@aihot/web/features/admin/toast";
import { Link } from "react-router";
import { useState } from "react";
import type { SourceInput, SourceView } from "../contracts.ts";
import {
  Field,
  TypeOptions,
  typeNames,
  sourceNames,
  emptySource,
  type Command,
} from "./controls.tsx";

export function Sources({
  data,
}: {
  data: { data: SourceView[]; page: number; has_more: boolean; presets?: SourceInput[]; monitoring?: { source_id: string; data: unknown[] } | null };
}) {
  const { run, busy } = useAdminAction();
  const [edit, setEdit] = useState<SourceInput | null>(null);
  const [configText, setConfigText] = useState("");
  const [why, setWhy] = useState("");
  const [command, setCommand] = useState<Command | null>(null);
  const [sampleSource, setSampleSource] = useState<SourceView | null>(null);
  const [sample, setSample] = useState("");
  const [preview, setPreview] = useState<unknown>(null);
  const open = (row?: SourceInput) => {
    const value = row
      ? {
          source_id: row.source_id,
          name: row.name,
          type: row.type,
          url: row.url,
          region_code: row.region_code,
          market_id: row.market_id,
          price_type: row.price_type,
          interval_minutes: row.interval_minutes,
          enabled: row.enabled,
          trust_score: row.trust_score,
          publisher_key: row.publisher_key,
          config: row.config,
        }
      : structuredClone(emptySource);
    setEdit(value);
    setConfigText(JSON.stringify(value.config, null, 2));
    setWhy("");
  };
  const change = <K extends keyof SourceInput>(key: K, value: SourceInput[K]) =>
    setEdit((e) => (e ? { ...e, [key]: value } : e));
  return (
    <div className="space-y-5">
      <Card
        title="信源列表"
        right={
          <div className="flex flex-wrap gap-2">
          {(data.presets ?? []).map((preset) => (
            <Button key={preset.source_id} onClick={() => open(data.data.find((source) => source.source_id === preset.source_id) ?? preset)}>
              安徽监测源
            </Button>
          ))}
          <Button tone="primary" onClick={() => open()}>
            添加信源
          </Button>
          </div>
        }
      >
        <DataTable
          rows={data.data}
          rowKey={(r) => r.source_id}
          columns={[
            {
              key: "name",
              label: "名称 / 来源主体",
              render: (r) => (
                <div>
                  <strong>{r.name}</strong>
                  <div className="text-xs text-ink-3">
                    {r.source_id} · {r.publisher_key}
                  </div>
                  {r.last_error && (
                    <p className="mt-1 text-hot">{r.last_error}</p>
                  )}
                </div>
              ),
            },
            {
              key: "type",
              label: "类型 / 地区",
              render: (r) => (
                <div>
                  {r.config.adapter === "anhui_weekly" ? "安徽每周监测" : sourceNames[r.type]}
                  <div className="text-xs text-ink-3">
                    {r.region_code} · {r.config.adapter === "anhui_weekly" ? "零售 / 批发地区均价" : typeNames[r.price_type]}
                  </div>
                </div>
              ),
            },
            {
              key: "interval",
              label: "频率 / 最近成功",
              render: (r) => (
                <div>
                  {r.interval_minutes} 分钟
                  <div className="text-xs text-ink-3">
                    <Time at={r.last_success_at} />
                  </div>
                </div>
              ),
            },
            {
              key: "status",
              label: "状态",
              render: (r) => (
                <Badge tone={r.enabled ? "ok" : "muted"}>
                  {r.enabled ? "启用" : "停用"}
                </Badge>
              ),
            },
            {
              key: "actions",
              label: "操作",
              render: (r) => (
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" onClick={() => open(r)}>
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setSampleSource(r);
                      setPreview(null);
                      setSample("");
                    }}
                  >
                    预览
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      !r.enabled ||
                      ["external", "user_report"].includes(r.type)
                    }
                    onClick={() =>
                      setCommand({
                        title: "立即采集",
                        path: `/api/admin/market/sources/${r.source_id}/collect`,
                        data: {},
                      })
                    }
                  >
                    采集
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setCommand({
                        title: r.enabled ? "停用信源" : "启用信源",
                        path: `/api/admin/market/sources/${r.source_id}/enabled`,
                        data: { enabled: !r.enabled },
                      })
                    }
                  >
                    {r.enabled ? "停用" : "启用"}
                  </Button>
                  <Link
                    className="px-2 py-1 text-xs text-accent"
                    to={`/admin/market/runs?source_id=${r.source_id}`}
                  >
                    记录
                  </Link>
                  {r.config.adapter === "anhui_weekly" && (
                    <Link className="px-2 py-1 text-xs text-accent" to={`/admin/market/sources?monitoring_source=${encodeURIComponent(r.source_id)}`}>
                      监测数据
                    </Link>
                  )}
                </div>
              ),
            },
          ]}
        />
        <Pager page={data.page} hasMore={data.has_more} />
      </Card>
      {data.monitoring && (
        <Card title="地区监测参考">
          <p className="mb-3 text-sm text-ink-3">{data.monitoring.source_id} · 每周发布的地区均价，保留原日期和规格。</p>
          {data.monitoring.data.length ? <Json value={data.monitoring.data} collapsed={false} label="已保存的监测序列" /> : <p className="text-sm text-ink-3">尚无已保存的监测数据。完成来源配置并确认使用范围后，可执行采集。</p>}
        </Card>
      )}
      {edit && (
        <Card title="信源配置">
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                const source = { ...edit, config: JSON.parse(configText) };
                if (
                  await run(
                    "POST",
                    "/api/admin/market/sources",
                    { source, reason: why },
                    { success: "信源已保存" },
                  )
                )
                  setEdit(null);
              } catch {
                toast("配置不是有效的 JSON", "error");
              }
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="信源 ID">
                <Input
                  required
                  readOnly={data.data.some(
                    (row) => row.source_id === edit.source_id,
                  )}
                  value={edit.source_id}
                  onChange={(e) => change("source_id", e.target.value)}
                />
              </Field>
              <Field label="名称">
                <Input
                  required
                  value={edit.name}
                  onChange={(e) => change("name", e.target.value)}
                />
              </Field>
              <Field label="采集类型">
                <Select
                  value={edit.type}
                  onChange={(e) =>
                    change("type", e.target.value as SourceInput["type"])
                  }
                >
                  {Object.entries(sourceNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="来源 URL">
                <Input
                  type="url"
                  value={edit.url ?? ""}
                  onChange={(e) => change("url", e.target.value || null)}
                />
              </Field>
              <Field label="地区代码">
                <Input
                  required
                  pattern="[0-9]{6}"
                  value={edit.region_code}
                  onChange={(e) => change("region_code", e.target.value)}
                />
              </Field>
              <Field label="市场 ID（可选）">
                <Input
                  value={edit.market_id ?? ""}
                  onChange={(e) => change("market_id", e.target.value || null)}
                />
              </Field>
              <Field label="价格类型">
                {edit.config.adapter === "anhui_weekly" ? <p className="py-2 text-sm">零售 / 批发地区均价</p> : (
                <Select
                  value={edit.price_type}
                  onChange={(e) =>
                    change(
                      "price_type",
                      e.target.value as SourceInput["price_type"],
                    )
                  }
                >
                  <TypeOptions />
                </Select>
                )}
              </Field>
              <Field label="采集间隔（分钟）">
                <Input
                  type="number"
                  min={15}
                  max={10080}
                  value={edit.interval_minutes}
                  onChange={(e) =>
                    change("interval_minutes", Number(e.target.value))
                  }
                />
              </Field>
              <Field
                label="独立来源主体"
                hint="转载或镜像填相同主体，避免重复计入独立来源"
              >
                <Input
                  required
                  value={edit.publisher_key}
                  onChange={(e) => change("publisher_key", e.target.value)}
                />
              </Field>
              <Field label="可信度（0–1）" hint={edit.config.adapter === "anhui_weekly" ? "监测均价独立保存，暂不参与单条报价统计" : "低于 0.8 的报价需要人工审核"}>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step="0.1"
                  value={edit.trust_score}
                  onChange={(e) =>
                    change("trust_score", Number(e.target.value))
                  }
                />
              </Field>
            </div>
            <Field
              label="解析与分页配置"
              hint={edit.config.adapter === "anhui_weekly" ? "goods_codes 选择官网商品，最多 50 个；来源使用范围确认后才将 terms_confirmed 设为 true" : "fields 为 JSON 路径或表格 CSS 选择器；terms_confirmed 需核对来源许可后设为 true；认证只填写环境变量名"}
            >
              <Textarea
                rows={12}
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                className="font-mono"
              />
            </Field>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={edit.enabled}
                onChange={(e) => change("enabled", e.target.checked)}
              />
              启用此信源
            </label>
            <Field label="保存原因">
              <Input
                required
                value={why}
                onChange={(e) => setWhy(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button tone="primary" type="submit" busy={busy}>
                保存配置
              </Button>
              <Button onClick={() => setEdit(null)}>取消</Button>
            </div>
          </form>
        </Card>
      )}
      {sampleSource && (
        <Card title={`解析预览 · ${sampleSource.name}`}>
          <p className="mb-3 text-sm text-ink-3">
            {sampleSource.config.adapter === "anhui_weekly" ? "粘贴包含查询参数、商品地区目录和返回数据的 JSON，即可预览地区监测序列。" : "粘贴固定 JSON 或 HTML 样本即可离线预览。"}
            预览结果不会入库。留空仅在真实采集已开启时试抓。
          </p>
          <Textarea
            aria-label="离线样本"
            rows={7}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          />
          <div className="my-3 flex gap-2">
            <Button
              busy={busy}
              onClick={async () =>
                setPreview(
                  await run(
                    "POST",
                    `/api/admin/market/sources/${sampleSource.source_id}/test`,
                    sample ? { sample } : {},
                    { revalidate: false },
                  ),
                )
              }
            >
              运行预览
            </Button>
            <Button onClick={() => setSampleSource(null)}>关闭</Button>
          </div>
          {preview != null && (
            <Json value={preview} collapsed={false} label="实际解析结果" />
          )}
        </Card>
      )}
      <ReasonDialog
        open={!!command}
        title={command?.title}
        busy={busy}
        onClose={() => setCommand(null)}
        onSubmit={async (reason) => {
          if (command) {
            const result = await run(
              command.method ?? "POST",
              command.path,
              { ...command.data, reason },
              { success: "操作已提交" },
            );
            if (!result) return false;
          }
          setCommand(null);
        }}
      />
    </div>
  );
}
