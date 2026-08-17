import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site.ts";

/**
 * One entry, because there is one page.
 *
 * No `lastModified`. Nothing here records when the game last changed, and stamping the
 * build time would tell a crawler the page is new on every deploy, which is a claim the
 * content does not support.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, changeFrequency: "monthly", priority: 1 }];
}
