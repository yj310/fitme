"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Banner, Button, Card, CardTitle, Modal, PageHeader, TextInput } from "@/components/ui";
import { deleteMe, errorMessage } from "@/lib/api";

const CONFIRM_TEXT = "계정 삭제";

export default function SettingsPage() {
  const { me, signOut } = useAuth();
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    setBusy("logout");
    await signOut();
    router.replace("/welcome");
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      await deleteMe();
      await signOut();
      router.replace("/welcome");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-[26px] py-[22px]">
      <PageHeader title="설정" />
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardTitle>AI 연결</CardTitle>
          <p className="text-[13px] text-muted">
            기본 무료 AI는 사용량 제한이 있고, 입력 내용이 Google 제품 개선에 쓰일 수 있어요. 내 API 키를 연결하면 작업마다 더 좋은 모델을
            고를 수 있어요.
          </p>
          <Link href="/settings/ai" className="self-start text-[13px] font-semibold text-accent hover:underline">
            AI 연결 관리 →
          </Link>
        </Card>
        <Card>
          <CardTitle>계정</CardTitle>
          <p className="text-[13px]">
            <span className="text-muted">카카오 로그인 · </span>
            {me?.nickname ?? "사용자"}
          </p>
          <p className="text-xs text-muted">옷 사진과 선택 입력한 신체 정보는 코디 추천에만 사용해요. 계정을 삭제하면 전부 지워져요.</p>
          <div className="mt-auto flex gap-2">
            <Button variant="ghost" onClick={logout} loading={busy === "logout"} disabled={busy !== null}>
              로그아웃
            </Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={busy !== null}>
              계정 삭제
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={confirmOpen}
        title="계정을 삭제할까요?"
        onClose={() => {
          setConfirmOpen(false);
          setTyped("");
        }}
      >
        <div className="flex flex-col gap-3 text-[13px]">
          <p>아래 데이터가 모두 지워지고 되돌릴 수 없어요.</p>
          <ul className="list-disc pl-5 text-muted">
            <li>옷장의 모든 옷과 사진</li>
            <li>추구미, 신체 정보, 코디·대화 기록</li>
            <li>연결한 AI 키</li>
          </ul>
          <label className="flex flex-col gap-1">
            <span>
              확인을 위해 <b>{CONFIRM_TEXT}</b>라고 입력해 주세요.
            </span>
            <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="확인 문구" />
          </label>
          {error && <Banner tone="danger">{error}</Banner>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy === "delete"}>
              취소
            </Button>
            <Button variant="danger" onClick={remove} disabled={typed.trim() !== CONFIRM_TEXT} loading={busy === "delete"}>
              영구 삭제
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
