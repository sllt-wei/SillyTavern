/**
 * 角色展示页面的主JavaScript文件
 * 负责处理页面交互、数据加载和展示
 */

// @ts-nocheck
const characterShowcase = (() => {
    // 私有变量
    let allCharacters = []; // 所有角色
    let originalCharacters = []; // 存储原始角色数据，用于重置搜索
    let displayedCharacters = []; // 当前已显示的角色
    let currentCharacter = null; // 当前查看的角色
    let allTags = new Set(); // 存储所有提取的标签
    let activeTags = new Set(); // 存储当前激活的标签筛选器
    let tagColumnsCount = 2; // 默认每行显示2个标签
    let searchQuery = ''; // 存储当前搜索关键词

    // 懒加载相关配置
    const CHARACTERS_PER_PAGE = 20; // 每页显示的角色数量
    let currentPage = 1; // 当前页码
    let isLoading = false; // 是否正在加载数据
    let hasMoreCharacters = true; // 是否还有更多角色可以加载
    let intersectionObserver = null; // 用于监视元素可见性的观察器

    // 获取当前页面的基础URL
    const baseUrl = window.location.origin;

    /**
     * 初始化页面
     */
    async function init() {
        console.log('初始化角色展示页面...');

        // 使用淡出效果移除preloader
        const preloader = document.getElementById('preloader');
        if (preloader) {
            $(preloader).fadeOut(400, function() {
                $(this).remove();
                console.log('已移除preloader');
            });
        }

        // 初始化API客户端
        await apiClient.init();

        // 判断登录状态
        updateLoginStatus(apiClient.getLoginStatus());

        // 初始化滚动监听器（必须在loadCharacterData之前）
        initScrollObserver();

        // 获取角色数据
        await loadCharacterData();

        // 初始化各个模块
        initUI();
        initEvents();

        // 初始化懒加载
        if (window.lazyLoader) {
            window.lazyLoader.init();
        }

        console.log('初始化完成。');
    }

    /**
     * 初始化用户界面
     */
    function initUI() {
        // 更新标签筛选区域
        updateTagFilters();

        // 加载用户设置
        loadUserSettings();
    }

    /**
     * 初始化事件监听
     */
    function initEvents() {
        // 弹窗相关事件
        $('#close-modal-btn').on('click', closeCharacterModal);
        $('#import-character-btn').on('click', importCharacter);
        $('#modal-close-icon').on('click', closeCharacterModal);

        // 侧边栏切换按钮事件
        $('#toggle-sidebar-btn').on('click', toggleSidebar);
        $('.sidebar-close').on('click', toggleSidebar);

        // 列数控制按钮事件
        $('.column-btn').on('click', function() {
            const columns = $(this).attr('data-columns');
            setTagColumnsCount(columns);
        });

        // 内容区域的折叠/展开事件
        $('#description-header').on('click', () => toggleContentSection('description-header', 'description-section'));
        $('#personality-header').on('click', () => toggleContentSection('personality-header', 'personality-section'));
        $('#scenario-header').on('click', () => toggleContentSection('scenario-header', 'scenario-section'));
        $('#example-header').on('click', () => toggleContentSection('example-header', 'example-section'));

        // 点击模态框外部关闭
        $('#character-modal').on('click', function(event) {
            if (event.target.id === 'character-modal') {
                closeCharacterModal();
            }
        });

        // 监听窗口大小变化，自动调整列数（仅当用户未手动设置时）
        $(window).on('resize', function() {
            if (!localStorage.getItem('tag_columns_count')) {
                if (window.innerWidth <= 768) {
                    setTagColumnsCount(1);
                } else {
                    setTagColumnsCount(2);
                }
            }
        });

        // 搜索相关事件
        $('#search-btn').on('click', function() {
            const query = $('#search-input').val();
            if (query.trim() !== '') {
                $(this).addClass('hidden');
                $('#clear-search-btn').removeClass('hidden');
                searchCharacters(query);
            }
        });

        $('#clear-search-btn').on('click', function() {
            clearSearch();
        });

        $('#search-input').on('keypress', function(e) {
            if (e.which === 13) { // Enter键
                const query = $(this).val();
                if (query.trim() !== '') {
                    $('#search-btn').addClass('hidden');
                    $('#clear-search-btn').removeClass('hidden');
                    searchCharacters(query);
                }
            }
        });

        // 搜索框输入监听，当输入框为空时恢复搜索按钮
        $('#search-input').on('input', function() {
            if ($(this).val().trim() === '') {
                $('#search-btn').removeClass('hidden');
                $('#clear-search-btn').addClass('hidden');
            } else {
                $('#search-btn').addClass('hidden');
                $('#clear-search-btn').removeClass('hidden');
            }
        });
    }

    /**
     * 更新登录状态UI
     * @param {boolean} isLoggedIn 是否已登录
     */
    function updateLoginStatus(isLoggedIn) {
        const loginBtn = document.getElementById('loginBtn');
        if (isLoggedIn) {
            loginBtn.textContent = '开始聊天';
            loginBtn.href = '/';
            loginBtn.target = '_blank'; // 在新页面打开链接
        } else {
            loginBtn.textContent = '登录';
            loginBtn.href = '/login';
            loginBtn.target = ''; // 移除target属性
        }
    }

    /**
     * 加载角色数据
     */
    async function loadCharacterData() {
        try {
            // 重置分页状态
            currentPage = 1;
            allCharacters = [];
            displayedCharacters = [];
            hasMoreCharacters = true;

            // 加载第一页数据
            await loadMoreCharacters();
        } catch (error) {
            console.error('加载角色数据失败:', error);
            toastr.error('加载角色数据失败，请刷新页面重试');
        }
    }

    /**
     * 从角色名称中提取标签
     * @param {string} characterName 角色名称
     * @returns {string[]} 标签数组
     */
    function extractTags(characterName) {
        const tags = [];
        const regex = /\(#([^)]+)\)/g;
        let match;

        while ((match = regex.exec(characterName)) !== null) {
            tags.push(match[1].trim());
        }

        return tags;
    }

    /**
     * 提取所有角色的标签
     */
    function extractAllTags() {
        allTags = new Set();
        allCharacters.forEach(character => {
            const tags = extractTags(character.name);
            tags.forEach(tag => allTags.add(tag));
        });
    }

    /**
     * 从API响应中提取所有标签
     * @param {Array} characters 角色数据数组
     */
    function extractAllTagsFromResponse(characters) {
        allTags = new Set();
        characters.forEach(character => {
            const tags = extractTags(character.name);
            tags.forEach(tag => allTags.add(tag));
        });
    }


    /**
     * 初始化滚动监听（滑动自动加载）
     */
    function initScrollObserver() {
        // 创建Intersection Observer来监视加载指示器
        intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                console.log('Intersection Observer 触发:', {
                    isIntersecting: entry.isIntersecting,
                    isLoading: isLoading,
                    hasMoreCharacters: hasMoreCharacters,
                    target: entry.target
                });
                
                if (entry.isIntersecting && !isLoading && hasMoreCharacters) {
                    console.log('触发加载更多角色...');
                    loadMoreCharacters();
                }
            });
        }, {
            root: null,
            rootMargin: '100px', // 提前100px开始加载
            threshold: 0.1
        });
        
        console.log('滚动监听器已初始化');
    }

    /**
     * 加载更多角色（滑动自动加载）
     */
    async function loadMoreCharacters() {
        if (isLoading || !hasMoreCharacters) return;

        isLoading = true;

        // 获取角色容器
        const container = document.getElementById('character-cards-container');

        // 如果是第一页，清空容器
        if (currentPage === 1) {
            container.innerHTML = '';
        } else {
            // 移除现有的加载指示器（非第一页时）
            const existingIndicator = container.querySelector('.loading-indicator');
            if (existingIndicator) {
                container.removeChild(existingIndicator);
            }
        }

        try {
            // 准备请求参数
            const requestData = {
                page: currentPage,
                pageSize: CHARACTERS_PER_PAGE,
                search: searchQuery,
                tags: Array.from(activeTags)
            };

            console.log(`正在加载第 ${currentPage} 页，每页 ${CHARACTERS_PER_PAGE} 个角色`);

            // 调用API获取分页数据
            const response = await apiClient.fetchCharactersPaginated(requestData);
            
            // 更新分页信息
            hasMoreCharacters = response.pagination.hasNextPage;

            console.log(`第 ${currentPage} 页加载完成，获得 ${response.data.length} 个角色，还有更多: ${hasMoreCharacters}`);

            // 如果是第一页，提取所有标签
            if (currentPage === 1) {
                extractAllTagsFromResponse(response.data);
            }

            // 显示空状态
            if (response.data.length === 0 && currentPage === 1) {
                const emptyState = document.createElement('div');
                emptyState.className = 'empty-state';

                if (searchQuery || activeTags.size > 0) {
                    // 搜索或标签筛选没有结果
                    emptyState.innerHTML = `
                        <i class="fa-solid fa-search"></i>
                        <h3>没有找到匹配的角色卡</h3>
                        <p>尝试使用不同的搜索关键词或标签组合。</p>
                    `;
                } else {
                    // 没有角色卡
                    emptyState.innerHTML = `
                        <i class="fa-solid fa-face-sad-tear"></i>
                        <h3>没有找到角色卡</h3>
                        <p>管理员尚未创建任何角色卡，或者在获取角色卡时发生了错误。</p>
                    `;
                }

                container.appendChild(emptyState);
                isLoading = false;
                return;
            }

            // 创建文档片段以减少DOM操作
            const fragment = document.createDocumentFragment();

            // 显示当前页的角色
            response.data.forEach(character => {
                // 清理显示的名称（移除标签部分）
                const displayName = character.name.replace(/\s*\(#[^)]+\)/g, '');
                const tags = extractTags(character.name);

                const card = document.createElement('div');
                card.className = 'character-card';
                card.setAttribute('data-avatar', character.avatar);

                // 使用缓存系统，添加时间戳避免缓存
                const timestamp = new Date().getTime();
                const avatarUrl = `${baseUrl}/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}&t=${timestamp}`;

                let tagsHtml = '';
                if (tags.length > 0) {
                    tagsHtml = '<div class="character-tags">' +
                        tags.map(tag => `<span class="character-tag">#${tag}</span>`).join('') +
                        '</div>';
                }

                // 添加占位符
                card.innerHTML = `
                    <div class="img-placeholder">
                        <i class="fa-solid fa-image"></i>
                    </div>
                    <img data-src="${avatarUrl}" alt="${displayName}">
                    <div class="character-card-info">
                        <h3>${displayName}</h3>
                        ${tagsHtml}
                    </div>
                `;

                card.addEventListener('click', () => showCharacterModal(character));
                fragment.appendChild(card);

                // 添加到已显示角色列表
                displayedCharacters.push(character);
            });

            // 将片段添加到容器
            container.appendChild(fragment);

            // 添加加载指示器（如果还有更多角色）
            if (hasMoreCharacters) {
                const loadingIndicator = document.createElement('div');
                loadingIndicator.className = 'loading-indicator';
                loadingIndicator.id = 'load-more-indicator';
                loadingIndicator.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 加载更多...';
                container.appendChild(loadingIndicator);

                console.log('创建加载指示器，开始观察:', loadingIndicator);

                // 使用Intersection Observer监视加载指示器
                if (intersectionObserver) {
                    intersectionObserver.observe(loadingIndicator);
                    console.log('加载指示器已添加到观察器');
                } else {
                    console.error('intersectionObserver 未初始化！');
                }
            } else {
                console.log('没有更多角色，不创建加载指示器');
            }

            // 启用懒加载的图片
            if (window.lazyLoader) {
                window.lazyLoader.refresh();
            }

            // 更新页码
            currentPage++;

        } catch (error) {
            console.error('加载角色数据失败:', error);
            toastr.error('加载角色数据失败，请刷新页面重试');
        }

        // 重置加载状态
        isLoading = false;
    }

    /**
     * 根据搜索关键词搜索角色
     * @param {string} query 搜索关键词
     */
    function searchCharacters(query) {
        // 保存搜索关键词
        searchQuery = query.trim().toLowerCase();

        // 重置分页状态
        currentPage = 1;
        displayedCharacters = [];

        // 加载搜索结果
        loadCharacterData();
    }

    /**
     * 清除搜索
     */
    function clearSearch() {
        document.getElementById('search-input').value = '';
        document.getElementById('search-btn').classList.remove('hidden');
        document.getElementById('clear-search-btn').classList.add('hidden');
        searchQuery = '';

        // 重置分页状态
        currentPage = 1;
        displayedCharacters = [];

        // 加载所有角色
        loadCharacterData();
    }

    /**
     * 根据激活的标签筛选角色
     */
    function filterCharactersByTags() {
        // 重置分页状态
        currentPage = 1;
        displayedCharacters = [];

        // 加载筛选后的角色
        loadCharacterData();
    }

    /**
     * 切换标签筛选
     * @param {string} tag 标签
     */
    function toggleTagFilter(tag) {
        if (activeTags.has(tag)) {
            activeTags.delete(tag);
        } else {
            activeTags.add(tag);
        }

        // 更新标签按钮样式
        document.querySelectorAll('.sidebar-tag').forEach(btn => {
            const btnTag = btn.getAttribute('data-tag');
            if (activeTags.has(btnTag)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 重新筛选角色
        filterCharactersByTags();
    }

    /**
     * 更新标签筛选区域
     */
    function updateTagFilters() {
        const filterContainer = document.querySelector('.sidebar-tags');
        if (filterContainer) {
            // 清空现有标签
            filterContainer.innerHTML = '';

            if (allTags.size > 0) {
                // 创建标签统计信息
                const tagCounts = {};
                allCharacters.forEach(character => {
                    const tags = extractTags(character.name);
                    tags.forEach(tag => {
                        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                    });
                });

                // 按字母顺序排序标签
                const sortedTags = Array.from(allTags).sort();

                sortedTags.forEach(tag => {
                    const tagBtn = document.createElement('div');
                    tagBtn.className = 'sidebar-tag';
                    if (activeTags.has(tag)) {
                        tagBtn.classList.add('active');
                    }
                    tagBtn.setAttribute('data-tag', tag);

                    // 添加标签计数
                    const count = tagCounts[tag] || 0;
                    tagBtn.innerHTML = `
                        <span>#${tag}</span>
                        <span class="sidebar-tag-count">${count}</span>
                    `;

                    tagBtn.addEventListener('click', () => toggleTagFilter(tag));
                    filterContainer.appendChild(tagBtn);
                });
            } else {
                // 如果没有标签，显示提示信息
                const noTagsMsg = document.createElement('div');
                noTagsMsg.textContent = '没有可用的标签';
                noTagsMsg.style.color = '#aaa';
                noTagsMsg.style.textAlign = 'center';
                noTagsMsg.style.padding = '20px 0';
                noTagsMsg.style.gridColumn = '1 / span 2'; // 横跨两列
                filterContainer.appendChild(noTagsMsg);
            }

            // 应用当前的列数设置
            applyTagColumnsCount();
        }
    }

    /**
     * 从本地存储恢复用户设置
     */
    function loadUserSettings() {
        const savedColumnsCount = localStorage.getItem('tag_columns_count');
        if (savedColumnsCount) {
            setTagColumnsCount(parseInt(savedColumnsCount));
        } else {
            // 检测是否为移动设备，自动设置合适的列数
            if (window.innerWidth <= 768) {
                setTagColumnsCount(1); // 移动设备默认显示1列
            } else {
                setTagColumnsCount(2); // 桌面默认显示2列
            }
        }
    }

    /**
     * 设置标签列数
     * @param {number} columns 列数
     */
    function setTagColumnsCount(columns) {
        tagColumnsCount = parseInt(columns);

        // 更新按钮状态
        document.querySelectorAll('.column-btn').forEach(btn => {
            if (parseInt(btn.getAttribute('data-columns')) === tagColumnsCount) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 保存用户设置到本地存储
        localStorage.setItem('tag_columns_count', tagColumnsCount);

        // 应用到标签容器
        applyTagColumnsCount();
    }

    /**
     * 应用标签列数到容器
     */
    function applyTagColumnsCount() {
        const tagsContainer = document.querySelector('.sidebar-tags');
        if (tagsContainer) {
            tagsContainer.style.gridTemplateColumns = `repeat(${tagColumnsCount}, 1fr)`;

            // 如果没有标签的提示信息存在，让它横跨所有列
            const noTagsMsg = tagsContainer.querySelector('div[style*="grid-column"]');
            if (noTagsMsg) {
                noTagsMsg.style.gridColumn = `1 / span ${tagColumnsCount}`;
            }
        }
    }

    /**
     * 切换侧边栏显示/隐藏
     */
    function toggleSidebar() {
        const sidebar = document.getElementById('tags-sidebar');
        sidebar.classList.toggle('show');
    }

    /**
     * 显示角色卡详情弹窗
     * @param {Object} characterPreview 角色预览数据
     */
    async function showCharacterModal(characterPreview) {
        if (!apiClient.getLoginStatus()) {
            toastr.warning('请先登录再查看角色详情');
            setTimeout(() => {
                window.location.href = '/login';
            }, 1500);
            return;
        }

        try {
            // 显示加载状态
            document.getElementById('modal-description').textContent = '加载中...';
            document.getElementById('modal-personality').textContent = '加载中...';
            document.getElementById('modal-scenario').textContent = '加载中...';
            document.getElementById('modal-example-messages').textContent = '加载中...';
            document.getElementById('modal-avatar').src = `${baseUrl}/thumbnail?type=avatar&file=${encodeURIComponent(characterPreview.avatar)}`;

            // 提取标签并清理显示的名称
            const tags = extractTags(characterPreview.name);
            const displayName = characterPreview.name.replace(/\s*\(#[^)]+\)/g, '');
            document.getElementById('modal-name').textContent = displayName;

            // 在标题下方显示标签
            const headerInfo = document.querySelector('.modal-header-info');
            const existingTags = headerInfo.querySelector('.character-tags');
            if (existingTags) {
                headerInfo.removeChild(existingTags);
            }

            if (tags.length > 0) {
                const tagsContainer = document.createElement('div');
                tagsContainer.className = 'character-tags';
                tagsContainer.innerHTML = tags.map(tag => `<span class="character-tag">#${tag}</span>`).join('');
                headerInfo.appendChild(tagsContainer);
            }

            document.getElementById('character-modal').style.display = 'block';

            // 重置所有内容区域为展开状态
            resetContentSections();

            // 获取完整的角色卡数据
            const character = await apiClient.getCharacterDetails(characterPreview.avatar);
            currentCharacter = character;

            // 填充模态框数据
            document.getElementById('modal-description').textContent = character.description || '无描述';
            document.getElementById('modal-personality').textContent = character.personality || '无个性描述';
            document.getElementById('modal-scenario').textContent = character.scenario || '无背景设定';
            document.getElementById('modal-example-messages').textContent = character.mes_example || '无示例对话';

            // 自动检测内容长度并决定是否需要折叠
            checkContentLength();

            // 更新所有部分的字符数显示
            updateCharacterCount('description-header', 'description-section');
            updateCharacterCount('personality-header', 'personality-section');
            updateCharacterCount('scenario-header', 'scenario-section');
            updateCharacterCount('example-header', 'example-section');

            // 显示关闭图标
            setTimeout(() => {
                const closeIcon = document.getElementById('modal-close-icon');
                closeIcon.style.visibility = 'visible';
                closeIcon.style.opacity = '1';
            }, 300);
        } catch (error) {
            console.error('显示角色详情时出错:', error);
            toastr.error('无法加载角色详情');
            closeCharacterModal();
        }
    }

    /**
     * 关闭角色卡详情弹窗
     */
    function closeCharacterModal() {
        document.getElementById('character-modal').style.display = 'none';
        // 隐藏关闭图标
        const closeIcon = document.getElementById('modal-close-icon');
        closeIcon.style.opacity = '0';
        closeIcon.style.visibility = 'hidden';
        currentCharacter = null;
    }

    /**
     * 导入角色卡到用户账户
     */
    async function importCharacter() {
        if (!currentCharacter) {
            toastr.error('没有选择角色');
            return;
        }

        try {
            // 导入角色
            await apiClient.importCharacter(currentCharacter.avatar);
            toastr.success(`成功导入角色 ${currentCharacter.name}`);

            // 在新窗口打开聊天页面
            setTimeout(() => {
                window.open('/', '_blank');
            }, 1500);
        } catch (error) {
            console.error('导入角色时出错:', error);
            toastr.error('导入角色失败');
        }
    }

    /**
     * 重置所有内容区域为展开状态
     */
    function resetContentSections() {
        // 移除所有折叠状态
        document.querySelectorAll('.modal-body h3').forEach(header => {
            header.classList.remove('collapsed');
        });

        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.remove('collapsed');
        });
    }

    /**
     * 检查内容长度并自动处理长文本
     */
    function checkContentLength() {
        const sections = [
            { text: document.getElementById('modal-description').textContent, header: 'description-header', section: 'description-section' },
            { text: document.getElementById('modal-personality').textContent, header: 'personality-header', section: 'personality-section' },
            { text: document.getElementById('modal-scenario').textContent, header: 'scenario-header', section: 'scenario-section' },
            { text: document.getElementById('modal-example-messages').textContent, header: 'example-header', section: 'example-section' }
        ];

        sections.forEach(item => {
            // 如果文本长度超过300个字符，自动折叠
            if (item.text && item.text.length > 300 && item.text !== '加载中...') {
                // 添加提示
                const header = document.getElementById(item.header);
                if (!header.querySelector('.length-indicator')) {
                    const indicator = document.createElement('span');
                    indicator.className = 'length-indicator';
                    indicator.textContent = `(${item.text.length}字符)`;
                    // 将字符数量指示器插入到标题和图标容器之间
                    const iconContainer = header.querySelector('.icon-container');
                    header.insertBefore(indicator, iconContainer);
                }

                // 折叠内容
                document.getElementById(item.header).classList.add('collapsed');
                document.getElementById(item.section).classList.add('collapsed');
            }
        });
    }

    /**
     * 切换内容区域的展开/收起状态
     * @param {string} headerId 标题元素ID
     * @param {string} sectionId 内容区域ID
     */
    function toggleContentSection(headerId, sectionId) {
        const header = document.getElementById(headerId);
        const section = document.getElementById(sectionId);
        header.classList.toggle('collapsed');
        section.classList.toggle('collapsed');

        // 更新字符数显示
        updateCharacterCount(headerId, sectionId);
    }

    /**
     * 更新字符数显示
     * @param {string} headerId 标题元素ID
     * @param {string} sectionId 内容区域ID
     */
    function updateCharacterCount(headerId, sectionId) {
        const header = document.getElementById(headerId);
        const contentElement = document.getElementById(sectionId).querySelector('p');
        const text = contentElement.textContent;

        if (text === '加载中...') return;

        let indicator = header.querySelector('.length-indicator');
        if (!indicator && text.length > 0) {
            indicator = document.createElement('span');
            indicator.className = 'length-indicator';
            const iconContainer = header.querySelector('.icon-container');
            header.insertBefore(indicator, iconContainer);
        }

        if (indicator) {
            indicator.textContent = `(${text.length}字符)`;
        }
    }

    // 公开API
    return {
        init,
        searchCharacters,
        clearSearch,
        toggleTagFilter,
        toggleSidebar,
        setTagColumnsCount
    };
})();

// 在页面加载完成后初始化
$(document).ready(function() {
    // 初始化角色展示功能
    characterShowcase.init();
});
