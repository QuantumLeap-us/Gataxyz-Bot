const axios = require('axios');
const ethers = require('ethers');
const fs = require('fs');
const HttpsProxyAgent = require('https-proxy-agent');

class GataBot {
    constructor(accountId, proxy) {
        this.accountId = accountId;
        this.proxy = proxy;
        this.baseUrls = {
            earn: 'https://earn.aggregata.xyz',
            agent: 'https://agent.gata.xyz',
            chat: 'https://chat.gata.xyz'
        };
        this.tokens = {
            bearer: '',
            aggr_llm: '',
            aggr_task: ''
        };
        this.stats = {
            dailyPoints: 0,
            totalPoints: 0,
            completedCount: 0,
            lastPointCheck: 0
        };
        this.minDelay = 5000;  // 5 seconds
        this.maxDelay = 15000; // 15 seconds
        this.retryDelay = 10000; // 10 seconds for retries

        // 创建带代理的axios实例
        this.axiosInstance = axios.create({
            httpsAgent: new HttpsProxyAgent(this.proxy),
            proxy: false // 必须设置为false，因为我们使用httpsAgent
        });
    }

    async initialize(privateKey) {
        try {
            const wallet = new ethers.Wallet(privateKey);
            const address = wallet.address;
            this.log('Initializing with address: ' + address);

            // Get authentication nonce
            const nonceResponse = await this.axiosInstance.post(`${this.baseUrls.earn}/api/signature_nonce`, {
                address: address
            });

            const authNonce = nonceResponse.data.auth_nonce;
            const signature = await wallet.signMessage(authNonce);

            // Authorize with signature
            const authResponse = await this.axiosInstance.post(`${this.baseUrls.earn}/api/authorize`, {
                public_address: address,
                signature_code: signature,
                invite_code: ''
            });

            // Store main bearer token
            this.tokens.bearer = authResponse.data.token;
            this.log('Authorization successful');

            // Get task token
            const taskTokenResponse = await this.axiosInstance.post(
                `${this.baseUrls.earn}/api/grant`, 
                { type: 1 },
                { headers: { Authorization: `Bearer ${this.tokens.bearer}` }}
            );
            this.tokens.aggr_task = taskTokenResponse.data.token;
            this.log('Task token obtained');

            // Get LLM token
            const llmTokenResponse = await this.axiosInstance.post(
                `${this.baseUrls.earn}/api/grant`,
                { type: 0 },
                { headers: { Authorization: `Bearer ${this.tokens.bearer}` }}
            );
            this.tokens.aggr_llm = llmTokenResponse.data.token;
            this.log('LLM token obtained');

            // Save tokens and initialize rewards
            this.saveTokens();
            await this.updateRewardsData();
            
            return true;
        } catch (error) {
            this.log('Initialization error: ' + error.message);
            return false;
        }
    }

    async getTask() {
        try {
            const response = await this.axiosInstance.get(`${this.baseUrls.agent}/api/task`, {
                headers: {
                    'Authorization': `Bearer ${this.tokens.aggr_task}`,
                    'X-Gata-Endpoint': 'pc-browser',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                }
            });
            return response.data;
        } catch (error) {
            console.error('Error getting task:', error.message);
            return null;
        }
    }

    async updateRewardsData() {
        try {
            const response = await this.axiosInstance.get(`${this.baseUrls.agent}/api/task_rewards`, {
                params: {
                    page: 0,
                    per_page: 10
                },
                headers: {
                    'Authorization': `Bearer ${this.tokens.aggr_task}`,
                    'X-Gata-Endpoint': 'pc-browser',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                }
            });

            const data = response.data;
            
            // Update stats
            this.stats.totalPoints = parseInt(data.total) || 0;
            this.stats.completedCount = parseInt(data.completed_count) || 0;
            
            // Calculate daily points
            const today = new Date().toISOString().split('T')[0];
            const todayReward = data.rewards.find(r => r.date === today);
            this.stats.dailyPoints = todayReward ? parseInt(todayReward.total_points) : 0;

            // Log updated stats
            this.log('\nCurrent Stats:');
            this.log(`Daily Points: ${this.stats.dailyPoints}`);
            this.log(`Total Points: ${this.stats.totalPoints}`);
            this.log(`Completed Tasks: ${this.stats.completedCount}`);
            
            this.saveStats();
            return true;
        } catch (error) {
            console.error('Error updating rewards:', error.message);
            return false;
        }
    }

    calculateScore(imageUrl, caption) {
        let score = 0;
        
        // Basic caption validation
        if (!caption || caption.length < 15) {
            return -0.5;
        }

        // Length-based scoring
        if (caption.length > 50) {
            score += 0.3;
        }

        // Check for descriptive elements
        const descriptiveElements = [
            'shows', 'displays', 'contains', 'depicts',
            'image', 'picture', 'photo', 'photograph',
            'background', 'foreground', 'color', 'featuring'
        ];

        const elementCount = descriptiveElements.filter(elem => 
            caption.toLowerCase().includes(elem)
        ).length;
        score += (elementCount * 0.1);

        // Check for proper sentence structure
        if (/^[A-Z].*[.!?]$/.test(caption)) {
            score += 0.2;
        }

        // Add natural variation
        const randomFactor = (Math.random() * 0.3) - 0.15;
        score += randomFactor;

        // Ensure score stays within bounds
        return Math.max(-0.9, Math.min(0.9, score));
    }

    async submitScore(taskId, score) {
        try {
            await this.axiosInstance.patch(`${this.baseUrls.agent}/api/task`, {
                id: taskId,
                score: score.toString()
            }, {
                headers: {
                    'Authorization': `Bearer ${this.tokens.aggr_task}`,
                    'X-Gata-Endpoint': 'pc-browser',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                }
            });
            return true;
        } catch (error) {
            console.error('Error submitting score:', error.message);
            return false;
        }
    }

    async validatePoints(beforePoints, afterPoints) {
        if (afterPoints <= beforePoints) {
            console.log('Warning: No points awarded for last task');
            await this.sleep(this.minDelay * 2);
            return false;
        }
        return true;
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    saveTokens() {
        try {
            let allTokens = {};
            if (fs.existsSync('all_tokens.json')) {
                allTokens = JSON.parse(fs.readFileSync('all_tokens.json', 'utf8'));
            }
            allTokens[this.accountId] = {
                timestamp: new Date().toISOString(),
                ...this.tokens
            };
            fs.writeFileSync('all_tokens.json', JSON.stringify(allTokens, null, 2));
        } catch (error) {
            console.error(`Error saving tokens for account ${this.accountId}:`, error);
        }
    }

    saveStats() {
        try {
            let allStats = {};
            if (fs.existsSync('all_stats.json')) {
                allStats = JSON.parse(fs.readFileSync('all_stats.json', 'utf8'));
            }
            allStats[this.accountId] = {
                timestamp: new Date().toISOString(),
                ...this.stats
            };
            fs.writeFileSync('all_stats.json', JSON.stringify(allStats, null, 2));
        } catch (error) {
            console.error(`Error saving stats for account ${this.accountId}:`, error);
        }
    }

    log(message) {
        console.log(`[Account ${this.accountId}] ${message}`);
    }

    async start() {
        this.log('Starting bot operation...');
        
        try {
            while (true) {
                // Store current points
                const beforePoints = this.stats.totalPoints;
                
                // Get new task
                const task = await this.getTask();
                if (!task || !task.id) {
                    this.log('No task available, waiting...');
                    await this.sleep(this.minDelay);
                    continue;
                }

                // Process task
                this.log(`\nProcessing task ${task.id}`);
                this.log(`Caption: ${task.text}`);
                this.log(`Image URL: ${task.link}`);

                // Calculate and submit score
                const score = this.calculateScore(task.link, task.text);
                const submitSuccess = await this.submitScore(task.id, score);
                
                if (submitSuccess) {
                    this.log(`Submitted score: ${score}`);
                    
                    // Wait for points update
                    await this.sleep(2000);
                    await this.updateRewardsData();

                    // Validate points
                    const pointsValid = await this.validatePoints(beforePoints, this.stats.totalPoints);
                    
                    // Calculate next delay
                    const delay = pointsValid ? 
                        this.minDelay + Math.random() * (this.maxDelay - this.minDelay) :
                        this.maxDelay;
                    
                    this.log(`Waiting ${Math.round(delay/1000)} seconds before next task...`);
                    await this.sleep(delay);
                } else {
                    this.log('Failed to submit score, retrying...');
                    await this.sleep(this.retryDelay);
                }
            }
        } catch (error) {
            this.log('Bot operation error: ' + error.message);
            this.log('Restarting in 10 seconds...');
            await this.sleep(this.retryDelay);
            this.start();
        }
    }
}

// Main function
async function main() {
    // Check for private key file
    if (!fs.existsSync('pk.txt')) {
        console.error('Error: pk.txt file not found!');
        console.log('Please create a pk.txt file with your private keys.');
        process.exit(1);
    }

    // Check for proxy file
    if (!fs.existsSync('proxies.txt')) {
        console.error('Error: proxies.txt file not found!');
        console.log('Please create a proxies.txt file with your proxies.');
        process.exit(1);
    }

    // Read private keys file
    const privateKeysText = fs.readFileSync('pk.txt', 'utf8');
    const privateKeys = privateKeysText.split(/[\r\n]+/).filter(key => key.trim().length > 0);
    
    // Read proxies file
    const proxiesText = fs.readFileSync('proxies.txt', 'utf8');
    const proxies = proxiesText.split(/[\r\n]+/).filter(proxy => proxy.trim().length > 0);

    if (proxies.length < privateKeys.length) {
        console.error('Error: Not enough proxies for all accounts!');
        console.log(`Found ${privateKeys.length} private keys but only ${proxies.length} proxies`);
        process.exit(1);
    }
    
    console.log(`Found ${privateKeys.length} private keys and ${proxies.length} proxies`);
    
    // Initialize and start bots one by one
    for (let i = 0; i < privateKeys.length; i++) {
        const privateKey = privateKeys[i].trim();
        const proxy = proxies[i].trim();

        if (privateKey.length !== 64) {
            console.log(`Skipping invalid private key at index ${i + 1}`);
            continue;
        }
        
        const bot = new GataBot(i + 1, proxy);
        try {
            const initSuccess = await bot.initialize(privateKey);
            if (initSuccess) {
                console.log(`Bot ${i + 1} successfully initialized with proxy: ${proxy}`);
                // Start bot immediately after successful initialization
                bot.start().catch(error => {
                    console.error(`Error in bot ${bot.accountId}:`, error);
                });
            } else {
                console.error(`Failed to initialize bot ${i + 1}`);
            }
        } catch (error) {
            console.error(`Fatal error for bot ${i + 1}:`, error);
        }
        // Add delay to avoid simultaneous initialization of next account
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// Run the main function
main().catch(console.error);