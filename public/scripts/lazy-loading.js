/**
 * 图片懒加载模块
 * 用于优化页面加载性能，只在需要时加载图片
 */

const lazyLoader = (() => {
    // 图片观察器
    let imageObserver = null;

    /**
     * 初始化图片懒加载
     * 使用Intersection Observer监视图片何时进入视口
     */
    function init() {
        // 检查浏览器是否支持IntersectionObserver
        if (!('IntersectionObserver' in window)) {
            // 回退方案：直接加载所有图片
            loadAllImages();
            return;
        }

        // 创建IntersectionObserver来监视图片
        imageObserver = new IntersectionObserver(handleIntersection, {
            root: null, // 使用视口作为容器
            rootMargin: '100px', // 提前100px触发加载
            threshold: 0.1 // 当10%的元素可见时触发
        });

        // 观察所有带有data-src属性的图片
        observeImages();
    }

    /**
     * 观察所有带有data-src属性的图片
     */
    function observeImages() {
        document.querySelectorAll('img[data-src]').forEach(img => {
            if (imageObserver) {
                imageObserver.observe(img);
            }
        });
    }

    /**
     * 处理元素进入视口的交叉事件
     * @param {IntersectionObserverEntry[]} entries 交叉条目
     * @param {IntersectionObserver} observer 观察器
     */
    function handleIntersection(entries, observer) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img instanceof HTMLImageElement) {
                    const src = img.getAttribute('data-src');

                    if (src) {
                        // 检查网络状态
                        if (navigator.onLine === false) {
                            console.warn('设备当前处于离线状态，图片加载可能会失败');
                        }

                        // 预加载图片
                        preloadImage(img, src, observer);
                    }
                }
            }
        });
    }

    /**
     * 预加载图片
     * @param {HTMLImageElement} imgElement 图片元素
     * @param {string} src 图片源URL
     * @param {IntersectionObserver} observer 观察器
     */
    function preloadImage(imgElement, src, observer) {
        const tempImg = new Image();

        // 设置加载和错误事件
        tempImg.onload = function() {
            // 预加载成功后，再设置实际图片的src
            imgElement.src = src;
            imgElement.removeAttribute('data-src');
            imgElement.classList.add('loaded');

            // 处理占位符淡出动画
            fadeOutPlaceholder(imgElement);

            // 停止监视此图片
            observer.unobserve(imgElement);
        };

        tempImg.onerror = function() {
            // 预加载失败处理
            handleImageError(imgElement);

            // 仍然设置图片src，以便浏览器的默认错误图标能够显示
            imgElement.src = src;
            imgElement.removeAttribute('data-src');

            // 停止监视此图片
            observer.unobserve(imgElement);
        };

        // 开始预加载
        tempImg.src = src;
    }

    /**
     * 淡出图片占位符
     * @param {HTMLImageElement} imgElement 图片元素
     */
    function fadeOutPlaceholder(imgElement) {
        const placeholder = imgElement.previousElementSibling;
        if (placeholder && placeholder.classList.contains('img-placeholder')) {
            if (placeholder instanceof HTMLElement) {
                placeholder.style.opacity = '0';
                setTimeout(() => {
                    if (placeholder.parentNode) {
                        placeholder.parentNode.removeChild(placeholder);
                    }
                }, 300);
            }
        }
    }

    /**
     * 处理图片加载错误
     * @param {HTMLImageElement} imgElement 图片元素
     */
    function handleImageError(imgElement) {
        const placeholder = imgElement.previousElementSibling;
        if (placeholder && placeholder.classList.contains('img-placeholder')) {
            placeholder.innerHTML = '<i class="fa-solid fa-image-slash"></i>';
        }
    }

    /**
     * 回退方案：直接加载所有图片
     * 用于不支持IntersectionObserver的浏览器
     */
    function loadAllImages() {
        document.querySelectorAll('img[data-src]').forEach(img => {
            if (img instanceof HTMLImageElement) {
                img.src = img.getAttribute('data-src');
                img.removeAttribute('data-src');
                img.classList.add('loaded');

                // 处理占位符
                fadeOutPlaceholder(img);

                // 添加错误处理
                img.onerror = function() {
                    handleImageError(img);
                };
            }
        });
    }

    /**
     * 处理动态添加的图片
     * 当新图片添加到DOM中时调用
     */
    function refresh() {
        if (imageObserver) {
            observeImages();
        } else {
            loadAllImages();
        }
    }

    // 公开API
    return {
        init,
        refresh
    };
})();

// 导出模块
if (typeof window !== 'undefined') {
    // @ts-ignore
    window.lazyLoader = lazyLoader;
}
