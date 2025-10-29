// worker/src/Command/ResetSubFullToken.js - 重置所有用户订阅令牌

import { generateRandomString, generateUUID } from '../utils/crypto';

/**
 * 重置所有用户订阅令牌
 * @param {D1Database} db - 数据库实例
 */
export async function resetAllSubscriptionTokens(db) {
    console.log('开始重置所有用户订阅令牌...');
    
    try {
        // 获取所有用户ID
        const users = await db.prepare('SELECT id FROM users').all();
        
        if (!users.results || users.results.length === 0) {
            console.log('没有找到用户记录');
            return { success: false, message: '没有找到用户记录' };
        }
        
        let updatedCount = 0;
        
        for (const user of users.results) {
            try {
                // 生成新的UUID、passwd和订阅令牌
                const newUUID = generateUUID(); // 生成真正的UUID
                const newPassword = generateRandomString(16);
                const newToken = generateRandomString(32);
                
                // 更新用户UUID、passwd和订阅令牌
                await db.prepare(`
                    UPDATE users 
                    SET uuid = ?,
                        passwd = ?,
                        token = ?, 
                        updated_at = datetime('now', '+8 hours')
                    WHERE id = ?
                `).bind(newUUID, newPassword, newToken, user.id).run();
                
                updatedCount++;
                console.log(`用户 ${user.id} 的UUID、密码和订阅令牌已重置`);
                
            } catch (error) {
                console.error(`重置用户 ${user.id} 订阅信息时出错:`, error);
            }
        }
        
        console.log(`订阅令牌重置完成，共重置 ${updatedCount} 个用户`);
        
        return { 
            success: true, 
            message: `订阅令牌重置完成，共重置 ${updatedCount} 个用户` 
        };
        
    } catch (error) {
        console.error('重置订阅令牌失败:', error);
        return { 
            success: false, 
            message: `重置订阅令牌失败: ${error.message}` 
        };
    }
}

/**
 * Cloudflare Workers 入口函数
 */
export async function handleResetSubFullToken(env) {
    return await resetAllSubscriptionTokens(env.DB);
}