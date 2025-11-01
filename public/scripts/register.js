$(document).ready(function() {
    let csrfToken = '';

    // 获取CSRF令牌
    async function getCsrfToken() {
        try {
            const response = await fetch('/csrf-token');
            const data = await response.json();
            csrfToken = data.token;
            // 更新隐藏的CSRF令牌字段
            $('#csrfToken').val(csrfToken);
            console.log('.');
        } catch (error) {
            console.error('..', error);
            $('#registerMessage').text('...');
        }
    }

    // 初始化页面
    async function initPage() {
        await getCsrfToken();
        setupEventListeners();
        fadeInLoginForm();
    }

    // 淡入登录表单
    function fadeInLoginForm() {
        $('#shadow_popup').animate({opacity: 1}, 500);
    }

    // 设置事件监听
    function setupEventListeners() {
        $('#registerForm').on('submit', async function(e) {
            e.preventDefault();
            // 确保每次提交前都有最新的CSRF令牌
            if (!csrfToken || csrfToken === '') {
                await getCsrfToken();
            }
            await handleRegister();
        });

        // 处理卡密输入的格式化功能
        $('#cardKey').on('input', function() {
            // 移除所有非字母数字字符
            let value = $(this).val().replace(/[^A-Za-z0-9]/g, '');

            // 每4位添加一个分隔符
            let formattedValue = '';
            for (let i = 0; i < value.length; i++) {
                if (i > 0 && i % 4 === 0) {
                    formattedValue += '-';
                }
                formattedValue += value[i];
            }

            // 限制最大长度为19（16个字符+3个分隔符）
            if (formattedValue.length > 19) {
                formattedValue = formattedValue.substring(0, 19);
            }

            $(this).val(formattedValue);
        });
    }

    // 处理注册逻辑
    async function handleRegister() {
        // 清除错误信息
        $('.error-message').text('');
        $('#registerMessage').text('').hide();

        // 获取表单数据
        const name = $('#registerName').val().trim();
        const handle = $('#registerHandle').val().trim();
        const password = $('#registerPassword').val();
        const confirm = $('#registerConfirm').val();
        let cardKey = $('#cardKey').val().trim(); // 获取卡密

        // 表单基本验证
        if (!validateForm(name, handle, password, confirm, cardKey)) {
            return;
        }

        // 移除卡密中的分隔符
        cardKey = cardKey.replace(/-/g, '');

        try {
            // 显示加载状态
            $('#submitRegister').prop('disabled', true).text('处理中...');
            $('#registerMessage')
                .text('正在验证卡密...')
                .css({
                    'display': 'block',
                    'background-color': 'rgba(52, 152, 219, 0.3)',
                    'padding': '15px',
                    'border-radius': '8px',
                    'margin-top': '15px',
                    'color': '#ffffff',
                    'font-weight': 'bold',
                    'text-align': 'center'
                });

            // 先验证卡密是否有效
            const validateResponse = await fetch('/api/validate-card', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ cardKey })
            });

            const validateData = await validateResponse.json();

            // 如果卡密无效，显示错误并停止注册流程
            if (!validateResponse.ok || !validateData.valid) {
                $('#cardKeyError').text(validateData.error || '卡密无效');
                $('#registerMessage')
                    .text('注册失败：' + (validateData.error || '卡密无效'))
                    .css({
                        'display': 'block',
                        'background-color': 'rgba(231, 76, 60, 0.3)',
                        'padding': '15px',
                        'border-radius': '8px',
                        'margin-top': '15px',
                        'color': '#ffffff',
                        'font-weight': 'bold',
                        'text-align': 'center'
                    });
                $('#submitRegister').prop('disabled', false).text('注册');
                return;
            }

            // 卡密有效，继续注册流程
            $('#registerMessage')
                .text('卡密有效，正在注册账户...')
                .css({
                    'display': 'block',
                    'background-color': 'rgba(52, 152, 219, 0.3)',
                    'padding': '15px',
                    'border-radius': '8px',
                    'margin-top': '15px',
                    'color': '#ffffff',
                    'font-weight': 'bold',
                    'text-align': 'center'
                });

            // 如果没有CSRF令牌或令牌为空，重新获取
            if (!csrfToken || csrfToken === '') {
                await getCsrfToken();
                if (!csrfToken || csrfToken === '') {
                    throw new Error('无法获取CSRF令牌，请刷新页面重试');
                }
            }

            // 确保使用最新的CSRF令牌值
            const currentCsrfToken = $('#csrfToken').val() || csrfToken;

            // 注册用户
            const response = await fetch('/api/users/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': currentCsrfToken,
                },
                body: JSON.stringify({ name, handle, password }),
                credentials: 'same-origin' // 确保发送cookies
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '注册失败');
            }

            const userData = await response.json();

            // 注册成功，现在使用卡密激活账户
            $('#registerMessage')
                .text('账户创建成功，正在激活账户...')
                .css({
                    'display': 'block',
                    'background-color': 'rgba(52, 152, 219, 0.3)',
                    'padding': '15px',
                    'border-radius': '8px',
                    'margin-top': '15px',
                    'color': '#ffffff',
                    'font-weight': 'bold',
                    'text-align': 'center'
                });

            // 调用续费接口激活账户
            const renewResponse = await fetch('/api/renew', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    handle: handle,
                    cardKey: cardKey,
                    cleanupOnFailure: true // 添加清理参数，激活失败时自动删除用户
                })
            });

            const renewData = await renewResponse.json();

            if (renewResponse.ok && renewData.success) {
                // 续费成功
                const expiryDate = new Date(renewData.expiryDate);
                const formattedDate = expiryDate.toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });

                $('#registerMessage')
                    .text(`注册成功！账户已激活，有效期至: ${formattedDate}，正在跳转到登录页面...`)
                    .css({
                        'display': 'block',
                        'background-color': 'rgba(39, 174, 96, 0.3)',
                        'padding': '15px',
                        'border-radius': '8px',
                        'margin-top': '15px',
                        'color': '#ffffff',
                        'font-weight': 'bold',
                        'text-align': 'center'
                    });
            } else {
                // 续费失败（这种情况理论上不会发生，因为之前已验证卡密有效）
                $('#registerMessage')
                    .text(`注册成功！但账户激活失败: ${renewData.error || '未知错误'}，请联系管理员。`)
                    .css({
                        'display': 'block',
                        'background-color': 'rgba(231, 76, 60, 0.3)',
                        'padding': '15px',
                        'border-radius': '8px',
                        'margin-top': '15px',
                        'color': '#ffffff',
                        'font-weight': 'bold',
                        'text-align': 'center'
                    });
            }

            // 恢复按钮状态
            $('#submitRegister').prop('disabled', false).text('注册');

            // 延迟跳转到登录页面
            setTimeout(() => {
                window.location.href = 'login';
            }, 3000);
        } catch (error) {
            console.error('注册出错:', error);
            $('#registerMessage')
                .text(error.message)
                .css({
                    'display': 'block',
                    'background-color': 'rgba(231, 76, 60, 0.3)',
                    'padding': '15px',
                    'border-radius': '8px',
                    'margin-top': '15px',
                    'color': '#ffffff',
                    'font-weight': 'bold',
                    'text-align': 'center'
                });
            // 恢复按钮状态
            $('#submitRegister').prop('disabled', false).text('注册');
        }
    }

    // 表单验证
    function validateForm(name, handle, password, confirm, cardKey) {
        let isValid = true;

        if (!name) {
            $('#nameError').text('请输入显示名称');
            isValid = false;
        }

        if (!handle) {
            $('#handleError').text('请输入用户名');
            isValid = false;
        } else if (handle.length < 3) {
            $('#handleError').text('用户名至少需要3个字符');
            isValid = false;
        } else if (!/^[\u4e00-\u9fa5a-z0-9-]+$/.test(handle)) {  // EDIT_1: 添加中文支持
            $('#handleError').text('用户名只能包含汉字、小写字母、数字和连字符');
            isValid = false;
        } else if (/[a-z]/.test(handle) && /[0-9]/.test(handle)) {  // EDIT_1: 新增混合验证
            $('#handleError').text('用户名不能同时包含字母和数字');
            isValid = false;
        }

        if (!password) {
            $('#passwordError').text('请输入密码');
            isValid = false;
        } else if (password.length < 6) {
            $('#passwordError').text('密码至少需要6个字符');
            isValid = false;
        }

        if (password !== confirm) {
            $('#confirmError').text('两次输入的密码不一致');
            isValid = false;
        }

        // 添加卡密验证
        if (!cardKey) {
            $('#cardKeyError').text('请输入卡密');
            isValid = false;
        } else if (cardKey.replace(/-/g, '').length !== 16) {
            $('#cardKeyError').text('卡密格式不正确，应为16位字符');
            isValid = false;
        }

        return isValid;
    }

    // 初始化页面
    initPage();
});
