import React from "react";
import {
    CheckCircle2,
    AlertCircle,
    Clock,
    ShieldX,
    HelpCircle,
    Loader2,
    Layers,
} from "lucide-react";

interface StepStatusIconProps {
    /** Estado del paso. Sin estado (p. ej. grupos de planificación) se muestra un icono neutro. */
    state?: string;
    size?: "sm" | "md";
}

const SIZE_CLASS = { sm: "w-3.5 h-3.5", md: "w-4 h-4" } as const;

export const StepStatusIcon: React.FC<StepStatusIconProps> = ({ state, size = "md" }) => {
    const base = `${SIZE_CLASS[size]} shrink-0`;

    switch (state) {
        case "COMPLETED":
            return <CheckCircle2 className={`${base} text-emerald-400`} />;
        case "RUNNING":
            return <Loader2 className={`${base} text-sky-400 animate-spin`} />;
        case "FAILED":
            return <AlertCircle className={`${base} text-rose-500`} />;
        case "UNVERIFIED":
            return <HelpCircle className={`${base} text-amber-400`} />;
        case "BLOCKED":
            return <ShieldX className={`${base} text-orange-500`} />;
        case "PENDING":
            return <Clock className={`${base} text-slate-600`} />;
        default:
            return <Layers className={`${base} text-slate-400`} />;
    }
};
