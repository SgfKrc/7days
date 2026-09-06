export interface GenomeParameters {
  cX: number;
  cY: number;
  zoom: number;
  maxIterations: number;
  palette: number;
  dither: boolean;
  scanlines: boolean;
  pixelDensity: number;
  filterIntensity: number;
  chromaticAberration: boolean;
  curvature: boolean;
}

export interface GenomePreset {
  id: string;
  name: string;
  description: string;
  values: Pick<GenomeParameters, 'cX' | 'cY' | 'zoom' | 'maxIterations' | 'palette' | 'filterIntensity'>;
}

export const DEFAULT_GENOME: GenomeParameters = {
  cX: -0.745,
  cY: 0.113,
  zoom: 1.2,
  maxIterations: 96,
  palette: 0,
  dither: true,
  scanlines: true,
  pixelDensity: 0.28,
  filterIntensity: 0.72,
  chromaticAberration: true,
  curvature: true,
};

export const GENOME_PRESETS: GenomePreset[] = [
  {
    id: 'coral-reef',
    name: 'Coral reef',
    description: 'High-energy cyan and bloom colors',
    values: { cX: -0.745, cY: 0.113, zoom: 1.2, maxIterations: 96, palette: 0, filterIntensity: 0.72 },
  },
  {
    id: 'kelp-current',
    name: 'Kelp current',
    description: 'Deep water blues with a wide field',
    values: { cX: -0.16, cY: 0.64, zoom: 0.88, maxIterations: 128, palette: 1, filterIntensity: 0.58 },
  },
  {
    id: 'violet-tide',
    name: 'Violet tide',
    description: 'Dense purple detail and stronger grain',
    values: { cX: -0.58, cY: -0.22, zoom: 1.74, maxIterations: 160, palette: 2, filterIntensity: 0.84 },
  },
  {
    id: 'ember-reef',
    name: 'Ember reef',
    description: 'Warm sunset tones for a night tank',
    values: { cX: 0.12, cY: 0.18, zoom: 1.08, maxIterations: 112, palette: 3, filterIntensity: 0.66 },
  },
];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatGenomeValue(value: number, digits = 3): string {
  return value.toFixed(digits);
}

export function cloneGenome(genome: GenomeParameters): GenomeParameters {
  return { ...genome };
}

export function applyGenomePreset(genome: GenomeParameters, preset: GenomePreset): GenomeParameters {
  return { ...genome, ...preset.values };
}
