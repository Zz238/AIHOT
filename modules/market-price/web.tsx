import { defineWebModule } from "@aihot/web/modules";

export default defineWebModule({
  name: "market-price",
  admin: {
    landing: "/admin/market/overview",
    groups: [
      {
        group: "菜价雷达",
        items: [
          { to: "/admin/market/overview", label: "价格总览" },
          { to: "/admin/market/sources", label: "价格信源" },
          { to: "/admin/market/runs", label: "采集记录" },
          {
            to: "/admin/market/reviews",
            label: "价格审核",
            count: "market.pending",
            tone: "bad",
          },
          { to: "/admin/market/products", label: "商品与市场" },
          { to: "/admin/market/publish", label: "发布与接口" },
        ],
      },
    ],
  },
});
