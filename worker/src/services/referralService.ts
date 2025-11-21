import type { Logger } from "../utils/logger";
import type { SystemConfigManager } from "../utils/systemConfig";
import { DatabaseService } from "./database";
import { ensureNumber, ensureString, getChanges, getLastRowId, toRunResult } from "../utils/d1";
import { fixMoneyPrecision } from "../utils/money";

type RebateMode = "first_order" | "every_order";

type RebateSettings = {
  rate: number;
  mode: RebateMode;
};

type AwardParams = {
  inviteeId: number;
  amount: number;
  sourceType: string;
  sourceId?: number | null;
  tradeNo?: string | null;
  eventType?: string;
  remark?: string;
};

type WithdrawalStatus = "pending" | "approved" | "rejected" | "paid";

type WithdrawalSettings = {
  minAmount: number;
  feeRate: number;
};

export class ReferralService {
  private readonly db: DatabaseService;
  private readonly configManager: SystemConfigManager;
  private readonly logger: Logger;
  private static readonly inviteChars =
    "abcdefghjkmnpqrstuvwxyz23456789";

  constructor(db: DatabaseService, configManager: SystemConfigManager, logger: Logger) {
    this.db = db;
    this.configManager = configManager;
    this.logger = logger;
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
    if (existing) {
      return existing;
    }

    const newCode = await this.generateUniqueInviteCode();
    await this.db.db
      .prepare("UPDATE users SET invite_code = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?")
      .bind(newCode, userId)
      .run();
    return newCode;
  }

  private async getDefaultInviteLimitValue(): Promise<number> {
    const raw = await this.configManager.getSystemConfig("invite_default_limit", "0");
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return 0;
  }

  async applyDefaultInviteLimit(userId: number) {
    const defaultLimit = await this.getDefaultInviteLimitValue();
    if (defaultLimit <= 0) {
      return;
    }
    await this.db.db
      .prepare(
        `
        UPDATE users
        SET invite_limit = ?,
            invite_used = CASE
              WHEN invite_used > ? THEN ?
              ELSE invite_used
            END,
            updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `
      )
      .bind(defaultLimit, defaultLimit, defaultLimit, userId)
      .run();
  }

  async regenerateInviteCode(userId: number) {
    if (!userId) return null;
    const newCode = await this.generateUniqueInviteCode();
    await this.db.db
      .prepare(
        `
        UPDATE users
        SET invite_code = ?, invite_used = 0, updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `
      )
      .bind(newCode, userId)
      .run();
    return newCode;
  }

  async resetAllInviteCodes(): Promise<number> {
    const rows = await this.db.db
      .prepare("SELECT id FROM users")
      .all<{ id: number }>();
    const list = rows.results ?? [];
    let updated = 0;
    for (const row of list) {
      const userId = ensureNumber(row.id);
      if (userId > 0) {
        await this.regenerateInviteCode(userId);
        updated += 1;
      }
    }
    return updated;
  }

  private async generateUniqueInviteCode(length = 6): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = Array.from({ length }, () =>
        ReferralService.inviteChars.charAt(
          Math.floor(Math.random() * ReferralService.inviteChars.length)
        )
      ).join("");
      const existing = await this.db.db
        .prepare("SELECT id FROM users WHERE invite_code = ?")
        .bind(code)
        .first<{ id: number } | null>();
      if (!existing) {
        return code;
      }
    }
    // 兜底方案: 使用时间戳
    return `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 4)}`.slice(0, length);
  }

  async findInviterByCode(code?: string | null) {
    const normalized = this.normalizeInviteCode(code);
    if (!normalized) {
      return null;
    }
    return await this.db.db
      .prepare("SELECT id, invite_code FROM users WHERE lower(invite_code) = ? LIMIT 1")
      .bind(normalized)
      .first<{ id: number; invite_code: string } | null>();
  }

  async saveReferralRelation(params: {
    inviterId: number;
    inviteeId: number;
    inviteCode: string;
    inviteIp?: string | null;
  }) {
    const { inviterId, inviteeId, inviteCode, inviteIp } = params;
    if (!inviterId || !inviteeId || inviterId === inviteeId) {
      return;
    }
    await this.db.db
      .prepare(`
        INSERT INTO referral_relations (
          inviter_id, invitee_id, invite_code, invite_ip, registered_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, datetime('now', '+8 hours'), 'pending', datetime('now', '+8 hours'), datetime('now', '+8 hours'))
        ON CONFLICT(invitee_id) DO UPDATE SET
          inviter_id = excluded.inviter_id,
          invite_code = excluded.invite_code,
          invite_ip = COALESCE(excluded.invite_ip, referral_relations.invite_ip),
          updated_at = datetime('now', '+8 hours')
      `)
      .bind(inviterId, inviteeId, inviteCode, inviteIp || null)
      .run();
  }

  async isInviteAvailable(inviterId: number) {
    if (!inviterId) return false;
    const row = await this.db.db
      .prepare("SELECT invite_limit, invite_used FROM users WHERE id = ?")
      .bind(inviterId)
      .first<{ invite_limit?: number | string | null; invite_used?: number | string | null } | null>();
    if (!row) return false;
    const limit = ensureNumber(row.invite_limit);
    const used = ensureNumber(row.invite_used);
    if (limit > 0 && used >= limit) {
      return false;
    }
    return true;
  }

  async incrementInviteUsage(inviterId: number) {
    if (!inviterId) return;
    await this.db.db
      .prepare(
        `
        UPDATE users
        SET invite_used = CASE
              WHEN invite_limit > 0 AND invite_used >= invite_limit THEN invite_limit
              ELSE invite_used + 1
            END,
            updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `
      )
      .bind(inviterId)
      .run();
  }

  private async getRelation(inviteeId: number): Promise<any | null> {
    if (!inviteeId) return null;
    return await this.db.db
      .prepare("SELECT * FROM referral_relations WHERE invitee_id = ? LIMIT 1")
      .bind(inviteeId)
      .first<Record<string, unknown> | null>();
  }

  async getRebateSettings(): Promise<RebateSettings> {
    const [rateRaw, modeRaw] = await Promise.all([
      this.configManager.getSystemConfig("rebate_rate", "0"),
      this.configManager.getSystemConfig("rebate_mode", "every_order")
    ]);
    const parsedRate = Number.parseFloat(rateRaw);
    const clamped = Number.isFinite(parsedRate)
      ? Math.max(0, Math.min(parsedRate, 1))
      : 0;
    const normalizedMode =
      modeRaw === "first_order" ? "first_order" : "every_order";
    return { rate: clamped, mode: normalizedMode };
  }

  async getWithdrawalSettings(): Promise<WithdrawalSettings> {
    const [minRaw, feeRaw] = await Promise.all([
      this.configManager.getSystemConfig("rebate_withdraw_min_amount", "200"),
      this.configManager.getSystemConfig("rebate_withdraw_fee_rate", "0")
    ]);

    const parsedMin = Number.parseFloat(minRaw);
    const minAmount = Number.isFinite(parsedMin) && parsedMin > 0
      ? fixMoneyPrecision(parsedMin)
      : 200;

    const parsedFee = Number.parseFloat(feeRaw);
    const feeRate = Number.isFinite(parsedFee)
      ? Math.min(Math.max(parsedFee, 0), 1)
      : 0;

    return {
      minAmount,
      feeRate,
    };
  }

  async awardRebate(params: AwardParams): Promise<number> {
    const { inviteeId, amount, sourceType } = params;
    if (amount <= 0 || !inviteeId) {
      return 0;
    }
    const settings = await this.getRebateSettings();
    if (settings.rate <= 0) {
      return 0;
    }

    const invitee = await this.db.db
      .prepare("SELECT invited_by FROM users WHERE id = ?")
      .bind(inviteeId)
      .first<{ invited_by?: number | null } | null>();

    const inviterId = ensureNumber(invitee?.invited_by);
    if (!inviterId || inviterId <= 0) {
      return 0;
    }

    if (params.sourceId) {
      const existing = await this.db.db
        .prepare(
          "SELECT id FROM rebate_transactions WHERE source_type = ? AND source_id = ? AND amount > 0 LIMIT 1"
        )
        .bind(sourceType, params.sourceId)
        .first<{ id: number } | null>();
      if (existing) {
        return 0;
      }
    }

    const relation =
      (await this.getRelation(inviteeId)) ??
      (await this.createFallbackRelation(inviterId, inviteeId));

    if (!relation) {
      return 0;
    }

    if (
      settings.mode === "first_order" &&
      relation.first_payment_id !== null &&
      relation.first_payment_id !== undefined
    ) {
      return 0;
    }

    const rebateAmount = fixMoneyPrecision(amount * settings.rate);
    if (rebateAmount <= 0) {
      return 0;
    }

    const insertResult = await this.db.db
      .prepare(
        `
        INSERT INTO rebate_transactions (
          inviter_id, referral_id, invitee_id, source_type, source_id,
          trade_no, event_type, amount, status, remark, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now', '+8 hours'))
      `
      )
      .bind(
        inviterId,
        relation.id ?? null,
        inviteeId,
        sourceType,
        params.sourceId ?? null,
        params.tradeNo ?? null,
        params.eventType || "rebate",
        rebateAmount,
        params.remark || null
      )
      .run();

    if (!insertResult.success) {
      this.logger.error("记录返利流水失败", insertResult.error);
      return 0;
    }

    await this.db.db
      .prepare(
        `
        UPDATE users
        SET rebate_available = rebate_available + ?, 
            rebate_total = rebate_total + ?, 
            updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `
      )
      .bind(rebateAmount, rebateAmount, inviterId)
      .run();

    const shouldUpdateFirstPayment =
      relation.first_payment_id === null ||
      relation.first_payment_id === undefined;

    if (shouldUpdateFirstPayment) {
      await this.db.db
        .prepare(
          `
          UPDATE referral_relations
          SET first_payment_type = ?,
              first_payment_id = ?,
              first_paid_at = datetime('now', '+8 hours'),
              status = 'active',
              updated_at = datetime('now', '+8 hours')
          WHERE invitee_id = ?
        `
        )
        .bind(
          sourceType,
          params.sourceId ?? null,
          inviteeId
        )
        .run();
    } else if (relation.status !== "active") {
      await this.db.db
        .prepare(
          "UPDATE referral_relations SET status = 'active', updated_at = datetime('now', '+8 hours') WHERE invitee_id = ?"
        )
        .bind(inviteeId)
        .run();
    }

    return rebateAmount;
  }

  private async createFallbackRelation(inviterId: number, inviteeId: number): Promise<any | null> {
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
      inviteCode,
    });
    return await this.getRelation(inviteeId);
  }

  async transferRebateToBalance(userId: number, amount: number) {
    const fixedAmount = fixMoneyPrecision(amount);
    if (fixedAmount <= 0) {
      throw new Error("划转金额必须大于0");
    }

    const userRow = await this.db.db
      .prepare("SELECT money, rebate_available FROM users WHERE id = ?")
      .bind(userId)
      .first<{ money?: number | string | null; rebate_available?: number | string | null } | null>();
    if (!userRow) {
      throw new Error("用户不存在");
    }
    const rebateBefore = ensureNumber(userRow.rebate_available);
    if (rebateBefore + 1e-6 < fixedAmount) {
      throw new Error("返利余额不足");
    }
    const balanceBefore = ensureNumber(userRow.money);

    const updateResult = toRunResult(
      await this.db.db
        .prepare(
          `
          UPDATE users
          SET rebate_available = rebate_available - ?,
              money = money + ?,
              updated_at = datetime('now', '+8 hours')
          WHERE id = ? AND rebate_available >= ?
        `
        )
        .bind(fixedAmount, fixedAmount, userId, fixedAmount)
        .run()
    );

    if (getChanges(updateResult) === 0) {
      throw new Error("划转失败，请稍后重试");
    }

    await this.db.db
      .prepare(
        `
        INSERT INTO rebate_transfers (
          user_id, amount, balance_before, balance_after, rebate_before, rebate_after, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
      `
      )
      .bind(
        userId,
        fixedAmount,
        balanceBefore,
        balanceBefore + fixedAmount,
        rebateBefore,
        rebateBefore - fixedAmount
      )
      .run();

    await this.insertTransaction(userId, null, fixedAmount * -1, "transfer", "balance");
  }

  async createWithdrawal(params: {
    userId: number;
    amount: number;
    method: string;
    accountPayload?: Record<string, unknown> | null;
  }) {
    const fixedAmount = fixMoneyPrecision(params.amount);
    if (fixedAmount <= 0) {
      throw new Error("提现金额必须大于0");
    }

    const withdrawSettings = await this.getWithdrawalSettings();
    const minAmount = withdrawSettings.minAmount;
    if (fixedAmount + 1e-6 < minAmount) {
      throw new Error(`单次提现金额需不少于${minAmount.toFixed(2)}元`);
    }

    const userRow = await this.db.db
      .prepare("SELECT rebate_available FROM users WHERE id = ?")
      .bind(params.userId)
      .first<{ rebate_available?: number | string | null } | null>();
    if (!userRow) {
      throw new Error("用户不存在");
    }
    const available = ensureNumber(userRow.rebate_available);
    if (available + 1e-6 < minAmount) {
      throw new Error(`返利余额满${minAmount.toFixed(2)}元才允许提现`);
    }
    if (available + 1e-6 < fixedAmount) {
      throw new Error("返利余额不足");
    }

    const deductResult = toRunResult(
      await this.db.db
        .prepare(
          `
          UPDATE users
          SET rebate_available = rebate_available - ?, updated_at = datetime('now', '+8 hours')
          WHERE id = ? AND rebate_available >= ?
        `
        )
        .bind(fixedAmount, params.userId, fixedAmount)
        .run()
    );

    if (getChanges(deductResult) === 0) {
      throw new Error("扣除返利余额失败，请稍后再试");
    }

    const payload = params.accountPayload ? JSON.stringify(params.accountPayload) : null;
    const feeAmount = fixMoneyPrecision(fixedAmount * withdrawSettings.feeRate);

    const withdrawResult = await this.db.db
      .prepare(
        `
        INSERT INTO rebate_withdrawals (
          user_id, amount, method, account_payload, fee_rate, fee_amount, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now', '+8 hours'))
      `
      )
      .bind(
        params.userId,
        fixedAmount,
        params.method || "manual",
        payload,
        withdrawSettings.feeRate,
        feeAmount
      )
      .run();

    const withdrawalId = getLastRowId(toRunResult(withdrawResult));

    const remark = params.accountPayload ? JSON.stringify(params.accountPayload) : params.method || null;
    await this.insertTransaction(
      params.userId,
      null,
      fixedAmount * -1,
      "withdraw",
      "withdraw",
      withdrawalId,
      null,
      remark
    );

    return withdrawalId;
  }

  async updateWithdrawalStatus(
    withdrawalId: number,
    status: WithdrawalStatus,
    reviewerId: number,
    note?: string
  ) {
    const record = await this.db.db
      .prepare("SELECT * FROM rebate_withdrawals WHERE id = ?")
      .bind(withdrawalId)
      .first<Record<string, unknown> | null>();
    if (!record) {
      throw new Error("提现申请不存在");
    }

    const currentStatus = ensureString(record.status, "pending") as WithdrawalStatus;
    if (currentStatus === status) {
      return record;
    }

    const amount = ensureNumber(record.amount);
    const userId = ensureNumber(record.user_id);

    if (status === "rejected" && currentStatus !== "rejected") {
      await this.db.db
        .prepare(
          `
          UPDATE users
          SET rebate_available = rebate_available + ?, updated_at = datetime('now', '+8 hours')
          WHERE id = ?
        `
        )
        .bind(amount, userId)
        .run();

      await this.insertTransaction(
        userId,
        null,
        amount,
        "withdraw_revert",
        "withdraw",
        withdrawalId,
        null,
        ensureString(record.method)
      );
    }

    await this.db.db
      .prepare(
        `
        UPDATE rebate_withdrawals
        SET status = ?, reviewer_id = ?, review_note = ?, processed_at = CASE WHEN ? IN ('approved','paid') THEN datetime('now', '+8 hours') ELSE processed_at END,
            updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `
      )
      .bind(status, reviewerId || null, note || null, status, withdrawalId)
      .run();

    return await this.db.db
      .prepare("SELECT * FROM rebate_withdrawals WHERE id = ?")
      .bind(withdrawalId)
      .first<Record<string, unknown> | null>();
  }

  private async insertTransaction(
    userId: number,
    inviteeId: number | null,
    amount: number,
    eventType: string,
    sourceType: string,
    sourceId?: number | null,
    tradeNo?: string | null,
    remark?: string | null
  ) {
    await this.db.db
      .prepare(
        `
        INSERT INTO rebate_transactions (
          inviter_id, referral_id, invitee_id, source_type, source_id, trade_no, event_type, amount, status, remark, created_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now', '+8 hours'))
      `
      )
      .bind(userId, inviteeId, sourceType, sourceId ?? null, tradeNo ?? null, eventType, amount, remark ?? null)
      .run();
  }
}
