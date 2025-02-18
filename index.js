const fs = require('fs');
const { chromium } = require('playwright');
const path = require('path');
const ethers = require('ethers');
const axios = require('axios');
const chalk = require('chalk');
const { EMOJIS, formatLog } = require('./utils');

// Global Configuration
const CONFIG = {
    urls: {
        base: 'https://app.gata.xyz/dataAgent',
        earn: 'https://earn.aggregata.xyz',
        agent: 'https://agent.gata.xyz',
        chat: 'https://chat.gata.xyz'
    },
    intervals: {
        activity: 120000,      // Activity simulation interval (2 minutes)
        session: 8 * 60 * 60 * 1000,  // Maximum session duration (8 hours)
        status: 60000,         // Status check interval (1 minute)
        pageTimeout: 120000    // Page load timeout (2 minutes)
    },
    browser: {
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
};

// Add missing constant
const SCREENSHOT_PATH = 'current_screenshot.png';

// Display ASCII banner and startup message
console.log(chalk.cyan(fs.readFileSync('banner.js', 'utf8')));
console.log(chalk.cyan(`${EMOJIS.rocket} Starting DVA automation...\n`));

// Cleanup function for screenshots
async function cleanupScreenshots() {
    const directory = './';
    fs.readdirSync(directory).forEach(file => {
        if (file.match(/^(screenshot|debug|error|verification)-/)) {
            try {
                fs.unlinkSync(path.join(directory, file));
            } catch (err) {
                console.error(formatLog(0, 'error', `Error deleting file ${file}: ${err.message}`));
            }
        }
    });
}

// Take screenshot with description
async function takeScreenshot(page, description = '') {
    try {
        if (fs.existsSync(SCREENSHOT_PATH)) {
            fs.unlinkSync(SCREENSHOT_PATH);
        }
        await page.screenshot({ path: SCREENSHOT_PATH });
        console.log(formatLog(0, 'info', `Screenshot taken: ${description}`));
    } catch (error) {
        console.error(formatLog(0, 'error', `Error taking screenshot: ${error.message}`));
    }
}

// Get authentication tokens using private key
async function getAuthTokens(privateKey, proxy) {
    try {
        // Create axios instance with proxy if provided
        let axiosInstance;
        if (proxy) {
            const tunnel = require('tunnel');
            let proxyUrl = proxy.startsWith('http') ? proxy : `http://${proxy}`;
            
            const proxyConfig = {
                proxy: {
                    host: new URL(proxyUrl).hostname,
                    port: parseInt(new URL(proxyUrl).port)
                }
            };
            
            const tunnelingAgent = tunnel.httpsOverHttp(proxyConfig);
            axiosInstance = axios.create({
                httpsAgent: tunnelingAgent,
                proxy: false,
                timeout: 30000
            });
        } else {
            axiosInstance = axios;
        }

        const wallet = new ethers.Wallet(privateKey);
        const address = wallet.address;

        // Get authentication nonce
        const nonceResponse = await axiosInstance.post(`${CONFIG.urls.earn}/api/signature_nonce`, {
            address: address
        });

        const authNonce = nonceResponse.data.auth_nonce;
        const signature = await wallet.signMessage(authNonce);

        // Authorize with signature
        const authResponse = await axiosInstance.post(`${CONFIG.urls.earn}/api/authorize`, {
            public_address: address,
            signature_code: signature,
            invite_code: ''
        });

        const bearer = authResponse.data.token;

        // Get task and LLM tokens
        const [taskTokenResponse, llmTokenResponse] = await Promise.all([
            axiosInstance.post(
                `${CONFIG.urls.earn}/api/grant`,
                { type: 1 },
                { headers: { Authorization: `Bearer ${bearer}` }}
            ),
            axiosInstance.post(
                `${CONFIG.urls.earn}/api/grant`,
                { type: 0 },
                { headers: { Authorization: `Bearer ${bearer}` }}
            )
        ]);

        return {
            address,
            bearer,
            llm_token: llmTokenResponse.data.token,
            task_token: taskTokenResponse.data.token
        };
    } catch (error) {
        throw new Error(`Authentication failed: ${error.message}`);
    }
}

async function setRequiredLocalStorage(page, tokens) {
    await page.evaluate((tokens) => {
        localStorage.setItem(tokens.address, tokens.bearer);
        localStorage.setItem('AGG_USER_IS_LOGIN', '1');
        localStorage.setItem('Gata_Chat_GotIt', '1');
        localStorage.setItem('aggr_current_address', tokens.address);
        localStorage.setItem(`aggr_llm_token_${tokens.address}`, tokens.llm_token);
        localStorage.setItem(`aggr_task_token_${tokens.address}`, tokens.task_token);
        localStorage.setItem('wagmi.recentConnectorId', '"metaMask"');
        localStorage.setItem('wagmi.store', JSON.stringify({
            state: {
                connections: {
                    __type: "Map",
                    value: [[
                        "e52bdc16f63",
                        {
                            accounts: [tokens.address],
                            chainId: 1017,
                            connector: {
                                id: "metaMask",
                                name: "MetaMask",
                                type: "injected",
                                uid: "e52bdc16f63"
                            }
                        }
                    ]]
                },
                chainId: 1017,
                current: "e52bdc16f63"
            },
            version: 2
        }));
    }, tokens);
    console.log('LocalStorage items set successfully');
}

async function waitForPageLoad(page) {
    try {
        await Promise.race([
            page.waitForLoadState('domcontentloaded', { timeout: CONFIG.intervals.pageTimeout }),
            page.waitForLoadState('load', { timeout: CONFIG.intervals.pageTimeout })
        ]);
        await page.waitForTimeout(5000);
        return true;
    } catch (error) {
        console.log('Page load timeout, but continuing execution...');
        return false;
    }
}

async function simulateActivity(page) {
    try {
        await page.evaluate(() => {
            window.scrollTo(0, 500);
            setTimeout(() => window.scrollTo(0, 0), 1000);
        });
        console.log(`Activity simulated at ${new Date().toLocaleTimeString()}`);
        await takeScreenshot(page, 'Activity simulation');
    } catch (error) {
        console.error('Error during activity simulation:', error.message);
    }
}

async function findAndClickStartButton(page) {
    console.log('Looking for Start button on DVA page...');
    
    try {
        await takeScreenshot(page, 'Before finding Start button');
        
        const currentUrl = page.url();
        if (!currentUrl.includes('/dataAgent')) {
            console.log('Not on DVA page, navigating...');
            await page.goto(CONFIG.urls.base);
            await waitForPageLoad(page);
        }

        await page.waitForTimeout(5000);

        const buttonFound = await page.evaluate(() => {
            const isVisible = (elem) => {
                if (!elem) return false;
                const style = window.getComputedStyle(elem);
                return style.display !== 'none' && 
                       style.visibility !== 'hidden' && 
                       style.opacity !== '0' &&
                       elem.offsetParent !== null;
            };

            const relevantTexts = ['start', 'begin', 'launch', 'dva', 'verify'];
            const elements = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], div[class*="button"]'));
            
            for (const element of elements) {
                const text = element.innerText.toLowerCase().trim();
                if (isVisible(element) && relevantTexts.some(t => text.includes(t))) {
                    element.click();
                    return true;
                }
            }

            const buttonSelectors = [
                '[class*="start"]',
                '[class*="begin"]',
                '[class*="launch"]',
                '[class*="verify"]',
                '[class*="dva"]'
            ];

            for (const selector of buttonSelectors) {
                const elements = Array.from(document.querySelectorAll(selector))
                    .filter(el => isVisible(el));
                
                if (elements.length > 0) {
                    elements[0].click();
                    return true;
                }
            }

            return false;
        });

        if (buttonFound) {
            console.log('Successfully clicked Start button');
            await takeScreenshot(page, 'After clicking Start button');
            return true;
        }

        console.log('Start button not found. Saving page content...');
        const pageContent = await page.content();
        fs.writeFileSync('dva-page-content.html', pageContent);
        return false;

    } catch (error) {
        console.error('Error finding Start button:', error);
        await takeScreenshot(page, 'Error state');
        return false;
    }
}

async function keepSessionActive(page) {
    const startTime = Date.now();
    
    const activityInterval = setInterval(async () => {
        if (Date.now() - startTime > CONFIG.intervals.session) {
            clearInterval(activityInterval);
            console.log('Session duration limit reached. Stopping activity.');
            return;
        }
        await simulateActivity(page);
    }, CONFIG.intervals.activity);
    
    return activityInterval;
}

// 添加 IP 检查函数
async function checkProxyIP(proxy) {
    try {
        const tunnel = require('tunnel');
        let proxyUrl = proxy.startsWith('http') ? proxy : `http://${proxy}`;
        
        const proxyConfig = {
            proxy: {
                host: new URL(proxyUrl).hostname,
                port: parseInt(new URL(proxyUrl).port)
            }
        };
        
        const tunnelingAgent = tunnel.httpsOverHttp(proxyConfig);
        const axiosInstance = axios.create({
            httpsAgent: tunnelingAgent,
            proxy: false,
            timeout: 30000
        });

        const response = await axiosInstance.get('https://api.ipify.org?format=json');
        return response.data.ip;
    } catch (error) {
        console.error('Error checking proxy IP:', error.message);
        return 'Unknown';
    }
}

// 修改 startAccountTask 函数
async function startAccountTask(page, tokens, browser, accountId, proxy) {
    try {
        // 检查代理 IP
        const proxyIP = await checkProxyIP(proxy);
        console.log(formatLog(accountId, 'info', `Using proxy with IP: ${proxyIP}`));

        console.log(formatLog(accountId, 'info', `Navigating to DVA page...`));
        await page.goto(CONFIG.urls.base);
        await waitForPageLoad(page);
        
        await setRequiredLocalStorage(page, tokens);
        console.log(formatLog(accountId, 'info', `Reloading page...`));
        
        await Promise.all([
            page.reload(),
            waitForPageLoad(page)
        ]);
        
        await page.waitForTimeout(5000);
        
        const buttonClicked = await findAndClickStartButton(page);
        
        if (buttonClicked) {
            console.log(formatLog(accountId, 'success', `DVA Start button clicked successfully. Starting activity simulation...`));
            
            // 添加任务状态监控
            let taskCount = 0;
            let lastTaskTime = Date.now();

            const statusInterval = setInterval(async () => {
                try {
                    const stats = await page.evaluate(() => {
                        const statsText = document.querySelector('[class*="stats"]')?.textContent;
                        return statsText || '';
                    });
                    
                    if (stats) {
                        console.log(formatLog(accountId, 'stats', `Stats: ${stats}`));
                        taskCount++;
                    }

                    // 检查任务是否停滞
                    if (Date.now() - lastTaskTime > 300000) { // 5分钟没有新任务
                        console.log(formatLog(accountId, 'info', `No new tasks for 5 minutes, refreshing page...`));
                        await page.reload();
                        lastTaskTime = Date.now();
                    }
                } catch (error) {
                    console.error(formatLog(accountId, 'error', `Error checking status:`, error.message));
                }
            }, CONFIG.intervals.status); // 每分钟检查一次

            const activityInterval = await keepSessionActive(page);
            
            process.on('SIGINT', async () => {
                clearInterval(statusInterval);
                clearInterval(activityInterval);
                console.log(formatLog(accountId, 'info', `Completed ${taskCount} tasks. Closing browser...`));
                await browser.close();
            });
        } else {
            console.error(formatLog(accountId, 'error', `Could not find DVA Start button.`));
            await browser.close();
        }
    } catch (error) {
        console.error(formatLog(accountId, 'error', `Error during execution:`, error));
        await takeScreenshot(page, `Account-${accountId}-Fatal-error`);
        await browser.close();
    }
}

// 修改 main 函数中的相关部分
async function main() {
    // 读取私钥和代理
    if (!fs.existsSync('pk.txt')) {
        console.error('Error: pk.txt file not found!');
        process.exit(1);
    }

    if (!fs.existsSync('proxies.txt')) {
        console.error('Error: proxies.txt file not found!');
        process.exit(1);
    }

    const privateKeysText = fs.readFileSync('pk.txt', 'utf8');
    const privateKeys = privateKeysText.split(/[\r\n]+/).filter(key => key.trim().length > 0);

    const proxiesText = fs.readFileSync('proxies.txt', 'utf8');
    const proxies = proxiesText.split(/[\r\n]+/).filter(proxy => proxy.trim().length > 0);

    if (proxies.length < privateKeys.length) {
        console.error('Error: Not enough proxies for all accounts!');
        console.log(`Found ${privateKeys.length} private keys but only ${proxies.length} proxies`);
        process.exit(1);
    }

    console.log(`Found ${privateKeys.length} private keys and ${proxies.length} proxies\n`);

    // 为每个账户创建一个浏览器实例
    for (let i = 0; i < privateKeys.length; i++) {
        const privateKey = privateKeys[i].trim().startsWith('0x') ? 
            privateKeys[i].trim().slice(2) : privateKeys[i].trim();
        const proxy = proxies[i].trim();

        console.log(`\nInitializing account ${i + 1}/${privateKeys.length}`);
        
        try {
            // 获取认证信息
            const tokens = await getAuthTokens(privateKey, proxy);

            const browser = await chromium.launch({
                headless: true,
                proxy: {
                    server: proxy.startsWith('http') ? proxy : `http://${proxy}`,
                    bypass: 'localhost,127.0.0.1'
                },
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            
            const context = await browser.newContext({
                viewport: CONFIG.browser.viewport,
                userAgent: CONFIG.browser.userAgent
            });
            
            const page = await context.newPage();
            
            // 启动账户的任务处理，传入代理信息
            startAccountTask(page, tokens, browser, i + 1, proxy).catch(error => {
                console.error(`Error in account ${i + 1}:`, error);
            });

            // 等待一段时间再启动下一个账户
            if (i < privateKeys.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        } catch (error) {
            console.error(`Error initializing account ${i + 1}:`, error);
        }
    }
}

main().catch(console.error);