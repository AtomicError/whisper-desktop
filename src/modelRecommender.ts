/**
 * Intelligent Whisper Model Recommendation Engine
 * 
 * Determines the 5 optimal Whisper GGML models tailored specifically to the host
 * machine's actual hardware: RAM capacity, CPU physical/logical cores, GPU architecture
 * (CUDA vs OpenVINO vs Vulkan vs Apple Silicon), and discrete vs integrated memory bus.
 * 
 * Recommends 5 distinct, orthogonal roles with zero ambiguity:
 * 1. 'balanced': Everyday general driver with optimal balance of speed and accuracy.
 * 2. 'quality': Maximum semantic intelligence and resilience against acoustic noise.
 * 3. 'fast': Ultra-fast, near-instantaneous transcription with minimal memory consumption.
 * 4. 'english': Dedicated English specialist utilizing the pure 51,865 English token architecture.
 * 5. 'quantized': Ultra-efficient compressed edition slashing RAM and battery usage by 40-60%.
 */

export interface SystemSpecs {
  total_ram_gb: number;
  cpu_cores: number;
  gpu_type: string;
  gpu_name?: string;
  is_discrete_gpu?: boolean;
}

export type RecommendationRole = 'balanced' | 'quality' | 'fast' | 'english' | 'quantized';

export interface RecommendationOptions {
  // Kept for backward compatibility
  scenario?: string;
  isEnglishOnly?: boolean;
}

export interface RecommendedModel {
  role: RecommendationRole;
  modelName: string;
  badgeI18nKey: string;
  titleI18nKey: string;
  reasonI18nKey: string;
  reasonFallback: string;
  ramEstimate: string;
  speedEstimate: string;
  accuracyEstimate: string;
}

export interface RecommendationResult {
  hardwareTier: 'entry' | 'budget' | 'capable' | 'workstation';
  hardwareSummary: {
    ramGb: number;
    cpuCores: number;
    gpuName: string;
    gpuType: string;
    isDiscrete: boolean;
  };
  models: {
    balanced: RecommendedModel;
    quality: RecommendedModel;
    fast: RecommendedModel;
    english: RecommendedModel;
    quantized: RecommendedModel;
  };
  modelNames: string[];
}

/**
 * Analyzes system specifications and returns the top 5 recommended models covering
 * balanced, quality, fast, english, and quantized roles.
 */
export function recommendModelsForSystem(
  specs: SystemSpecs | null | undefined,
  _options: RecommendationOptions = {}
): RecommendationResult {
  const ram = specs && typeof specs.total_ram_gb === 'number' && specs.total_ram_gb > 0 ? specs.total_ram_gb : 8.0;
  const cores = specs && typeof specs.cpu_cores === 'number' && specs.cpu_cores > 0 ? specs.cpu_cores : 4;
  const gpuType = (specs?.gpu_type || 'unknown').toLowerCase();
  const isDiscrete = !!specs?.is_discrete_gpu;
  const gpuName = specs?.gpu_name || (gpuType === 'nvidia' ? 'NVIDIA GPU' : gpuType === 'intel' ? 'Intel Graphics' : gpuType === 'amd' ? 'AMD Radeon' : 'CPU Only');

  const isNvidiaCuda = gpuType === 'nvidia';
  const isAppleSilicon = gpuType === 'apple_silicon';

  // 1. Determine Hardware Capability Tier
  let tier: 'entry' | 'budget' | 'capable' | 'workstation';

  if (ram < 5.0 || (cores <= 2 && !isDiscrete && !isNvidiaCuda)) {
    tier = 'entry';
  } else if (ram < 10.0 && !isNvidiaCuda && !isDiscrete) {
    tier = 'budget';
  } else if (ram >= 24.0 || (ram >= 14.0 && isNvidiaCuda) || (ram >= 16.0 && isAppleSilicon)) {
    tier = 'workstation';
  } else {
    // 10 - 24 GB RAM, or 8GB with discrete GPU
    tier = 'capable';
  }

  let balancedModel = 'small';
  let qualityModel = 'large-v3-turbo';
  let fastModel = 'base-q8_0';
  let englishModel = 'medium.en';
  let quantizedModel = 'large-v3-turbo-q8_0';

  let balancedReasonKey = 'models.recReasonBalancedDefault';
  let balancedReasonFallback = 'Excellent balance between fast turnaround and low error rate for everyday use.';

  let qualityReasonKey = 'models.recReasonQualityDefault';
  let qualityReasonFallback = 'Maximum semantic accuracy and resilience against acoustic noise and technical vocabulary.';

  let fastReasonKey = 'models.recReasonFastDefault';
  let fastReasonFallback = 'Near-instantaneous, lightweight processing for long audio files with minimal resource footprint.';

  let englishReasonKey = 'models.recReasonQualityMediumEn';
  let englishReasonFallback = 'Dedicated English architecture with 51,865 English tokens for superior recognition speed and accuracy.';

  let quantizedReasonKey = 'models.recReasonBalancedQuant';
  let quantizedReasonFallback = 'Optimized quantized edition; slashes memory consumption and battery drain by 40-60%.';

  // 2. Hardware Matrix with 5 Mutually Exclusive Roles
  switch (tier) {
    case 'entry': {
      balancedModel = 'base';
      qualityModel = 'small-q5_1';
      fastModel = 'tiny-q5_1';
      englishModel = 'base.en-q8_0';
      quantizedModel = 'base-q8_0';

      balancedReasonKey = 'models.recReasonBalancedEntry';
      balancedReasonFallback = 'Standard 16-bit Base model; smooth execution and solid general accuracy for entry-level PCs.';

      qualityReasonKey = 'models.recReasonQualityEntry';
      qualityReasonFallback = '5-bit quantized Small family; high intelligence without exhausting constrained memory.';

      fastReasonKey = 'models.recReasonFastEntry';
      fastReasonFallback = 'Ultra-compact 31 MB file; guaranteed smooth execution on any hardware without lag.';

      englishReasonKey = 'models.recReasonBalancedEnEntry';
      englishReasonFallback = 'Under 200 MB memory footprint with high English vocabulary focus for entry-level PCs.';

      quantizedReasonKey = 'models.recReasonBalancedBudget';
      quantizedReasonFallback = '8-bit quantized Base model; cuts memory footprint in half with zero loss in recognition.';
      break;
    }

    case 'budget': {
      balancedModel = 'small';
      qualityModel = 'large-v3-turbo-q5_0';
      fastModel = 'base-q8_0';
      englishModel = 'medium.en-q5_0';
      quantizedModel = 'small-q8_0';

      balancedReasonKey = 'models.recReasonBalancedDefault';
      balancedReasonFallback = 'Optimal everyday workhorse; provides high accuracy across all languages with modest RAM usage.';

      qualityReasonKey = 'models.recReasonQualityBudget';
      qualityReasonFallback = 'Compact turbo edition with only ~1.1 GB memory usage while preserving Large-family quality.';

      fastReasonKey = 'models.recReasonFastBudget';
      fastReasonFallback = 'Fast speech-to-text with minimal compute and battery impact.';

      englishReasonKey = 'models.recReasonQualityMediumEnQuant';
      englishReasonFallback = '5-bit quantized English specialist; studio-grade comprehension taking under 700 MB RAM.';

      quantizedReasonKey = 'models.recReasonBalancedBudget';
      quantizedReasonFallback = '8-bit quantization with fast execution and optimized ~550 MB memory footprint for memory-constrained systems.';
      break;
    }

    case 'capable': {
      if (isNvidiaCuda) {
        balancedModel = 'large-v3-turbo';
        qualityModel = 'large-v3';
        fastModel = 'small-q5_1';
        englishModel = 'medium.en';
        quantizedModel = 'large-v3-q5_0';

        balancedReasonKey = 'models.recReasonBalancedCuda';
        balancedReasonFallback = 'Outstanding acceleration on NVIDIA Tensor Cores with exceptional throughput.';

        qualityReasonKey = 'models.recReasonQualityCuda';
        qualityReasonFallback = 'Full 16-bit FP16 precision for uncompromising recognition accuracy and noise rejection.';

        fastReasonKey = 'models.recReasonFastCuda';
        fastReasonFallback = 'Instantaneous transcription at tens of times faster than real-time audio on CUDA.';

        englishReasonKey = 'models.recReasonQualityMediumEn';
        englishReasonFallback = 'Dedicated 768M English architecture; near-Large accuracy with 2x inference speed.';

        quantizedReasonKey = 'models.recReasonQualityQuantLarge';
        quantizedReasonFallback = '5-bit quantized Large flagship; retains 99% accuracy at less than half the RAM.';
      } else if (isAppleSilicon) {
        balancedModel = 'large-v3-turbo';
        qualityModel = 'large-v3';
        fastModel = 'small';
        englishModel = 'medium.en';
        quantizedModel = 'large-v3-q5_0';

        balancedReasonKey = 'models.recReasonBalancedApple';
        balancedReasonFallback = 'High unified memory bandwidth on Apple Silicon enables blazing-fast transcription.';

        qualityReasonKey = 'models.recReasonQualityApple';
        qualityReasonFallback = 'Studio-grade precision powered by the Apple Neural Engine and GPU.';

        fastReasonKey = 'models.recReasonFastApple';
        fastReasonFallback = 'Blazing-fast transcription with minimal battery drain.';

        englishReasonKey = 'models.recReasonQualityMediumEn';
        englishReasonFallback = 'Dedicated 768M English architecture; near-Large accuracy with 2x inference speed.';

        quantizedReasonKey = 'models.recReasonQualityQuantLarge';
        quantizedReasonFallback = '5-bit quantized Large flagship; retains 99% accuracy at less than half the RAM.';
      } else {
        // CPU-only or Intel/AMD iGPU
        balancedModel = 'small';
        qualityModel = 'large-v3-turbo';
        fastModel = 'base-q8_0';
        englishModel = 'medium.en-q8_0';
        quantizedModel = 'large-v3-turbo-q8_0';

        balancedReasonKey = 'models.recReasonBalancedCapable';
        balancedReasonFallback = 'Optimal balance of speed and accuracy, tailored for multi-core CPUs and system graphics acceleration.';

        qualityReasonKey = 'models.recReasonQualityTurbo';
        qualityReasonFallback = 'Modern turbo architecture with 4 decoder layers; delivers full Large-family accuracy at ~2x-4x speed.';

        fastReasonKey = 'models.recReasonFastCapable';
        fastReasonFallback = 'High-speed transcription with minimal CPU and battery usage for rapid turnaround.';

        englishReasonKey = 'models.recReasonQualityMediumEnQuant';
        englishReasonFallback = 'Dedicated 768M English architecture with 8-bit quantization; runs 2x faster than Large on CPU.';

        quantizedReasonKey = 'models.recReasonQualityQuantTurbo';
        quantizedReasonFallback = '8-bit Turbo architecture; delivers Large-family accuracy with low memory footprint and zero lag.';
      }
      break;
    }

    case 'workstation': {
      balancedModel = 'large-v3-turbo';
      qualityModel = 'large-v3';
      fastModel = 'small';
      englishModel = 'medium.en';
      quantizedModel = 'large-v3-q5_0';

      balancedReasonKey = 'models.recReasonBalancedWorkstation';
      balancedReasonFallback = 'Ample system RAM and compute allow running the Turbo model comfortably as your daily driver.';

      qualityReasonKey = 'models.recReasonQualityWorkstation';
      qualityReasonFallback = 'Unrestricted execution of the flagship Whisper model on your capable hardware.';

      fastReasonKey = 'models.recReasonFastWorkstation';
      fastReasonFallback = 'Extremely fast processing with zero memory contention.';

      englishReasonKey = 'models.recReasonQualityMediumEn';
      englishReasonFallback = 'Dedicated 768M English architecture; near-Large accuracy with 2x inference speed.';

      quantizedReasonKey = 'models.recReasonQualityQuantLarge';
      quantizedReasonFallback = '5-bit quantized Large flagship; retains 99% accuracy at less than half the RAM.';
      break;
    }
  }

  // Model Metadata summaries
  const modelRamMap: Record<string, string> = {
    'tiny-q5_1': '~100 MB',
    'tiny.en-q5_1': '~100 MB',
    'tiny-q8_0': '~120 MB',
    'tiny': '~150 MB',
    'base-q5_1': '~180 MB',
    'base-q8_0': '~200 MB',
    'base.en-q8_0': '~200 MB',
    'base': '~250 MB',
    'small-q5_1': '~400 MB',
    'small.en-q5_1': '~400 MB',
    'small-q8_0': '~550 MB',
    'small.en-q8_0': '~550 MB',
    'small': '~800 MB',
    'small.en': '~800 MB',
    'medium-q5_0': '~900 MB',
    'medium-q8_0': '~1.3 GB',
    'medium.en-q5_0': '~650 MB',
    'medium.en-q8_0': '~850 MB',
    'medium.en': '~1.5 GB',
    'large-v3-q5_0': '~1.6 GB',
    'large-v3-turbo-q5_0': '~1.1 GB',
    'large-v3-turbo-q8_0': '~1.4 GB',
    'large-v3-turbo': '~2.0 GB',
    'large-v3': '~3.8 GB',
  };

  const modelSpeedMap: Record<string, string> = {
    'tiny-q5_1': '⚡⚡⚡ ~15x',
    'tiny.en-q5_1': '⚡⚡⚡ ~15x',
    'tiny-q8_0': '⚡⚡⚡ ~12x',
    'base-q8_0': '⚡⚡ ~7x',
    'base.en-q8_0': '⚡⚡ ~7x',
    'base': '⚡⚡ ~6x',
    'small-q5_1': '⚡⚡ ~4x',
    'small.en-q5_1': '⚡⚡ ~4x',
    'small-q8_0': '⚡⚡ ~3.5x',
    'small.en-q8_0': '⚡⚡ ~3.5x',
    'small': '⚡⚡ ~3x',
    'small.en': '⚡⚡ ~3x',
    'medium-q5_0': '⚡ ~2x',
    'medium-q8_0': '⚡ ~1.8x',
    'medium.en-q5_0': '⚡ ~2.2x',
    'medium.en-q8_0': '⚡ ~2.0x',
    'medium.en': '⚡ ~1.8x',
    'large-v3-q5_0': '⚡ ~1.5x',
    'large-v3-turbo-q5_0': '⚡⚡ ~3.5x',
    'large-v3-turbo-q8_0': '⚡⚡ ~3.0x',
    'large-v3-turbo': '⚡⚡ ~3.0x',
    'large-v3': '~1.0x',
  };

  const modelAccuracyMap: Record<string, string> = {
    'tiny-q5_1': 'Basic & Draft Quality',
    'tiny.en-q5_1': 'Basic & Draft Quality (English)',
    'tiny-q8_0': 'Basic & Draft Quality',
    'base-q8_0': 'Moderate & Lightweight',
    'base.en-q8_0': 'Moderate & Dedicated English',
    'base': 'Good Everyday Dictation',
    'small-q5_1': 'High & Efficient',
    'small.en-q5_1': 'High & Efficient (English)',
    'small-q8_0': 'Very Good',
    'small.en-q8_0': 'Very Good (English Dedicated)',
    'small': 'Very Good',
    'small.en': 'Very Good (English Dedicated)',
    'medium-q5_0': 'Studio Precision',
    'medium-q8_0': 'Studio Precision',
    'medium.en-q5_0': 'Studio Precision (English Dedicated)',
    'medium.en-q8_0': 'Studio Precision (English Dedicated)',
    'medium.en': 'Studio Flagship (English Dedicated)',
    'large-v3-q5_0': 'Flagship (5-bit Quantized)',
    'large-v3-turbo-q5_0': 'Excellent (Near Studio Quality)',
    'large-v3-turbo-q8_0': 'Flagship (8-bit Turbo)',
    'large-v3-turbo': 'Flagship Tier & Exceptional',
    'large-v3': 'Maximum Absolute Accuracy',
  };

  const balanced: RecommendedModel = {
    role: 'balanced',
    modelName: balancedModel,
    badgeI18nKey: 'models.recRoleBalanced',
    titleI18nKey: 'models.recTitleBalanced',
    reasonI18nKey: balancedReasonKey,
    reasonFallback: balancedReasonFallback,
    ramEstimate: modelRamMap[balancedModel] || '~800 MB',
    speedEstimate: modelSpeedMap[balancedModel] || '~3x - 6x',
    accuracyEstimate: modelAccuracyMap[balancedModel] || 'Very Good',
  };

  const quality: RecommendedModel = {
    role: 'quality',
    modelName: qualityModel,
    badgeI18nKey: 'models.recRoleQuality',
    titleI18nKey: 'models.recTitleQuality',
    reasonI18nKey: qualityReasonKey,
    reasonFallback: qualityReasonFallback,
    ramEstimate: modelRamMap[qualityModel] || '~2.0 GB',
    speedEstimate: modelSpeedMap[qualityModel] || '~2x - 4x',
    accuracyEstimate: modelAccuracyMap[qualityModel] || 'Flagship Tier & Exceptional',
  };

  const fast: RecommendedModel = {
    role: 'fast',
    modelName: fastModel,
    badgeI18nKey: 'models.recRoleFast',
    titleI18nKey: 'models.recTitleFast',
    reasonI18nKey: fastReasonKey,
    reasonFallback: fastReasonFallback,
    ramEstimate: modelRamMap[fastModel] || '~200 MB',
    speedEstimate: modelSpeedMap[fastModel] || '~7x',
    accuracyEstimate: modelAccuracyMap[fastModel] || 'Moderate & Lightweight',
  };

  const english: RecommendedModel = {
    role: 'english',
    modelName: englishModel,
    badgeI18nKey: 'models.recRoleEnglish',
    titleI18nKey: 'models.recTitleEnglish',
    reasonI18nKey: englishReasonKey,
    reasonFallback: englishReasonFallback,
    ramEstimate: modelRamMap[englishModel] || '~800 MB',
    speedEstimate: modelSpeedMap[englishModel] || '~3x - 8x',
    accuracyEstimate: modelAccuracyMap[englishModel] || 'Studio Precision (English Dedicated)',
  };

  const quantized: RecommendedModel = {
    role: 'quantized',
    modelName: quantizedModel,
    badgeI18nKey: 'models.recRoleQuantized',
    titleI18nKey: 'models.recTitleQuantized',
    reasonI18nKey: quantizedReasonKey,
    reasonFallback: quantizedReasonFallback,
    ramEstimate: modelRamMap[quantizedModel] || '~600 MB',
    speedEstimate: modelSpeedMap[quantizedModel] || '~3x - 8x',
    accuracyEstimate: modelAccuracyMap[quantizedModel] || 'High Efficiency',
  };

  return {
    hardwareTier: tier,
    hardwareSummary: {
      ramGb: ram,
      cpuCores: cores,
      gpuName,
      gpuType,
      isDiscrete,
    },
    models: {
      balanced,
      quality,
      fast,
      english,
      quantized,
    },
    modelNames: [balancedModel, qualityModel, fastModel, englishModel, quantizedModel],
  };
}
