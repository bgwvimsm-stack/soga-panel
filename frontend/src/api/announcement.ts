import http from "./http";
import type { ApiResponse, PaginationParams, PaginationResponse } from "./types";

// 公告相关类型定义
export interface Announcement {
  id: number;
  title: string;
  content: string;
  content_html?: string;
  type: 'info' | 'warning' | 'success' | 'danger';
  is_active: boolean;
  is_pinned: boolean;
  priority: number;
  created_at: number;
  updated_at?: number;
  expires_at?: number;
  is_expired?: boolean;
  created_by?: number;
  created_by_name?: string;
}

export interface AnnouncementCreateRequest {
  title: string;
  content: string;
  type?: 'info' | 'warning' | 'success' | 'danger';
  is_pinned?: boolean;
  priority?: number;
  expires_at?: number;
}

export interface AnnouncementUpdateRequest extends AnnouncementCreateRequest {
  is_active?: boolean;
}

/**
 * 获取公告列表（用户端）
 */
export const getAnnouncements = (params?: {
  limit?: number;
  offset?: number;
}): Promise<ApiResponse<Announcement[]>> => {
  return http.get("/announcements", { params });
};

/**
 * 获取所有公告（管理员端）
 */
export const getAllAnnouncements = (params?: PaginationParams): Promise<ApiResponse<PaginationResponse<Announcement>>> => {
  return http.get("/admin/announcements", { params });
};

/**
 * 创建公告（管理员）
 */
export const createAnnouncement = (data: AnnouncementCreateRequest): Promise<ApiResponse<{ id: number; message: string }>> => {
  return http.post("/admin/announcements", data);
};

/**
 * 更新公告（管理员）
 */
export const updateAnnouncement = (id: number, data: AnnouncementUpdateRequest): Promise<ApiResponse<{ message: string }>> => {
  return http.put(`/admin/announcements/${id}`, data);
};

/**
 * 删除公告（管理员）
 */
export const deleteAnnouncement = (id: number): Promise<ApiResponse<{ message: string }>> => {
  return http.delete(`/admin/announcements/${id}`);
};