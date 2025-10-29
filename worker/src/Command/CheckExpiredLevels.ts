// worker/src/Command/CheckExpiredLevels.js - 手动检测并重置过期用户等级

import { CacheService } from "../services/cache";

/**
 * 检测并重置过期用户等级
 * @param {D1Database} db - 数据库实例
 */
export async function checkAndResetExpiredLevels(db) {
    console.log('开始检测并重置过期用户等级...');
    
    // 初始化缓存服务
    const cache = new CacheService(db);
    
    try {
        // 时区处理通过SQL的 datetime('now', '+8 hours') 自动处理
        
        // 查找等级已过期的用户
        const expiredUsers = await db.prepare(`
            SELECT id, username, class, class_expire_time
            FROM users 
            WHERE class_expire_time IS NOT NULL 
            AND class_expire_time <= datetime('now', '+8 hours')
            AND class > 1
        `).all();
        
        if (!expiredUsers.results || expiredUsers.results.length === 0) {
            console.log('没有找到等级过期的用户');
            return { success: true, message: '没有找到等级过期的用户', count: 0 };
        }
        
        let resetCount = 0;
        const resetUsers = [];
        
        for (const user of expiredUsers.results) {
            try {
                // 重置用户等级为默认等级1
                await db.prepare(`
                    UPDATE users 
                    SET class = 1,
                        class_expire_time = NULL,
                        updated_at = datetime('now', '+8 hours')
                    WHERE id = ?
                `).bind(user.id).run();
                
                resetCount++;
                resetUsers.push({
                    id: user.id,
                    username: user.username,
                    old_class: user.class,
                    expire_time: user.class_expire_time
                });
                
                console.log(`用户 ${user.username} (ID: ${user.id}) 等级已从 ${user.class} 重置为 1`);
                
            } catch (error) {
                console.error(`重置用户 ${user.username} (ID: ${user.id}) 等级时出错:`, error);
            }
        }
        
        // 如果有用户等级被重置，清除相关缓存
        if (resetCount > 0) {
            console.log('清除用户相关缓存...');
            // 清除所有节点的用户缓存
            await cache.deleteByPrefix('node_users_');
            console.log('用户缓存清除完成');
        }
        
        console.log(`等级重置完成，共重置 ${resetCount} 个用户`);
        
        return { 
            success: true, 
            message: `等级重置完成，共重置 ${resetCount} 个用户`,
            count: resetCount,
            users: resetUsers
        };
        
    } catch (error) {
        console.error('检测过期等级失败:', error);
        return { 
            success: false, 
            message: `检测过期等级失败: ${error.message}` 
        };
    }
}

/**
 * Cloudflare Workers 入口函数
 */
export async function handleCheckExpiredLevels(env) {
    return await checkAndResetExpiredLevels(env.DB);
}