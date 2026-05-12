import crypto from 'node:crypto';

import storage from 'node-persist';
import express from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getIpAddress, retryAfter } from '../express-common.js';
import { color, Cache, getConfigValue } from '../util.js';
import { KEY_PREFIX, getUserAvatar, toKey, getPasswordHash, getPasswordSalt, getUserDirectories, getAllUserHandles, ensurePublicDirectoriesExist, getAccountVersion } from '../users.js';
import { checkForNewContent, CONTENT_TYPES } from './content-manager.js';
import lodash from 'lodash';
import { serverEvents, EVENT_NAMES, onlineUsers } from '../server-events.js';
import { addOnlineUser, removeOnlineUser } from '../session-manager.js';

const DISCREET_LOGIN = getConfigValue('enableDiscreetLogin', false, 'boolean');
const PREFER_REAL_IP_HEADER = getConfigValue('rateLimiting.preferRealIpHeader', false, 'boolean');
const LOGIN_POINTS = getConfigValue('rateLimiting.accountsLoginMaxAttempts', 5, 'number');
const RECOVER_POINTS = getConfigValue('rateLimiting.accountsRecoverMaxAttempts', 5, 'number');
const MFA_CACHE = new Cache(5 * 60 * 1000);

const generateRecoveryCode = () => Array.from({ length: 6 }, () => crypto.randomInt(0, 10)).join('');

export const router = express.Router();
const loginLimiter = new RateLimiterMemory({
    points: LOGIN_POINTS > 0 ? LOGIN_POINTS : Number.MAX_SAFE_INTEGER,
    duration: 60,
});
const recoverLimiter = new RateLimiterMemory({
    points: RECOVER_POINTS > 0 ? RECOVER_POINTS : Number.MAX_SAFE_INTEGER,
    duration: 300,
});
const registrationLimiter = new RateLimiterMemory({
    points: 3,
    duration: 300,
});

router.post('/list', async (_request, response) => {
    try {
        if (getConfigValue('enableDiscreetLogin', false, 'boolean')) {
            return response.sendStatus(204);
        }

        /** @type {import('../users.js').User[]} */
        const users = await storage.values(x => x.key.startsWith(KEY_PREFIX));

        /** @type {Promise<import('../users.js').UserViewModel>[]} */
        const viewModelPromises = users
            .filter(x => x.enabled)
            .map(user => new Promise(async (resolve) => {
                getUserAvatar(user.handle).then(avatar =>
                    resolve({
                        handle: user.handle,
                        name: user.name,
                        created: user.created,
                        avatar: avatar,
                        password: !!user.password,
                    }),
                );
            }));

        const viewModels = await Promise.all(viewModelPromises);
        viewModels.sort((x, y) => (x.created ?? 0) - (y.created ?? 0));
        return response.json(viewModels);
    } catch (error) {
        console.error('User list failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/login', async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Login failed: 缺少必填信息');
            return response.status(400).json({ error: '缺少必填信息' });
        }

        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        await loginLimiter.consume(ip);

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.error('Login failed: User', request.body.handle, 'not found');
            return response.status(403).json({ error: '用户名或密码不正确' });
        }

        if (!user.enabled) {
            console.warn('Login failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        if (user.password && user.password !== getPasswordHash(request.body.password, user.salt)) {
            console.warn('Login failed: Incorrect password for', user.handle);
            return response.status(403).json({ error: '用户名或密码不正确' });
        }

        if (!request.session) {
            console.error('Session not available');
            return response.sendStatus(500);
        }

        await loginLimiter.delete(ip);
        request.session.handle = user.handle;
        request.session.version = getAccountVersion(user);

        // 使用新的会话管理器添加用户
        addOnlineUser(user.handle);
        // 触发用户登录事件
        serverEvents.emit(EVENT_NAMES.USER_LOGIN, user.handle);

        console.info('Login successful:', user.handle, 'from', ip, 'at', new Date().toLocaleString());
        return response.json({ handle: user.handle });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Login failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: 'Too many attempts. Try again later or recover your password.' });
        }

        console.error('Login failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/logout', async (request, response) => {
    try {
        if (request.session && request.session.handle) {
            const userHandle = request.session.handle;

            // 使用新的会话管理器移除用户
            removeOnlineUser(userHandle);
            // 触发用户登出事件
            serverEvents.emit(EVENT_NAMES.USER_LOGOUT, userHandle);

            // 清除会话
            request.session.handle = null;
            request.session.csrfToken = null;
            request.session = null;

            console.info('Logout successful:', userHandle, 'at', new Date().toLocaleString());
        }

        return response.redirect('/login');
    } catch (error) {
        console.error('Logout failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/recover-step1', async (request, response) => {
    try {
        if (!request.body.handle) {
            console.warn('Recover step 1 failed: 缺少必填信息');
            return response.status(400).json({ error: '缺少必填信息' });
        }

        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        await recoverLimiter.consume(ip);

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.error('Recover step 1 failed: User', request.body.handle, 'not found');
            return response.status(404).json({ error: 'User not found' });
        }

        if (!user.enabled) {
            console.error('Recover step 1 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        const mfaCode = generateRecoveryCode();
        console.log();
        console.log(color.blue(`${user.name}, your password recovery code is: `) + color.magenta(mfaCode));
        console.log();
        MFA_CACHE.set(user.handle, mfaCode);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 1 failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: 'Too many attempts. Try again later or contact your admin.' });
        }

        console.error('Recover step 1 failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/recover-step2', async (request, response) => {
    try {
        if (!request.body.handle || !request.body.code) {
            console.warn('Recover step 2 failed: 缺少必填信息');
            return response.status(400).json({ error: '缺少必填信息' });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));
        const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
        const rateLimit = await recoverLimiter.get(ip);

        if (rateLimit !== null && rateLimit.consumedPoints > recoverLimiter.points) {
            throw rateLimit;
        }

        if (!user) {
            console.error('Recover step 2 failed: User', request.body.handle, 'not found');
            return response.status(404).json({ error: 'User not found' });
        }

        if (!user.enabled) {
            console.warn('Recover step 2 failed: User', user.handle, 'is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        const mfaCode = MFA_CACHE.get(user.handle);

        if (request.body.code !== mfaCode) {
            await recoverLimiter.consume(ip);
            console.warn('Recover step 2 failed: Incorrect code');
            return response.status(403).json({ error: 'Incorrect code' });
        }

        if (request.body.newPassword) {
            const salt = getPasswordSalt();
            user.password = getPasswordHash(request.body.newPassword, salt);
            user.salt = salt;
            await storage.setItem(toKey(user.handle), user);
        } else {
            user.password = '';
            user.salt = '';
            await storage.setItem(toKey(user.handle), user);
        }

        if (request.session && request.session.handle === user.handle) {
            request.session.version = getAccountVersion(user);
        }

        await recoverLimiter.delete(ip);
        MFA_CACHE.remove(user.handle);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('Recover step 2 failed: Rate limited from', getIpAddress(request, PREFER_REAL_IP_HEADER));
            return retryAfter(response, error).status(429).send({ error: 'Too many attempts. Try again later or contact your admin.' });
        }

        console.error('Recover step 2 failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/create', async (request, response) => {
    if (!getConfigValue('allowUserRegistration', true, 'boolean')) {
        return response.status(403).json({ error: '公开注册已禁用，请联系管理员' });
    }

    try {
        const ip = getIpAddress(request);
        await registrationLimiter.consume(ip);

        if (!request.body.handle || !request.body.name) {
            console.warn('创建用户失败: 缺少必填信息');
            return response.status(400).json({ error: '缺少必填信息' });
        }

        const handles = await getAllUserHandles();
        const handle = lodash.kebabCase(String(request.body.handle).toLowerCase().trim());

        if (!handle) {
            console.warn('创建用户失败: 无效的用户名');
            return response.status(400).json({ error: '无效的用户名' });
        }

        if (handles.some(x => x === handle)) {
            console.warn('创建用户失败: 用户名已存在');
            return response.status(409).json({ error: '用户已存在' });
        }

        const salt = getPasswordSalt();
        const password = request.body.password ? getPasswordHash(request.body.password, salt) : '';

        // 设置默认过期时间为当前时间（即立即过期）
        const defaultExpiry = Date.now(); // 用户一注册就过期

        const newUser = {
            handle: handle,
            name: request.body.name || '匿名用户',
            created: Date.now(),
            password: password,
            salt: salt,
            admin: false,
            enabled: true,
            expiry: defaultExpiry, // 设置为当前时间，一注册就已过期
        };

        await storage.setItem(toKey(handle), newUser);

        // 同步更新config.yaml中的账户信息
        try {
            // 导入读写config的函数
            const yaml = await import('yaml');
            const fs = await import('node:fs');
            const path = await import('node:path');

            // 读取配置文件
            const configPath = path.join(process.cwd(), 'config.yaml');
            const configContent = fs.readFileSync(configPath, 'utf8');
            const config = yaml.parse(configContent);

            // 确保accounts数组存在
            if (!config.accounts) {
                config.accounts = [];
            }

            if (!Array.isArray(config.accounts)) {
                config.accounts = [];
            }

            // 添加新用户到accounts中
            config.accounts.push({
                handle: handle,
                enabled: true,
                expiry: defaultExpiry
            });

            // 写入更新后的配置
            fs.writeFileSync(configPath, yaml.stringify(config), 'utf8');
            console.log(`新用户 ${handle} 已添加到config.yaml，过期时间: ${new Date(defaultExpiry).toISOString()}`);
        } catch (configError) {
            console.error('同步用户信息到config.yaml失败:', configError);
            // 不中断注册流程，仅记录错误
        }

        console.info('为用户创建数据目录:', newUser.handle);
        await ensurePublicDirectoriesExist();
        const directories = getUserDirectories(newUser.handle);
        await checkForNewContent([directories], [CONTENT_TYPES.SETTINGS]);

        await registrationLimiter.delete(ip);
        return response.json({ handle: newUser.handle });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.error('创建用户失败: 操作过于频繁', getIpAddress(request));
            return response.status(429).json({ error: '操作过于频繁，请稍后再试' });
        }

        console.error('创建用户失败:', error);
        return response.sendStatus(500);
    }
});
