// worker/src/Command/resetTodayBandwidth.js - 重置今日已使用流量

/**
 * 重置所有用户今日已使用流量
 * @param {D1Database} db - 数据库实例
 */
export async function resetTodayBandwidth(db) {
    console.log('开始重置今日已使用流量...');
    
    try {
        // 获取今日有流量使用的用户数量
        const activeUsersResult = await db.prepare(`
            SELECT COUNT(*) as count 
            FROM users 
            WHERE upload_today > 0 OR download_today > 0
        `).first();
        
        const activeCount = activeUsersResult?.count || 0;
        
        // 获取今日流量统计信息用于记录
        const todayStats = await db.prepare(`
            SELECT 
                COUNT(*) as active_users,
                SUM(upload_today) as total_upload,
                SUM(download_today) as total_download,
                SUM(upload_today + download_today) as total_traffic
            FROM users 
            WHERE upload_today > 0 OR download_today > 0
        `).first();
        
        // 记录到每日流量统计表
        if (todayStats && todayStats.active_users > 0) {
            const today = new Date().toISOString().split('T')[0];
            
            // 为每个有流量使用的用户创建每日流量记录
            const usersWithTraffic = await db.prepare(`
                SELECT id, upload_today, download_today
                FROM users 
                WHERE upload_today > 0 OR download_today > 0
            `).all();
            
            for (const user of usersWithTraffic.results || []) {
                await db.prepare(`
                    INSERT OR REPLACE INTO daily_traffic 
                    (user_id, record_date, upload_traffic, download_traffic, total_traffic, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).bind(
                    user.id,
                    today,
                    user.upload_today,
                    user.download_today,
                    user.upload_today + user.download_today,
                    Math.floor(Date.now() / 1000)
                ).run();
            }
            
            // 记录系统流量汇总
            await db.prepare(`
                INSERT OR REPLACE INTO system_traffic_summary 
                (record_date, total_users, total_upload, total_download, total_traffic, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
                today,
                todayStats.active_users,
                todayStats.total_upload,
                todayStats.total_download,
                todayStats.total_traffic,
                Math.floor(Date.now() / 1000)
            ).run();
            
            console.log(`已记录 ${todayStats.active_users} 个用户的流量统计到每日流量表`);
        }
        
        // 重置所有用户的今日流量
        await db.prepare(`
            UPDATE users 
            SET upload_today = 0,
                download_today = 0,
                updated_at = datetime('now', '+8 hours')
            WHERE upload_today > 0 OR download_today > 0
        `).run();
        
        console.log(`成功重置 ${activeCount} 个用户的今日流量`);
        
        return { 
            success: true, 
            message: `成功重置 ${activeCount} 个用户的今日流量`,
            count: activeCount,
            stats: todayStats
        };
        
    } catch (error) {
        console.error('重置今日流量失败:', error);
        return { 
            success: false, 
            message: `重置今日流量失败: ${error.message}` 
        };
    }
}

/**
 * Cloudflare Workers 入口函数
 */
export async function handleResetTodayBandwidth(env) {
    return await resetTodayBandwidth(env.DB);
}