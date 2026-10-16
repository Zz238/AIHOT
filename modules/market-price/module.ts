import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "market-price",
  apiPaths: [/^\/api\/market(?:\/|$)/, /^\/api\/admin\/market(?:\/|$)/],
  adminPages: [
    {
      path: "admin/market/:section?",
      file: "web/admin.tsx",
      id: "market-admin",
    },
  ],
});
