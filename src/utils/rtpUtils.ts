import { RtpHeader } from './types';

export function parseRtpHeader(buffer: Buffer): RtpHeader {
  if (buffer.length < 12) {
    throw new Error('Buffer too small for RTP header');
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  
  const version = (firstByte >> 6) & 0b11;
  const padding = ((firstByte >> 5) & 0b1) === 1;
  const extension = ((firstByte >> 4) & 0b1) === 1;
  const csrcCount = firstByte & 0b1111;
  
  const marker = ((secondByte >> 7) & 0b1) === 1;
  const payloadType = secondByte & 0b1111111;
  
  const sequenceNumber = buffer.readUInt16BE(2);
  const timestamp = buffer.readUInt32BE(4);
  const ssrc = buffer.readUInt32BE(8);

  return {
    version,
    padding,
    extension,
    csrcCount,
    marker,
    payloadType,
    sequenceNumber,
    timestamp,
    ssrc
  };
}

export function extractOpusPayload(buffer: Buffer): Buffer {
  const header = parseRtpHeader(buffer);
  let payloadStart = 12;
  
  // Skip CSRC list if present
  if (header.csrcCount > 0) {
    payloadStart += header.csrcCount * 4;
  }
  
  // Skip extension if present
  if (header.extension) {
    if (buffer.length < payloadStart + 4) {
      throw new Error('Buffer too small for RTP extension header');
    }
    const extensionLength = buffer.readUInt16BE(payloadStart + 2);
    payloadStart += 4 + (extensionLength * 4);
  }
  
  return buffer.slice(payloadStart);
}

export function hrtimeToMs(hrtime: [number, number]): number {
  return (hrtime[0] * 1e9 + hrtime[1]) / 1e6;
}

export function calculateExpectedTimestamp(
  firstTimestamp: number,
  firstTime: number,
  currentTime: number,
  sampleRate: number = 48000
): number {
  const elapsedMs = currentTime - firstTime;
  const expectedSamples = Math.round((elapsedMs / 1000) * sampleRate);
  return firstTimestamp + expectedSamples;
}