# Gata.xyz Multi-Account Bot

A Node.js bot that automates task completion for multiple Gata.xyz accounts with proxy support.

## Features

- Multi-account support
- Proxy support for each account
- Automatic task completion
- Score calculation based on image captions
- Centralized stats and token storage
- Error handling and auto-restart

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)
- Ethereum wallet private keys
- HTTP/HTTPS proxies

## Installation

1. Clone the repository:
```bash
git clone https://github.com/QuantumLeap-us/Gataxyz-Bot.git
cd Gataxyz-Bot
```

2. Install dependencies:
```bash
npm install
```

3. Create required files:

`pk.txt`: Add your private keys (one per line)
```
private_key_1
private_key_2
...
```

`proxies.txt`: Add your proxies (one per line)
```
http://host1:port1
http://username:password@host2:port2
...
```

## Configuration

The bot supports two proxy formats:
- Simple: `http://host:port`
- Authenticated: `http://username:password@host:port`

Make sure you have:
- Equal or more proxies than private keys
- Valid Ethereum private keys (64 characters)

## Usage

Start the bot:
```bash
npm start
```

The bot will:
1. Load private keys and proxies
2. Initialize each account with its dedicated proxy
3. Start task processing for each account
4. Save stats and tokens in `all_stats.json` and `all_tokens.json`

## Registration

To get started with Gata.xyz:
1. Visit [https://app.gata.xyz/](https://app.gata.xyz/)
2. Use invitation code: `ngzxbox8`

## File Structure

- `main.js`: Main bot implementation
- `pk.txt`: Private keys storage
- `proxies.txt`: Proxy list
- `all_stats.json`: Centralized stats storage
- `all_tokens.json`: Centralized token storage

## Monitoring

The bot provides detailed logging:
- Account-specific logs with proxy information
- Task processing status
- Points and rewards tracking
- Error reporting

## Error Handling

The bot includes:
- Automatic retry on failed tasks
- Connection error handling
- Invalid proxy/key detection
- Auto-restart on critical errors

## Security

- Never share your private keys
- Keep your `pk.txt` and `proxies.txt` secure
- Don't commit sensitive files to version control

## Contributing

Feel free to submit issues and enhancement requests.

## License

This project is licensed under the MIT License. 
