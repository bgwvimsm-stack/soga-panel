import http from "./http";
import type { ApiResponse } from "./types";

export interface SiteSettingsResponse {
  siteName: string;
  siteUrl?: string;
}

export function getSiteSettings() {
  return http.get<ApiResponse<SiteSettingsResponse>>("/site/settings");
}
