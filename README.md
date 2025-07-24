# EchoLog - High-Fidelity Discord Voice Recording Bot

EchoLog is a professional-grade Discord bot designed for high-fidelity multitrack voice recording with precise synchronization (±20ms accuracy). It captures Discord voice conversations and produces broadcast-quality mixed audio files suitable for podcasts, interviews, and content creation.

## Features

- **Protocol-Aware Recording**: Parses RTP headers for precise timing metadata
- **Multi-track Synchronization**: Maintains ±20ms accuracy across all participants
- **Jitter Buffer Management**: Handles network irregularities and packet loss
- **Drift Correction**: Compensates for clock differences in long sessions
- **Professional Post-Processing**: FFmpeg-powered mixing with multiple output formats
- **Dynamic Participant Handling**: Automatically handles users joining/leaving mid-session
- **Real-time Monitoring**: Live session status and buffer monitoring

## Quick Start

### 1. Prerequisites

- Node.js 18+ 
- FFmpeg installed on your system
- Discord bot token with voice permissions

### 2. Installation

```bash
git clone <repository-url>
cd echolog
npm install
```

### 3. Configuration

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your Discord bot token:
```env
DISCORD_TOKEN=your_discord_bot_token_here
RECORDINGS_DIR=./recordings
LOG_LEVEL=info
```

### 4. Build and Run

```bash
npm run build
npm start
```

For development:
```bash
npm run dev
```

## Bot Commands

- `!record` - Start recording the voice channel you're in
- `!stop` - Stop the current recording session
- `!status` - Show current recording session status
- `!mix <session_id>` - Generate mixed audio from a session (coming soon)
- `!help` - Show help message

## Usage Examples

### Basic Recording

1. Join a Discord voice channel
2. Type `!record` to start recording
3. The bot will join and begin capturing all participants
4. Type `!stop` when finished
5. Use the provided session ID to generate the final mix

### Post-Processing

After recording, mix the session:

```bash
# List available sessions
npm run mix list

# Mix a specific session
npm run mix <session_id>

# Mix specific metadata files
npm run mix files user1_metadata.json user2_metadata.json
```

## Technical Architecture

### Core Components

#### RTP Processing
- **RTP Header Parsing**: Extracts sequence numbers, timestamps, and SSRC identifiers
- **Timeline Reconstruction**: Creates a global timeline using high-resolution timestamps
- **Packet Loss Detection**: Identifies missing packets and inserts appropriate silence

#### Audio Pipeline
- **Jitter Buffer**: 150ms adaptive buffer with 60ms maximum jitter tolerance
- **Opus Decoding**: Real-time Opus to PCM conversion
- **Metadata Capture**: Per-stream timing information for post-processing

#### Synchronization System
- **Global Timeline**: Common reference point across all tracks
- **Drift Detection**: Linear regression analysis of timing patterns
- **Correction Algorithms**: FFmpeg-based audio stretching/compression

### File Structure

```
src/
├── core/
│   ├── UserStreamHandler.ts      # Individual user audio processing
│   └── RecordingSessionManager.ts # Multi-user session management
├── utils/
│   ├── types.ts                  # TypeScript interfaces
│   ├── rtpUtils.ts              # RTP header parsing utilities
│   ├── jitterBuffer.ts          # Network jitter management
│   └── driftCorrector.ts        # Clock drift detection/correction
├── scripts/
│   └── mix.ts                   # FFmpeg post-processing
└── index.ts                     # Main bot entry point
```

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_TOKEN` | - | Discord bot token (required) |
| `RECORDINGS_DIR` | `./recordings` | Directory for audio files |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |

### Audio Settings

The bot uses these optimal settings based on Discord's voice implementation:

- **Sample Rate**: 48000 Hz (Discord's native rate)
- **Channels**: 2 (stereo)
- **Frame Duration**: 20ms (960 samples per frame)
- **Codec**: Opus (for transmission), PCM (for processing)

### Synchronization Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| **Jitter Buffer Size** | 150ms | Network irregularity tolerance |
| **Maximum Jitter** | 60ms | Packet drop threshold |
| **Drift Threshold** | 10ms/sec | Minimum for correction |
| **Buffer Flush Interval** | 20ms | Real-time processing rate |

## Performance Considerations

### System Requirements

- **CPU**: Multi-core recommended for multiple simultaneous users
- **Memory**: ~100MB base + ~50MB per active user
- **Disk**: ~10MB per minute per user (PCM format)
- **Network**: Stable connection required for timing accuracy

### Scalability

For high-load scenarios:
- Use SSD storage for reduced I/O latency
- Consider distributed architecture for multiple channels
- Monitor memory usage during long sessions
- Implement cleanup routines for old recordings

## Troubleshooting

### Common Issues

**Bot can't hear audio**
- Ensure `selfDeaf: false` in voice connection
- Verify bot has voice permissions in the channel
- Check that users are actually speaking (not muted)

**Synchronization problems**
- Verify stable network connection
- Check system clock accuracy
- Monitor jitter buffer queue lengths with `!status`

**FFmpeg errors**
- Ensure FFmpeg is installed and in PATH
- Check available disk space
- Verify input file integrity

### Debugging

Enable debug logging:
```bash
LOG_LEVEL=debug npm start
```

Check jitter buffer status:
```
!status
```

Validate audio files:
```bash
ffmpeg -i recording.pcm -f null -
```

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

Based on research from:
- Discord.js Voice documentation
- RTP/RTCP protocol specifications
- Professional audio synchronization techniques
- VoIP jitter buffer implementations

## Support

For issues and feature requests, please use the GitHub issue tracker.