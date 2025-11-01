import { onlineUsers, serverEvents, EVENT_NAMES } from './server-events.js';
import { getConfigValue } from './util.js';

// 存储用户最后活动时间的映射
const userLastActivity = new Map();

/**
 * 更新用户最后活动时间
 * @param {string} handle 用户标识
 */
export function updateUserActivity(handle) {
    if (!handle) return;
    userLastActivity.set(handle, Date.now());
}

/**
 * 获取用户的最后活动时间
 * @param {string} handle 用户标识
 * @returns {number|undefined} 最后活动时间戳或undefined
 */
export function getUserLastActivity(handle) {
    return userLastActivity.get(handle);
}

/**
 * 添加用户到在线用户列表
 * @param {string} handle 用户标识
 */
export function addOnlineUser(handle) {
    if (!handle) return;
    onlineUsers.add(handle);
    updateUserActivity(handle);
    console.log(`用户 ${handle} 已上线，当前在线用户数: ${onlineUsers.size}`);
}

/**
 * 从在线用户列表中移除用户
 * @param {string} handle 用户标识
 */
export function removeOnlineUser(handle) {
    if (!handle) return;
    onlineUsers.delete(handle);
    userLastActivity.delete(handle);
    console.log(`用户 ${handle} 已离线，当前在线用户数: ${onlineUsers.size}`);
}

/**
 * 检查并清理过期会话
 */
export function cleanExpiredSessions() {
    const sessionTimeout = getConfigValue('sessionTimeout', 0, 'number');
    if (sessionTimeout <= 0) return; // 如果没有设置超时或为0，不执行清理

    const now = Date.now();
    const expireTime = sessionTimeout * 1000; // 转换为毫秒
    let cleanedCount = 0;

    // 复制一份在线用户列表，避免在迭代过程中修改原集合
    const onlineUsersCopy = Array.from(onlineUsers);

    for (const handle of onlineUsersCopy) {
        const lastActivity = getUserLastActivity(handle);

        // 如果没有活动记录或活动已超时
        if (!lastActivity || (now - lastActivity > expireTime)) {
            // 触发用户登出事件
            serverEvents.emit(EVENT_NAMES.USER_LOGOUT, handle);
            // 移除用户
            removeOnlineUser(handle);
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        console.log(`清理了 ${cleanedCount} 个过期会话，当前在线用户数: ${onlineUsers.size}`);
    }
}

/**
 * 初始化会话管理器
 */
export function initSessionManager() {
    // 每30秒检查一次过期会话
    setInterval(cleanExpiredSessions, 30000);
    console.log('会话管理器已初始化，将定期清理过期会话');
}