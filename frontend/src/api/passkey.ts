import http from "./http";
import type { ApiResponse } from "./types";

export const getPasskeys = (): Promise<ApiResponse<{ items: any[] }>> => {
  return http.get("/user/passkeys");
};

export const deletePasskey = (credentialId: string): Promise<ApiResponse<{ removed: string }>> => {
  return http.delete(`/user/passkeys/${encodeURIComponent(credentialId)}`);
};
