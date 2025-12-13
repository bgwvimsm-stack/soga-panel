import { DatabaseService } from "./database";
import { ensureNumber } from "../utils/d1";

type RebateMode = "first_order" | "every_order";

function fixMoneyPrecision(amount: number): number {
  return Number(Number(amount).toFixed(2));
}

export class ReferralService {
  private readonly db: DatabaseService;
  private static readonly inviteChars = "abcdefghjkmnpqrstuvwxyz23456789";

  constructor(db: DatabaseService) {
    this.db = db;
  }

  normalizeInviteCode(raw?: string | null) {
    return (raw || "").trim().toLowerCase();
  }

  async ensureUserInviteCode(userId: number): Promise<string> {
    const row = await this.db.db
      .prepare("SELECT invite_code FROM users WHERE id = ?")
      .bind(userId)
      .first<{ invite_code?: string | null }>();
    const existing = this.normalizeInviteCode(row?.invite_code);
    if (existing) return existing;
    const code = await this.generateUniqueInviteCode();
    await this.db.db
      .prepare("UPDATE users SET invite_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(code, userId)
      .run();
    return code;
  }

  private async generateUniqueInviteCode(length = 6): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = Array.from({ length }, () =>
        ReferralService.inviteChars.charAt(Math.floor(Math.random() * ReferralService.inviteChars.length))
      ).join("");
      const exists = await this.db.db
        .prepare("SELECT id FROM users WHERE invite_code = ? LIMIT 1")
        .bind(code)
        .first();
      if (!exists) return code;
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`.slice(0, length);
  }

  async regenerateInviteCode(userId: number, length = 6) {
    const code = await this.generateUniqueInviteCode(length);
    await this.db.db
      .prepare("UPDATE users SET invite_code = ?, invite_used = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(code, userId)
      .run();
    return code;
  }

  async findInviterByCode(code?: string | null) {
    const normalized = this.normalizeInviteCode(code);
    if (!normalized) return null;
    return await this.db.db
      .prepare("SELECT id, invite_limit, invite_used FROM users WHERE LOWER(invite_code) = ? LIMIT 1")
      .bind(normalized)
      .first<{ id: number; invite_limit?: number | string | null; invite_used?: number | string | null } | null>();
  }

  async incrementInviteUsage(inviterId: number) {
    await this.db.db
      .prepare(
        `
        UPDATE users
        SET invite_used = CASE
              WHEN invite_limit > 0 AND invite_used >= invite_limit THEN invite_limit
              ELSE invite_used + 1
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(inviterId)
      .run();
  }

  async saveReferralRelation(params: { inviterId: number; inviteeId: number; inviteCode: string; inviteIp?: string | null }) {
    if (!params.inviterId || !params.inviteeId || params.inviterId === params.inviteeId) return;
    await this.db.db
      .prepare(
        `
        INSERT INTO referral_relations (
          inviter_id, invitee_id, invite_code, invite_ip, registered_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          inviter_id = VALUES(inviter_id),
          invite_code = VALUES(invite_code),
          invite_ip = COALESCE(VALUES(invite_ip), referral_relations.invite_ip),
          updated_at = CURRENT_TIMESTAMP
      `
      )
      .bind(params.inviterId, params.inviteeId, params.inviteCode, params.inviteIp ?? null)
      .run();
  }

  private async getRelation(inviteeId: number) {
    if (!inviteeId) return null;
    return await this.db.db
      .prepare("SELECT * FROM referral_relations WHERE invitee_id = ? LIMIT 1")
      .bind(inviteeId)
      .first<Record<string, any> | null>();
  }

  private async createFallbackRelation(inviterId: number, inviteeId: number) {
    const inviter = await this.db.db
      .prepare("SELECT invite_code FROM users WHERE id = ?")
      .bind(inviterId)
      .first<{ invite_code?: string | null } | null>();
    const inviteCode = this.normalizeInviteCode(inviter?.invite_code);
    if (!inviteCode) {
      return null;
    }
    await this.saveReferralRelation({
      inviterId,
      inviteeId,
      inviteCode
    });
    return await this.getRelation(inviteeId);
  }

  private async getRebateSettings(): Promise<{ rate: number; mode: RebateMode }> {
    const map = await this.db.listSystemConfigsMap();
    const rateRaw = map["rebate_rate"] ?? "0";
    const modeRaw = (map["rebate_mode"] ?? "every_order").toString();
    const rate = Math.min(Math.max(Number.parseFloat(rateRaw), 0), 1) || 0;
    const mode: RebateMode = modeRaw === "first_order" ? "first_order" : "every_order";
    return { rate, mode };
  }

  async awardRebate(params: {
    inviteeId: number;
    amount: number;
    sourceType: string;
    sourceId?: number | null;
    tradeNo?: string | null;
    eventType?: string | null;
  }) {
    const { inviteeId, amount, sourceType } = params;

    if (!inviteeId || amount <= 0) {
      return { success: false, reason: "invalid_amount" };
    }

    const settings = await this.getRebateSettings();
    if (settings.rate <= 0) {
      return { success: false, reason: "rate_zero" };
    }

    // 通过 users.invited_by 获取邀请人，更稳健
    const inviteeRow = await this.db.db
      .prepare("SELECT invited_by FROM users WHERE id = ?")
      .bind(inviteeId)
      .first<{ invited_by?: number | null } | null>();
    const inviterId = ensureNumber(inviteeRow?.invited_by, 0);
    if (!inviterId || inviterId <= 0) {
      return { success: false, reason: "no_inviter" };
    }

    // 避免对同一 source 重复发放返利
    if (params.sourceId) {
      const existing = await this.db.db
        .prepare(
          "SELECT id FROM rebate_transactions WHERE source_type = ? AND source_id = ? AND amount > 0 LIMIT 1"
        )
        .bind(sourceType, params.sourceId)
        .first<{ id: number } | null>();
      if (existing) {
        return { success: false, reason: "duplicate" };
      }
    }

    // 确保 referral_relations 存在，没有则补一条
    let relation = await this.getRelation(inviteeId);
    if (!relation) {
      relation = await this.createFallbackRelation(inviterId, inviteeId);
    }
    if (!relation) {
      return { success: false, reason: "no_relation" };
    }

    if (settings.mode === "first_order" && relation.first_payment_id != null) {
      return { success: false, reason: "already_first" };
    }

    const rebateAmount = fixMoneyPrecision(amount * settings.rate);
    if (rebateAmount <= 0) {
      return { success: false, reason: "small_amount" };
    }

    await this.db.db
      .prepare(
        `
        INSERT INTO rebate_transactions (
          inviter_id, referral_id, invitee_id, source_type, source_id, trade_no, event_type, amount, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', CURRENT_TIMESTAMP)
      `
      )
      .bind(
        inviterId,
        relation.id ?? null,
        inviteeId,
        params.sourceType,
        params.sourceId ?? null,
        params.tradeNo ?? null,
        params.eventType ?? params.sourceType,
        rebateAmount
      )
      .run();

    await this.db.db
      .prepare(
        `
        UPDATE users
        SET rebate_available = rebate_available + ?, rebate_total = rebate_total + ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .bind(rebateAmount, rebateAmount, inviterId)
      .run();

    const shouldUpdateFirstPayment = relation.first_payment_id == null;
    if (shouldUpdateFirstPayment) {
      await this.db.db
        .prepare(
          `
          UPDATE referral_relations
          SET first_payment_type = ?,
              first_payment_id = ?,
              first_paid_at = CURRENT_TIMESTAMP,
              status = 'active',
              updated_at = CURRENT_TIMESTAMP
          WHERE invitee_id = ?
        `
        )
        .bind(sourceType, params.sourceId ?? null, inviteeId)
        .run();
    } else if (relation.status !== "active") {
      await this.db.db
        .prepare(
          `
          UPDATE referral_relations
          SET status = 'active',
              updated_at = CURRENT_TIMESTAMP
          WHERE invitee_id = ?
        `
        )
        .bind(inviteeId)
        .run();
    }

    return { success: true, amount: rebateAmount, inviterId };
  }

  async insertUserTransaction(params: {
    userId: number;
    amount: number;
    eventType: string;
    sourceType: string;
    sourceId?: number | null;
    tradeNo?: string | null;
    remark?: string | null;
  }) {
    const fixedAmount = fixMoneyPrecision(params.amount);
    if (!params.userId || fixedAmount === 0) return;
    await this.db.db
      .prepare(
        `
        INSERT INTO rebate_transactions (
          inviter_id, referral_id, invitee_id, source_type, source_id, trade_no, event_type, amount, status, remark, created_at
        ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 'confirmed', ?, CURRENT_TIMESTAMP)
      `
      )
      .bind(
        params.userId,
        params.sourceType,
        params.sourceId ?? null,
        params.tradeNo ?? null,
        params.eventType,
        fixedAmount,
        params.remark ?? null
      )
      .run();
  }
}
