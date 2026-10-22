import React from "react";
import { AlertCircle, X } from "lucide-react";

interface ErrorBannerProps {
    message: string;
    onClose: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onClose }) => (
    <div
        role="alert"
        className="mx-6 mt-3 p-3 bg-rose-950/70 border border-rose-900 rounded-lg text-rose-200 text-xs flex items-center justify-between shadow-md"
    >
        <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-mono">{message}</span>
        </div>
        <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar notificación de error"
            className="text-rose-400 hover:text-rose-200 cursor-pointer p-0.5 transition-colors"
        >
            <X className="w-4 h-4" />
        </button>
    </div>
);
