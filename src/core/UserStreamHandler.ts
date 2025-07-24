import { AudioReceiveStream } from '@discordjs/voice';
import { createWriteStream, WriteStream } from 'fs';
import { promises as fs } from 'fs';
import { join } from 'path';
import OpusScript = require('opusscript');

import { parseRtpHeader, extractOpusPayload, hrtimeToMs } from '../utils/rtpUtils';
import { JitterBuffer } from '../utils/jitterBuffer';
import { RtpHeader, TrackMetadata, JitterBufferPacket } from '../utils/types';

const OPUS_SAMPLE_RATE = 48000;
const OPUS_FRAME_DURATION = 20; // in ms
const CHANNELS = 2; // Discord sends stereo

export class UserStreamHandler {
  private readonly userId: string;
  private readonly recordingsDir: string;
  private readonly pcmStream: WriteStream;
  private readonly jitterBuffer: JitterBuffer;
  private readonly opusDecoder: OpusScript;
  
  private hasCapturedMetadata = false;
  private metadata?: TrackMetadata;
  private flushInterval?: NodeJS.Timeout;
  private isActive = true;

  constructor(receiverStream: AudioReceiveStream, userId: string, recordingsDir: string = './recordings') {
    this.userId = userId;
    this.recordingsDir = recordingsDir;
    
    const timestamp = Date.now();
    const pcmFilename = `${userId}_${timestamp}.pcm`;
    this.pcmStream = createWriteStream(join(recordingsDir, pcmFilename));
    
    this.jitterBuffer = new JitterBuffer();
    this.opusDecoder = new OpusScript(OPUS_SAMPLE_RATE, CHANNELS);

    // Set up stream event handlers
    receiverStream.on('data', (chunk) => this.handlePacket(chunk));
    receiverStream.on('end', () => this.handleStreamEnd());
    receiverStream.on('error', (error) => this.handleStreamError(error));

    // Start periodic buffer processing
    this.startBufferProcessing();
    
    console.log(`Started recording user: ${userId}`);
  }

  private handlePacket(chunk: Buffer): void {
    if (!this.isActive) return;

    try {
      const header = parseRtpHeader(chunk);
      const arrivalTime = Date.now();
      
      // Capture metadata on first packet
      if (!this.hasCapturedMetadata) {
        this.captureMetadata(header, arrivalTime);
        this.hasCapturedMetadata = true;
      }

      // Extract Opus payload
      const opusPayload = extractOpusPayload(chunk);
      
      // Buffer the packet for jitter correction
      const jitterPacket: JitterBufferPacket = {
        data: opusPayload,
        sequence: header.sequenceNumber,
        timestamp: header.timestamp,
        bufferedAt: arrivalTime
      };
      
      this.jitterBuffer.bufferPacket(jitterPacket);
      
    } catch (error) {
      console.error(`Error processing packet for user ${this.userId}:`, error);
    }
  }

  private async captureMetadata(header: RtpHeader, arrivalTime: number): Promise<void> {
    const timestamp = Date.now();
    const pcmFilename = `${this.userId}_${timestamp}.pcm`;
    
    this.metadata = {
      userId: this.userId,
      ssrc: header.ssrc,
      startTimeRTP: header.timestamp,
      startTimeHR: process.hrtime(),
      opusSampleRate: OPUS_SAMPLE_RATE,
      pcmSampleRate: OPUS_SAMPLE_RATE,
      filename: pcmFilename
    };
    
    try {
      const metadataPath = join(this.recordingsDir, `${this.userId}_${timestamp}.json`);
      await fs.writeFile(metadataPath, JSON.stringify(this.metadata, null, 2));
      console.log(`Captured metadata for user ${this.userId}`);
    } catch (error) {
      console.error(`Failed to write metadata for user ${this.userId}:`, error);
    }
  }

  private startBufferProcessing(): void {
    this.flushInterval = setInterval(() => {
      this.processJitterBuffer();
    }, OPUS_FRAME_DURATION);
  }

  private processJitterBuffer(): void {
    if (!this.isActive) return;

    const packets = this.jitterBuffer.flush();
    
    for (const packet of packets) {
      try {
        // Decode Opus to PCM
        const pcmData = this.opusDecoder.decode(packet.data);
        this.pcmStream.write(pcmData);
      } catch (error) {
        // Handle decode errors (usually silence or corrupt packets)
        console.warn(`Decode error for user ${this.userId}, writing silence:`, (error as Error).message);
        
        // Write silence for this frame (20ms at 48kHz stereo = 1920 samples = 3840 bytes)
        const silenceBuffer = Buffer.alloc(3840, 0);
        this.pcmStream.write(silenceBuffer);
      }
    }
  }

  private handleStreamEnd(): void {
    console.log(`Stream ended for user ${this.userId}`);
    this.stop();
  }

  private handleStreamError(error: Error): void {
    console.error(`Stream error for user ${this.userId}:`, error);
    this.stop();
  }

  public stop(): void {
    if (!this.isActive) return;
    
    this.isActive = false;
    
    // Clear the processing interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }
    
    // Process any remaining packets
    this.processJitterBuffer();
    
    // Close the PCM stream
    this.pcmStream.end();
    
    // Clear the jitter buffer
    this.jitterBuffer.clear();
    
    console.log(`Stopped recording user ${this.userId}`);
  }

  public getMetadata(): TrackMetadata | undefined {
    return this.metadata;
  }

  public getBufferStatus(): { queueLength: number; isActive: boolean } {
    return {
      queueLength: this.jitterBuffer.getQueueLength(),
      isActive: this.isActive
    };
  }
}