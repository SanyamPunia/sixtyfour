import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site.ts";

/**
 * One page, nothing to hide, and one thing to keep crawlers out of.
 *
 * `/api/` is room state. There is nothing secret in it, but it is a live endpoint that
 * answers differently on every request and changes what it returns when asked, so it has no
 * business in an index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
