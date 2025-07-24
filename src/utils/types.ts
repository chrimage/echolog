export interface RtpHeader {
  version: number;
  padding: boolean;
  extension: boolean;
  csrcCount: number;
  marker: boolean;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
}

export interface AudioPacket {
  data: Buffer;
  sequence: number;
  timestamp: number;
  arrivalTime: number;
  userId: string;
  drift?: number;
}

export interface UserTimeline {
  userId: string;
  ssrc: number;
  firstPacketTime: number;
  lastSequence: number;
  timestampOffset: number;
  packets: AudioPacket[];
}

export interface TrackMetadata {
  userId: string;
  ssrc: number;
  startTimeRTP: number;
  startTimeHR: [number, number];
  opusSampleRate: number;
  pcmSampleRate: number;
  filename: string;
}

export interface JitterBufferPacket {
  data: Buffer;
  sequence: number;
  timestamp: number;
  bufferedAt: number;
}

export interface DriftInfo {
  driftMs: number;
  confidence: number;
  samplesAnalyzed: number;
}