#!/usr/bin/env node

// native node modules
import path from 'node:path';
import util from 'node:util';
import net from 'node:net';
import dns from 'node:dns';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import { csrfSync } from 'csrf-sync';
import express from 'express';
import compression from 'compression';
import cookieSession from 'cookie-session';
import multer from 'multer';
import responseTime from 'response-time';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import open from 'open';

// local library imports
import './fetch-patch.js';
import { serverEvents, EVENT_NAMES } from './server-events.js';
import { CommandLineParser } from './command-line.js';
import { loadPlugins } from './plugin-loader.js';
import {
    initUserStorage,
    getCookieSecret,
    getCookieSessionName,
    ensurePublicDirectoriesExist,
    getUserDirectoriesList,
    migrateSystemPrompts,
    migrateUserData,
    requireLoginMiddleware,
    setUserDataMiddleware,
    shouldRedirectToLogin,
    cleanUploads,
    getSessionCookieAge,
    verifySecuritySettings,
    loginPageMiddleware,
} from './users.js';
import { initSessionManager } from './session-manager.js';

import getWebpackServeMiddleware from './middleware/webpack-serve.js';
import basicAuthMiddleware from './middleware/basicAuth.js';
import getWhitelistMiddleware from './middleware/whitelist.js';
import accessLoggerMiddleware, { getAccessLogPath, migrateAccessLog } from './middleware/accessLogWriter.js';
import multerMonkeyPatch from './middleware/multerMonkeyPatch.js';
import initRequestProxy from './request-proxy.js';
import getCacheBusterMiddleware from './middleware/cacheBuster.js';
import corsProxyMiddleware from './middleware/corsProxy.js';
import {
    getVersion,
    color,
    removeColorFormatting,
    getSeparator,
    safeReadFileSync,
    setupLogLevel,
    setWindowTitle,
} from './util.js';
import { UPLOADS_DIRECTORY } from './constants.js';
import { ensureThumbnailCache } from './endpoints/thumbnails.js';

// Routers
import { router as usersPublicRouter } from './endpoints/users-public.js';
import { router as apiRouter } from './endpoints/api.js';
import { init as statsInit, onExit as statsOnExit } from './endpoints/stats.js';
import { checkForNewContent } from './endpoints/content-manager.js';
import { init as settingsInit } from './endpoints/settings.js';
import { redirectDeprecatedEndpoints, ServerStartup, setupPrivateEndpoints } from './server-startup.js';
import { diskCache } from './endpoints/characters.js';

// Unrestrict console logs display limit
util.inspect.defaultOptions.maxArrayLength = null;
util.inspect.defaultOptions.maxStringLength = null;
util.inspect.defaultOptions.depth = 4;

// Set a working directory for the server
const serverDirectory = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
console.log(`Node version: ${process.version}. Running in ${process.env.NODE_ENV} environment. Server directory: ${serverDirectory}`);
process.chdir(serverDirectory);

// Work around a node v20.0.0, v20.1.0, and v20.2.0 bug. The issue was fixed in v20.3.0.
// https://github.com/nodejs/node/issues/47822#issuecomment-1564708870
// Safe to remove once support for Node v20 is dropped.
if (process.versions && process.versions.node && process.versions.node.match(/20\.[0-2]\.0/)) {
    // @ts-ignore
    if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(false);
}

const cliArgs = new CommandLineParser().parse(process.argv);
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;

if (!cliArgs.enableIPv6 && !cliArgs.enableIPv4) {
    console.error('error: You can\'t disable all internet protocols: at least IPv6 or IPv4 must be enabled.');
    process.exit(1);
}

try {
    if (cliArgs.dnsPreferIPv6) {
        dns.setDefaultResultOrder('ipv6first');
        console.log('Preferring IPv6 for DNS resolution');
    } else {
        dns.setDefaultResultOrder('ipv4first');
        console.log('Preferring IPv4 for DNS resolution');
    }
} catch (error) {
    console.warn('Failed to set DNS resolution order. Possibly unsupported in this Node version.');
}

const app = express();
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(compression());
app.use(responseTime());

app.use(bodyParser.json({ limit: '200mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '200mb' }));

// CORS Settings //
const CORS = cors({
    origin: 'null',
    methods: ['OPTIONS'],
});

app.use(CORS);

if (cliArgs.listen && cliArgs.basicAuthMode) {
    app.use(basicAuthMiddleware);
}

if (cliArgs.whitelistMode) {
    const whitelistMiddleware = await getWhitelistMiddleware();
    app.use(whitelistMiddleware);
}

if (cliArgs.listen) {
    app.use(accessLoggerMiddleware());
}

if (cliArgs.enableCorsProxy) {
    app.use('/proxy/:url(*)', corsProxyMiddleware);
} else {
    app.use('/proxy/:url(*)', async (_, res) => {
        const message = 'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.';
        console.log(message);
        res.status(404).send(message);
    });
}

app.use(cookieSession({
    name: getCookieSessionName(),
    sameSite: 'lax',
    httpOnly: true,
    maxAge: getSessionCookieAge(),
    secret: getCookieSecret(globalThis.DATA_ROOT),
}));

app.use(setUserDataMiddleware);

// CSRF Protection //
// 定义默认的csrfSyncProtection中间件
let csrfSyncProtection = (req, res, next) => next();

if (!cliArgs.disableCsrf) {
    const csrfProtection = csrfSync({
        getTokenFromState: (req) => {
            if (!req.session) {
                console.error('(CSRF error) getTokenFromState: Session object not initialized');
                return;
            }
            return req.session.csrfToken;
        },
        getTokenFromRequest: (req) => {
            return req.headers['x-csrf-token']?.toString();
        },
        storeTokenInState: (req, token) => {
            if (!req.session) {
                console.error('(CSRF error) storeTokenInState: Session object not initialized');
                return;
            }
            req.session.csrfToken = token;
        },
        size: 32,
        ignoredMethods: ['GET', 'HEAD', 'OPTIONS']
    });

    app.get('/csrf-token', (req, res) => {
        res.json({
            'token': csrfProtection.generateToken(req),
        });
    });

    // Customize the error message
    csrfProtection.invalidCsrfTokenError.message = color.red('Invalid CSRF token. Please refresh the page and try again.');
    csrfProtection.invalidCsrfTokenError.stack = undefined;

    // 自定义CSRF中间件，排除特定路由
    const customCsrfProtection = (req, res, next) => {
        // 特定路由跳过CSRF验证
        if (req.path === '/api/renew' || req.path === '/api/validate-card') {
            return next();
        }
        // 其他路由正常进行CSRF验证
        return csrfProtection.csrfSynchronisedProtection(req, res, next);
    };

    app.use(customCsrfProtection);
    // 使用自定义的CSRF保护中间件
    csrfSyncProtection = customCsrfProtection;
} else {
    console.warn('\nCSRF protection is disabled. This will make your server vulnerable to CSRF attacks.\n');
    app.get('/csrf-token', (req, res) => {
        res.json({
            'token': 'disabled',
        });
    });
}

// Static files
// Host index page
app.get('/', getCacheBusterMiddleware(), (request, response) => {
    if (shouldRedirectToLogin(request)) {
        const query = request.url.split('?')[1];
        const redirectUrl = query ? `/login?${query}` : '/login';
        return response.redirect(redirectUrl);
    }

    return response.sendFile('index.html', { root: path.join(process.cwd(), 'public') });
});

// Callback endpoint for OAuth PKCE flows (e.g. OpenRouter)
app.get('/callback/:source?', (request, response) => {
    const source = request.params.source;
    const query = request.url.split('?')[1];
    const searchParams = new URLSearchParams();
    source && searchParams.set('source', source);
    query && searchParams.set('query', query);
    const path = `/?${searchParams.toString()}`;
    return response.redirect(307, path);
});

// Host login page
app.get('/login', loginPageMiddleware);

// Host frontend assets
const webpackMiddleware = getWebpackServeMiddleware();
app.use(webpackMiddleware);
app.use(express.static(process.cwd() + '/public', {}));

// Public API
app.use('/api/users', usersPublicRouter);
app.use('/api/status', apiRouter);

// 卡密续费接口 - 这个API不需要身份验证，供用户续费使用
app.post('/api/renew', (req, res) => {
    if (!req.body || !req.body.handle || !req.body.cardKey) {
        return res.status(400).json({ error: '缺少必要参数' });
    }

    const { handle, cardKey } = req.body;
    const cleanupOnFailure = req.body.cleanupOnFailure === true; // 是否在验证失败时清理用户

    // 动态导入api-share插件
    import('./plugins/api-share/index.js')
        .then(apiSharePlugin => {
            // 调用renewSubscription函数
            if (typeof apiSharePlugin.renewSubscription === 'function') {
                apiSharePlugin.renewSubscription(handle, cardKey, cleanupOnFailure)
                    .then(result => {
                        res.json(result);
                    })
                    .catch(error => {
                        console.error('续费处理失败:', error);
                        res.status(400).json({ error: error.message || '续费处理失败' });
                    });
            } else {
                // 如果函数不存在，返回错误
                console.error('续费函数不存在');
                res.status(500).json({ error: '续费服务暂时不可用' });
            }
        })
        .catch(error => {
            // 导入模块失败
            console.error('加载API-Share插件失败:', error);
            res.status(500).json({ error: '续费服务暂时不可用' });
        });
});

// 卡密验证接口 - 用于验证卡密是否有效，不消耗卡密
app.post('/api/validate-card', (req, res) => {
    if (!req.body || !req.body.cardKey) {
        return res.status(400).json({ error: '缺少必要参数' });
    }

    const { cardKey } = req.body;

    // 动态导入api-share插件
    import('./plugins/api-share/index.js')
        .then(apiSharePlugin => {
            // 调用validateCardKey函数
            if (typeof apiSharePlugin.validateCardKey === 'function') {
                apiSharePlugin.validateCardKey(cardKey)
                    .then(result => {
                        if (result.valid) {
                            res.json({
                                valid: true,
                                duration: result.duration
                            });
                        } else {
                            res.status(400).json({
                                valid: false,
                                error: result.error
                            });
                        }
                    })
                    .catch(error => {
                        console.error('卡密验证失败:', error);
                        res.status(400).json({ error: error.message || '卡密验证失败' });
                    });
            } else {
                // 如果函数不存在，返回错误
                console.error('卡密验证函数不存在');
                res.status(500).json({ error: '卡密验证服务暂时不可用' });
            }
        })
        .catch(error => {
            // 导入模块失败
            console.error('加载API-Share插件失败:', error);
            res.status(500).json({ error: '卡密验证服务暂时不可用' });
        });
});

// Everything below this line requires authentication
app.use(requireLoginMiddleware);
app.post('/api/ping', (request, response) => {
    if (request.query.extend && request.session && request.session.handle) {
        request.session.touch = Date.now();

        // 更新用户活动时间
        import('./session-manager.js')
            .then(sessionManager => {
                sessionManager.updateUserActivity(request.session.handle);
            })
            .catch(error => {
                console.error('更新用户活动时间失败:', error);
            });
    }

    response.sendStatus(204);
});

// File uploads
const uploadsPath = path.join(cliArgs.dataRoot, UPLOADS_DIRECTORY);
app.use(multer({ dest: uploadsPath, limits: { fieldSize: 10 * 1024 * 1024 } }).single('avatar'));
app.use(multerMonkeyPatch);

app.get('/version', async function (_, response) {
    const data = await getVersion();
    response.send(data);
});

redirectDeprecatedEndpoints(app);
setupPrivateEndpoints(app);

/**
 * Tasks that need to be run before the server starts listening.
 * @returns {Promise<void>}
 */
async function preSetupTasks() {
    try {
        console.log(color.yellow('Starting pre-setup tasks...'));
        console.log(color.blue('Setting up storage...'));
        await initUserStorage(globalThis.DATA_ROOT);

        console.log(color.blue('Ensuring directories exist...'));
        await ensurePublicDirectoriesExist();

        console.log(color.blue('Migrating user data...'));
        await migrateUserData();

        console.log(color.blue('Migrating system prompts...'));
        await migrateSystemPrompts();

        console.log(color.blue('Cleaning uploads...'));
        cleanUploads();

        console.log(color.blue('Migrating access log...'));
        await migrateAccessLog();

        // 初始化会话管理器
        console.log(color.blue('Initializing session manager...'));
        initSessionManager();

        // 加载服务器插件
        console.log(color.blue('Loading server plugins...'));
        const pluginsPath = path.join(process.cwd(), 'plugins');
        await loadPlugins(app, pluginsPath);

        console.log(color.yellow('Pre-setup tasks complete'));
        return true;
    } catch (error) {
        console.error('Pre-setup tasks failed:', error);
        return false;
    }
}

/**
 * Tasks that need to be run after the server starts listening.
 * @param {import('./server-startup.js').ServerStartupResult} result The result of the server startup
 * @returns {Promise<void>}
 */
async function postSetupTasks(result) {
    const autorunHostname = await cliArgs.getAutorunHostname(result);
    const autorunUrl = cliArgs.getAutorunUrl(autorunHostname);

    if (cliArgs.autorun) {
        try {
            console.log('Launching in a browser...');
            await open(autorunUrl.toString());
        } catch (error) {
            console.error('Failed to launch the browser. Open the URL manually.');
        }
    }

    setWindowTitle('SillyTavern WebServer');

    let logListen = 'SillyTavern is listening on';

    if (result.useIPv6 && !result.v6Failed) {
        logListen += color.green(
            ' IPv6: ' + cliArgs.getIPv6ListenUrl().host,
        );
    }

    if (result.useIPv4 && !result.v4Failed) {
        logListen += color.green(
            ' IPv4: ' + cliArgs.getIPv4ListenUrl().host,
        );
    }

    const goToLog = 'Go to: ' + color.blue(autorunUrl) + ' to open SillyTavern';
    const plainGoToLog = removeColorFormatting(goToLog);

    console.log(logListen);
    if (cliArgs.listen) {
        console.log();
        console.log('To limit connections to internal localhost only ([::1] or 127.0.0.1), change the setting in config.yaml to "listen: false".');
        console.log('Check the "access.log" file in the data directory to inspect incoming connections:', color.green(getAccessLogPath()));
    }
    console.log('\n' + getSeparator(plainGoToLog.length) + '\n');
    console.log(goToLog);
    console.log('\n' + getSeparator(plainGoToLog.length) + '\n');

    setupLogLevel();
    serverEvents.emit(EVENT_NAMES.SERVER_STARTED, { url: autorunUrl });
}

/**
 * Registers a not-found error response if a not-found error page exists. Should only be called after all other middlewares have been registered.
 */
function apply404Middleware() {
    const notFoundWebpage = safeReadFileSync('./public/error/url-not-found.html') ?? '';
    app.use((req, res) => {
        res.status(404).send(notFoundWebpage);
    });
}

// User storage module needs to be initialized before starting the server
initUserStorage(globalThis.DATA_ROOT)
    .then(ensurePublicDirectoriesExist)
    .then(migrateUserData)
    .then(migrateSystemPrompts)
    .then(verifySecuritySettings)
    .then(preSetupTasks)
    .then(apply404Middleware)
    .then(() => new ServerStartup(app, cliArgs).start())
    .then(postSetupTasks);
