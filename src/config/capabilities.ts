export interface ModelCapability {
    supportsVision: boolean;
}

const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
    "gpt-5.6-luna": { supportsVision: true },
    "gpt-5.6-terra": { supportsVision: false },
    "gpt-5.6-sol": { supportsVision: false },
    "gpt-omni": { supportsVision: true },
    "claude-omni": { supportsVision: true },
    "gemini-omni": { supportsVision: true },
    "deepseek-omni": { supportsVision: false },
    "kimi-omni": { supportsVision: false },
    "grok-omni": { supportsVision: true },
    "llama-omni": { supportsVision: true },
    "mistral-omni": { supportsVision: false },
    "qwen-omni": { supportsVision: true },
};

export function supportsVision(modelId: string): boolean {
    return MODEL_CAPABILITIES[modelId]?.supportsVision ?? false;
}
