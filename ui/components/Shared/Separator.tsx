import React from "react";

export interface SeparatorProps {
    className?: string;
}

export const Separator: React.FC<SeparatorProps> = ({ className = "" }) => (
    <span aria-hidden="true" className={`text-slate-600 ${className}`.trim()}>
        ·
    </span>
);
