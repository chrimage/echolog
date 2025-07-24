import { VoiceConnection, VoiceReceiver, EndBehaviorType } from '@discordjs/voice';
import { VoiceChannel, GuildMember } from 'discord.js';
import { promises as fs } from 'fs';
import { join } from 'path';

import { UserStreamHandler } from './UserStreamHandler';
import { TrackMetadata } from '../utils/types';

export class RecordingSessionManager {
  private readonly connection: VoiceConnection;
  private readonly receiver: VoiceReceiver;
  private readonly channel: VoiceChannel;
  private readonly recordingsDir: string;
  private readonly sessionId: string;
  
  private userStreams = new Map<string, UserStreamHandler>();
  private isRecording = false;
  private startTime: Date;

  constructor(connection: VoiceConnection, channel: VoiceChannel, recordingsDir: string = './recordings') {
    this.connection = connection;
    this.receiver = connection.receiver;
    this.channel = channel;
    this.recordingsDir = recordingsDir;
    this.sessionId = `${channel.guild.id}_${Date.now()}`;
    this.startTime = new Date();

    console.log(`Created recording session ${this.sessionId} for channel ${channel.name}`);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Subscribe to speaking events to detect when users start/stop talking
    this.receiver.speaking.on('start', (userId) => {
      this.handleUserStartSpeaking(userId);
    });

    this.receiver.speaking.on('end', (userId) => {
      this.handleUserStopSpeaking(userId);
    });

    // Handle connection state changes
    this.connection.on('stateChange', (oldState, newState) => {
      console.log(`Voice connection state changed: ${oldState.status} -> ${newState.status}`);
      
      if (newState.status === 'disconnected') {
        this.stop();
      }
    });

    // Handle channel member changes
    this.channel.guild.voiceStates.cache.forEach((voiceState) => {
      if (voiceState.channelId === this.channel.id && voiceState.member) {
        console.log(`User already in channel: ${voiceState.member.displayName}`);
      }
    });
  }

  public start(): void {
    if (this.isRecording) {
      console.warn('Recording session is already active');
      return;
    }

    this.isRecording = true;
    console.log(`Started recording session ${this.sessionId}`);
    
    // Create session metadata
    this.createSessionMetadata();
  }

  private async createSessionMetadata(): Promise<void> {
    const sessionMetadata = {
      sessionId: this.sessionId,
      guildId: this.channel.guild.id,
      channelId: this.channel.id,
      channelName: this.channel.name,
      startTime: this.startTime.toISOString(),
      participants: Array.from(this.channel.members.values()).map(member => ({
        id: member.id,
        username: member.user.username,
        displayName: member.displayName
      }))
    };

    try {
      const metadataPath = join(this.recordingsDir, `session_${this.sessionId}.json`);
      await fs.writeFile(metadataPath, JSON.stringify(sessionMetadata, null, 2));
      console.log(`Created session metadata: ${metadataPath}`);
    } catch (error) {
      console.error('Failed to create session metadata:', error);
    }
  }

  private handleUserStartSpeaking(userId: string): void {
    if (!this.isRecording) return;

    // Check if user is actually in the voice channel
    const member = this.channel.members.get(userId);
    if (!member) {
      console.warn(`User ${userId} not found in channel, skipping`);
      return;
    }

    if (this.userStreams.has(userId)) {
      console.log(`User ${member.displayName} is already being recorded`);
      return;
    }

    try {
      // Subscribe to the user's audio stream
      const audioStream = this.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000 // End after 1 second of silence
        }
      });

      // Create stream handler
      const streamHandler = new UserStreamHandler(audioStream, userId, this.recordingsDir);
      this.userStreams.set(userId, streamHandler);
      
      console.log(`Started recording user: ${member.displayName} (${userId})`);
      
    } catch (error) {
      console.error(`Failed to start recording for user ${userId}:`, error);
    }
  }

  private handleUserStopSpeaking(userId: string): void {
    const member = this.channel.members.get(userId);
    const displayName = member ? member.displayName : userId;
    
    console.log(`User stopped speaking: ${displayName} (${userId})`);
    
    // Note: We don't immediately stop the stream handler here because the user
    // might start speaking again soon. The stream will end automatically after
    // the silence duration specified in the subscription.
  }

  public stop(): Promise<string[]> {
    if (!this.isRecording) {
      console.warn('Recording session is not active');
      return Promise.resolve([]);
    }

    this.isRecording = false;
    console.log(`Stopping recording session ${this.sessionId}`);

    const filenames: string[] = [];

    // Stop all user stream handlers
    for (const [userId, streamHandler] of this.userStreams) {
      streamHandler.stop();
      
      const metadata = streamHandler.getMetadata();
      if (metadata) {
        filenames.push(metadata.filename);
      }
    }

    this.userStreams.clear();

    // Destroy the voice connection
    this.connection.destroy();

    console.log(`Recording session ${this.sessionId} stopped. Recorded ${filenames.length} tracks.`);
    return Promise.resolve(filenames);
  }

  public getSessionInfo(): {
    sessionId: string;
    isRecording: boolean;
    activeStreams: number;
    channelName: string;
    startTime: Date;
    duration: number;
  } {
    return {
      sessionId: this.sessionId,
      isRecording: this.isRecording,
      activeStreams: this.userStreams.size,
      channelName: this.channel.name,
      startTime: this.startTime,
      duration: Date.now() - this.startTime.getTime()
    };
  }

  public getActiveUsers(): Array<{
    userId: string;
    displayName: string;
    bufferStatus: { queueLength: number; isActive: boolean };
  }> {
    const activeUsers: Array<{
      userId: string;
      displayName: string;
      bufferStatus: { queueLength: number; isActive: boolean };
    }> = [];

    for (const [userId, streamHandler] of this.userStreams) {
      const member = this.channel.members.get(userId);
      const displayName = member ? member.displayName : userId;
      
      activeUsers.push({
        userId,
        displayName,
        bufferStatus: streamHandler.getBufferStatus()
      });
    }

    return activeUsers;
  }

  public async getAllMetadata(): Promise<TrackMetadata[]> {
    const metadata: TrackMetadata[] = [];
    
    for (const streamHandler of this.userStreams.values()) {
      const trackMetadata = streamHandler.getMetadata();
      if (trackMetadata) {
        metadata.push(trackMetadata);
      }
    }

    return metadata;
  }
}