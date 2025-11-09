import http from "./http";
import type { ApiResponse } from "./types";

export interface SiteSettingsResponse {
  siteName: string;
  siteUrl?: string;
}

export function getSiteSettings() {
  return http.get<SiteSettingsResponse>("/site/settings");
}
