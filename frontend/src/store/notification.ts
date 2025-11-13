import { defineStore } from "pinia";
import { fetchAdminTicketPendingCount, fetchUserTicketUnreadCount } from "@/api/ticket";

export const useNotificationStore = defineStore("notification", {
  state: () => ({
    userUnreadTickets: 0,
    adminPendingTickets: 0,
    loadingUser: false,
    loadingAdmin: false,
  }),
  actions: {
    async refreshUserTicketUnread() {
      if (this.loadingUser) return;
      this.loadingUser = true;
      try {
        const { data } = await fetchUserTicketUnreadCount();
        this.userUnreadTickets = data?.count ?? 0;
      } catch (error) {
        console.error("Failed to fetch user unread ticket count", error);
      } finally {
        this.loadingUser = false;
      }
    },
    async refreshAdminTicketPending() {
      if (this.loadingAdmin) return;
      this.loadingAdmin = true;
      try {
        const { data } = await fetchAdminTicketPendingCount();
        this.adminPendingTickets = data?.count ?? 0;
      } catch (error) {
        console.error("Failed to fetch admin pending ticket count", error);
      } finally {
        this.loadingAdmin = false;
      }
    },
    reset() {
      this.userUnreadTickets = 0;
      this.adminPendingTickets = 0;
    }
  }
});
