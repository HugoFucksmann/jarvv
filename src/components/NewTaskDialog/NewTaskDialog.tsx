import React, { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

interface NewTaskDialogProps {
    /** Cancela la tarea en curso y prepara la vista para una nueva. */
    onConfirm: () => Promise<void>;
    onDismiss: () => void;
}

/** Confirmación previa a iniciar una tarea nueva mientras otra sigue ejecutándose. */
export const NewTaskDialog: React.FC<NewTaskDialogProps> = ({ onConfirm, onDismiss }) => {
    const [isCancelling, setIsCancelling] = useState(false);

    const handleDismiss = () => {
        if (!isCancelling) onDismiss();
    };

    const handleConfirm = async () => {
        setIsCancelling(true);
        try {
            await onConfirm();
        } finally {
            setIsCancelling(false);
        }
    };

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !isCancelling) onDismiss();
        };
        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [isCancelling, onDismiss]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-task-dialog-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
        >
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-5 text-slate-100 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-900/60 text-amber-400 shrink-0">
                        <AlertCircle className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <h3 id="new-task-dialog-title" className="text-sm font-semibold text-slate-100">
                            Tarea en ejecución activa
                        </h3>
                        <p className="text-xs text-slate-400 leading-relaxed">
                            Hay una tarea actualmente procesando llamadas y modelos en el servidor backend. Para iniciar una nueva tarea limpia, es necesario cancelar la ejecución en curso.
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
                    <button
                        type="button"
                        disabled={isCancelling}
                        onClick={handleDismiss}
                        className="px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                    >
                        Volver
                    </button>
                    <button
                        type="button"
                        disabled={isCancelling}
                        onClick={handleConfirm}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-md transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                    >
                        {isCancelling ? (
                            <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Cancelando...</span>
                            </>
                        ) : (
                            <span>Cancelar tarea y empezar otra</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};