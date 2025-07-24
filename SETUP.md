# EchoLog Setup Guide

This guide will walk you through setting up EchoLog for production use.

## Prerequisites

### System Requirements

- **Node.js**: Version 18.0.0 or higher
- **FFmpeg**: Latest stable version
- **Operating System**: Linux (recommended), macOS, or Windows
- **RAM**: Minimum 4GB, 8GB+ recommended for multiple channels
- **Storage**: SSD recommended for optimal I/O performance

### Discord Requirements

1. **Discord Application**: Create a bot application at https://discord.com/developers/applications
2. **Bot Permissions**: The bot needs the following permissions:
   - View Channels
   - Connect (to voice channels)
   - Speak (though it will be muted during recording)
   - Use Voice Activity
   - Read Message History
   - Send Messages

## Installation Steps

### 1. Install System Dependencies

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install nodejs npm ffmpeg build-essential python3
```

#### CentOS/RHEL/Fedora
```bash
sudo dnf install nodejs npm ffmpeg gcc gcc-c++ make python3
# or for older versions:
# sudo yum install nodejs npm ffmpeg gcc gcc-c++ make python3
```

#### macOS
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install node ffmpeg
```

#### Windows
1. Install Node.js from https://nodejs.org/
2. Install FFmpeg from https://ffmpeg.org/download.html
3. Add FFmpeg to your system PATH
4. Install Visual Studio Build Tools or Visual Studio Community

### 2. Clone and Install EchoLog

```bash
git clone <repository-url>
cd echolog
npm install
```

### 3. Create Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Give your application a name (e.g., "EchoLog Recording Bot")
4. Go to the "Bot" section
5. Click "Add Bot"
6. Copy the bot token (you'll need this for configuration)
7. Under "Privileged Gateway Intents", enable:
   - Server Members Intent (if you want user info)
   - Message Content Intent

### 4. Bot Permissions Setup

In the "OAuth2 > URL Generator" section:
1. Select "bot" scope
2. Select these bot permissions:
   - View Channels
   - Connect
   - Speak
   - Use Voice Activity
   - Send Messages
   - Read Message History
3. Copy the generated URL and use it to invite the bot to your server

### 5. Configuration

Create your environment file:
```bash
cp .env.example .env
```

Edit the `.env` file:
```env
# Required: Your Discord bot token
DISCORD_TOKEN=your_discord_bot_token_here

# Optional: Recordings directory (default: ./recordings)
RECORDINGS_DIR=./recordings

# Optional: Log level (default: info)
LOG_LEVEL=info
```

Create the recordings directory:
```bash
mkdir -p recordings
```

## Advanced Configuration

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DISCORD_TOKEN` | string | required | Discord bot token |
| `RECORDINGS_DIR` | string | `./recordings` | Directory for storing recordings |
| `LOG_LEVEL` | string | `info` | Logging level (debug, info, warn, error) |
| `MAX_RECORDING_DURATION` | number | `3600000` | Max recording time in ms (1 hour) |
| `CLEANUP_OLD_FILES` | boolean | `false` | Auto-cleanup files older than 7 days |
| `ENABLE_DRIFT_CORRECTION` | boolean | `true` | Enable automatic drift correction |

### Production Settings

For production environments, create a more robust configuration:

```env
# Production configuration
NODE_ENV=production
DISCORD_TOKEN=your_production_token
RECORDINGS_DIR=/var/echolog/recordings
LOG_LEVEL=warn
MAX_RECORDING_DURATION=7200000
CLEANUP_OLD_FILES=true
ENABLE_DRIFT_CORRECTION=true
```

### System Service Setup (Linux)

Create a systemd service for automatic startup:

```bash
sudo nano /etc/systemd/system/echolog.service
```

```ini
[Unit]
Description=EchoLog Discord Recording Bot
After=network.target

[Service]
Type=simple
User=echolog
WorkingDirectory=/home/echolog/echolog
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl enable echolog
sudo systemctl start echolog
sudo systemctl status echolog
```

### Docker Setup

Create a `Dockerfile`:
```dockerfile
FROM node:18-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY dist/ ./dist/

# Create recordings directory
RUN mkdir -p recordings

# Set permissions
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

Build and run:
```bash
npm run build
docker build -t echolog .
docker run -d --name echolog -v $(pwd)/recordings:/app/recordings --env-file .env echolog
```

## Security Considerations

### Bot Token Security

1. **Never commit tokens to version control**
2. **Use environment variables** for sensitive data
3. **Rotate tokens regularly** in production
4. **Limit bot permissions** to only what's needed
5. **Monitor bot activity** for unusual behavior

### File System Security

```bash
# Set appropriate permissions for recordings directory
chmod 750 recordings
chown echolog:echolog recordings

# Consider encryption for sensitive recordings
# Use tools like gpg or openssl for file encryption
```

### Network Security

- **Use HTTPS** for any web interfaces
- **Implement rate limiting** if exposing APIs
- **Consider VPN** for remote access to recordings
- **Monitor network traffic** for anomalies

## Monitoring and Maintenance

### Log Management

Set up log rotation:
```bash
sudo nano /etc/logrotate.d/echolog
```

```
/var/log/echolog/*.log {
    daily
    missingok
    rotate 7
    compress
    notifempty
    create 644 echolog echolog
    postrotate
        systemctl reload echolog
    endscript
}
```

### Health Monitoring

Create a simple health check script:
```bash
#!/bin/bash
# health-check.sh

if ! pgrep -f "node.*echolog" > /dev/null; then
    echo "EchoLog is not running"
    systemctl restart echolog
    exit 1
fi

echo "EchoLog is running"
exit 0
```

Set up a cron job for automated checks:
```bash
crontab -e
```

```
# Check EchoLog health every 5 minutes
*/5 * * * * /path/to/health-check.sh
```

### Performance Monitoring

Monitor key metrics:
- CPU usage during recording
- Memory consumption per active stream
- Disk I/O for large sessions
- Network latency to Discord

### Backup Strategy

Set up automated backups:
```bash
#!/bin/bash
# backup-recordings.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/echolog"
SOURCE_DIR="/var/echolog/recordings"

# Create compressed backup
tar -czf "$BACKUP_DIR/recordings_$DATE.tar.gz" -C "$SOURCE_DIR" .

# Keep only last 30 days of backups
find "$BACKUP_DIR" -name "recordings_*.tar.gz" -mtime +30 -delete
```

## Troubleshooting

### Common Issues

**Permission Denied Errors**
```bash
# Fix file permissions
sudo chown -R echolog:echolog /path/to/echolog
chmod +x dist/index.js
```

**FFmpeg Not Found**
```bash
# Verify FFmpeg installation
which ffmpeg
ffmpeg -version

# Add to PATH if needed (Linux/macOS)
export PATH=$PATH:/usr/local/bin
```

**Memory Issues**
```bash
# Increase Node.js memory limit
node --max-old-space-size=8192 dist/index.js
```

**Network Connection Issues**
```bash
# Test Discord connectivity
curl -I https://discord.com/api/v10/gateway

# Check DNS resolution
nslookup discord.com
```

### Debug Mode

Enable detailed debugging:
```bash
LOG_LEVEL=debug npm start
```

This will show:
- RTP packet details
- Jitter buffer status
- FFmpeg command execution
- Network timing information

### Performance Profiling

For performance analysis:
```bash
# CPU profiling
node --prof dist/index.js

# Memory usage
node --inspect dist/index.js
```

## Production Checklist

Before deploying to production:

- [ ] Bot token configured and tested
- [ ] All system dependencies installed
- [ ] Permissions properly configured
- [ ] Monitoring and logging set up
- [ ] Backup strategy implemented
- [ ] Security measures in place
- [ ] Load testing completed
- [ ] Disaster recovery plan documented

## Support

If you encounter issues during setup:

1. Check the logs for error messages
2. Verify all prerequisites are met
3. Test with minimal configuration first
4. Consult the troubleshooting section
5. Create an issue on GitHub with:
   - System information
   - Error logs
   - Steps to reproduce