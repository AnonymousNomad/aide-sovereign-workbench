import type { GgufInfo } from './gguf.ts';

export interface FitReport {
  fileBytes: number;
  modelBytes: number;
  kvBytesPerToken: number;
  contextLength: number;
  maxContextLength: number;
  kvBytesAtContext: number;
  requiredBytes: number;
  availableBytes: number;
  fits: boolean;
  quant: string;
  recommendedQuant: string;
  parametersB: number | null;
}

export const CTX_TIERS = [32768, 16384, 8192, 4096, 2048];
export const BUFFER_MARGIN_BYTES = 1024 * 1024 * 1024;
export const FIT_HEADROOM = 0.8;

const BITS_PER_WEIGHT: Array<{ name: string; bpw: number }> = [
  { name: 'Q8_0', bpw: 8 },
  { name: 'Q6_K', bpw: 6.5625 },
  { name: 'Q5_K_M', bpw: 5.5 },
  { name: 'Q4_K_M', bpw: 4.5 },
  { name: 'Q3_K_M', bpw: 3.9 }
];

export function kvBytesPerToken(blockCount: number, headCountKv: number, headDim: number): number {
  return 2 * blockCount * headCountKv * headDim * 2;
}

export function headDimFor(info: Pick<GgufInfo, 'embeddingLength' | 'headCount'>): number {
  if (info.embeddingLength === undefined || info.headCount === undefined || info.headCount === 0) return 0;
  return Math.floor(info.embeddingLength / info.headCount);
}

export function parseParameters(sizeLabel: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*([bm])/i.exec(sizeLabel.trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  return unit === 'b' ? value * 1e9 : value * 1e6;
}

export function quantFromFileName(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const match = /[-_.](q\d(?:_[a-z0-9]+)*|iq\d(?:_[a-z0-9]+)*|f16|f32|bf16)(?:[-_.]|$)/i.exec(base);
  if (!match) return 'unknown';
  const quant = match[1]!.toUpperCase();
  return quant === 'Q8_0' || quant.startsWith('Q') || quant.startsWith('IQ') || ['F16', 'F32', 'BF16'].includes(quant) ? quant : 'unknown';
}

const FILE_TYPE_FAMILY: Record<number, string> = {
  2: 'Q4_0',
  3: 'Q4_1',
  7: 'Q8_0',
  8: 'Q5_0',
  9: 'Q5_1',
  10: 'Q2_K',
  11: 'Q3_K',
  12: 'Q4_K',
  13: 'Q5_K',
  14: 'Q6_K',
  15: 'Q4_K'
};

export function quantFor(filePath: string, fileType: number): string {
  const fromName = quantFromFileName(filePath);
  if (fromName !== 'unknown') return fromName;
  return FILE_TYPE_FAMILY[fileType] ?? 'unknown';
}

export function estimateQuantBytes(parameters: number | null, bpw: number): number | null {
  if (parameters === null) return null;
  return Math.round((parameters * bpw) / 8) * 1.15;
}

export function fitModel(info: GgufInfo, fileBytes: number, freeRamBytes: number, fileName?: string): FitReport {
  const headDim = headDimFor(info);
  const kvPerToken = headDim > 0 && info.headCountKv !== undefined && info.blockCount !== undefined
    ? kvBytesPerToken(info.blockCount, info.headCountKv, headDim)
    : 0;
  const available = Math.floor(freeRamBytes * FIT_HEADROOM);
  const maxCtx = Math.min(info.contextLength ?? 2048, CTX_TIERS[0] ?? 32768);

  let contextLength = CTX_TIERS[CTX_TIERS.length - 1] ?? 2048;
  for (const tier of CTX_TIERS) {
    if (tier > maxCtx) continue;
    if (fileBytes + kvPerToken * tier + BUFFER_MARGIN_BYTES <= available) {
      contextLength = tier;
      break;
    }
  }
  const required = fileBytes + kvPerToken * contextLength + BUFFER_MARGIN_BYTES;
  const parameters = parseParameters(info.sizeLabel ?? '');
  const recommended = pickRecommendedQuant(parameters, available);

  return {
    fileBytes,
    modelBytes: fileBytes,
    kvBytesPerToken: kvPerToken,
    contextLength,
    maxContextLength: maxCtx,
    kvBytesAtContext: kvPerToken * contextLength,
    requiredBytes: required,
    availableBytes: available,
    fits: required <= available,
    quant: quantFor(fileName ?? info.name ?? '', info.fileType ?? 0),
    recommendedQuant: recommended,
    parametersB: parameters
  };
}

function pickRecommendedQuant(parameters: number | null, availableBytes: number): string {
  if (parameters === null) return 'Q4_K_M';
  for (const { name, bpw } of BITS_PER_WEIGHT) {
    const estimate = estimateQuantBytes(parameters, bpw);
    if (estimate !== null && estimate + BUFFER_MARGIN_BYTES <= availableBytes) return name;
  }
  return 'Q4_K_M';
}