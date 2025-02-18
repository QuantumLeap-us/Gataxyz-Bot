# GATA DVA Automation Bot 🤖

An automation tool for GATA DVA tasks with multi-account and proxy support.

## Features ✨

- 🚀 Multi-account support
- 🔒 Proxy support with IP rotation
- 📊 Real-time status monitoring
- 🔄 Automatic task processing
- 🌐 Browser automation
- 💎 Points tracking
- 🛡️ Error handling and recovery
- 📝 Detailed logging

## Prerequisites 📋

- Node.js v16 or higher
- npm (Node Package Manager)
- A list of private keys
- A list of HTTP proxies

## Installation 🔧

1. Clone the repository:
   ```bash
   git clone https://github.com/QuantumLeap-us/Gataxyz-Bot.git
   cd Gata-Auto-Bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Install Playwright browsers:
   ```bash
   npx playwright install chromium
   ```

## Configuration ⚙️

1. Create `pk.txt` file with your private keys (one per line):
   ```
   0x123...abc
   0x456...def
   ```

2. Create `proxies.txt` file with your proxies (one per line):
   ```
   http://user:pass@ip:port
   ip:port
   ```

## Usage 🎮

Start the bot:
   ```bash
   npm start
   ```

The bot will:
1. Load private keys and proxies
2. Initialize browser instances for each account
3. Authenticate using private keys
4. Start processing DVA tasks
5. Monitor and display task status

## File Structure 📁 
