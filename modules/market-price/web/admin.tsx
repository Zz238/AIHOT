import { adminGet } from "@aihot/web/lib/admin.server";

export async function loader({ request }: { request: Request }) {
  await adminGet(request, "/api/admin/me");
  return null;
}

export default function MarketAdmin() {
  return <main className="p-6"><h1 className="text-xl font-semibold">菜价雷达 · 市场价格管理</h1><p className="mt-2 text-ink-3">信源、观测、审核与发布使用独立价格模块。</p></main>;
}
