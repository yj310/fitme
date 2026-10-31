"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { onboardingDone, useAuth } from "@/components/providers/AuthProvider";
import { LoadingState } from "@/components/ui";

export default function Home() {
  const { status, me, meError } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "signed_out") router.replace("/welcome");
    else if (status === "signed_in" && me) router.replace(onboardingDone(me) ? "/chat" : "/onboarding");
    else if (status === "signed_in" && meError) router.replace("/chat"); // the app shell shows the error + retry
  }, [status, me, meError, router]);
  return (
    <div className="grid min-h-screen place-items-center">
      <LoadingState />
    </div>
  );
}
