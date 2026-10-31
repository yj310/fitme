"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import { StepsCard } from "@/components/chat/StepsCard";
import { CompactOutfitCard, MissingNotice } from "@/components/OutfitCards";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge, Banner, Button, ButtonLink, Chip, ErrorState, LoadingState } from "@/components/ui";
import { ApiError, errorMessage, getChatLatest, streamChat } from "@/lib/api";
import { cx } from "@/lib/format";
import type { AskEvent, ChatEvent, ChatMessage, Notice, OutfitCard, OutfitsEvent, Step } from "@/lib/types";

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: Step[];
  run?: { steps: number; ms: number };
  ask?: AskEvent;
  answered?: boolean;
  outfits?: OutfitsEvent;
  error?: { code: string; message: string };
  pending?: boolean;
}

const EXAMPLES = [
  "내일 소개팅인데 미니멀하고 너무 꾸민 느낌은 싫어",
  "이번 주 금요일 출근룩 단정하게 짜줘",
  "주말에 친구 모임, 편하고 따뜻하게",
];

function fromServer(m: ChatMessage): UiMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    steps: m.payload?.steps ?? [],
    run: m.payload?.run,
    ask: m.payload?.ask,
    answered: m.payload?.answered,
    outfits: m.payload?.outfits,
  };
}

let localId = 0;
const newId = () => `local-${++localId}`;

export default function ChatPage() {
  const { me, refreshMe } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [current, setCurrent] = useState<OutfitsEvent | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await getChatLatest();
      setConversationId(r.conversation?.id ?? null);
      setMessages(r.messages.map(fromServer));
      setCurrent(r.current);
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load once per mount. With Cache Components the page stays mounted (hidden) while you visit other
  // screens and effects re-run on return, so don't reload over the conversation or abort a running stream.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  const patchAssistant = (id: string, fn: (m: UiMessage) => UiMessage) =>
    setMessages((list) => list.map((m) => (m.id === id ? fn(m) : m)));

  const send = async (text: string, answer?: { ask_id: string; value: string }) => {
    const message = text.trim();
    if (!message || streaming) return;
    const assistantId = newId();
    setMessages((list) => [
      ...list,
      { id: newId(), role: "user", content: message, steps: [] },
      { id: assistantId, role: "assistant", content: "", steps: [], pending: true },
    ]);
    setInput("");
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const onEvent = (e: ChatEvent) => {
      switch (e.event) {
        case "meta":
          setConversationId(e.data.conversation_id);
          break;
        case "step":
          patchAssistant(assistantId, (m) => {
            const steps = [...m.steps];
            const last = steps.length - 1;
            if (last >= 0 && steps[last].tool === e.data.tool && steps[last].status === "running") steps[last] = e.data;
            else steps.push(e.data);
            return { ...m, steps };
          });
          break;
        case "notice":
          setNotices((n) => [...n, e.data]);
          break;
        case "message":
          patchAssistant(assistantId, (m) => ({ ...m, content: m.content + e.data.delta }));
          break;
        case "outfits":
          setCurrent(e.data);
          patchAssistant(assistantId, (m) => ({ ...m, outfits: e.data }));
          break;
        case "ask":
          patchAssistant(assistantId, (m) => ({ ...m, ask: e.data }));
          break;
        case "done":
          setConversationId(e.data.conversation_id);
          patchAssistant(assistantId, (m) => ({ ...m, run: { steps: e.data.steps, ms: e.data.ms }, pending: false }));
          break;
        case "error":
          patchAssistant(assistantId, (m) => ({ ...m, error: e.data, pending: false }));
          break;
      }
    };

    try {
      await streamChat({ conversation_id: conversationId, message, answer }, onEvent, ctrl.signal);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "ERROR";
      patchAssistant(assistantId, (m) => ({ ...m, error: { code, message: errorMessage(e) } }));
    } finally {
      patchAssistant(assistantId, (m) => ({ ...m, pending: false }));
      setStreaming(false);
      abortRef.current = null;
      void refreshMe(); // "앞으로 기억" may have changed the profile
    }
  };

  const answerAsk = (msgId: string, ask: AskEvent, opt: { label: string; value: string }) => {
    setMessages((list) => list.map((m) => (m.id === msgId ? { ...m, answered: true } : m)));
    if (ask.kind === "remember") void send(opt.label, { ask_id: ask.ask_id, value: opt.value });
    else void send(opt.label);
  };

  const newConversation = () => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setCurrent(null);
    setNotices([]);
  };

  const updateOutfit = (o: OutfitCard) =>
    setCurrent((c) => (c ? { ...c, outfits: c.outfits.map((x) => (x.id === o.id ? o : x)) } : c));

  const lowCloset = (me?.closet_count ?? 0) < 3;

  return (
    <div className="grid h-full min-h-[560px] grid-cols-[minmax(0,1fr)_340px]">
      {/* ── 대화 영역 ── */}
      <section className="flex min-h-0 flex-col" aria-label="대화">
        <div className="flex items-center justify-between border-b border-line bg-surface px-[26px] py-3">
          <h1 className="text-[15px] font-bold">스타일리스트에게 말하기</h1>
          <Button variant="ghost" onClick={newConversation} disabled={streaming}>
            새 대화
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[26px] py-5" aria-live="polite">
          {notices.map((n, i) => (
            <Banner key={i} tone="warn" onClose={() => setNotices((list) => list.filter((_, j) => j !== i))}>
              {n.message}
            </Banner>
          ))}
          {lowCloset && (
            <Banner tone="accent">
              옷을 3벌 이상 등록하면 더 정확한 코디를 받을 수 있어요.{" "}
              <ButtonLink href="/closet" variant="subtle" className="!px-1 !py-0 underline">
                옷 등록하기
              </ButtonLink>
            </Banner>
          )}
          {loading ? (
            <LoadingState />
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : messages.length === 0 ? (
            <div className="m-auto flex max-w-[460px] flex-col items-center gap-3 text-center">
              <p className="text-[15px] font-semibold">어떤 상황의 코디가 필요하세요?</p>
              <p className="text-[13px] text-muted">날짜·상황·원하는 느낌을 말해 주시면 날씨를 확인하고 내 옷장에서 3개를 골라요.</p>
              <div className="flex flex-col gap-1.5">
                {EXAMPLES.map((ex) => (
                  <Chip key={ex} onClick={() => void send(ex)} className="justify-center">
                    {ex}
                  </Chip>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <p
                  key={m.id}
                  className="max-w-[75%] self-end whitespace-pre-wrap rounded-[16px] rounded-br-[4px] bg-bubble px-3.5 py-2 text-bubble-ink"
                >
                  {m.content}
                </p>
              ) : (
                <div key={m.id} className="flex flex-col gap-2">
                  <StepsCard steps={m.steps} run={m.run} running={Boolean(m.pending)} />
                  {m.content && (
                    <p className="max-w-[80%] self-start whitespace-pre-wrap rounded-[16px] rounded-bl-[4px] border border-line bg-surface px-3.5 py-2">
                      {m.content}
                    </p>
                  )}
                  {m.error && <ApiErrorBanner code={m.error.code} message={m.error.message} />}
                  {m.ask && (
                    <div className="flex flex-col gap-1.5 self-start">
                      {m.ask.question && m.ask.question !== m.content && <p className="text-[13px] text-muted">{m.ask.question}</p>}
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="답변 선택">
                        {m.ask.options.map((o) => (
                          <Chip
                            key={o.value}
                            onClick={m.answered || streaming ? undefined : () => answerAsk(m.id, m.ask!, o)}
                            className={cx(m.answered && "opacity-50")}
                          >
                            {o.label}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ),
            )
          )}
          <div ref={bottomRef} />
        </div>
        <form
          className="border-t border-line bg-app px-[26px] py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="flex items-end gap-2 rounded-[14px] border border-line-strong bg-surface py-2 pl-4 pr-2">
            <textarea
              aria-label="스타일리스트에게 말하기"
              rows={1}
              value={input}
              placeholder="스타일리스트에게 말하기"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              className="max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 outline-none placeholder:text-muted"
            />
            {/* 사진·링크 첨부 버튼은 P1에서 숨김 (spec 6.3 ②) */}
            <Button type="submit" disabled={!input.trim() || streaming} loading={streaming} aria-label="보내기">
              ↑
            </Button>
          </div>
        </form>
      </section>

      {/* ── 결과 패널 ── */}
      <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-l border-line bg-surface px-[18px] py-5" aria-label="추천 코디">
        {current ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-bold">{current.title}</h2>
              <Badge>
                v{current.version}
                {current.label ? ` · ${current.label}` : ""}
              </Badge>
            </div>
            <MissingNotice missing={current.missing} count={current.outfits.length} />
            {current.outfits.map((o) => (
              <CompactOutfitCard key={o.id} outfit={o} onChange={updateOutfit} />
            ))}
            <p className="mt-auto pt-2 text-[11.5px] text-muted">점수 = 스타일 일치 · 조화 · 상황 · 개인 선호</p>
          </>
        ) : (
          <div className="m-auto flex flex-col items-center gap-2 text-center text-[13px] text-muted">
            <p className="font-semibold text-ink">추천 코디가 여기에 보여요</p>
            <p>대화로 요청하면 코디 3개와 점수를 보여드려요.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
