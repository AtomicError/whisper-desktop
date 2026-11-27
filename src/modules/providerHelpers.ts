// Pure types, normalization, lookup, and JSON helpers for AI Translation Providers
import { parseTokensInput } from '../i18n/formatters';

export interface ModelObject {
  id: string;
  contextWindow?: number;
  context_window?: number;
  maxOutputTokens?: number;
  max_output_tokens?: number;
  vision?: boolean;
  reasoning?: string;
  supportsReasoning?: boolean;
  supports_reasoning?: boolean;
  enabled?: boolean;
}

export interface ProviderConfig {
  name: string;
  baseUrl?: string;
  base_url?: string;
  apiFormat?: string;
  api_format?: string;
  apiKey?: string;
  api_key?: string;
  useKeyring?: boolean;
  use_keyring?: boolean;
  models?: ModelObject[];
  customPrompt?: string;
  custom_prompt?: string;
}

export const POPULAR_PROVIDER_FILTERS = [
  { id: 'openai', label: 'OpenAI', test: (id: string) => id.includes('openai') || id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3') },
  { id: 'anthropic', label: 'Anthropic', test: (id: string) => id.includes('anthropic') || id.startsWith('claude') },
  { id: 'google', label: 'Google', test: (id: string) => id.includes('google') || id.startsWith('gemini') },
  { id: 'meta', label: 'Meta', test: (id: string) => id.includes('meta') || id.includes('llama') },
  { id: 'deepseek', label: 'DeepSeek', test: (id: string) => id.includes('deepseek') },
  { id: 'mistral', label: 'Mistral', test: (id: string) => id.includes('mistral') },
  { id: 'amazon', label: 'Amazon', test: (id: string) => id.includes('amazon') || id.startsWith('nova') },
  { id: 'qwen', label: 'Qwen', test: (id: string) => id.includes('qwen') }
];

export function readProviders(
  settingsState: { translateAiProviders?: string } | null | undefined,
  onCorruptJson?: (err: unknown) => void
): ProviderConfig[] {
  const raw = settingsState?.translateAiProviders;
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (typeof onCorruptJson === 'function') {
      onCorruptJson(err);
    } else {
      console.error('Failed to parse translateAiProviders JSON:', err);
    }
    return [];
  }
}

export function writeProviders(
  settingsState: { translateAiProviders?: string } | null | undefined,
  providers: ProviderConfig[]
): void {
  if (!settingsState) return;
  settingsState.translateAiProviders = JSON.stringify(providers);
}

export function normalizeModelId(id: string | null | undefined): string {
  return (id || '').trim().toLowerCase();
}

export function isModelIdMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const aNorm = normalizeModelId(a);
  const bNorm = normalizeModelId(b);
  return Boolean(aNorm && bNorm && aNorm === bNorm);
}

export function hasDuplicateModelId(
  models: ModelObject[],
  candidateId: string,
  excludeModel?: ModelObject
): boolean {
  const target = normalizeModelId(candidateId);
  if (!target) return false;
  return models.some(m => m !== excludeModel && normalizeModelId(m?.id) === target);
}

export function normalizeProviderModel(
  raw: any,
  options?: {
    idOverride?: string;
    reasoningOverride?: string;
    supportsReasoningOverride?: boolean;
    enabledOverride?: boolean;
    fallbackModel?: any;
  }
): ModelObject {
  const fallback = options?.fallbackModel;
  const resolvedId = options?.idOverride ?? (raw?.id || '');
  const rawCtx = raw?.contextWindow ?? raw?.context_window ?? fallback?.contextWindow ?? fallback?.context_window ?? 200000;
  const rawMaxOut = raw?.maxOutputTokens ?? raw?.max_output_tokens ?? fallback?.maxOutputTokens ?? fallback?.max_output_tokens;
  const parsedMaxOut = typeof rawMaxOut === 'number' && Number.isFinite(rawMaxOut) && rawMaxOut > 0
    ? Math.floor(rawMaxOut)
    : undefined;
  const vision = typeof raw?.vision === 'boolean'
    ? raw.vision
    : (typeof fallback?.vision === 'boolean' ? fallback.vision : undefined);

  const supportsReasoning = options?.supportsReasoningOverride !== undefined
    ? options.supportsReasoningOverride
    : (typeof raw?.supportsReasoning === 'boolean'
        ? raw.supportsReasoning
        : (typeof raw?.supports_reasoning === 'boolean'
            ? raw.supports_reasoning
            : (raw?.reasoning && String(raw.reasoning).toLowerCase() !== 'none' ? true : undefined)));

  const model: ModelObject = {
    id: resolvedId,
    contextWindow: parseTokensInput(rawCtx),
    reasoning: options?.reasoningOverride ?? (raw?.reasoning || 'None'),
    supportsReasoning,
    enabled: options?.enabledOverride !== undefined ? options.enabledOverride : (raw?.enabled !== false)
  };
  if (parsedMaxOut !== undefined) {
    model.maxOutputTokens = parsedMaxOut;
  }
  if (vision !== undefined) {
    model.vision = vision;
  }
  return model;
}

export function normalizeProviderModelsList(models: ModelObject[]): ModelObject[] {
  const validModels: ModelObject[] = [];
  const seenIds = new Set<string>();
  models.forEach(m => {
    const trimmedId = (m.id || '').trim();
    const key = trimmedId.toLowerCase();
    if (trimmedId && !seenIds.has(key)) {
      seenIds.add(key);
      validModels.push(normalizeProviderModel(m, { idOverride: trimmedId }));
    }
  });
  return validModels;
}

export function isModelReasoningSupported(modelObj: ModelObject | null | undefined): boolean {
  if (!modelObj || typeof modelObj !== 'object') return false;
  if (typeof modelObj.supportsReasoning === 'boolean') {
    return modelObj.supportsReasoning;
  }
  if (typeof modelObj.supports_reasoning === 'boolean') {
    return modelObj.supports_reasoning;
  }
  const reasoning = (modelObj.reasoning || '').trim().toLowerCase();
  return Boolean(reasoning && reasoning !== 'none');
}
