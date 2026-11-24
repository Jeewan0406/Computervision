// Shared data types for JeeA!
import type { WebSource } from './web';

/** How the app talks to a provider. Almost every provider speaks the OpenAI
 * "chat/completions" dialect; Anthropic has its own "messages" API. */
export type ProviderKind = 'openai' | 'anthropic' | 'puter' | 'browser';

/** How a user can get access to a provider. */
export type Access = 'keyless' | 'free-tier' | 'paid' | 'local';

export interface ProviderDef {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  access: Access;
  color: string;
  /** Short line shown in the catalog. */
  tagline: string;
  keyUrl?: string;
  docsUrl?: string;
  /** Warnings the user should see (rate limits, CORS, etc.). */
  note?: string;
  suggestedModels: string[];
  defaultModel: string;
  /** Friendly names for model ids that are not self-explanatory. */
  modelLabels?: Record<string, string>;
  /** Provider accepts `stream_options: { include_usage: true }`. */
  streamUsage?: boolean;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
  /** Created by the user in the app. */
  custom?: boolean;
  /** Keyless providers allow only one request at a time per IP. */
  maxConcurrent?: number;
  /** Minimum time between two requests (shared free tiers). */
  minGapMs?: number;
  /** Path for chat requests, default "/chat/completions". */
  chatPath?: string;
  /** false = no native tool calling; agents use the text tool protocol. */
  nativeTools?: boolean;
  /** Provider whose models are free only when the id ends with ":free". */
  freeSuffixOnly?: boolean;
  /** When set, only these model ids are free on this provider. */
  freeModels?: string[];
  /** Regular expression (text) of model ids to hide from the live list. */
  hideModels?: string;
}

export type SlotStatus = 'unknown' | 'ok' | 'error' | 'cooldown';

/** One API key ("slot"). A provider can have many slots; requests rotate
 * across them and fail over when one is rate-limited or broken. */
export interface Slot {
  id: string;
  providerId: string;
  label: string;
  apiKey: string;
  baseUrl?: string;
  /** Send this slot's requests through the CORS proxy from Routing settings. */
  useProxy?: boolean;
  enabled: boolean;
  createdAt: number;
  status: SlotStatus;
  lastError?: string;
  cooldownUntil?: number;
  uses: number;
  failures: number;
  models?: string[];
  modelsFetchedAt?: number;
}

/** Which model to use. `slotId` pins one key; empty means auto-rotate. */
export interface ModelRef {
  providerId: string;
  model: string;
  slotId?: string;
}

export interface GenParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Thinking level; sent as the provider's effort setting where the model has one. */
  effort?: import('./thinking').ThinkLevel;
}

export interface MsgMeta {
  ttftMs?: number;
  totalMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  estimated?: boolean;
  slotLabel?: string;
  providerName?: string;
  attempts?: number;
  fellBackFrom?: string;
}

export type MsgStatus = 'streaming' | 'done' | 'error' | 'stopped';

/** A picture sent with a message (made smaller in the browser first). */
export interface ImageAtt {
  name: string;
  /** data: URL, e.g. "data:image/jpeg;base64,..." */
  dataUrl: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Pictures attached by the user (sent to models that can see images). */
  images?: ImageAtt[];
  reasoning?: string;
  model?: ModelRef;
  meta?: MsgMeta;
  status?: MsgStatus;
  /** Short live note while waiting (rate-limit countdown, fallback, ...). */
  statusText?: string;
  /** Agent mode: the plan / tool steps taken before the final answer. */
  steps?: AgentStep[];
  /** Web results this answer was given (automatic web search). */
  sources?: WebSource[];
  /** Set when the app searched the web for this answer. */
  web?: { query: string; at: number; note?: string };
  error?: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  kind: 'chat';
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** Project this conversation belongs to (projects.ts). */
  projectId?: string;
  model: ModelRef;
  system: string;
  params: GenParams;
  messages: Message[];
}

export interface CompareLane {
  id: string;
  model: ModelRef;
  messages: Message[];
}

export interface CompareSession {
  id: string;
  kind: 'compare';
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** Project this conversation belongs to (projects.ts). */
  projectId?: string;
  system: string;
  params: GenParams;
  lanes: CompareLane[];
  /** turn index -> winning lane id */
  votes: Record<number, string>;
  judge?: { model: ModelRef; message?: Message };
}

export type TeamMode = 'pipeline' | 'moa' | 'debate';

export interface TeamRole {
  id: string;
  name: string;
  emoji: string;
  color: string;
  model: ModelRef;
  instructions: string;
}

export interface TeamStep {
  id: string;
  roleId: string;
  roleName: string;
  emoji: string;
  color: string;
  round?: number;
  message: Message;
}

export interface TeamRun {
  id: string;
  input: string;
  mode: TeamMode;
  createdAt: number;
  steps: TeamStep[];
  status: 'running' | 'done' | 'error' | 'stopped';
  /** Web results shared with every role (automatic web search). */
  sources?: WebSource[];
  web?: { query: string; at: number; note?: string };
}

export interface TeamSession {
  id: string;
  kind: 'team';
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** Project this conversation belongs to (projects.ts). */
  projectId?: string;
  mode: TeamMode;
  rounds: number;
  roles: TeamRole[];
  runs: TeamRun[];
}

export interface CodeVersion {
  id: string;
  at: number;
  code: string;
  note: string;
}

export interface CodeSession {
  id: string;
  kind: 'code';
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** Project this conversation belongs to (projects.ts). */
  projectId?: string;
  model: ModelRef;
  messages: Message[];
  code: string;
  versions: CodeVersion[];
}

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: string;
  ms?: number;
  link?: { view: 'code'; sessionId: string; label: string };
}

export interface AgentStep {
  id: string;
  kind: 'thought' | 'tool';
  text?: string;
  tool?: AgentToolCall;
}

export interface AgentSession {
  id: string;
  kind: 'agent';
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** Project this conversation belongs to (projects.ts). */
  projectId?: string;
  model: ModelRef;
  messages: Message[];
  tools: string[];
  maxSteps: number;
  /** Agent workspace: files the agent wrote (path -> text). */
  files: Record<string, string>;
}

export type Session = ChatSession | CompareSession | TeamSession | CodeSession | AgentSession;
export type SessionKind = Session['kind'];

export type View = 'chat' | 'agent' | 'compare' | 'team' | 'code' | 'images' | 'keys' | 'logs';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  /** "request" = one HTTP call to a model; "system" = app events. */
  type: 'request' | 'system';
  feature: View | 'system';
  providerId?: string;
  providerName?: string;
  model?: string;
  slotLabel?: string;
  status?: 'ok' | 'error' | 'aborted' | 'retry';
  httpStatus?: number;
  ttftMs?: number;
  totalMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  estimated?: boolean;
  attempt?: number;
  message: string;
}
