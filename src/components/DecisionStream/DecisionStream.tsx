import React from "react";
import { CoreEvent } from "../../core/types.ts";
import { DecisionOneView } from "./components/DecisionOneView.tsx";
import { DecisionTwoView } from "./components/DecisionTwoView.tsx";

interface DecisionStreamProps {
  events: CoreEvent[];
}

export const DecisionStream: React.FC<DecisionStreamProps> = ({ events }) => {
  const d1Event = [...events].reverse().find((e: CoreEvent) => e.type === "DECISION_ONE");
  const d2Event = [...events].reverse().find((e: CoreEvent) => e.type === "DECISION_TWO");

  if (!d1Event && !d2Event) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-6 py-2">
      <DecisionOneView d1Event={d1Event} />
      <DecisionTwoView d2Event={d2Event} />
    </div>
  );
};
