// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import market from "../../modules/market-price/web.tsx";

export const WEB_MODULES: readonly WebModule[] = [market];
