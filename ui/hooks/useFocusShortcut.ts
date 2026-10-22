import { useEffect, type RefObject } from "react";

/** Enfoca el elemento indicado con Cmd/Ctrl + K desde cualquier parte de la aplicación. */
export function useFocusShortcut(targetRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                targetRef.current?.focus();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [targetRef]);
}
