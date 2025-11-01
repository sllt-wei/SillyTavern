import EventEmitter from 'node:events';
import process from 'node:process';

/**
 * @typedef {import('../index').ServerEventMap} ServerEventMap
 * @type {EventEmitter<ServerEventMap>} The default event source.
 */
export const serverEvents = new EventEmitter();
process.serverEvents = serverEvents;
export default serverEvents;

/**
 * @enum {string}
 * @readonly
 */
export const EVENT_NAMES = Object.freeze({
    /**
     * Emitted when the server has started.
     */
    SERVER_STARTED: 'server-started',
    /**
     * 用户登录事件
     */
    USER_LOGIN: 'user-login',
    /**
     * 用户登出事件
     */
    USER_LOGOUT: 'user-logout',
});

// 跟踪当前在线用户
export const onlineUsers = new Set();

/**
 * 获取当前在线用户数量
 * @returns {number} 在线用户数量
 */
export function getOnlineUsersCount() {
    return onlineUsers.size;
}
