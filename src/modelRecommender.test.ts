import { describe, it, expect } from 'vitest';
import { recommendModelsForSystem, SystemSpecs } from './modelRecommender';

describe('modelRecommender (5 Dedicated Roles)', () => {
  describe('Hardware Tiers and Unique Role Assignments', () => {
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
      expect(res.modelNames).toEqual(['base', 'small-q5_1', 'tiny-q5_1', 'base.en-q8_0', 'base-q8_0']);
      expect(new Set(res.modelNames).size).toBe(5);

      expect(res.models.balanced.modelName).toBe('base');
      expect(res.models.quality.modelName).toBe('small-q5_1');
      expect(res.models.fast.modelName).toBe('tiny-q5_1');
      expect(res.models.english.modelName).toBe('base.en-q8_0');
      expect(res.models.quantized.modelName).toBe('base-q8_0');
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
      expect(res.modelNames).toEqual(['small', 'large-v3-turbo-q5_0', 'base-q8_0', 'medium.en-q5_0', 'small-q8_0']);
      expect(new Set(res.modelNames).size).toBe(5);

      expect(res.models.balanced.modelName).toBe('small');
      expect(res.models.quality.modelName).toBe('large-v3-turbo-q5_0');
      expect(res.models.fast.modelName).toBe('base-q8_0');
      expect(res.models.english.modelName).toBe('medium.en-q5_0');
      expect(res.models.quantized.modelName).toBe('small-q8_0');
    });

    it('handles capable mid-tier CPU/AMD integrated system (16GB RAM, 12 Cores, 780M iGPU)', () => {
      const specs: SystemSpecs = {
        total_ram_gb: 15.3,
        cpu_cores: 12,
        gpu_type: 'amd',
        gpu_name: 'AMD Radeon 780M',
        is_discrete_gpu: false,
      };

      const res = recommendModelsForSystem(specs);
      expect(res.hardwareTier).toBe('capable');
      expect(res.modelNames).toEqual(['small', 'large-v3-turbo', 'base-q8_0', 'medium.en-q8_0', 'large-v3-turbo-q8_0']);
      expect(new Set(res.modelNames).size).toBe(5);

      expect(res.models.balanced.modelName).toBe('small');
      expect(res.models.quality.modelName).toBe('large-v3-turbo');
      expect(res.models.fast.modelName).toBe('base-q8_0');
      expect(res.models.english.modelName).toBe('medium.en-q8_0');
      expect(res.models.quantized.modelName).toBe('large-v3-turbo-q8_0');
    });

    it('handles capable discrete AMD Radeon RX system (16GB RAM, discrete GPU)', () => {
      const specs: SystemSpecs = {
        total_ram_gb: 16.0,
        cpu_cores: 8,
        gpu_type: 'amd',
        gpu_name: 'AMD Radeon RX 6700 XT',
        is_discrete_gpu: true,
      };

      const res = recommendModelsForSystem(specs);
      expect(res.hardwareTier).toBe('capable');
      expect(res.modelNames).toEqual(['large-v3-turbo', 'large-v3', 'small-q5_1', 'medium.en', 'large-v3-q5_0']);
      expect(new Set(res.modelNames).size).toBe(5);

      expect(res.models.balanced.modelName).toBe('large-v3-turbo');
      expect(res.models.quality.modelName).toBe('large-v3');
      expect(res.models.fast.modelName).toBe('small-q5_1');
      expect(res.models.english.modelName).toBe('medium.en');
      expect(res.models.quantized.modelName).toBe('large-v3-q5_0');
    });

    it('handles capable discrete Intel Arc system (16GB RAM, discrete GPU)', () => {
      const specs: SystemSpecs = {
        total_ram_gb: 16.0,
        cpu_cores: 12,
        gpu_type: 'intel',
        gpu_name: 'Intel Arc A770',
        is_discrete_gpu: true,
      };

      const res = recommendModelsForSystem(specs);
      expect(res.hardwareTier).toBe('capable');
      expect(res.modelNames).toEqual(['large-v3-turbo', 'large-v3', 'small-q5_1', 'medium.en', 'large-v3-q5_0']);
      expect(new Set(res.modelNames).size).toBe(5);

      expect(res.models.balanced.modelName).toBe('large-v3-turbo');
      expect(res.models.quality.modelName).toBe('large-v3');
      expect(res.models.fast.modelName).toBe('small-q5_1');
      expect(res.models.english.modelName).toBe('medium.en');
      expect(res.models.quantized.modelName).toBe('large-v3-q5_0');
    });

    it('handles capable NVIDIA CUDA system (12GB RAM, discrete GPU)', () => {
      const specs: SystemSpecs = {
        total_ram_gb: 12.0,
        cpu_cores: 8,
        gpu_type: 'nvidia',
        gpu_name: 'NVIDIA GeForce RTX 3060',
        is_discrete_gpu: true,
      };

      const res = recommendModelsForSystem(specs);
      expect(res.hardwareTier).toBe('capable');
      expect(res.modelNames).toEqual(['large-v3-turbo', 'large-v3', 'small-q5_1', 'medium.en', 'large-v3-q5_0']);
      expect(new Set(res.modelNames).size).toBe(5);

      expect(res.models.balanced.modelName).toBe('large-v3-turbo');
      expect(res.models.quality.modelName).toBe('large-v3');
      expect(res.models.fast.modelName).toBe('small-q5_1');
      expect(res.models.english.modelName).toBe('medium.en');
      expect(res.models.quantized.modelName).toBe('large-v3-q5_0');
    });

    it('handles workstation with NVIDIA CUDA (32GB RAM)', () => {
      const specs: SystemSpecs = {
        total_ram_gb: 32.0,
        cpu_cores: 16,
        gpu_type: 'nvidia',
        gpu_name: 'NVIDIA GeForce RTX 4080',
        is_discrete_gpu: true,
      };

      const res = recommendModelsForSystem(specs);
      expect(res.hardwareTier).toBe('workstation');
      expect(res.modelNames).toEqual(['large-v3-turbo', 'large-v3', 'small', 'medium.en', 'large-v3-q5_0']);
      expect(new Set(res.modelNames).size).toBe(5);

      expect(res.models.balanced.modelName).toBe('large-v3-turbo');
      expect(res.models.balanced.reasonI18nKey).toBe('models.recReasonBalancedCuda');
      expect(res.models.quality.modelName).toBe('large-v3');
      expect(res.models.quality.reasonI18nKey).toBe('models.recReasonQualityCuda');
      expect(res.models.fast.modelName).toBe('small');
      expect(res.models.fast.reasonI18nKey).toBe('models.recReasonFastCuda');
      expect(res.models.english.modelName).toBe('medium.en');
      expect(res.models.quantized.modelName).toBe('large-v3-q5_0');
    });

    it('handles Apple Silicon unified memory (16GB RAM reported as 15.3GB by macOS)', () => {
      const specs: SystemSpecs = {
        total_ram_gb: 15.3,
        cpu_cores: 10,
        gpu_type: 'apple_silicon',
        gpu_name: 'Apple M2 Pro',
        is_discrete_gpu: false,
      };

      const res = recommendModelsForSystem(specs);
      expect(res.hardwareTier).toBe('workstation');
      expect(res.modelNames).toEqual(['large-v3-turbo', 'large-v3', 'small', 'medium.en', 'large-v3-q5_0']);
      expect(new Set(res.modelNames).size).toBe(5);

      expect(res.models.balanced.modelName).toBe('large-v3-turbo');
      expect(res.models.balanced.reasonI18nKey).toBe('models.recReasonBalancedApple');
      expect(res.models.quality.modelName).toBe('large-v3');
      expect(res.models.quality.reasonI18nKey).toBe('models.recReasonQualityApple');
      expect(res.models.fast.modelName).toBe('small');
      expect(res.models.fast.reasonI18nKey).toBe('models.recReasonFastApple');
      expect(res.models.english.modelName).toBe('medium.en');
      expect(res.models.quantized.modelName).toBe('large-v3-q5_0');
    });

    it('handles high-spec CPU-only workstation (32GB RAM, 16 Cores)', () => {
      const specs: SystemSpecs = {
        total_ram_gb: 32.0,
        cpu_cores: 16,
        gpu_type: 'unknown',
        gpu_name: 'CPU Only',
        is_discrete_gpu: false,
      };

      const res = recommendModelsForSystem(specs);
      expect(res.hardwareTier).toBe('workstation');
      expect(res.modelNames).toEqual(['large-v3-turbo', 'large-v3', 'small', 'medium.en', 'large-v3-q5_0']);
      expect(new Set(res.modelNames).size).toBe(5);

      expect(res.models.balanced.reasonI18nKey).toBe('models.recReasonBalancedWorkstation');
      expect(res.models.quality.reasonI18nKey).toBe('models.recReasonQualityWorkstation');
      expect(res.models.fast.reasonI18nKey).toBe('models.recReasonFastWorkstation');
    });
  });

  describe('Edge Cases and Invariants', () => {
    it('gracefully handles null, undefined, or empty specs with sensible defaults', () => {
      const resNull = recommendModelsForSystem(null);
      expect(resNull.modelNames.length).toBe(5);
      expect(new Set(resNull.modelNames).size).toBe(5);
      expect(resNull.hardwareTier).toBe('budget');

      const resUndefined = recommendModelsForSystem(undefined);
      expect(resUndefined.modelNames.length).toBe(5);
      expect(new Set(resUndefined.modelNames).size).toBe(5);

      const resEmpty = recommendModelsForSystem({} as SystemSpecs);
      expect(resEmpty.modelNames.length).toBe(5);
      expect(new Set(resEmpty.modelNames).size).toBe(5);
    });

    it('ensures all 5 recommended models contain valid metadata and reasons across all tiers', () => {
      const testCases: SystemSpecs[] = [
        { total_ram_gb: 4, cpu_cores: 2, gpu_type: 'unknown' },
        { total_ram_gb: 8, cpu_cores: 4, gpu_type: 'intel' },
        { total_ram_gb: 12, cpu_cores: 8, gpu_type: 'nvidia', is_discrete_gpu: true },
        { total_ram_gb: 16, cpu_cores: 8, gpu_type: 'amd' },
        { total_ram_gb: 32, cpu_cores: 16, gpu_type: 'apple_silicon' },
      ];

      const roles = ['balanced', 'quality', 'fast', 'english', 'quantized'] as const;

      for (const specs of testCases) {
        const res = recommendModelsForSystem(specs);
        expect(res.modelNames.length).toBe(5);
        expect(new Set(res.modelNames).size).toBe(5);

        for (const role of roles) {
          const model = res.models[role];
          expect(model.modelName).toBeTruthy();
          expect(model.role).toBe(role);
          expect(model.titleI18nKey).toBeTruthy();
          expect(model.badgeI18nKey).toBeTruthy();
          expect(model.reasonI18nKey).toContain('models.recReason');
          expect(model.reasonFallback).toBeTruthy();
          expect(model.ramEstimate).toBeTruthy();
          expect(model.speedEstimate).toBeTruthy();
          expect(model.accuracyEstimate).toBeTruthy();
        }
      }
    });
  });
});
