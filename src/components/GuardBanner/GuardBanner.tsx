import React from "react";
import { PendingApproval } from "../../core/types.ts";
import { ApprovalAction } from "./components/ApprovalAction.tsx";

interface GuardBannerProps {
  pending: PendingApproval | null;
  onApprove: () => void;
  onDeny: (reason?: string) => void;
}

export const GuardBanner: React.FC<GuardBannerProps> = ({
  pending,
  onApprove,
  onDeny,
}) => {
  if (!pending) return null;

  return (
    <div className="px-6 py-2">
      <ApprovalAction
        pending={pending}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    </div>
  );
};
