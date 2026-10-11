import React from "react";
import type { PendingApproval } from "../../core/types.ts";
import { ApprovalAction } from "./components/ApprovalAction.tsx";

interface GuardBannerProps {
  pending: PendingApproval | null;
  onApprove: () => void | Promise<void>;
  onDeny: (reason?: string) => void | Promise<void>;
}

export const GuardBanner: React.FC<GuardBannerProps> = ({
  pending,
  onApprove,
  onDeny,
}) => {
  if (!pending) return null;

  return (
    <div className="sticky top-0 z-30 px-6 py-2.5 bg-slate-950/95 backdrop-blur-md border-b border-amber-900/50 shadow-xl transition-all">
      <ApprovalAction
        pending={pending}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    </div>
  );
};
