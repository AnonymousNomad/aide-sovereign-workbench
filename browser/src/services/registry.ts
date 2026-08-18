export interface Service {
  init(): Promise<void> | void;
  dispose(): Promise<void> | void;
}

const services: Service[] = [];

export function register(service: Service): Service {
  services.push(service);
  return service;
}

export async function initAll(): Promise<void> {
  for (const service of services) await service.init();
}

export async function disposeAll(): Promise<void> {
  for (const service of [...services].reverse()) await service.dispose();
}