"use client";

import { env } from "./env";
import { getAccessToken } from "./supabase";
import type {
  AiConnection,
  AiConnections,
  AiUsage,
  ChatEvent,
  ChatLatest,
  ChatRequest,
  FeedbackChip,
  GenerateRequest,
  Health,
  Item,
  ItemCreate,
  ItemList,
  ItemPatch,
  LearningLog,
  OutfitCard,
  Provider,
  Region,
  StyleAttributes,
  StylePreset,
  StyleProfile,
  TagResult,
  TaskSetting,
  TimeOfDay,
  TodayResult,
  User,
  UserPatch,
  Weather,
} from "./types";

export const QUOTA_MESSAGE = "오늘 무료 사용량을 다 썼어요. 내일 다시 쓰거나 내 AI 키를 연결하세요.";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${env.apiBase}/api/v1${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    if (body?.error?.code) return new ApiError(body.error.code, body.error.message, res.status);
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return new ApiError("UNAUTHORIZED", "다시 로그인해 주세요.", 401);
  return new ApiError("HTTP_ERROR", "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.", res.status);
}

async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Query; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = opts.auth === false ? {} : await authHeaders();
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 0);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.code === "FREE_QUOTA_EXCEEDED" ? QUOTA_MESSAGE : e.message;
  if (e instanceof Error) return e.message;
  return "알 수 없는 오류가 났어요.";
}

// ── 상태 · 개발 ──
export const getHealth = () => request<Health>("GET", "/health", { auth: false });
export const devSession = (account: "a" | "b") =>
  request<{ access_token: string; refresh_token: string }>("POST", "/dev/session", {
    body: { account },
    auth: false,
  });

// ── 프로필 ──
export const getMe = () => request<User>("GET", "/me");
export const patchMe = (body: UserPatch) => request<User>("PATCH", "/me", { body });
export const deleteMe = () => request<void>("DELETE", "/me");
export const deleteExclusion = (id: string) => request<void>("DELETE", `/me/exclusions/${id}`);
export const getLearningLog = () => request<LearningLog>("GET", "/me/learning-log");

// ── 옷장 ──
export const getUploadUrl = (content_type: string) =>
  request<{ path: string; upload_url: string }>("POST", "/items/upload-url", { body: { content_type } });
export const tagItem = (image_path: string) => request<TagResult>("POST", "/items/tag", { body: { image_path } });
export const createItem = (body: ItemCreate) => request<Item>("POST", "/items", { body });
export const listItems = (q: { category?: string; color?: string; season?: string; active?: "true" | "false" | "all" } = {}) =>
  request<ItemList>("GET", "/items", { query: q });
export const patchItem = (id: string, body: ItemPatch) => request<Item>("PATCH", `/items/${id}`, { body });
export const deleteItem = (id: string) => request<void>("DELETE", `/items/${id}`);

export async function uploadImage(blob: Blob, contentType: string): Promise<string> {
  const { path, upload_url } = await getUploadUrl(contentType);
  let res: Response;
  try {
    res = await fetch(upload_url, { method: "PUT", headers: { "content-type": contentType }, body: blob });
  } catch {
    throw new ApiError("UPLOAD_FAILED", "사진을 올리지 못했어요. 다시 시도해 주세요.", 0);
  }
  if (!res.ok) throw new ApiError("UPLOAD_FAILED", "사진을 올리지 못했어요. 다시 시도해 주세요.", res.status);
  return path;
}

// ── 추구미 ──
export const getStylePresets = () => request<{ presets: StylePreset[] }>("GET", "/style-presets");
export const createStyleProfile = (body: { text: string } | { preset: string }) =>
  request<StyleProfile>("POST", "/style-profiles", { body });
export const listStyleProfiles = () => request<{ profiles: StyleProfile[] }>("GET", "/style-profiles");
export const patchStyleProfile = (
  id: string,
  body: { style_name?: string; attributes?: StyleAttributes; is_default?: true },
) => request<StyleProfile>("PATCH", `/style-profiles/${id}`, { body });
export const deleteStyleProfile = (id: string) => request<void>("DELETE", `/style-profiles/${id}`);

// ── 날씨·지역 ──
export const getWeather = (q: { date: string; time_of_day?: TimeOfDay; nx?: number; ny?: number }) =>
  request<Weather>("GET", "/weather", { query: q });
export const searchRegions = (q: string) => request<{ regions: Region[] }>("GET", "/regions", { query: { q } });
export const nearestRegion = (lat: number, lon: number) =>
  request<{ region: Region }>("GET", "/regions/nearest", { query: { lat, lon } });

// ── 대화 ──
export const getChatLatest = () => request<ChatLatest>("GET", "/chat/latest");

/** POST /chat as SSE. EventSource can't POST, so parse the stream manually. */
export async function streamChat(
  body: ChatRequest,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json", Accept: "text/event-stream" };
  let res: Response;
  try {
    res = await fetch(buildUrl("/chat"), { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
    throw new ApiError("NETWORK_ERROR", "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 0);
  }
  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    try {
      onEvent({ event, data: JSON.parse(data.join("\n")) } as ChatEvent);
    } catch {
      /* ignore malformed event */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      flush(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) flush(buffer);
}

// ── 오늘의 코디 · 저장 ──
export const generateOutfits = (body: GenerateRequest) => request<TodayResult>("POST", "/outfits/generate", { body });
export const outfitFeedback = (id: string, body: { chip?: FeedbackChip; message?: string }) =>
  request<TodayResult>("POST", `/outfits/${id}/feedback`, { body });
export const setFavorite = (id: string, on: boolean) =>
  request<{ id: string; is_favorite: boolean }>(on ? "POST" : "DELETE", `/outfits/${id}/favorite`);
export const listOutfits = (q: { favorite?: boolean; occasion?: string; limit?: number }) =>
  request<{ outfits: OutfitCard[]; occasions: string[] }>("GET", "/outfits", { query: q });

// ── AI 연결 ──
export const getAiConnections = () => request<AiConnections>("GET", "/ai/connections");
export const connectAi = (provider: Provider, api_key: string, monthly_limit_usd?: number | null) =>
  request<AiConnection>("POST", `/ai/connections/${provider}`, { body: { api_key, monthly_limit_usd } });
export const patchAiConnection = (provider: Provider, monthly_limit_usd: number | null) =>
  request<AiConnection>("PATCH", `/ai/connections/${provider}`, { body: { monthly_limit_usd } });
export const disconnectAi = (provider: Provider) => request<void>("DELETE", `/ai/connections/${provider}`);
export const getTaskSettings = () => request<{ tasks: TaskSetting[] }>("GET", "/ai/task-settings");
export const putTaskSettings = (tasks: { task: string; provider: string; model: string }[]) =>
  request<{ tasks: TaskSetting[] }>("PUT", "/ai/task-settings", { body: { tasks } });
export const getAiUsage = (month?: string) => request<AiUsage>("GET", "/ai/usage", { query: { month } });
