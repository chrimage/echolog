import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import ffmpegStatic = require('ffmpeg-static');

import { TrackMetadata } from '../utils/types';
import { hrtimeToMs } from '../utils/rtpUtils';

const RECORDINGS_DIR = process.env.RECORDINGS_DIR || './recordings';
const FFMPEG_PATH = (ffmpegStatic as unknown as string) || 'ffmpeg';

interface MixingOptions {
  outputFormat: 'wav' | 'ogg' | 'mp3';
  quality: 'low' | 'medium' | 'high';
  normalize: boolean;
  removeNoise: boolean;
}

const DEFAULT_OPTIONS: MixingOptions = {
  outputFormat: 'wav',
  quality: 'high',
  normalize: false,
  removeNoise: false
};

export class AudioMixer {
  private recordingsDir: string;

  constructor(recordingsDir: string = RECORDINGS_DIR) {
    this.recordingsDir = recordingsDir;
  }

  async mixSession(sessionId: string, options: Partial<MixingOptions> = {}): Promise<string> {
    const mixOptions = { ...DEFAULT_OPTIONS, ...options };
    
    console.log(`Starting audio mixing for session: ${sessionId}`);
    
    // Find all metadata files for the session
    const tracks = await this.loadSessionTracks(sessionId);
    
    if (tracks.length === 0) {
      throw new Error(`No tracks found for session ${sessionId}`);
    }
    
    console.log(`Found ${tracks.length} tracks to mix`);
    
    // Calculate timing offsets
    const globalStartTime = this.calculateGlobalStartTime(tracks);
    const trackDelays = this.calculateTrackDelays(tracks, globalStartTime);
    
    // Generate FFmpeg command
    const outputPath = await this.generateMixCommand(tracks, trackDelays, sessionId, mixOptions);
    
    console.log(`Mixed audio saved to: ${outputPath}`);
    return outputPath;
  }

  async mixFiles(metadataFiles: string[], outputName?: string, options: Partial<MixingOptions> = {}): Promise<string> {
    const mixOptions = { ...DEFAULT_OPTIONS, ...options };
    
    console.log(`Mixing ${metadataFiles.length} individual files`);
    
    // Load metadata from specified files
    const tracks: TrackMetadata[] = [];
    for (const file of metadataFiles) {
      try {
        const content = await fs.readFile(join(this.recordingsDir, file), 'utf-8');
        tracks.push(JSON.parse(content));
      } catch (error) {
        console.warn(`Failed to load metadata from ${file}:`, error);
      }
    }
    
    if (tracks.length === 0) {
      throw new Error('No valid tracks found from metadata files');
    }
    
    // Calculate timing
    const globalStartTime = this.calculateGlobalStartTime(tracks);
    const trackDelays = this.calculateTrackDelays(tracks, globalStartTime);
    
    // Generate output name if not provided
    const sessionName = outputName || `manual_mix_${Date.now()}`;
    const outputPath = await this.generateMixCommand(tracks, trackDelays, sessionName, mixOptions);
    
    console.log(`Mixed audio saved to: ${outputPath}`);
    return outputPath;
  }

  private async loadSessionTracks(sessionId: string): Promise<TrackMetadata[]> {
    const files = await fs.readdir(this.recordingsDir);
    const metadataFiles = files.filter(f => 
      f.endsWith('.json') && 
      !f.startsWith('session_') && 
      f.includes(sessionId.split('_')[0]) // Match guild ID
    );
    
    const tracks: TrackMetadata[] = [];
    
    for (const file of metadataFiles) {
      try {
        const content = await fs.readFile(join(this.recordingsDir, file), 'utf-8');
        const metadata = JSON.parse(content);
        
        // Verify the PCM file exists
        const pcmPath = join(this.recordingsDir, metadata.filename);
        await fs.access(pcmPath);
        
        tracks.push(metadata);
      } catch (error) {
        console.warn(`Skipping invalid metadata file ${file}:`, error);
      }
    }
    
    return tracks;
  }

  private calculateGlobalStartTime(tracks: TrackMetadata[]): number {
    if (tracks.length === 0) return 0;
    
    return Math.min(...tracks.map(track => hrtimeToMs(track.startTimeHR)));
  }

  private calculateTrackDelays(tracks: TrackMetadata[], globalStartTime: number): Map<string, number> {
    const delays = new Map<string, number>();
    
    for (const track of tracks) {
      const trackStartTime = hrtimeToMs(track.startTimeHR);
      const delayMs = Math.round(trackStartTime - globalStartTime);
      delays.set(track.userId, Math.max(0, delayMs)); // Ensure non-negative
    }
    
    return delays;
  }

  private async generateMixCommand(
    tracks: TrackMetadata[], 
    trackDelays: Map<string, number>, 
    sessionName: string, 
    options: MixingOptions
  ): Promise<string> {
    const ffmpegArgs: string[] = [];
    const filterComplexParts: string[] = [];
    
    // Add input files
    tracks.forEach((track, index) => {
      const pcmPath = join(this.recordingsDir, track.filename);
      ffmpegArgs.push(
        '-f', 's16le',           // PCM signed 16-bit little endian
        '-ar', String(track.pcmSampleRate),
        '-ac', '2',              // Stereo
        '-i', pcmPath
      );
    });
    
    // Create adelay filters for each track
    tracks.forEach((track, index) => {
      const delayMs = trackDelays.get(track.userId) || 0;
      filterComplexParts.push(`[${index}:a]adelay=delays=${delayMs}:all=true[delayed${index}]`);
    });
    
    // Create amix filter
    const mixInputs = tracks.map((_, index) => `[delayed${index}]`).join('');
    let mixFilter = `${mixInputs}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0`;
    
    if (!options.normalize) {
      mixFilter += ':normalize=0';
    }
    
    mixFilter += '[mixed]';
    filterComplexParts.push(mixFilter);
    
    // Add noise reduction if requested
    if (options.removeNoise) {
      filterComplexParts.push('[mixed]afftdn=nr=20:nf=-25[denoised]');
      filterComplexParts.push('[denoised]aresample=async=1:first_pts=0[final]');
    } else {
      filterComplexParts.push('[mixed]aresample=async=1:first_pts=0[final]');
    }
    
    // Add filter complex
    ffmpegArgs.push('-filter_complex', filterComplexParts.join('; '));
    ffmpegArgs.push('-map', '[final]');
    
    // Output settings based on format and quality
    const outputPath = join(this.recordingsDir, `${sessionName}_mixed.${options.outputFormat}`);
    
    switch (options.outputFormat) {
      case 'wav':
        ffmpegArgs.push('-c:a', 'pcm_s16le');
        break;
      case 'ogg':
        const oggQuality = options.quality === 'high' ? '7' : options.quality === 'medium' ? '5' : '3';
        ffmpegArgs.push('-c:a', 'libvorbis', '-q:a', oggQuality);
        break;
      case 'mp3':
        const mp3Bitrate = options.quality === 'high' ? '320k' : options.quality === 'medium' ? '192k' : '128k';
        ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', mp3Bitrate);
        break;
    }
    
    ffmpegArgs.push('-y', outputPath); // Overwrite output file
    
    // Execute FFmpeg
    await this.executeFFmpeg(ffmpegArgs);
    
    return outputPath;
  }

  private executeFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`Executing FFmpeg: ${FFMPEG_PATH} ${args.join(' ')}`);
      
      const ffmpeg: ChildProcess = spawn(FFMPEG_PATH, args);
      
      let stderr = '';
      
      ffmpeg.stdout?.on('data', (data: any) => {
        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`FFmpeg stdout: ${data}`);
        }
      });
      
      ffmpeg.stderr?.on('data', (data: any) => {
        stderr += data.toString();
        if (process.env.LOG_LEVEL === 'debug') {
          console.error(`FFmpeg stderr: ${data}`);
        }
      });
      
      ffmpeg.on('close', (code: number | null) => {
        if (code === 0) {
          console.log('FFmpeg mixing completed successfully');
          resolve();
        } else {
          console.error(`FFmpeg process exited with code ${code}`);
          console.error('FFmpeg stderr:', stderr);
          reject(new Error(`FFmpeg failed with exit code ${code}`));
        }
      });
      
      ffmpeg.on('error', (error: Error) => {
        console.error('FFmpeg process error:', error);
        reject(error);
      });
    });
  }

  async listSessions(): Promise<Array<{ sessionId: string; trackCount: number; metadata: any }>> {
    const files = await fs.readdir(this.recordingsDir);
    const sessionFiles = files.filter(f => f.startsWith('session_') && f.endsWith('.json'));
    
    const sessions = [];
    
    for (const file of sessionFiles) {
      try {
        const content = await fs.readFile(join(this.recordingsDir, file), 'utf-8');
        const metadata = JSON.parse(content);
        
        // Count tracks for this session
        const sessionId = metadata.sessionId;
        const tracks = await this.loadSessionTracks(sessionId);
        
        sessions.push({
          sessionId,
          trackCount: tracks.length,
          metadata
        });
      } catch (error) {
        console.warn(`Failed to process session file ${file}:`, error);
      }
    }
    
    return sessions;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npm run mix <session_id>           - Mix a recorded session');
    console.log('  npm run mix list                   - List available sessions');
    console.log('  npm run mix files <file1> <file2>  - Mix specific metadata files');
    return;
  }
  
  const mixer = new AudioMixer();
  
  try {
    if (args[0] === 'list') {
      const sessions = await mixer.listSessions();
      
      if (sessions.length === 0) {
        console.log('No recording sessions found.');
        return;
      }
      
      console.log('Available recording sessions:');
      for (const session of sessions) {
        const date = new Date(session.metadata.startTime).toLocaleString();
        console.log(`  ${session.sessionId} - ${session.trackCount} tracks - ${date}`);
        console.log(`    Channel: ${session.metadata.channelName} (${session.metadata.guildId})`);
      }
      
    } else if (args[0] === 'files') {
      const metadataFiles = args.slice(1);
      if (metadataFiles.length === 0) {
        console.error('Please specify metadata files to mix');
        return;
      }
      
      const outputPath = await mixer.mixFiles(metadataFiles);
      console.log(`Mixed audio saved to: ${outputPath}`);
      
    } else {
      const sessionId = args[0];
      const outputPath = await mixer.mixSession(sessionId);
      console.log(`Mixed audio saved to: ${outputPath}`);
    }
    
  } catch (error) {
    console.error('Mixing failed:', error);
    process.exit(1);
  }
}

// Run CLI if this file is executed directly
if (require.main === module) {
  main();
}