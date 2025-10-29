// worker/src/Command/clearJwtToken.js - 清除所有JWT令牌

/**
 * 清除所有JWT令牌（通过清除用户会话表）
 * @param {D1Database} db - 数据库实例
 */
export async function clearAllJwtTokens(db) {
    console.log('开始清除所有JWT令牌...');
    
    try {
        // 获取当前会话数量
        const sessionCountResult = await db.prepare('SELECT COUNT(*) as count FROM user_sessions').first();
        const sessionCount = sessionCountResult?.count || 0;
        
        // 清除所有会话记录
        await db.prepare('DELETE FROM user_sessions').run();
        
        console.log(`成功清除 ${sessionCount} 个JWT令牌会话`);
        
        return { 
            success: true, 
            message: `成功清除 ${sessionCount} 个JWT令牌会话`,
            count: sessionCount
        };
        
    } catch (error) {
        console.error('清除JWT令牌失败:', error);
        return { 
            success: false, 
            message: `清除JWT令牌失败: ${error.message}` 
        };
    }
}

/**
 * 清除过期的JWT令牌
 * @param {D1Database} db - 数据库实例
 */
export async function clearExpiredJwtTokens(db) {
    console.log('开始清除过期的JWT令牌...');
    
    try {
        // 获取过期会话数量
        const expiredSessionsResult = await db.prepare(`
            SELECT COUNT(*) as count 
            FROM user_sessions 
            WHERE expires_at <= datetime('now', '+8 hours')
        `).first();
        
        const expiredCount = expiredSessionsResult?.count || 0;
        
        // 清除过期的会话记录
        await db.prepare(`
            DELETE FROM user_sessions 
            WHERE expires_at <= datetime('now', '+8 hours')
        `).run();
        
        console.log(`成功清除 ${expiredCount} 个过期的JWT令牌会话`);
        
        return { 
            success: true, 
            message: `成功清除 ${expiredCount} 个过期的JWT令牌会话`,
            count: expiredCount
        };
        
    } catch (error) {
        console.error('清除过期JWT令牌失败:', error);
        return { 
            success: false, 
            message: `清除过期JWT令牌失败: ${error.message}` 
        };
    }
}

/**
 * Cloudflare Workers 入口函数
 */
export async function handleClearJwtToken(env, onlyExpired = false) {
    if (onlyExpired) {
        return await clearExpiredJwtTokens(env.DB);
    } else {
        return await clearAllJwtTokens(env.DB);
    }
}