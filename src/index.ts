import { Client, GatewayIntentBits, VoiceChannel } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { promises as fs } from 'fs';
import { join } from 'path';

import { RecordingSessionManager } from './core/RecordingSessionManager';
import { AudioMixer } from './scripts/mix';
import { logger } from './utils/logger';

// Environment configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || './recordings';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN environment variable is required');
  process.exit(1);
}

// Global state
const activeSessions = new Map<string, RecordingSessionManager>();

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Bot ready event
client.on('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  console.log(`Bot is ready and monitoring ${client.guilds.cache.size} guilds`);
  
  // Ensure recordings directory exists
  try {
    await fs.mkdir(RECORDINGS_DIR, { recursive: true });
    console.log(`Recordings directory ready: ${RECORDINGS_DIR}`);
  } catch (error) {
    console.error('Failed to create recordings directory:', error);
    process.exit(1);
  }
});

// Message command handling
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  const content = message.content.toLowerCase().trim();
  
  try {
    if (content.startsWith('!record')) {
      await handleRecordCommand(message);
    } else if (content === '!stop') {
      await handleStopCommand(message);
    } else if (content === '!status') {
      await handleStatusCommand(message);
    } else if (content === '!help') {
      await handleHelpCommand(message);
    } else if (content.startsWith('!mix')) {
      await handleMixCommand(message);
    } else if (content === '!list') {
      await handleListCommand(message);
    }
  } catch (error) {
    console.error('Error handling command:', error);
    await message.reply('❌ An error occurred while processing your command.');
  }
});

async function handleRecordCommand(message: any): Promise<void> {
  const member = message.member;
  if (!member?.voice.channel) {
    await message.reply('❌ You need to join a voice channel first!');
    return;
  }

  const voiceChannel = member.voice.channel as VoiceChannel;
  const guildId = message.guild.id;

  // Check if already recording in this guild
  if (activeSessions.has(guildId)) {
    await message.reply('❌ Already recording in this server. Use `!stop` to end the current session.');
    return;
  }

  try {
    await message.reply('🎙️ Starting recording session...');

    // Join the voice channel
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false, // Important: bot must not be deafened to receive audio
      selfMute: true   // Bot should be muted since it's just recording
    });

    // Wait for connection to be ready
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

    // Create and start recording session
    const sessionManager = new RecordingSessionManager(connection, voiceChannel, RECORDINGS_DIR);
    sessionManager.start();
    
    activeSessions.set(guildId, sessionManager);

    await message.reply(`✅ Started recording in **${voiceChannel.name}**!\n` +
                       `Use \`!status\` to check recording status or \`!stop\` to end the session.`);

  } catch (error) {
    console.error('Failed to start recording:', error);
    await message.reply('❌ Failed to join the voice channel or start recording. Please try again.');
  }
}

async function handleStopCommand(message: any): Promise<void> {
  const guildId = message.guild.id;
  const session = activeSessions.get(guildId);

  if (!session) {
    await message.reply('❌ No active recording session in this server.');
    return;
  }

  try {
    await message.reply('⏹️ Stopping recording session...');

    const filenames = await session.stop();
    activeSessions.delete(guildId);

    const sessionInfo = session.getSessionInfo();
    const durationMinutes = Math.round(sessionInfo.duration / 60000);
    
    await message.reply(`✅ Recording stopped!\n` +
                       `📊 **Session Summary:**\n` +
                       `• Duration: ${durationMinutes} minutes\n` +
                       `• Tracks recorded: ${filenames.length}\n` +
                       `• Session ID: \`${sessionInfo.sessionId}\`\n\n` +
                       `Use \`!mix ${sessionInfo.sessionId}\` to generate the final mixed audio file.`);

  } catch (error) {
    console.error('Error stopping recording:', error);
    await message.reply('❌ Error occurred while stopping the recording session.');
  }
}

async function handleStatusCommand(message: any): Promise<void> {
  const guildId = message.guild.id;
  const session = activeSessions.get(guildId);

  if (!session) {
    await message.reply('📊 No active recording session in this server.');
    return;
  }

  const sessionInfo = session.getSessionInfo();
  const activeUsers = session.getActiveUsers();
  const durationMinutes = Math.round(sessionInfo.duration / 60000);

  let statusMessage = `📊 **Recording Session Status**\n` +
                     `• Session ID: \`${sessionInfo.sessionId}\`\n` +
                     `• Channel: **${sessionInfo.channelName}**\n` +
                     `• Duration: ${durationMinutes} minutes\n` +
                     `• Active streams: ${sessionInfo.activeStreams}\n\n`;

  if (activeUsers.length > 0) {
    statusMessage += `👥 **Active Users:**\n`;
    for (const user of activeUsers) {
      const bufferStatus = user.bufferStatus.isActive ? '🟢' : '🔴';
      const queueInfo = user.bufferStatus.queueLength > 0 ? ` (${user.bufferStatus.queueLength} queued)` : '';
      statusMessage += `${bufferStatus} ${user.displayName}${queueInfo}\n`;
    }
  } else {
    statusMessage += `👥 No users currently speaking`;
  }

  await message.reply(statusMessage);
}

async function handleHelpCommand(message: any): Promise<void> {
  const helpMessage = `🎙️ **EchoLog Bot Commands**\n\n` +
                     `\`!record\` - Start recording the voice channel you're in\n` +
                     `\`!stop\` - Stop the current recording session\n` +
                     `\`!status\` - Show current recording session status\n` +
                     `\`!mix <session_id>\` - Generate mixed audio from a session\n` +
                     `\`!list\` - List available recording sessions\n` +
                     `\`!help\` - Show this help message\n\n` +
                     `📋 **Notes:**\n` +
                     `• You must be in a voice channel to start recording\n` +
                     `• Only one recording session per server at a time\n` +
                     `• Bot records all participants automatically\n` +
                     `• Generated files are saved with high-precision timestamps for synchronization`;

  await message.reply(helpMessage);
}

async function handleMixCommand(message: any): Promise<void> {
  const args = message.content.trim().split(/\s+/);
  
  if (args.length < 2) {
    await message.reply('❌ Please specify a session ID. Use `!list` to see available sessions.\nExample: `!mix guild123_1640995200000`');
    return;
  }

  const sessionId = args[1];
  
  try {
    await message.reply('🎵 Starting audio mixing process...');
    
    const mixer = new AudioMixer(RECORDINGS_DIR);
    const outputPath = await mixer.mixSession(sessionId);
    
    // Get file size for display
    const stats = await fs.stat(outputPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    
    await message.reply(`✅ Audio mixing completed!\n` +
                       `📁 Output file: \`${outputPath}\`\n` +
                       `📊 File size: ${fileSizeMB} MB\n\n` +
                       `The mixed audio file contains all participants synchronized with high precision.`);
                       
  } catch (error) {
    logger.error('Error during mixing:', error);
    await message.reply(`❌ Failed to mix session "${sessionId}". Please check that the session exists and all files are available.`);
  }
}

async function handleListCommand(message: any): Promise<void> {
  try {
    const mixer = new AudioMixer(RECORDINGS_DIR);
    const sessions = await mixer.listSessions();
    
    if (sessions.length === 0) {
      await message.reply('📋 No recording sessions found in this server.');
      return;
    }
    
    let listMessage = `📋 **Available Recording Sessions**\n\n`;
    
    for (const session of sessions) {
      const date = new Date(session.metadata.startTime).toLocaleDateString();
      const time = new Date(session.metadata.startTime).toLocaleTimeString();
      
      listMessage += `🎙️ **${session.sessionId}**\n`;
      listMessage += `   📅 ${date} at ${time}\n`;
      listMessage += `   🎵 ${session.trackCount} tracks\n`;
      listMessage += `   📍 ${session.metadata.channelName}\n`;
      listMessage += `   👥 ${session.metadata.participants.length} participants\n\n`;
    }
    
    listMessage += `To mix a session, use: \`!mix <session_id>\``;
    
    await message.reply(listMessage);
    
  } catch (error) {
    logger.error('Error listing sessions:', error);
    await message.reply('❌ Error retrieving session list.');
  }
}

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  
  // Stop all active sessions
  for (const [guildId, session] of activeSessions) {
    console.log(`Stopping session in guild ${guildId}...`);
    session.stop();
  }
  
  // Destroy the client
  client.destroy();
  process.exit(0);
});

// Start the bot
console.log('Starting EchoLog bot...');
client.login(DISCORD_TOKEN);