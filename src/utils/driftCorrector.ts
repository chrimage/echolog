import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import ffmpegStatic = require('ffmpeg-static');

import { UserTimeline, DriftInfo, TrackMetadata } from './types';
import { hrtimeToMs } from './rtpUtils';

const FFMPEG_PATH = (ffmpegStatic as unknown as string) || 'ffmpeg';

export class DriftCorrector {
  private readonly DRIFT_THRESHOLD_MS = 10;
  private readonly CORRECTION_INTERVAL = 30000; // 30 seconds
  private readonly MIN_SAMPLES_FOR_ANALYSIS = 100;

  detectDrift(timeline: UserTimeline): DriftInfo {
    const packets = timeline.packets;
    
    if (packets.length < this.MIN_SAMPLES_FOR_ANALYSIS) {
      return { 
        driftMs: 0, 
        confidence: 0, 
        samplesAnalyzed: packets.length 
      };
    }

    // Use linear regression to detect drift trend
    const regression = this.calculateLinearRegression(
      packets.map(p => p.arrivalTime),
      packets.map(p => p.timestamp / 48) // Convert RTP timestamp to ms
    );

    // Drift = difference from expected 1:1 ratio
    const driftRatio = regression.slope - 1.0;
    const driftMs = driftRatio * 1000; // ms per second

    return {
      driftMs,
      confidence: regression.r2,
      samplesAnalyzed: packets.length
    };
  }

  private calculateLinearRegression(xValues: number[], yValues: number[]): {
    slope: number;
    intercept: number;
    r2: number;
  } {
    const n = xValues.length;
    
    if (n < 2) {
      return { slope: 1, intercept: 0, r2: 0 };
    }

    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);
    const sumYY = yValues.reduce((sum, y) => sum + y * y, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const meanY = sumY / n;
    const ssRes = yValues.reduce((sum, y, i) => {
      const predicted = slope * xValues[i] + intercept;
      return sum + Math.pow(y - predicted, 2);
    }, 0);
    const ssTot = yValues.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
    const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);

    return { slope, intercept, r2 };
  }

  async correctDrift(inputFile: string, driftMs: number, outputDir: string): Promise<string> {
    if (Math.abs(driftMs) < this.DRIFT_THRESHOLD_MS) {
      console.log(`Drift ${driftMs.toFixed(2)}ms is below threshold, no correction needed`);
      return inputFile; // No correction needed
    }

    console.log(`Correcting drift of ${driftMs.toFixed(2)}ms for file ${inputFile}`);

    // Calculate stretch factor
    // Positive drift means the track is running slow (needs to be sped up)
    // Negative drift means the track is running fast (needs to be slowed down)
    const stretchFactor = 1.0 - (driftMs / 1000);
    
    // Clamp stretch factor to reasonable bounds
    const clampedFactor = Math.max(0.95, Math.min(1.05, stretchFactor));
    
    if (clampedFactor !== stretchFactor) {
      console.warn(`Stretch factor ${stretchFactor} clamped to ${clampedFactor}`);
    }

    const outputFile = join(outputDir, `corrected_${Date.now()}.pcm`);

    const args = [
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      '-i', inputFile,
      '-filter:a', `atempo=${clampedFactor}`,
      '-f', 's16le',
      '-y', outputFile
    ];

    await this.executeFFmpeg(args);
    console.log(`Drift correction completed: ${outputFile}`);
    
    return outputFile;
  }

  async analyzeAndCorrectSession(
    tracks: TrackMetadata[], 
    recordingsDir: string
  ): Promise<Map<string, string>> {
    const correctedFiles = new Map<string, string>();
    
    console.log(`Analyzing drift for ${tracks.length} tracks...`);

    for (const track of tracks) {
      try {
        // For now, we'll estimate drift based on the metadata
        // In a full implementation, we'd analyze the actual audio packets
        const driftInfo = await this.estimateDriftFromMetadata(track, recordingsDir);
        
        if (Math.abs(driftInfo.driftMs) >= this.DRIFT_THRESHOLD_MS && driftInfo.confidence > 0.7) {
          console.log(`Detected significant drift for user ${track.userId}: ${driftInfo.driftMs.toFixed(2)}ms`);
          
          const inputPath = join(recordingsDir, track.filename);
          const correctedPath = await this.correctDrift(inputPath, driftInfo.driftMs, recordingsDir);
          correctedFiles.set(track.userId, correctedPath);
        } else {
          console.log(`No significant drift detected for user ${track.userId}`);
          correctedFiles.set(track.userId, join(recordingsDir, track.filename));
        }
        
      } catch (error) {
        console.error(`Failed to analyze drift for user ${track.userId}:`, error);
        // Use original file if correction fails
        correctedFiles.set(track.userId, join(recordingsDir, track.filename));
      }
    }

    return correctedFiles;
  }

  private async estimateDriftFromMetadata(
    track: TrackMetadata, 
    recordingsDir: string
  ): Promise<DriftInfo> {
    try {
      // Get file stats to estimate actual duration
      const filePath = join(recordingsDir, track.filename);
      const stats = await fs.stat(filePath);
      
      // Calculate expected duration from sample rate and file size
      // PCM s16le stereo: 4 bytes per sample (2 bytes * 2 channels)
      const bytesPerSecond = track.pcmSampleRate * 4;
      const actualDurationMs = (stats.size / bytesPerSecond) * 1000;
      
      // For a more sophisticated analysis, we could:
      // 1. Parse the actual RTP timestamps from stored metadata
      // 2. Compare against system timestamps
      // 3. Look for patterns in packet timing
      
      // For now, we'll do a simple check based on file size vs expected duration
      // This is a placeholder for more sophisticated drift detection
      
      const currentTime = Date.now();
      const trackStartTime = hrtimeToMs(track.startTimeHR);
      const expectedDurationMs = currentTime - trackStartTime;
      
      const driftMs = actualDurationMs - expectedDurationMs;
      const confidence = Math.min(1.0, Math.abs(driftMs) / 100); // Rough confidence estimate
      
      return {
        driftMs: Math.abs(driftMs) > 1000 ? 0 : driftMs, // Ignore huge discrepancies
        confidence,
        samplesAnalyzed: Math.floor(actualDurationMs / 20) // Estimate packet count
      };
      
    } catch (error) {
      console.warn(`Failed to estimate drift for ${track.filename}:`, error);
      return { driftMs: 0, confidence: 0, samplesAnalyzed: 0 };
    }
  }

  private executeFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`Executing FFmpeg for drift correction: ${FFMPEG_PATH} ${args.join(' ')}`);
      
      const ffmpeg: ChildProcess = spawn(FFMPEG_PATH, args);
      
      let stderr = '';
      
      ffmpeg.stderr?.on('data', (data: any) => {
        stderr += data.toString();
      });
      
      ffmpeg.on('close', (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          console.error(`FFmpeg drift correction failed with code ${code}`);
          console.error('Stderr:', stderr);
          reject(new Error(`FFmpeg failed with exit code ${code}`));
        }
      });
      
      ffmpeg.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  // Real-time drift monitoring for active sessions
  monitorDrift(timeline: UserTimeline, callback: (driftInfo: DriftInfo) => void): () => void {
    const interval = setInterval(() => {
      if (timeline.packets.length < this.MIN_SAMPLES_FOR_ANALYSIS) {
        return;
      }

      const driftInfo = this.detectDrift(timeline);
      
      if (Math.abs(driftInfo.driftMs) >= this.DRIFT_THRESHOLD_MS && driftInfo.confidence > 0.5) {
        callback(driftInfo);
      }
    }, this.CORRECTION_INTERVAL);

    // Return cleanup function
    return () => clearInterval(interval);
  }

  // Utility method to validate audio file integrity
  async validateAudioFile(filePath: string): Promise<{
    isValid: boolean;
    duration: number;
    sampleRate: number;
    channels: number;
  }> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', filePath,
        '-f', 'null',
        '-'
      ];

      const ffmpeg: ChildProcess = spawn(FFMPEG_PATH, args);
      let stderr = '';

      ffmpeg.stderr?.on('data', (data: any) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code: number | null) => {
        try {
          // Parse FFmpeg output for audio information
          const durationMatch = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
          const streamMatch = stderr.match(/Stream.*Audio.*?(\d+) Hz.*?(\d+) channels/);

          if (durationMatch && streamMatch) {
            const hours = parseInt(durationMatch[1]);
            const minutes = parseInt(durationMatch[2]);
            const seconds = parseFloat(durationMatch[3]);
            const duration = hours * 3600 + minutes * 60 + seconds;

            resolve({
              isValid: code === 0,
              duration,
              sampleRate: parseInt(streamMatch[1]),
              channels: parseInt(streamMatch[2])
            });
          } else {
            resolve({
              isValid: false,
              duration: 0,
              sampleRate: 0,
              channels: 0
            });
          }
        } catch (error) {
          reject(error);
        }
      });

      ffmpeg.on('error', (error: Error) => {
        reject(error);
      });
    });
  }
}