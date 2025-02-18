const chalk = require('chalk');

const EMOJIS = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    rocket: '🚀',
    fire: '🔥',
    star: '⭐',
    time: '⏰',
    ip: '🌐',
    task: '📝',
    points: '💎',
    wallet: '👛',
    browser: '🌐',
    proxy: '🔒',
    refresh: '🔄',
    stats: '📊'
};

function formatLog(accountId, type, message, proxyIP = '') {
    const timestamp = new Date().toISOString();
    const accountStr = chalk.blue(`[Account ${accountId}]`);
    const ipStr = proxyIP ? chalk.yellow(`[IP: ${proxyIP}]`) : '';
    
    let emoji = '';
    let coloredMessage = message;

    switch (type) {
        case 'success':
            emoji = EMOJIS.success;
            coloredMessage = chalk.green(message);
            break;
        case 'error':
            emoji = EMOJIS.error;
            coloredMessage = chalk.red(message);
            break;
        case 'warning':
            emoji = EMOJIS.warning;
            coloredMessage = chalk.yellow(message);
            break;
        case 'info':
            emoji = EMOJIS.info;
            coloredMessage = chalk.white(message);
            break;
        case 'stats':
            emoji = EMOJIS.stats;
            coloredMessage = chalk.cyan(message);
            break;
    }

    return `${chalk.gray(timestamp)} ${accountStr}${ipStr} ${emoji} ${coloredMessage}`;
}

module.exports = {
    EMOJIS,
    formatLog
}; 