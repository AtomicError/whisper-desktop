/**
 * Intelligent Whisper Model Recommendation Engine
 * 
 * Determines the 3 optimal Whisper GGML models tailored specifically to the host
 * machine's actual hardware: RAM capacity, CPU physical/logical cores, GPU architecture
 * (CUDA vs OpenVINO vs Vulkan vs Apple Silicon), and discrete vs integrated memory bus.
 */

export interface SystemSpecs {
  total_ram_gb: number;
  cpu_cores: number;
  gpu_type: string;
  gpu_name?: string;
  is_discrete_gpu?: boolean;
}

export type RecommendationRole = 'balanced' | 'quality' | 'fast';

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
  };
  modelNames: string[];
}

/**
 * Analyzes system specifications and returns the top 3 recommended models.
 */
export function recommendModelsForSystem(
  specs: SystemSpecs | null | undefined,
  options: { isEnglishOnly?: boolean } = {}
): RecommendationResult {
  const ram = specs && typeof specs.total_ram_gb === 'number' && specs.total_ram_gb > 0 ? specs.total_ram_gb : 8.0;
  const cores = specs && typeof specs.cpu_cores === 'number' && specs.cpu_cores > 0 ? specs.cpu_cores : 4;
  const gpuType = (specs?.gpu_type || 'unknown').toLowerCase();
  const isDiscrete = !!specs?.is_discrete_gpu;
  const gpuName = specs?.gpu_name || (gpuType === 'nvidia' ? 'NVIDIA GPU' : gpuType === 'intel' ? 'Intel Graphics' : gpuType === 'amd' ? 'AMD Radeon' : 'CPU Only');
  const en = !!options.isEnglishOnly;

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

  let balancedReasonKey = 'models.recReasonBalancedDefault';
  let balancedReasonFallback = 'توازن عالی میان سرعت بالا و خطای رونویسی ناچیز برای استفاده روزمره.';

  let qualityReasonKey = 'models.recReasonQualityDefault';
  let qualityReasonFallback = 'بالاترین دقت معنایی و مقاوم در برابر نویز و لهجه‌ها.';

  let fastReasonKey = 'models.recReasonFastDefault';
  let fastReasonFallback = 'پردازش فوری و سبک فایل‌های طولانی با حداقل مصرف باتری و منابع.';

  // 2. Select Models based on Hardware Matrix
  switch (tier) {
    case 'entry': {
      // Memory heavily constrained (<5GB or 2-core CPU). Prevent OOM crashes.
      balancedModel = en ? 'base.en-q8_0' : 'base-q8_0';
      qualityModel = en ? 'small.en-q5_1' : 'small-q5_1';
      fastModel = en ? 'tiny.en-q5_1' : 'tiny-q5_1';

      balancedReasonKey = 'models.recReasonBalancedEntry';
      balancedReasonFallback = 'مصرف رم کمتر از ۲۰۰ مگابایت با دقت مناسب برای سیستم‌های اقتصادی.';

      qualityReasonKey = 'models.recReasonQualityEntry';
      qualityReasonFallback = 'کوانتایز ۵ بیتی خانواده Small؛ ارائه هوش بالا بدون فشار آوردن به رم محدود سیستم.';

      fastReasonKey = 'models.recReasonFastEntry';
      fastReasonFallback = 'فوق‌سبک با حجم تنها ۳۱ مگابایت؛ اجرای تضمین‌شده روی هر سیستم بدون افت سرعت.';
      break;
    }

    case 'budget': {
      // 6 - 9 GB RAM, typically integrated graphics / 4-6 cores
      balancedModel = en ? 'small.en-q8_0' : 'small-q8_0';
      qualityModel = 'large-v3-turbo-q5_0';
      fastModel = en ? 'base.en-q8_0' : 'base-q8_0';

      balancedReasonKey = 'models.recReasonBalancedBudget';
      balancedReasonFallback = 'کوانتایز ۸ بیتی با سرعت عالی و مصرف حافظه بهینه (حدود ۵۵۰ مگابایت) برای سیستم‌های با رم محدود.';

      qualityReasonKey = 'models.recReasonQualityBudget';
      qualityReasonFallback = 'نسخه فشرده توربو با مصرف تنها ۱.۱ گیگابایت حافظه و حفظ کیفیت خانواده Large.';

      fastReasonKey = 'models.recReasonFastBudget';
      fastReasonFallback = 'تبدیل سریع صوت به متن با مصرف پردازشی بسیار پایین.';
      break;
    }

    case 'capable': {
      // 10 - 24 GB RAM, 8-16 cores, integrated graphics or mid-range GPUs
      if (isNvidiaCuda) {
        balancedModel = 'large-v3-turbo';
        qualityModel = 'large-v3';
        fastModel = en ? 'small.en-q5_1' : 'small-q5_1';

        balancedReasonKey = 'models.recReasonBalancedCuda';
        balancedReasonFallback = 'شتاب‌دهی فوق‌العاده با هسته‌های تنسور کارت گرافیک انویدیا با سرعتی خیره‌کننده.';

        qualityReasonKey = 'models.recReasonQualityCuda';
        qualityReasonFallback = 'دقت کامل ۱۶ بیتی FP16 برای بالاترین درک محتوایی و مقاومت در برابر نویز.';

        fastReasonKey = 'models.recReasonFastCuda';
        fastReasonFallback = 'رونویسی آنی و با سرعت ده‌ها برابر زمان صوت روی شتاب‌دهنده CUDA.';
      } else if (isAppleSilicon) {
        balancedModel = 'large-v3-turbo';
        qualityModel = 'large-v3';
        fastModel = en ? 'small.en' : 'small';

        balancedReasonKey = 'models.recReasonBalancedApple';
        balancedReasonFallback = 'پهنای باند حافظه یکپارچه Apple Silicon سرعت رونویسی فوق‌العاده‌ای فراهم می‌سازد.';

        qualityReasonKey = 'models.recReasonQualityApple';
        qualityReasonFallback = 'دقت استودیویی با استفاده از موتور عصبی و گرافیک اپل سیلیکون.';

        fastReasonKey = 'models.recReasonFastApple';
        fastReasonFallback = 'سرعت برق‌آسا و روان با حداقل مصرف باتری.';
      } else {
        // Multi-core CPU + Integrated / Standard GPU (Intel Iris/UHD, AMD Radeon, etc.)
        balancedModel = en ? 'small.en' : 'small';
        qualityModel = 'large-v3-turbo';
        fastModel = en ? 'base.en-q8_0' : 'base-q8_0';

        balancedReasonKey = 'models.recReasonBalancedCapable';
        balancedReasonFallback = 'بهترین توازن سرعت و دقت، بهینه‌سازی‌شده برای پردازنده‌های چند‌هسته‌ای و شتاب‌دهنده گرافیکی سیستم شما.';

        qualityReasonKey = 'models.recReasonQualityTurbo';
        qualityReasonFallback = 'معماری مدرن توربو با ۴ لایه دی‌کودر؛ ارائه دقت کامل خانواده Large با سرعتی چند برابر بیشتر.';

        fastReasonKey = 'models.recReasonFastCapable';
        fastReasonFallback = 'رونویسی بسیار پرسرعت با مصرف ناچیز باتری و پردازنده برای پیش‌نویس‌های آنی.';
      }
      break;
    }

    case 'workstation': {
      // 24+ GB RAM or High-end CUDA workstation / Apple Silicon Pro/Max
      if (isNvidiaCuda) {
        balancedModel = 'large-v3-turbo';
        qualityModel = 'large-v3';
        fastModel = en ? 'small.en-q5_1' : 'small-q5_1';

        balancedReasonKey = 'models.recReasonBalancedCuda';
        balancedReasonFallback = 'بهره‌گیری کامل از توان شتاب‌دهنده انویدیا برای رونویسی سریع و دقیق.';

        qualityReasonKey = 'models.recReasonQualityCuda';
        qualityReasonFallback = 'بالاترین کیفیت مطلق بدون هیچ‌گونه مصالحه در دقت با حافظه کامل FP16.';

        fastReasonKey = 'models.recReasonFastCuda';
        fastReasonFallback = 'رونویسی با سرعتی حیرت‌انگیز ده‌ها برابر زمان صوت.';
      } else if (isAppleSilicon) {
        balancedModel = 'large-v3-turbo';
        qualityModel = 'large-v3';
        fastModel = en ? 'small.en' : 'small';

        balancedReasonKey = 'models.recReasonBalancedApple';
        balancedReasonFallback = 'پهنای باند حافظه یکپارچه Apple Silicon سرعت رونویسی فوق‌العاده‌ای فراهم می‌سازد.';

        qualityReasonKey = 'models.recReasonQualityApple';
        qualityReasonFallback = 'دقت استودیویی با استفاده از موتور عصبی و گرافیک اپل سیلیکون.';

        fastReasonKey = 'models.recReasonFastApple';
        fastReasonFallback = 'سرعت برق‌آسا و روان با حداقل مصرف باتری.';
      } else {
        balancedModel = 'large-v3-turbo';
        qualityModel = 'large-v3';
        fastModel = en ? 'small.en-q5_1' : 'small-q5_1';

        balancedReasonKey = 'models.recReasonBalancedWorkstation';
        balancedReasonFallback = 'ظرفیت بالای رم و پردازنده امکان اجرای روان مدل توربو را به عنوان گزینه روزمره فراهم کرده است.';

        qualityReasonKey = 'models.recReasonQualityWorkstation';
        qualityReasonFallback = 'اجرای بدون محدودیت قوی‌ترین مدل ویسپر روی سخت‌افزار توانمند شما.';

        fastReasonKey = 'models.recReasonFastWorkstation';
        fastReasonFallback = 'پردازش فوق‌العاده سریع بدون کوچک‌ترین درگیری حافظه.';
      }
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
    'large-v3-turbo-q5_0': '~1.1 GB',
    'large-v3-turbo': '~2.0 GB',
    'large-v3': '~3.8 GB',
  };

  const modelSpeedMap: Record<string, string> = {
    'tiny-q5_1': '⚡⚡⚡ ~15x',
    'tiny.en-q5_1': '⚡⚡⚡ ~15x',
    'tiny-q8_0': '⚡⚡⚡ ~12x',
    'base-q8_0': '⚡⚡ ~7x',
    'base.en-q8_0': '⚡⚡ ~7x',
    'small-q5_1': '⚡⚡ ~5x - 10x',
    'small.en-q5_1': '⚡⚡ ~5x - 10x',
    'small-q8_0': '⚡ ~4x - 8x',
    'small': '⚡ ~3x - 6x',
    'small.en': '⚡ ~3x - 6x',
    'large-v3-turbo-q5_0': '⚡ ~3x - 5x',
    'large-v3-turbo': '⚡ ~2x - 4x',
    'large-v3': '~1x - 2.5x',
  };

  const modelAccuracyMap: Record<string, string> = {
    'tiny-q5_1': 'پایه (برای پیش‌نویس)',
    'tiny.en-q5_1': 'پایه (برای پیش‌نویس)',
    'base-q8_0': 'متوسط و سبک',
    'base.en-q8_0': 'متوسط و سبک',
    'small-q5_1': 'خوب و مطمئن',
    'small.en-q5_1': 'خوب و مطمئن',
    'small-q8_0': 'بسیار خوب (خطای کم)',
    'small': 'بسیار خوب (تعادل طلایی)',
    'small.en': 'بسیار خوب (اختصاصی انگلیسی)',
    'large-v3-turbo-q5_0': 'فوق‌العاده (نزدیک به استودیو)',
    'large-v3-turbo': 'فوق‌العاده و سطح اول',
    'large-v3': 'حداکثر دقت مطلق',
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
    accuracyEstimate: modelAccuracyMap[balancedModel] || 'بسیار خوب',
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
    accuracyEstimate: modelAccuracyMap[qualityModel] || 'فوق‌العاده و سطح اول',
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
    accuracyEstimate: modelAccuracyMap[fastModel] || 'متوسط و سبک',
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
    },
    modelNames: [balancedModel, qualityModel, fastModel],
  };
}
