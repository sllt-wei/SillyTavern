/**
 * 卡密续费功能JS
 */
$(document).ready(function() {
    // 获取CSRF令牌函数
    function fetchCsrfToken() {
        return fetch('/api/csrf-token')
            .then(response => response.json())
            .then(data => {
                $('#csrfToken').val(data.token);
                return data.token;
            })
            .catch(error => {
                console.error('获取CSRF令牌失败:', error);
                return null;
            });
    }

    // 页面加载时获取CSRF令牌
    fetchCsrfToken();

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

    // 发送续费请求函数
    function sendRenewRequest(handle, cardKey, csrfToken, retryCount = 0) {
        // 最多重试3次
        if (retryCount > 3) {
            $('#renewMessage')
                .removeClass('success')
                .addClass('error')
                .text('续费请求失败，请刷新页面后重试')
                .show();
            return;
        }

        fetch('/api/renew', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                handle: handle,
                cardKey: cardKey
            })
        })
            .then(response => {
                if (response.status === 403) {
                    // CSRF令牌无效，重新获取并重试
                    console.log('CSRF令牌无效，重新获取...');
                    return fetchCsrfToken()
                        .then(newToken => {
                            if (newToken) {
                                return sendRenewRequest(handle, cardKey, newToken, retryCount + 1);
                            } else {
                                throw new Error('无法获取新的CSRF令牌');
                            }
                        });
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    // 续费成功
                    $('#renewMessage')
                        .removeClass('error')
                        .addClass('success')
                        .text(data.message)
                        .show();

                    // 显示新的过期时间
                    if (data.expiryDate) {
                        const expiryDate = new Date(data.expiryDate);
                        const formattedDate = expiryDate.toLocaleDateString('zh-CN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });

                        $('#expiryInfo')
                            .text(`您的账户有效期至: ${formattedDate}`)
                            .show();
                    }

                    // 清空表单
                    $('#renewForm')[0].reset();
                } else {
                    // 续费失败
                    $('#renewMessage')
                        .removeClass('success')
                        .addClass('error')
                        .text(data.error || '续费失败，请稍后重试')
                        .show();
                }
            })
            .catch(error => {
                console.error('续费请求失败:', error);
                $('#renewMessage')
                    .removeClass('success')
                    .addClass('error')
                    .text('续费请求失败，请稍后重试')
                    .show();
            });
    }

    // 表单提交处理
    $('#renewForm').submit(function(e) {
        e.preventDefault();

        // 清除之前的错误信息
        $('.error-message').empty();
        $('#renewMessage').hide();
        $('#expiryInfo').hide();

        // 获取表单数据
        const handle = $('#renewHandle').val().trim();
        let cardKey = $('#cardKey').val().trim();

        // 移除卡密中的分隔符
        cardKey = cardKey.replace(/-/g, '');

        // 验证输入
        let isValid = true;

        if (!handle) {
            $('#handleError').text('请输入用户名');
            isValid = false;
        }

        if (!cardKey || cardKey.length !== 16) {
            $('#keyError').text('请输入有效的16位卡密');
            isValid = false;
        }

        if (!isValid) {
            return;
        }

        // 获取CSRF令牌
        const csrfToken = $('#csrfToken').val();

        // 发送续费请求
        sendRenewRequest(handle, cardKey, csrfToken);
    });
});
