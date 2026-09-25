import { describe, it, expect } from 'vitest';
import { recommendModelsForSystem, SystemSpecs } from './modelRecommender';

describe('modelRecommender', () => {
  it('correctly assesses capable mid-tier system with integrated GPU (16GB RAM, 12 Cores)', () => {
    const specs: SystemSpecs = {
      total_ram_gb: 15.3,
      cpu_cores: 12,
      gpu_type: 'intel',
      gpu_name: 'Intel Iris Xe Graphics',
      is_discrete_gpu: false,
    };

    const res = recommendModelsForSystem(specs);
    expect(res.hardwareTier).toBe('capable');
    expect(res.modelNames).toEqual(['small', 'large-v3-turbo', 'base-q8_0']);
    expect(res.models.balanced.modelName).toBe('small');
    expect(res.models.balanced.reasonI18nKey).toBe('models.recReasonBalancedCapable');
    expect(res.models.quality.modelName).toBe('large-v3-turbo');
    expect(res.models.fast.modelName).toBe('base-q8_0');
    expect(res.models.quality.reasonI18nKey).toBe('models.recReasonQualityTurbo');
  });

  it('handles low-end entry level systems (< 5GB RAM or 2-core CPU)', () => {
    const specs: SystemSpecs = {
      total_ram_gb: 3.8,
      cpu_cores: 2,
      gpu_type: 'unknown',
      gpu_name: 'CPU Only',
      is_discrete_gpu: false,
    };

    const res = recommendModelsForSystem(specs);
    expect(res.hardwareTier).toBe('entry');
    expect(res.modelNames).toEqual(['base-q8_0', 'small-q5_1', 'tiny-q5_1']);
    expect(res.models.balanced.modelName).toBe('base-q8_0');
    expect(res.models.quality.modelName).toBe('small-q5_1');
    expect(res.models.fast.modelName).toBe('tiny-q5_1');
  });

  it('handles budget 8GB systems with integrated GPU', () => {
    const specs: SystemSpecs = {
      total_ram_gb: 7.8,
      cpu_cores: 6,
      gpu_type: 'intel',
      gpu_name: 'Intel UHD Graphics',
      is_discrete_gpu: false,
    };

    const res = recommendModelsForSystem(specs);
    expect(res.hardwareTier).toBe('budget');
    expect(res.modelNames).toEqual(['small-q8_0', 'large-v3-turbo-q5_0', 'base-q8_0']);
    expect(res.models.balanced.modelName).toBe('small-q8_0');
    expect(res.models.quality.modelName).toBe('large-v3-turbo-q5_0');
  });

  it('handles high-end workstation with NVIDIA CUDA', () => {
    const specs: SystemSpecs = {
      total_ram_gb: 32.0,
      cpu_cores: 16,
      gpu_type: 'nvidia',
      gpu_name: 'NVIDIA GeForce RTX 4080',
      is_discrete_gpu: true,
    };

    const res = recommendModelsForSystem(specs);
    expect(res.hardwareTier).toBe('workstation');
    expect(res.modelNames).toEqual(['large-v3-turbo', 'large-v3', 'small-q5_1']);
    expect(res.models.quality.modelName).toBe('large-v3');
    expect(res.models.balanced.modelName).toBe('large-v3-turbo');
  });

  it('handles Apple Silicon unified memory', () => {
    const specs: SystemSpecs = {
      total_ram_gb: 16.0,
      cpu_cores: 10,
      gpu_type: 'apple_silicon',
      gpu_name: 'Apple M2 Pro',
      is_discrete_gpu: false,
    };

    const res = recommendModelsForSystem(specs);
    expect(res.hardwareTier).toBe('workstation');
    expect(res.models.balanced.modelName).toBe('large-v3-turbo');
    expect(res.models.quality.modelName).toBe('large-v3');
    expect(res.models.fast.modelName).toBe('small');
  });

  it('switches to English-optimized models when isEnglishOnly option is provided', () => {
    const specs: SystemSpecs = {
      total_ram_gb: 16.0,
      cpu_cores: 8,
      gpu_type: 'amd',
      gpu_name: 'AMD Radeon Graphics',
      is_discrete_gpu: false,
    };

    const res = recommendModelsForSystem(specs, { isEnglishOnly: true });
    expect(res.models.balanced.modelName).toBe('small.en');
    expect(res.models.quality.modelName).toBe('large-v3-turbo'); // large-v3-turbo is unified multi/en
    expect(res.models.fast.modelName).toBe('base.en-q8_0');
  });

  it('gracefully handles null, undefined, or empty specs with sensible defaults', () => {
    const resNull = recommendModelsForSystem(null);
    expect(resNull.modelNames.length).toBe(3);
    expect(resNull.hardwareTier).toBe('budget');

    const resUndefined = recommendModelsForSystem(undefined);
    expect(resUndefined.modelNames.length).toBe(3);

    const resEmpty = recommendModelsForSystem({} as SystemSpecs);
    expect(resEmpty.modelNames.length).toBe(3);
  });
});
