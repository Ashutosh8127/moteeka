/**
 * Pixel dimensions straight from the file header, for JPEG, PNG and WebP.
 *
 * Needed because a supplier page mixes 1200×1200 product photographs with
 * 250×169 badges and trust seals, and the only reliable way to tell them apart
 * is to look at the size. No decoding, no dependency — every one of these
 * formats states its dimensions in the first few dozen bytes.
 */
export interface Size { width: number; height: number }

export function imageSize(buf: Buffer): Size | null {
  if (buf.length < 24) return null;

  // PNG: IHDR is always the first chunk.
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // WebP: three sub-formats, each storing the size differently.
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    const kind = buf.subarray(12, 16).toString('latin1');
    if (kind === 'VP8X') {
      return { width: read24(buf, 24) + 1, height: read24(buf, 27) + 1 };
    }
    if (kind === 'VP8L') {
      const n = buf.readUInt32LE(21);
      return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    return null;
  }

  // JPEG: walk the segment markers to the start-of-frame.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1]!;
      // SOF0-SOF15, excluding the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function read24(buf: Buffer, at: number): number {
  return buf[at]! | (buf[at + 1]! << 8) | (buf[at + 2]! << 16);
}
