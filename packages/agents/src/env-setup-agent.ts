import type { ChangePlan, EnvState, ServiceHandle } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface ServiceDescriptor { name: string; startCommand: string; }
export interface EnvSetupAgentDeps {
  discoverServices: (plan: ChangePlan) => Promise<ServiceDescriptor[]>;
  startService: (descriptor: ServiceDescriptor) => Promise<ServiceHandle>;
}

export class EnvSetupAgent implements IAgent<ChangePlan, EnvState> {
  constructor(private readonly deps: EnvSetupAgentDeps) {}

  async run(plan: ChangePlan): Promise<EnvState> {
    const descriptors = await this.deps.discoverServices(plan);
    const services: ServiceHandle[] = [];
    for (const descriptor of descriptors) {
      try {
        const handle = await this.deps.startService(descriptor);
        services.push(handle);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failureError = new Error(`Failed to start service "${descriptor.name}": ${message}`);
        (failureError as any).partialEnvState = { services } satisfies EnvState;
        throw failureError;
      }
    }
    return { services };
  }
}
