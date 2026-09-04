import { anthropicAdapter } from './anthropic.js';
import { openAICompatibleAdapter } from './openai-compatible.js';

import type { InferenceAdapter, ModelProvider } from '../types.js';

const adapters: Record<ModelProvider, InferenceAdapter> = {
  anthropic: anthropicAdapter,
  openai_compatible: openAICompatibleAdapter,
};

export function adapterFor(provider: ModelProvider): InferenceAdapter {
  return adapters[provider];
}

export { anthropicAdapter, openAICompatibleAdapter };
