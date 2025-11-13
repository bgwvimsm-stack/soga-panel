import http from "./http";
import type { TicketDetailResult, TicketListResult, TicketStatus } from "./types";

export interface TicketQueryParams {
  page?: number;
  pageSize?: number;
  status?: TicketStatus;
}

export interface TicketCreatePayload {
  title: string;
  content: string;
}

export interface TicketReplyPayload {
  content: string;
  status?: TicketStatus;
}

export interface TicketStatusPayload {
  status: TicketStatus;
}

export function fetchUserTickets(params?: TicketQueryParams) {
  return http.get<TicketListResult>("/user/tickets", { params });
}

export function createUserTicket(payload: TicketCreatePayload) {
  return http.post("/user/tickets", payload);
}

export function fetchUserTicketDetail(ticketId: number) {
  return http.get<TicketDetailResult>(`/user/tickets/${ticketId}`);
}

export function fetchAdminTickets(params?: TicketQueryParams) {
  return http.get<TicketListResult>("/admin/tickets", { params });
}

export function fetchAdminTicketDetail(ticketId: number) {
  return http.get<TicketDetailResult>(`/admin/tickets/${ticketId}`);
}

export function replyAdminTicket(ticketId: number, payload: TicketReplyPayload) {
  return http.post(`/admin/tickets/${ticketId}/replies`, payload);
}

export function updateTicketStatus(ticketId: number, payload: TicketStatusPayload) {
  return http.post(`/admin/tickets/${ticketId}/status`, payload);
}

export function replyUserTicket(ticketId: number, payload: { content: string }) {
  return http.post(`/user/tickets/${ticketId}/replies`, payload);
}

export function fetchUserTicketUnreadCount() {
  return http.get<{ count: number }>("/user/tickets/unread-count");
}

export function fetchAdminTicketPendingCount() {
  return http.get<{ count: number }>("/admin/tickets/pending-count");
}

export function closeUserTicket(ticketId: number) {
  return http.post(`/user/tickets/${ticketId}/close`);
}
