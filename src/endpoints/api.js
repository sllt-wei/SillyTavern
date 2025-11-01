import express from 'express';
import { getOnlineUsersCount } from '../server-events.js';

export const router = express.Router();

/**
 * 获取当前在线用户数量
 */
router.get('/online-count', (req, res) => {
    // 添加CORS头
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Content-Type');

    try {
        const count = getOnlineUsersCount();
        return res.json({ count });
    } catch (error) {
        console.error('获取在线用户数量失败:', error);
        return res.status(500).json({ error: '服务器内部错误' });
    }
});

/**
 * 获取服务器状态信息
 * 返回包含负载信息的JSON对象：
 * - count: 在线用户数量
 * - status: 服务器负载状态 (low, medium, high)
 */
router.get('/server-status', (req, res) => {
    // 添加CORS头
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Content-Type');

    try {
        const count = getOnlineUsersCount();
        let status = 'low';

        // 根据在线用户数量判断服务器负载
        if (count > 20) {
            status = 'high';
        } else if (count > 10) {
            status = 'medium';
        }

        return res.json({
            count,
            status
        });
    } catch (error) {
        console.error('获取服务器状态失败:', error);
        return res.status(500).json({ error: '服务器内部错误' });
    }
});

// 添加OPTIONS请求处理，用于CORS预检请求
router.options('/*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(200);
});
