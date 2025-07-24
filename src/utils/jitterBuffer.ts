import { JitterBufferPacket } from './types';

export class JitterBuffer {
  private readonly TARGET_DELAY_MS = 150;
  private readonly MAX_JITTER_MS = 60;
  private readonly SAMPLE_RATE = 48000;
  private readonly FRAME_DURATION_MS = 20;
  
  private packetQueue: JitterBufferPacket[] = [];
  private lastFlushTime = 0;
  private expectedSequence = 0;
  private isInitialized = false;

  bufferPacket(packet: JitterBufferPacket): void {
    this.packetQueue.push({
      ...packet,
      bufferedAt: Date.now()
    });
    
    // Initialize sequence tracking on first packet
    if (!this.isInitialized) {
      this.expectedSequence = packet.sequence;
      this.isInitialized = true;
    }
    
    // Sort by sequence number to handle reordering
    this.packetQueue.sort((a, b) => a.sequence - b.sequence);
  }

  shouldFlush(currentTime: number = Date.now()): boolean {
    if (this.packetQueue.length === 0) return false;
    
    const oldestPacket = this.packetQueue[0];
    const bufferDelay = currentTime - oldestPacket.bufferedAt;
    
    // Flush if buffer delay exceeds target or on timer interval
    return bufferDelay >= this.TARGET_DELAY_MS || 
           (currentTime - this.lastFlushTime) >= this.FRAME_DURATION_MS;
  }

  flush(): JitterBufferPacket[] {
    if (!this.shouldFlush()) {
      return [];
    }

    const packetsToFlush: JitterBufferPacket[] = [];
    this.lastFlushTime = Date.now();
    
    // Determine how many packets we should have received by now
    const currentTime = Date.now();
    const oldestTime = this.packetQueue.length > 0 ? this.packetQueue[0].bufferedAt : currentTime;
    const timeSpan = currentTime - oldestTime;
    const expectedPackets = Math.max(1, Math.floor(timeSpan / this.FRAME_DURATION_MS));
    
    // Process packets up to expected count
    for (let i = 0; i < expectedPackets && this.packetQueue.length > 0; i++) {
      const expectedSeq = this.expectedSequence + i;
      const packetIndex = this.packetQueue.findIndex(p => p.sequence === expectedSeq);
      
      if (packetIndex >= 0) {
        // Found the expected packet
        packetsToFlush.push(this.packetQueue.splice(packetIndex, 1)[0]);
      } else {
        // Packet is missing, create silence
        packetsToFlush.push(this.createSilencePacket(expectedSeq));
      }
    }
    
    this.expectedSequence += expectedPackets;
    return packetsToFlush;
  }

  private createSilencePacket(sequence: number): JitterBufferPacket {
    // Create a minimal Opus silence frame (20ms of silence)
    const silenceFrame = Buffer.from([0xF8, 0xFF, 0xFE]); // Opus silence frame
    
    return {
      data: silenceFrame,
      sequence,
      timestamp: 0, // Will be calculated properly in the caller
      bufferedAt: Date.now()
    };
  }

  getQueueLength(): number {
    return this.packetQueue.length;
  }

  clear(): void {
    this.packetQueue = [];
    this.lastFlushTime = 0;
    this.expectedSequence = 0;
    this.isInitialized = false;
  }
}