/**
 * API客户端模块
 * 处理所有与后端的通信
 */

// API请求客户端
const apiClient = (() => {
    // 私有变量
    let csrfToken = '';
    let isLoggedIn = false;

    // 获取当前页面的基础URL
    const baseUrl = window.location.origin;

    /**
     * 获取CSRF令牌
     * @returns {Promise<string>} CSRF令牌
     */
    async function getCsrfToken() {
        try {
            const response = await fetch(`${baseUrl}/csrf-token`);
            const data = await response.json();
            csrfToken = data.token;
            return csrfToken;
        } catch (error) {
            console.error('获取CSRF令牌失败:', error);
            return '';
        }
    }

    /**
     * 为请求添加必要的头部
     * @returns {Object} 请求头对象
     */
    function getRequestHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        };
    }

    /**
     * 检查用户登录状态
     * @returns {Promise<boolean>} 是否已登录
     */
    async function checkLoginStatus() {
        try {
            const response = await fetch(`${baseUrl}/api/ping`, {
                method: 'GET',
                headers: getRequestHeaders(),
            });

            isLoggedIn = response.status === 204;
            return isLoggedIn;
        } catch (error) {
            console.error('检查登录状态时出错:', error);
            isLoggedIn = false;
            return false;
        }
    }

    /**
     * 获取所有角色卡（旧版本，保持兼容性）
     * @returns {Promise<Array>} 角色卡数组
     */
    async function fetchCharacters() {
        try {
            const response = await fetch(`${baseUrl}/api/characters/admin-showcase`, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({}),
            });

            if (!response.ok) {
                throw new Error('获取角色卡失败');
            }

            return await response.json();
        } catch (error) {
            console.error('获取角色卡时出错:', error);
            return [];
        }
    }

    /**
     * 获取分页角色卡
     * @param {Object} params 分页参数
     * @param {number} params.page 页码
     * @param {number} params.pageSize 每页数量
     * @param {string} params.search 搜索关键词
     * @param {Array} params.tags 标签筛选
     * @returns {Promise<Object>} 分页数据
     */
    async function fetchCharactersPaginated(params) {
        try {
            const response = await fetch(`${baseUrl}/api/characters/admin-showcase`, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(params),
            });

            if (!response.ok) {
                throw new Error('获取角色卡失败');
            }

            return await response.json();
        } catch (error) {
            console.error('获取分页角色卡时出错:', error);
            throw error;
        }
    }

    /**
     * 获取角色详情
     * @param {string} avatarUrl 角色头像URL
     * @returns {Promise<Object>} 角色详情
     */
    async function getCharacterDetails(avatarUrl) {
        try {
            const response = await fetch(`${baseUrl}/api/characters/get-admin-character`, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    avatar_url: avatarUrl
                })
            });

            if (!response.ok) {
                throw new Error('获取角色详情失败');
            }

            return await response.json();
        } catch (error) {
            console.error('获取角色详情时出错:', error);
            throw error;
        }
    }

    /**
     * 导入角色
     * @param {string} avatarUrl 角色头像URL
     * @returns {Promise<void>}
     */
    async function importCharacter(avatarUrl) {
        try {
            // 从管理员导入角色
            const importResponse = await fetch(`${baseUrl}/api/characters/import-from-admin`, {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    avatar_url: avatarUrl,
                })
            });

            if (!importResponse.ok) {
                throw new Error('导入角色失败');
            }

            // 聊天会在首次使用时自动创建，无需显式创建
            return true;
        } catch (error) {
            console.error('导入角色时出错:', error);
            throw error;
        }
    }

    // 公开API
    return {
        init: async function() {
            await getCsrfToken();
            await checkLoginStatus();
            return { isLoggedIn };
        },
        getLoginStatus: () => isLoggedIn,
        fetchCharacters,
        fetchCharactersPaginated,
        getCharacterDetails,
        importCharacter
    };
})();

// 导出模块
window.apiClient = apiClient;
