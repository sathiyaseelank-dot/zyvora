/**
 * Zero-dependency pure TypeScript QR Code Generator (ISO/IEC 18004).
 *
 * Implements Byte-mode encoding with Reed-Solomon error correction (EC Level M)
 * and produces a boolean 2D matrix suitable for direct SVG or Canvas rendering.
 */

// GF(256) arithmetic with primitive polynomial 0x11D (x^8 + x^4 + x^3 + x^2 + 1)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  LOG_TABLE[0] = 0;
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

// Reed-Solomon generator polynomials cache
const RS_GENERATORS: Record<number, Uint8Array> = {};

function getRsGenerator(degree: number): Uint8Array {
  if (RS_GENERATORS[degree]) return RS_GENERATORS[degree];
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = EXP_TABLE[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], factor);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  RS_GENERATORS[degree] = poly;
  return poly;
}

function rsCompute(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = getRsGenerator(ecCount);
  const remainder = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecCount - 1] = 0;
    for (let j = 0; j < ecCount; j++) {
      remainder[j] ^= gfMul(gen[j], factor);
    }
  }
  return remainder;
}

// Version table for EC Level M (Medium - 15% recovery)
// [version, totalCodewords, ecCodewordsPerBlock, numBlocksGroup1, dataPerBlockG1, numBlocksG2, dataPerBlockG2, [alignPos]]
interface VersionInfo {
  version: number;
  totalDataCodewords: number;
  ecPerBlock: number;
  b1: number;
  d1: number;
  b2: number;
  d2: number;
  align: number[];
}

const VERSIONS: VersionInfo[] = [
  {
    version: 1,
    totalDataCodewords: 16,
    ecPerBlock: 10,
    b1: 1,
    d1: 16,
    b2: 0,
    d2: 0,
    align: [],
  },
  {
    version: 2,
    totalDataCodewords: 28,
    ecPerBlock: 16,
    b1: 1,
    d1: 28,
    b2: 0,
    d2: 0,
    align: [6, 18],
  },
  {
    version: 3,
    totalDataCodewords: 44,
    ecPerBlock: 26,
    b1: 1,
    d1: 44,
    b2: 0,
    d2: 0,
    align: [6, 22],
  },
  {
    version: 4,
    totalDataCodewords: 64,
    ecPerBlock: 18,
    b1: 2,
    d1: 32,
    b2: 0,
    d2: 0,
    align: [6, 26],
  },
  {
    version: 5,
    totalDataCodewords: 86,
    ecPerBlock: 24,
    b1: 2,
    d1: 43,
    b2: 0,
    d2: 0,
    align: [6, 30],
  },
  {
    version: 6,
    totalDataCodewords: 108,
    ecPerBlock: 16,
    b1: 4,
    d1: 27,
    b2: 0,
    d2: 0,
    align: [6, 34],
  },
  {
    version: 7,
    totalDataCodewords: 124,
    ecPerBlock: 18,
    b1: 4,
    d1: 31,
    b2: 0,
    d2: 0,
    align: [6, 22, 38],
  },
  {
    version: 8,
    totalDataCodewords: 154,
    ecPerBlock: 22,
    b1: 2,
    d1: 38,
    b2: 2,
    d2: 39,
    align: [6, 24, 42],
  },
];

export function generateQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const dataLen = bytes.length;

  // Pick suitable version
  const vi = VERSIONS.find((v) => v.totalDataCodewords >= dataLen + 3);
  if (!vi) {
    throw new Error('Text too long for QR generator');
  }

  // 1. Data bitstream (Byte mode = 0100)
  const bitstream: number[] = [0, 1, 0, 0];
  // 8-bit character count indicator for versions 1-9
  for (let i = 7; i >= 0; i--) {
    bitstream.push((dataLen >> i) & 1);
  }
  // Data bytes
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) {
      bitstream.push((b >> i) & 1);
    }
  }

  // Terminator (up to 4 zeroes)
  const totalBits = vi.totalDataCodewords * 8;
  const padZeros = Math.min(4, totalBits - bitstream.length);
  for (let i = 0; i < padZeros; i++) bitstream.push(0);

  // Pad to multiple of 8
  while (bitstream.length % 8 !== 0) bitstream.push(0);

  // Convert to codewords
  const dataCodewords = new Uint8Array(vi.totalDataCodewords);
  let byteIdx = 0;
  for (let i = 0; i < bitstream.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) {
      val = (val << 1) | bitstream[i + j];
    }
    dataCodewords[byteIdx++] = val;
  }

  // Pad with alternating 0xEC, 0x11
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (byteIdx < vi.totalDataCodewords) {
    dataCodewords[byteIdx++] = padBytes[p % 2];
    p++;
  }

  // 2. Block partition and Reed-Solomon error correction
  const blocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < vi.b1; i++) {
    const b = dataCodewords.slice(offset, offset + vi.d1);
    offset += vi.d1;
    blocks.push(b);
    ecBlocks.push(rsCompute(b, vi.ecPerBlock));
  }
  for (let i = 0; i < vi.b2; i++) {
    const b = dataCodewords.slice(offset, offset + vi.d2);
    offset += vi.d2;
    blocks.push(b);
    ecBlocks.push(rsCompute(b, vi.ecPerBlock));
  }

  // Interleave data codewords
  const finalCodewords: number[] = [];
  const maxDataLen = Math.max(vi.d1, vi.d2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocks) {
      if (i < b.length) finalCodewords.push(b[i]);
    }
  }
  // Interleave EC codewords
  for (let i = 0; i < vi.ecPerBlock; i++) {
    for (const ec of ecBlocks) {
      finalCodewords.push(ec[i]);
    }
  }

  // 3. Matrix generation
  const size = vi.version * 4 + 17;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null),
  );

  function fillRect(r: number, c: number, w: number, h: number, val: boolean) {
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        if (r + i >= 0 && r + i < size && c + j >= 0 && c + j < size) {
          matrix[r + i][c + j] = val;
        }
      }
    }
  }

  // Finder pattern (7x7) + separator (8x8)
  function placeFinder(row: number, col: number) {
    fillRect(row - 1, col - 1, 9, 9, false);
    fillRect(row, col, 7, 7, true);
    fillRect(row + 1, col + 1, 5, 5, false);
    fillRect(row + 2, col + 2, 3, 3, true);
  }

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const val = i % 2 === 0;
    if (matrix[6][i] === null) matrix[6][i] = val;
    if (matrix[i][6] === null) matrix[i][6] = val;
  }

  // Alignment patterns
  if (vi.align.length > 0) {
    for (const r of vi.align) {
      for (const c of vi.align) {
        if (matrix[r][c] !== null) continue;
        fillRect(r - 2, c - 2, 5, 5, true);
        fillRect(r - 1, c - 1, 3, 3, false);
        matrix[r][c] = true;
      }
    }
  }

  // Dark module
  matrix[size - 8][8] = true;

  // Format info area reservation (dummy placeholder)
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false;
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false;
  }

  // 4. Data bit placement in 2-column zig-zag
  const allBits: number[] = [];
  for (const cw of finalCodewords) {
    for (let i = 7; i >= 0; i--) {
      allBits.push((cw >> i) & 1);
    }
  }

  let bitPtr = 0;
  let dir = -1; // up
  let col = size - 1;

  while (col > 0) {
    if (col === 6) col--; // skip vertical timing line
    const rows =
      dir === -1
        ? Array.from({ length: size }, (_, i) => size - 1 - i)
        : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (const c of [col, col - 1]) {
        if (matrix[r][c] === null) {
          const bit = bitPtr < allBits.length ? allBits[bitPtr++] : 0;
          // Apply mask 0: (row + col) % 2 === 0
          const mask = (r + c) % 2 === 0;
          matrix[r][c] = (bit === 1) !== mask;
        }
      }
    }
    col -= 2;
    dir = -dir;
  }

  // 5. Format info: EC Level M (00) + Mask 0 (000) = 0b00000 -> BCH code = 0b000001010011001 ^ 0x5412 = 0x5412
  // Format bits for Level M, Mask 0: 0x5412 (101010000010010)
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];

  // Write format info
  for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i] === 1;
  matrix[8][7] = formatBits[6] === 1;
  matrix[8][8] = formatBits[7] === 1;
  matrix[7][8] = formatBits[8] === 1;
  for (let i = 0; i < 6; i++) matrix[5 - i][8] = formatBits[9 + i] === 1;

  for (let i = 0; i < 7; i++) matrix[size - 1 - i][8] = formatBits[i] === 1;
  for (let i = 0; i < 8; i++) matrix[8][size - 8 + i] = formatBits[7 + i] === 1;

  return matrix.map((row) => row.map((cell) => cell ?? false));
}

/**
 * Generate a standalone SVG string representation of a QR code.
 */
export function generateQrSvg(
  text: string,
  options?: {
    margin?: number;
    darkColor?: string;
    lightColor?: string;
  },
): string {
  const margin = options?.margin ?? 2;
  const darkColor = options?.darkColor ?? '#0f172a';
  const lightColor = options?.lightColor ?? '#ffffff';
  const matrix = generateQrMatrix(text);
  const size = matrix.length;
  const total = size + margin * 2;
  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="${darkColor}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${lightColor}"/>${rects}</svg>`;
}
