/**
 * Pure TypeScript GIF89a encoder — no external dependencies.
 * Uses LZW compression + 6×6×6 color cube quantization.
 */

/** Maximum number of frames captured into the frame buffer and encoded into GIF. */
export const MAX_GIF_FRAMES = 60;

// 6×6×6 = 216 colors; remaining 40 slots stay black (already 0)
function buildPalette(): Uint8Array {
  const pal = new Uint8Array(256 * 3);
  let i = 0;
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        pal[i * 3]     = Math.round(r * 255 / 5);
        pal[i * 3 + 1] = Math.round(g * 255 / 5);
        pal[i * 3 + 2] = Math.round(b * 255 / 5);
        i++;
      }
    }
  }
  return pal;
}

function quantizePixel(r: number, g: number, b: number): number {
  return Math.round(r / 51) * 36 + Math.round(g / 51) * 6 + Math.round(b / 51);
}

/**
 * GIF LZW encoder. Returns raw code bytes (not yet wrapped in sub-blocks).
 * minCodeSize is 8 for a 256-color palette.
 *
 * Uses numeric Map keys (prefixCode << 8 | pixelByte) instead of string
 * concatenation to avoid repeated heap allocations per pixel.
 */
function lzwEncode(pixels: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;   // 256
  const eoiCode   = clearCode + 1;      // 257

  const bytes: number[] = [];
  let bitBuf = 0;
  let bitLen = 0;

  // Initialize with placeholder values; reset() sets the real ones before use.
  // Keys encode (prefixCode << 8) | nextByte; max key = (4095 << 8)|255 = 1,048,319.
  let table: Map<number, number> = new Map();
  let nextCode = 0;
  let codeSize = 0;

  const reset = () => {
    table = new Map();
    nextCode = clearCode + 2; // skip clearCode and eoiCode slots
    codeSize = minCodeSize + 1;
  };

  const emit = (code: number) => {
    bitBuf |= (code << bitLen);
    bitLen += codeSize;
    while (bitLen >= 8) {
      bytes.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitLen -= 8;
    }
  };

  reset();
  emit(clearCode);

  if (pixels.length === 0) {
    emit(eoiCode);
    if (bitLen > 0) bytes.push(bitBuf & 0xff);
    return bytes;
  }

  // prefixCode is the LZW code for the current match prefix.
  // For single bytes it equals the byte value (implicit in the standard table);
  // for compound sequences it is the code assigned when the sequence was first seen.
  let prefixCode = pixels[0];

  for (let i = 1; i < pixels.length; i++) {
    const byte = pixels[i];
    const key  = (prefixCode << 8) | byte;
    const found = table.get(key);
    if (found !== undefined) {
      prefixCode = found;
    } else {
      emit(prefixCode);
      if (nextCode < 4096) {
        table.set(key, nextCode++);
        if (nextCode >= (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        emit(clearCode);
        reset();
      }
      prefixCode = byte;
    }
  }

  emit(prefixCode);
  emit(eoiCode);
  if (bitLen > 0) bytes.push(bitBuf & 0xff);

  return bytes;
}

async function svgToIndexedPixels(
  svgStr: string,
  width: number,
  height: number,
  ctx: CanvasRenderingContext2D,
): Promise<Uint8Array> {
  const blob = new Blob([svgStr], { type: "image/svg+xml" });
  const url  = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src   = url;
    await new Promise<void>((resolve, reject) => {
      img.onload  = () => resolve();
      img.onerror = () => reject(new Error("SVG load failed"));
    });

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);
    const indexed  = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      indexed[i] = quantizePixel(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    }
    return indexed;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Encode an array of serialised SVG strings as an animated GIF.
 * Returns a blob: URL that the caller should revoke after use.
 */
export async function encodeSvgFramesToGif(
  frames: string[],
  viewport: { width: number; height: number },
  fps = 8,
): Promise<string> {
  // Scale to max 512 px wide, preserving viewport aspect ratio
  const scale  = Math.min(1, 512 / Math.max(viewport.width, 1));
  const width  = Math.max(2, Math.round(viewport.width  * scale));
  const height = Math.max(2, Math.round(viewport.height * scale));

  // Validate fps to ensure we don't produce an invalid frame delay
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`Invalid fps value: ${fps}. Expected a finite, positive number.`);
  }
  // GIF frame delay is an unsigned 16-bit field (centiseconds); clamp to [1, 65535]
  const delay  = Math.min(65535, Math.max(1, Math.round(100 / fps)));

  const palette = buildPalette();

  // Create a single reusable canvas for all frame rasterizations.
  const canvas = document.createElement("canvas");
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D canvas context");

  // Render frames (skip broken ones)
  const renderedFrames: Uint8Array[] = [];
  const limit = Math.min(frames.length, MAX_GIF_FRAMES);
  for (let f = 0; f < limit; f++) {
    try {
      renderedFrames.push(await svgToIndexedPixels(frames[f], width, height, ctx));
    } catch {
      // skip
    }
  }

  if (renderedFrames.length === 0) throw new Error("No frames to encode");

  const buf: number[] = [];

  // GIF89a header
  for (const c of "GIF89a") buf.push(c.charCodeAt(0));

  // Logical Screen Descriptor
  buf.push(width  & 0xff, (width  >> 8) & 0xff);
  buf.push(height & 0xff, (height >> 8) & 0xff);
  buf.push(0xF7); // GCT flag + 256 colors (color resolution 8, GCT size 7)
  buf.push(0);    // background color index
  buf.push(0);    // pixel aspect ratio

  // Global Color Table (256 × 3 bytes)
  for (let i = 0; i < 256 * 3; i++) buf.push(palette[i]);

  // Netscape Application Extension (infinite loop)
  buf.push(0x21, 0xFF, 0x0B);
  for (const c of "NETSCAPE2.0") buf.push(c.charCodeAt(0));
  buf.push(0x03, 0x01, 0x00, 0x00, 0x00); // sub-block + loop-count LE + terminator

  for (const indexed of renderedFrames) {
    // Graphic Control Extension
    buf.push(0x21, 0xF9, 0x04);
    buf.push(0x00);                              // disposal=0, no transparency
    buf.push(delay & 0xff, (delay >> 8) & 0xff); // delay in centiseconds
    buf.push(0x00, 0x00);                        // transparent idx + block terminator

    // Image Descriptor
    buf.push(0x2C);
    buf.push(0, 0, 0, 0);                        // left=0, top=0
    buf.push(width  & 0xff, (width  >> 8) & 0xff);
    buf.push(height & 0xff, (height >> 8) & 0xff);
    buf.push(0x00);                              // no local color table, not interlaced

    // LZW image data
    const minCodeSize = 8;
    buf.push(minCodeSize);
    const encoded = lzwEncode(indexed, minCodeSize);
    let offset = 0;
    while (offset < encoded.length) {
      const blockSize = Math.min(255, encoded.length - offset);
      buf.push(blockSize);
      for (let i = 0; i < blockSize; i++) buf.push(encoded[offset + i]);
      offset += blockSize;
    }
    buf.push(0x00); // block terminator
  }

  // GIF Trailer
  buf.push(0x3B);

  return URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: "image/gif" }));
}
