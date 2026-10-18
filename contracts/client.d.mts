export type RequestId = string | number;
export interface ErrorInfo { code: string; message: string; userMessage: string; details: Record<string, unknown> }
export class DeskHubError extends Error { code: string; details: Record<string, unknown>; technicalMessage?: string; constructor(info?: Partial<ErrorInfo>); }
export interface Capability { id: string; read?: boolean; write?: boolean; invoke?: boolean; valueType?: string; min?: number; max?: number; step?: number }
export interface Reading<T = unknown> { value: T; min?: number; max?: number; step?: number; maxBytes?: number; verified?: boolean; [metadata: string]: unknown }
export interface DeviceSnapshot {
  id: string; label: string; moduleId: string; moduleVersion: string | null;
  generation: number; revision: number;
  phase: 'stopped' | 'starting' | 'disconnected' | 'connected' | 'waiting' | 'faulted';
  offline: boolean; target: Record<string, unknown> | null; bindingTarget: Record<string, unknown>;
  capabilities: Capability[]; values: Record<string, Reading>; unavailable: Record<string, unknown>;
  valueState: 'unknown' | 'confirmed' | 'stale'; error: ErrorInfo | null; processId: number | null;
}
export interface Candidate { label: string; modelVerified: boolean; target: { resourceId: string; [key: string]: unknown } }
export interface ModuleManifest { id: string; name: string; version: string; protocolVersion: 1; executable: string; transport?: string[]; files: Record<string, string> }
export interface ModulePackage { manifest: ModuleManifest; packagePath: string; fingerprint: string }
export interface HubInfo { name: 'DeskHub'; version: string; protocolVersion: 1; offline: boolean; dataDirectory: string; maxFrameBytes: number; methods: string[]; desktop?: { version: string; updater: boolean } }
export interface Artifact { url: string; signature: string; sha256: string; size: number }
export interface ModuleRelease { moduleId: string; name: string; version: string; minimumHubVersion: string; protocolVersion: number; platform: string; notes: string; artifact: Artifact }
export interface ModuleCatalog { releases: { release: ModuleRelease; installedVersions: string[]; devices: { deviceId: string; version: string | null }[]; compatible: boolean; available: boolean }[] }
export interface UpdateJob {
  id: string; kind: 'module' | 'app'; subject: string; version: string;
  state: 'queued' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  downloaded: number; total: number; createdAtUnixMs: number; error: ErrorInfo | null;
  result: { package?: ModulePackage; device?: DeviceSnapshot | null; version?: string; restarted?: boolean } | null;
}
export interface AppUpdateResult { version: string; jobId: string; state: 'completed' | 'interrupted'; cleanupPending: boolean }
type Empty = Record<string, never>;
type Device = { deviceId: string; timeoutMs?: number };
export type ModuleSelection = { moduleId: string; packagePath?: never } | { packagePath: string; moduleId?: never };
export interface Api {
  'hub.describe': { params: Empty; result: HubInfo };
  'modules.list': { params: Empty; result: ModulePackage[] };
  'modules.inspect': { params: ModuleSelection; result: ModulePackage };
  'modules.catalog': { params: Empty; result: ModuleCatalog };
  'modules.checkUpdates': { params: Empty; result: ModuleCatalog };
  'modules.download': { params: { moduleId: string; version?: string }; result: UpdateJob };
  'modules.install': { params: { jobId: string; deviceId?: string }; result: UpdateJob };
  'updates.list': { params: Empty; result: UpdateJob[] };
  'updates.get': { params: { jobId: string }; result: UpdateJob };
  'updates.cancel': { params: { jobId: string }; result: UpdateJob };
  'app.updates.info': { params: Empty; result: { version: string; lastResult: AppUpdateResult | null } };
  'app.updates.check': { params: Empty; result: { currentVersion: string; release: { version: string; notes: string } | null } };
  'app.updates.download': { params: Empty; result: UpdateJob };
  'app.updates.install': { params: { jobId: string }; result: UpdateJob };
  'app.takeActivationNotice': { params: Empty; result: boolean };
  'devices.list': { params: Empty; result: DeviceSnapshot[] };
  'devices.add': { params: ModuleSelection & { id: string; label?: string; offline?: boolean; target?: Record<string, unknown>; config?: Record<string, unknown> }; result: DeviceSnapshot };
  'devices.get': { params: Device; result: DeviceSnapshot };
  'devices.start': { params: Device; result: DeviceSnapshot };
  'devices.stop': { params: Device; result: DeviceSnapshot };
  'devices.restart': { params: Device; result: DeviceSnapshot };
  'devices.replace': { params: Device & ModuleSelection; result: DeviceSnapshot };
  'devices.rebind': { params: Device & ModuleSelection & { target: Record<string, unknown>; config?: Record<string, unknown> }; result: DeviceSnapshot };
  'devices.rename': { params: Device & { label: string }; result: DeviceSnapshot };
  'devices.remove': { params: Device; result: { removed: boolean } };
  'devices.scan': { params: Device & { arguments?: Record<string, unknown> }; result: Candidate[] };
  'devices.connect': { params: Device; result: DeviceSnapshot };
  'devices.disconnect': { params: Device; result: DeviceSnapshot };
  'devices.refresh': { params: Device; result: DeviceSnapshot };
  'devices.read': { params: Device & { capability: string }; result: Reading };
  'devices.write': { params: Device & { capability: string; value: unknown }; result: Reading };
  'devices.invoke': { params: Device & { capability: string; arguments?: Record<string, unknown> }; result: unknown };
  'diagnostics.export': { params: Empty; result: { directory: string } };
  'diagnostics.report': { params: { context: string; detail: string }; result: { recorded: boolean } };
}
export type DeskHubEvent =
  | { type: 'devices.changed'; device: DeviceSnapshot }
  | { type: 'devices.removed'; deviceId: string }
  | { type: 'updates.changed'; job: UpdateJob }
  | { type: 'app.activated' }
  | { type: 'operations.changed'; deviceId: string; generation: number; requestId: RequestId; state: 'pending' | 'completed' | 'failed'; operation?: string; error?: ErrorInfo | null };
export interface DeskHubClient {
  request<M extends keyof Api>(method: M, ...args: Empty extends Api[M]['params'] ? [params?: Api[M]['params']] : [params: Api[M]['params']]): Promise<Api[M]['result']>;
  subscribe(listener: (event: DeskHubEvent) => void): () => void;
  close(reason?: string): void;
}
export interface Transport {
  send(message: { jsonrpc: '2.0'; id: RequestId; method: string; params: unknown }): void | Promise<void>;
  subscribe(listener: (message: any) => void): (() => void) | void;
}
export function createClient(transport: Transport): DeskHubClient;
