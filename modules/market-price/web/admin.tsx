import { adminGet } from "@aihot/web/lib/admin.server";
import { AdminPage } from "@aihot/web/features/admin/ui";

import { Link } from "react-router";
import type {
  SourceView,
  Product,
  ObservationView,
  PriceList,
  BriefView,
  OverviewView,
  RunView,
  DictionaryView,
  DocumentView,
} from "../contracts.ts";

const sections = {
  overview: "价格总览",
  sources: "价格信源",
  runs: "采集记录",
  reviews: "价格审核",
  products: "商品与市场",
  publish: "发布与接口",
};
type Section = keyof typeof sections;
type Loaded = {
  section: Section;
  overview?: OverviewView;
  sources?: { data: SourceView[]; page: number; has_more: boolean };
  runs?: {
    data: RunView[];
    page: number;
    has_more: boolean;
    documents: DocumentView[];
  };
  reviews?: {
    data: ObservationView[];
    products: Product[];
    page: number;
    has_more: boolean;
  };
  products?: DictionaryView;
  publish?: {
    prices: PriceList;
    brief: BriefView;
    products: Product[];
    api_base: string;
  };
};
export async function loader({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string | undefined>;
}): Promise<Loaded> {
  const section = params.section ?? "overview";
  if (!(section in sections)) throw new Response("页面不存在", { status: 404 });
  const search = new URL(request.url).searchParams;
  // Single-fetch navigation metadata belongs to the router, not the price API.
  search.delete("_routes");
  search.delete("index");
  const query = search.toString();
  const data = await adminGet(
    request,
    `/api/admin/market/${section}${query ? `?${query}` : ""}`,
  );
  return { section: section as Section, [section]: data };
}
export const meta = () => [{ title: "菜价雷达 · 市场价格管理" }];
export default function MarketAdmin({ loaderData }: { loaderData: Loaded }) {
  const { section } = loaderData;
  return (
    <AdminPage
      title={sections[section]}
      subtitle="价格有据可查；地区、规格、价格类型和观测日期分别核对。"
    >
      <nav aria-label="价格管理" className="mb-5 flex flex-wrap gap-2">
        {Object.entries(sections).map(([key, title]) => (
          <Link
            key={key}
            to={`/admin/market/${key}`}
            className={`rounded-control px-3 py-2 text-sm ${section === key ? "bg-ink text-bg" : "bg-surface text-ink-3 ring-1 ring-line"}`}
          >
            {title}
          </Link>
        ))}
      </nav>
      {loaderData.overview && <Overview data={loaderData.overview} />}
      {loaderData.sources && <Sources data={loaderData.sources} />}
      {loaderData.runs && <Runs data={loaderData.runs} />}
      {loaderData.reviews && <Reviews data={loaderData.reviews} />}
      {loaderData.products && <Dictionary data={loaderData.products} />}
      {loaderData.publish && <Publish data={loaderData.publish} />}
    </AdminPage>
  );
}
import { Overview } from "./overview.tsx";
import { Sources } from "./sources.tsx";
import { Runs } from "./runs.tsx";
import { Reviews } from "./reviews.tsx";
import { Dictionary } from "./dictionary.tsx";
import { Publish } from "./publish.tsx";
