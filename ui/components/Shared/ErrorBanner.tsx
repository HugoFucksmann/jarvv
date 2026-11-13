import React from "react";
import { AlertCircle, X } from "lucide-react";

interface ErrorBannerProps {
    message: string;
    onClose: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onClose }) => (
    <div
        role="alert"
        className="mx-6 2xl:mx-10 mt-3 p-3 bg-rose-950/50 border border-rose-900/70 rounded-lg text-rose-200 text-[13px] flex items-start justify-between gap-3 shadow-md"
    >
        <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-px" />
            <span className="font-mono break-words min-w-0">{message}</span>
        </div>
        <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar notificación de error"
            className="text-rose-400 hover:text-rose-200 cursor-pointer p-0.5 transition-colors shrink-0"
        >
            <X className="w-4 h-4" />
        </button>
    </div>
);