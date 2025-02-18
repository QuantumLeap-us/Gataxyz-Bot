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
        let axiosInstance;
        if (proxy) {
            const tunnel = require('tunnel');
            
            // 解析代理URL
            const proxyParts = proxy.match(/http:\/\/(.*):(.*)@(.*):(\d+)/);
            if (!proxyParts) {
                throw new Error('Invalid proxy format');
            }

            const [_, username, password, host, port] = proxyParts;
            
            const proxyConfig = {
                proxy: {
                    host: host,
                    port: parseInt(port),
                    proxyAuth: `${username}:${password}`
                }
            };
            
            const tunnelingAgent = tunnel.httpsOverHttp(proxyConfig);
            axiosInstance = axios.create({
                httpsAgent: tunnelingAgent,
                proxy: false,
                timeout: 30000,
                headers: {
                    'Proxy-Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
                }
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

// Check proxy IP and return the actual IP address
async function checkProxyIP(proxy) {
    try {
        const tunnel = require('tunnel');
        
        // Parse proxy URL
        const proxyParts = proxy.match(/http:\/\/(.*):(.*)@(.*):(\d+)/);
        if (!proxyParts) {
            throw new Error('Invalid proxy format');
        }

        const [_, username, password, host, port] = proxyParts;
        
        const proxyConfig = {
            proxy: {
                host: host,
                port: parseInt(port),
                proxyAuth: `${username}:${password}`
            }
        };

        const tunnelingAgent = tunnel.httpsOverHttp(proxyConfig);
        const axiosInstance = axios.create({
            httpsAgent: tunnelingAgent,
            proxy: false,
            timeout: 30000,
            headers: {
                'Proxy-Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
            }
        });

        // Get actual IP from ipify API
        const response = await axiosInstance.get('https://api.ipify.org?format=json', {
            headers: {
                'User-Agent': CONFIG.browser.userAgent
            }
        });

        return response.data.ip;
    } catch (error) {
        // Try backup IP check service
        try {
            const axiosInstance = axios.create({
                httpsAgent: tunnelingAgent,
                proxy: false,
                timeout: 30000
            });
            
            const backupResponse = await axiosInstance.get('https://ifconfig.me/ip');
            return backupResponse.data.trim();
        } catch (backupError) {
            return 'Unknown';
        }
    }
}

// Process tasks for a single account
async function startAccountTask(page, tokens, browser, accountId, proxy) {
    try {
        // Check proxy IP
        const proxyIP = await checkProxyIP(proxy);
        console.log(formatLog(accountId, 'info', `${EMOJIS.proxy} Proxy IP: ${proxyIP}`));
        console.log(formatLog(accountId, 'info', 'Navigating to DVA page...'));

        // Increase page load timeout
        await page.goto(CONFIG.urls.base, {
            timeout: 60000, // Increase to 60 seconds
            waitUntil: 'domcontentloaded' // Use domcontentloaded instead of load
        });
        
        await setRequiredLocalStorage(page, tokens);
        console.log(formatLog(accountId, 'info', 'Reloading page...'));
        
        await Promise.all([
            page.reload(),
            waitForPageLoad(page)
        ]);
        
        await page.waitForTimeout(5000);
        
        const buttonClicked = await findAndClickStartButton(page);
        
        if (buttonClicked) {
            console.log(formatLog(accountId, 'success', 'DVA Start button clicked successfully'));
            const intervalId = await keepSessionActive(page);
            
            process.on('SIGINT', async () => {
                clearInterval(intervalId);
                console.log(formatLog(accountId, 'info', 'Received SIGINT. Closing browser...'));
                await browser.close();
            });
        } else {
            console.error(formatLog(accountId, 'error', 'Could not find DVA Start button'));
            await browser.close();
        }
    } catch (error) {
        console.error(formatLog(accountId, 'error', `Error during execution: ${error.message}`));
        await browser.close();
    }
}

// Main execution function
async function main() {
    // Check for required files
    if (!fs.existsSync('pk.txt')) {
        console.error(formatLog(0, 'error', 'Error: pk.txt file not found!'));
        process.exit(1);
    }

    if (!fs.existsSync('proxies.txt')) {
        console.error(formatLog(0, 'error', 'Error: proxies.txt file not found!'));
        process.exit(1);
    }

    // Load private keys and proxies
    const privateKeysText = fs.readFileSync('pk.txt', 'utf8');
    const privateKeys = privateKeysText.split(/[\r\n]+/).filter(key => key.trim().length > 0);

    const proxiesText = fs.readFileSync('proxies.txt', 'utf8');
    const proxies = proxiesText.split(/[\r\n]+/).filter(proxy => proxy.trim().length > 0);

    // Validate proxy count
    if (proxies.length < privateKeys.length) {
        console.error(formatLog(0, 'error', `Error: Not enough proxies for all accounts!`));
        console.log(formatLog(0, 'info', `Found ${privateKeys.length} private keys but only ${proxies.length} proxies`));
        process.exit(1);
    }

    console.log(formatLog(0, 'info', `Found ${privateKeys.length} private keys and ${proxies.length} proxies`));

    // Initialize browser instances for each account
    for (let i = 0; i < privateKeys.length; i++) {
        const privateKey = privateKeys[i].trim().startsWith('0x') ? 
            privateKeys[i].trim().slice(2) : privateKeys[i].trim();
        const proxy = proxies[i].trim();

        console.log(formatLog(0, 'info', `Initializing account ${i + 1}/${privateKeys.length}`));
        
        try {
            // Get authentication tokens
            const tokens = await getAuthTokens(privateKey, proxy);

            // Launch browser with proxy
            const browser = await chromium.launch({
                headless: true,
                proxy: {
                    server: proxy.startsWith('http') ? proxy : `http://${proxy}`,
                    bypass: 'localhost,127.0.0.1'
                },
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            
            // Create browser context and page
            const context = await browser.newContext({
                viewport: CONFIG.browser.viewport,
                userAgent: CONFIG.browser.userAgent
            });
            
            const page = await context.newPage();
            
            // Start task processing
            startAccountTask(page, tokens, browser, i + 1, proxy).catch(error => {
                console.error(formatLog(i + 1, 'error', `Error in account: ${error.message}`));
            });

            // Wait before starting next account
            if (i < privateKeys.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        } catch (error) {
            console.error(formatLog(i + 1, 'error', `Error initializing account: ${error.message}`));
        }
    }
}

// Start the application
main().catch(error => console.error(formatLog(0, 'error', `Fatal error: ${error.message}`)));