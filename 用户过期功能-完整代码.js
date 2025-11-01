// ==========================================
// 完整的用户过期和活动追踪代码实现
// 文件：src/users.js
// ==========================================

// ========== 1. 更新 User typedef（约第 48-57 行）==========
/**
 * @typedef {Object} User
 * @property {string} handle - The user's short handle. Used for directories and other references
 * @property {string} name - The user's name. Displayed in the UI
 * @property {number} created - The timestamp when the user was created
 * @property {string} password - Scrypt hash of the user's password
 * @property {string} salt - Salt used for hashing the password
 * @property {boolean} enabled - Whether the user is enabled
 * @property {boolean} admin - Whether the user is an admin (can manage other users)
 * @property {number} [expiry] - Optional expiry timestamp (milliseconds). If set, user will be logged out after this time
 * @property {number} [lastActivity] - Last activity timestamp (milliseconds)
 */


// ========== 2. 添加在线用户跟踪常量（约第 37 行之后）==========
/**
 * Set of currently online users (by handle).
 * @type {Set<string>}
 */
const ONLINE_USERS = new Set();

/**
 * Configuration for activity update interval (milliseconds).
 * Only update if last activity was more than this time ago.
 */
const ACTIVITY_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes


// ========== 3. 添加辅助函数（约第 820-850 行之间）==========

/**
 * Updates the last activity timestamp for a user.
 * Only updates if more than ACTIVITY_UPDATE_INTERVAL has passed since last update.
 * @param {string} handle - User handle
 * @returns {Promise<void>}
 */
async function updateUserActivity(handle) {
    if (!handle) return;
    
    try {
        const user = await storage.getItem(toKey(handle));
        if (user) {
            const now = Date.now();
            
            // Only update if interval has passed to avoid frequent writes
            if (!user.lastActivity || now - user.lastActivity > ACTIVITY_UPDATE_INTERVAL) {
                user.lastActivity = now;
                await storage.setItem(toKey(handle), user);
                console.debug(`Updated activity for user: ${handle}`);
            }
            
            // Always mark as online
            ONLINE_USERS.add(handle);
        }
    } catch (error) {
        console.error('Failed to update user activity:', handle, error);
    }
}

/**
 * Removes a user from the online users set.
 * @param {string} handle - User handle
 */
function removeOnlineUser(handle) {
    if (!handle) return;
    const wasOnline = ONLINE_USERS.delete(handle);
    if (wasOnline) {
        console.debug(`User removed from online list: ${handle}`);
    }
}

/**
 * Gets the list of currently online users.
 * @returns {string[]} Array of user handles
 */
export function getOnlineUsers() {
    return Array.from(ONLINE_USERS);
}

/**
 * Checks if a user is online.
 * @param {string} handle - User handle
 * @returns {boolean}
 */
export function isUserOnline(handle) {
    return ONLINE_USERS.has(handle);
}

/**
 * Clears the user session and removes from online users.
 * @param {import('express').Request} request - Request object
 * @param {string} handle - User handle
 */
function clearUserSession(request, handle) {
    if (handle) {
        removeOnlineUser(handle);
    }
    
    if (request.session) {
        request.session.handle = null;
        request.session.csrfToken = null;
        // Note: session.destroy() is async, but we don't await it
        // to avoid blocking the response
        request.session.destroy((err) => {
            if (err) {
                console.error('Failed to destroy session:', err);
            }
        });
    }
}


// ========== 4. 修改 setUserDataMiddleware（替换第 850-900 行）==========

/**
 * Middleware to add user data to the request object.
 * Also checks user expiry and updates activity.
 * @param {import('express').Request} request Request object
 * @param {import('express').Response} response Response object
 * @param {import('express').NextFunction} next Next function
 */
export async function setUserDataMiddleware(request, response, next) {
    // If user accounts are disabled, use the default user
    if (!ENABLE_ACCOUNTS) {
        const handle = DEFAULT_USER.handle;
        const directories = getUserDirectories(handle);
        request.user = {
            profile: DEFAULT_USER,
            directories: directories,
        };
        return next();
    }

    if (!request.session) {
        console.error('Session not available');
        return response.sendStatus(500);
    }

    // If user accounts are enabled, get the user from the session
    let handle = request.session?.handle;

    // If we have the only user and it's not password protected, use it
    if (!handle) {
        return next();
    }

    /** @type {User} */
    const user = await storage.getItem(toKey(handle));

    if (!user) {
        console.error('User not found:', handle);
        clearUserSession(request, handle);
        return next();
    }

    if (!user.enabled) {
        console.error('User is disabled:', handle);
        clearUserSession(request, handle);
        return next();
    }

    // ✨ 新增：检查用户是否过期
    if (user.expiry && user.expiry < Date.now()) {
        console.warn(`User ${user.handle} has expired at ${new Date(user.expiry).toISOString()}. Logging out.`);
        
        // 清除会话和在线状态
        clearUserSession(request, handle);
        
        // 重定向到登录页并显示过期消息
        return response.redirect('/login?error=expired');
    }

    // ✨ 新增：更新用户最后活动时间（异步执行，不阻塞请求）
    // 只在 GET 请求时更新，避免频繁写入
    if (request.method === 'GET') {
        updateUserActivity(handle).catch(err => {
            console.error('Failed to update user activity:', err);
        });
    }

    const directories = getUserDirectories(handle);
    request.user = {
        profile: user,
        directories: directories,
    };

    // Touch the session if loading the home page
    if (request.method === 'GET' && request.path === '/') {
        request.session.touch = Date.now();
    }

    return next();
}


// ========== 5. 在注册路由的地方添加（搜索 router.post 找到合适位置）==========

/**
 * Route handler for user logout.
 * Clears session and removes user from online list.
 */
router.post('/logout', csrfProtection, async (request, response) => {
    const handle = request.session?.handle;
    
    // ✨ 清理在线用户状态
    if (handle) {
        removeOnlineUser(handle);
        console.log(`User logged out: ${handle}`);
    }
    
    if (request.session) {
        request.session.destroy((err) => {
            if (err) {
                console.error('Failed to destroy session:', err);
                return response.sendStatus(500);
            }
            response.redirect('/login');
        });
    } else {
        response.redirect('/login');
    }
});


// ========== 6. 可选：添加管理端点（文件末尾或路由定义区域）==========

/**
 * Route handler to get online users (admin only).
 * GET /api/users/online
 */
router.get('/api/users/online', requireLoginMiddleware, async (request, response) => {
    try {
        // 检查是否是管理员
        if (!request.user?.profile?.admin) {
            return response.sendStatus(403);
        }
        
        const onlineHandles = getOnlineUsers();
        const onlineUsers = [];
        
        for (const handle of onlineHandles) {
            const user = await storage.getItem(toKey(handle));
            if (user) {
                onlineUsers.push({
                    handle: user.handle,
                    name: user.name,
                    lastActivity: user.lastActivity,
                    expiry: user.expiry,
                });
            }
        }
        
        response.json({
            count: onlineUsers.length,
            users: onlineUsers,
        });
    } catch (error) {
        console.error('Failed to get online users:', error);
        response.sendStatus(500);
    }
});

/**
 * Route handler to set user expiry (admin only).
 * POST /api/users/:handle/expiry
 * Body: { expiry: timestamp | null }
 */
router.post('/api/users/:handle/expiry', requireLoginMiddleware, async (request, response) => {
    try {
        // 检查是否是管理员
        if (!request.user?.profile?.admin) {
            return response.sendStatus(403);
        }
        
        const { handle } = request.params;
        const { expiry } = request.body; // timestamp in milliseconds or null to clear
        
        if (!handle) {
            return response.status(400).json({ error: 'Handle is required' });
        }
        
        const user = await storage.getItem(toKey(handle));
        if (!user) {
            return response.status(404).json({ error: 'User not found' });
        }
        
        // 设置或清除过期时间
        if (expiry === null || expiry === undefined) {
            delete user.expiry;
            console.log(`Cleared expiry for user: ${handle}`);
        } else {
            const expiryTimestamp = Number(expiry);
            if (isNaN(expiryTimestamp) || expiryTimestamp <= 0) {
                return response.status(400).json({ error: 'Invalid expiry timestamp' });
            }
            user.expiry = expiryTimestamp;
            console.log(`Set expiry for user ${handle} to ${new Date(expiryTimestamp).toISOString()}`);
        }
        
        await storage.setItem(toKey(handle), user);
        
        response.json({
            success: true,
            handle: user.handle,
            expiry: user.expiry,
            expiryDate: user.expiry ? new Date(user.expiry).toISOString() : null,
        });
    } catch (error) {
        console.error('Failed to set user expiry:', error);
        response.sendStatus(500);
    }
});

/**
 * Route handler to get user activity info (admin only).
 * GET /api/users/:handle/activity
 */
router.get('/api/users/:handle/activity', requireLoginMiddleware, async (request, response) => {
    try {
        // 检查是否是管理员或本人
        const requestingUser = request.user?.profile;
        const { handle } = request.params;
        
        if (!requestingUser?.admin && requestingUser?.handle !== handle) {
            return response.sendStatus(403);
        }
        
        const user = await storage.getItem(toKey(handle));
        if (!user) {
            return response.status(404).json({ error: 'User not found' });
        }
        
        response.json({
            handle: user.handle,
            name: user.name,
            lastActivity: user.lastActivity,
            lastActivityDate: user.lastActivity ? new Date(user.lastActivity).toISOString() : null,
            expiry: user.expiry,
            expiryDate: user.expiry ? new Date(user.expiry).toISOString() : null,
            isOnline: isUserOnline(handle),
        });
    } catch (error) {
        console.error('Failed to get user activity:', error);
        response.sendStatus(500);
    }
});


// ========== 7. 使用示例 ==========

// 示例 1：设置用户 24 小时后过期
async function setUserExpiry24Hours(handle) {
    const user = await storage.getItem(toKey(handle));
    if (user) {
        user.expiry = Date.now() + (24 * 60 * 60 * 1000);
        await storage.setItem(toKey(handle), user);
        console.log(`User ${handle} will expire at ${new Date(user.expiry).toISOString()}`);
    }
}

// 示例 2：清除用户过期时间
async function clearUserExpiry(handle) {
    const user = await storage.getItem(toKey(handle));
    if (user) {
        delete user.expiry;
        await storage.setItem(toKey(handle), user);
        console.log(`Cleared expiry for user ${handle}`);
    }
}

// 示例 3：检查在线用户
function logOnlineUsers() {
    const online = getOnlineUsers();
    console.log(`Currently online users (${online.length}):`, online);
}

// 示例 4：使用 API 设置过期时间（从前端）
async function setUserExpiryFromAPI(handle, hours) {
    const expiry = Date.now() + (hours * 60 * 60 * 1000);
    const response = await fetch(`/api/users/${handle}/expiry`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiry }),
    });
    return await response.json();
}

