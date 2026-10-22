import React from "react";
import { Copy, Check } from "lucide-react";
import { useClipboardCopy } from "../../hooks/useClipboardCopy.ts";

interface CopyButtonProps {
    /** Texto a copiar. Puede ser una función para construirlo recién al hacer click. */
    text: string | (() => string);
    label?: string;
    copiedLabel?: string;
    title?: string;
    ariaLabel?: string;
    /** Clases del botón (layout, colores, padding). */
    className?: string;
    /** Tamaño de los iconos (clases Tailwind). */
    iconSize?: string;
    /** Color del icono "Copiar". El check siempre es verde. */
    iconColor?: string;
    duration?: number;
    /** Evita que el click burbujee (útil dentro de cabeceras clickeables). */
    stopPropagation?: boolean;
}

/**
 * Botón de copiado con feedback temporal. Cada instancia maneja su propio estado,
 * por lo que no hace falta llevar claves ni flags `copiedX` en el componente padre.
 */
export const CopyButton: React.FC<CopyButtonProps> = ({
    text,
    label = "Copiar",
    copiedLabel = "Copiado",
    title,
    ariaLabel,
    className = "",
    iconSize = "w-3 h-3",
    iconColor = "",
    duration,
    stopPropagation = false,
}) => {
    const { copy, isCopied } = useClipboardCopy(duration);
    const copied = isCopied();

    return (
        <button
            type="button"
            onClick={(e) => {
                if (stopPropagation) e.stopPropagation();
                void copy(typeof text === "function" ? text() : text);
            }}
            title={title}
            aria-label={ariaLabel}
            className={`flex items-center transition-colors cursor-pointer ${className}`}
        >
            {copied ? (
                <>
                    <Check className={`${iconSize} text-emerald-400`} />
                    <span className="text-emerald-400">{copiedLabel}</span>
                </>
            ) : (
                <>
                    <Copy className={`${iconSize} ${iconColor}`} />
                    <span>{label}</span>
                </>
            )}
        </button>
    );
};
