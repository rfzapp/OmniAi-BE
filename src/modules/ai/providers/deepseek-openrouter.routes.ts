export interface DeepSeekOpenRouterRoute {
  displayName: string;
  provider: "openrouter";
  openRouterModelId: string;
  enabled: boolean;
  capabilities: {
    text: boolean;
    vision: boolean;
    streaming: boolean;
  };
}

export const DEEPSEEK_OPENROUTER_ROUTES: Readonly<Record<string, DeepSeekOpenRouterRoute>> = Object.freeze({
  "deepseek-chat": {
    displayName: "DeepSeek V3",
    provider: "openrouter",
    openRouterModelId: "deepseek/deepseek-chat",
    enabled: true,
    capabilities: { text: true, vision: false, streaming: true },
  },
  "deepseek-reasoner": {
    displayName: "DeepSeek R1",
    provider: "openrouter",
    openRouterModelId: "deepseek/deepseek-r1",
    enabled: true,
    capabilities: { text: true, vision: false, streaming: true },
  },
  "deepseek-omni": {
    displayName: "DeepSeek",
    provider: "openrouter",
    openRouterModelId: "deepseek/deepseek-chat",
    enabled: true,
    capabilities: { text: true, vision: false, streaming: true },
  },
});

export function resolveDeepSeekOpenRouterRoute(modelId: string): DeepSeekOpenRouterRoute | undefined {
  return Object.prototype.hasOwnProperty.call(DEEPSEEK_OPENROUTER_ROUTES, modelId)
    ? DEEPSEEK_OPENROUTER_ROUTES[modelId]
    : undefined;
}
