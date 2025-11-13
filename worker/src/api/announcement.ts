import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { DatabaseService } from '../services/database';
import { successResponse as success, errorResponse as error } from '../utils/response';
import { getUtc8Timestamp } from '../utils/crypto';
import { ensureNumber, ensureString, toRunResult, getChanges, getLastRowId } from '../utils/d1';

interface AnnouncementRow {
  id: number;
  title: string;
  content: string;
  content_html: string | null;
  type: string | null;
  is_pinned: number | null;
  priority: number | null;
  created_at: number;
  updated_at?: number;
  expires_at: number | null;
  is_active?: number;
  created_by?: number | null;
}

interface AnnouncementWithCreatorRow extends AnnouncementRow {
  created_by_name: string | null;
}

interface CountRow {
  total: number;
}

export class AnnouncementAPI {
  private readonly env: Env;
  private readonly db: D1Database;
  private readonly dbService: DatabaseService;

  constructor(env: Env) {
    this.env = env;
    this.db = env.DB as D1Database;
    this.dbService = new DatabaseService(env.DB);
  }

  // 获取公告列表（用户端）
  async getAnnouncements(request: Request) {
    try {
      const url = new URL(request.url);
      const limitParam = parseInt(url.searchParams.get('limit') || '0', 10);
      const offsetParam = parseInt(url.searchParams.get('offset') || '0', 10);
      const safeLimit = limitParam > 0 ? limitParam : 10;
      const safeOffset = offsetParam >= 0 ? offsetParam : 0;

      const query = `
        SELECT id, title, content, content_html, type, is_pinned, priority, created_at, expires_at
        FROM announcements 
        WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY is_pinned DESC, priority DESC, created_at DESC
        LIMIT ? OFFSET ?
      `;

      const currentTimestamp = getUtc8Timestamp();
      const result = await this.db
        .prepare(query)
        .bind(currentTimestamp, safeLimit, safeOffset)
        .all<AnnouncementRow>();
      const announcements = result.results ?? [];

      const formattedAnnouncements = announcements.map((ann) => {
        const isPinned = !!ann.is_pinned;
        const priority = ensureNumber(ann.priority);
        const createdAt = ensureNumber(ann.created_at);
        const expiresAt = ann.expires_at !== null ? ensureNumber(ann.expires_at) : null;

        return {
          id: ann.id,
          title: ensureString(ann.title),
          content: ensureString(ann.content),
          content_html: ann.content_html ?? '',
          type: ensureString(ann.type),
          is_pinned: isPinned,
          priority,
          created_at: createdAt,
          expires_at: expiresAt,
          is_expired: expiresAt !== null ? expiresAt < currentTimestamp : false,
        };
      });

      return success(formattedAnnouncements);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Get announcements error:', err);
      return error('获取公告失败', 500);
    }
  }

  // 获取所有公告（管理员端）
  async getAllAnnouncements(request: Request) {
    try {
      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get('page') || '0', 10) || 1;
      const limitParam = parseInt(url.searchParams.get('limit') || '0', 10) || 20;
      const safeLimit = limitParam > 0 ? limitParam : 20;
      const offset = (page - 1) * safeLimit;
      
      const query = `
        SELECT a.*, u.username as created_by_name
        FROM announcements a
        LEFT JOIN users u ON a.created_by = u.id
        ORDER BY a.created_at DESC
        LIMIT ? OFFSET ?
      `;
      
      const result = await this.db
        .prepare(query)
        .bind(safeLimit, offset)
        .all<AnnouncementWithCreatorRow>();
      const announcements = result.results ?? [];
      
      // 获取总数
      const countQuery = 'SELECT COUNT(*) as total FROM announcements';
      const countResult = await this.db.prepare(countQuery).first<CountRow>();
      const total = ensureNumber(countResult?.total);
      
      // 格式化数据，将 is_active 转换为 status
      const formattedAnnouncements = announcements.map((ann) => ({
        ...ann,
        status: ensureNumber(ann.is_active),
        created_at: new Date(ensureNumber(ann.created_at) * 1000).toISOString(),
      }));
      
      return success({
        data: formattedAnnouncements,
        total,
        page,
        limit: safeLimit,
        pagination: {
          total,
          page,
          limit: safeLimit,
          pages: total > 0 ? Math.ceil(total / safeLimit) : 0,
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Get all announcements error:', err);
      return error('获取公告列表失败', 500);
    }
  }

  // 创建公告（管理员）
  async createAnnouncement(request: Request) {
    try {
      const data = await request.json();
      const { title, content, type = 'notice', status = 1, is_pinned = false, priority = 0 } = data as Record<string, unknown>;

      if (!title || !content) {
        return error('标题和内容不能为空', 400);
      }

      // 获取用户ID（从认证中间件中）
      const userId = 1; // 暂时硬编码，后续从认证中间件获取

      // 转换HTML内容
      const contentHtml = await this.markdownToHtml(String(content));

      const query = `
        INSERT INTO announcements (title, content, content_html, type, is_active, is_pinned, priority, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const currentTimestamp = getUtc8Timestamp();
      const insertResult = toRunResult(
        await this.db
          .prepare(query)
          .bind(
            ensureString(title),
            ensureString(content),
            contentHtml,
            ensureString(type),
            Number(status),
            is_pinned ? 1 : 0,
            Number(priority) || 0,
            userId,
            currentTimestamp,
            currentTimestamp
          )
          .run()
      );

      const newId = getLastRowId(insertResult);
      const newAnnouncement = await this.db
        .prepare('SELECT * FROM announcements WHERE id = ?')
        .bind(newId)
        .first<AnnouncementRow>();

      return success({
        ...newAnnouncement,
        status: newAnnouncement?.is_active,
        message: '公告创建成功'
      });
    } catch (err) {
      console.error('Create announcement error:', err);
      return error('创建公告失败', 500);
    }
  }

  // 更新公告（管理员）
  async updateAnnouncement(request: Request) {
    try {
      const url = new URL(request.url);
      const announcementIdStr = url.pathname.split('/').pop();
      const announcementId = announcementIdStr ? Number(announcementIdStr) : NaN;
      const data = await request.json();

      if (!Number.isFinite(announcementId)) {
        return error('无效的公告ID', 400);
      }

      const { title, content, type, status, is_pinned, priority } = data as Record<string, unknown>;

      const contentHtml = await this.markdownToHtml(typeof content === 'string' ? content : String(content ?? ''));
      const currentTimestamp = getUtc8Timestamp();

      const query = `
        UPDATE announcements
        SET title = ?, content = ?, content_html = ?, type = ?, is_active = ?, is_pinned = ?, priority = ?, updated_at = ?
        WHERE id = ?
      `;

      const updateResult = toRunResult(
        await this.db
          .prepare(query)
          .bind(
            ensureString(title),
            ensureString(content),
            contentHtml,
            ensureString(type),
            status !== undefined ? Number(status) : 1,
            is_pinned ? 1 : 0,
            priority !== undefined ? Number(priority) : 0,
            currentTimestamp,
            announcementId
          )
          .run()
      );

      if (getChanges(updateResult) === 0) {
        return error('公告不存在或未更新', 404);
      }

      const updatedAnnouncement = await this.db
        .prepare('SELECT * FROM announcements WHERE id = ?')
        .bind(announcementId)
        .first<AnnouncementRow>();

      return success({
        ...updatedAnnouncement,
        status: updatedAnnouncement?.is_active,
        message: '公告更新成功'
      });
    } catch (err) {
      console.error('Update announcement error:', err);
      return error('更新公告失败', 500);
    }
  }

  // 删除公告（管理员）
  async deleteAnnouncement(request: Request) {
    try {
      const url = new URL(request.url);
      const announcementIdStr = url.pathname.split('/').pop();
      const announcementId = announcementIdStr ? Number(announcementIdStr) : NaN;

      if (!Number.isFinite(announcementId)) {
        return error('无效的公告ID', 400);
      }

      const query = 'DELETE FROM announcements WHERE id = ?';
      const deleteResult = toRunResult(
        await this.db.prepare(query).bind(announcementId).run()
      );

      if (getChanges(deleteResult) === 0) {
        return error('公告不存在', 404);
      }

      return success({ message: '公告删除成功' });
    } catch (err) {
      console.error('Delete announcement error:', err);
      return error('删除公告失败', 500);
    }
  }

  // 简单的Markdown转HTML（基础版本）
  async markdownToHtml(markdown: string | undefined): Promise<string> {
    if (!markdown) return '';
    
    // 基础的Markdown转换
    let html = markdown
      // 标题
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // 粗体
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      // 列表
      .replace(/^\- (.*$)/gim, '<li>$1</li>')
      // 段落
      .replace(/\n\n/gim, '</p><p>')
      // 换行
      .replace(/\n/gim, '<br/>');
    
    // 包装在段落中
    html = '<p>' + html + '</p>';
    
    // 处理列表
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    return html;
  }
}
