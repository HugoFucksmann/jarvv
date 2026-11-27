/** Ancho de la ventana nativa (Tauri): igual al de `src-tauri/src/main.rs`. */
const WINDOW_WIDTH = 640;

/** Lo que se maneja con el mouse o se selecciona: ahí no se arrastra la ventana. */
const NO_DRAG = "button, input, textarea, select, a, [role=switch], .select-text";

/**
 * Dentro de la app nativa: la ventana crece y se achica con el contenido (así no queda un rectángulo transparente que tape lo que hay debajo)
 * y se arrastra desde cualquier parte que no sea un control o texto. En el navegador no hace nada.
 */
export function setupNativeWindow(root: HTMLElement): void {
  if (!("__TAURI_INTERNALS__" in window)) return;
  void Promise.all([import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi")]).then(([{ getCurrentWindow }, { LogicalSize }]) => {
    const win = getCurrentWindow();

    let last = 0;
    new ResizeObserver(() => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height > 0 && height !== last) {
        last = height;
        void win.setSize(new LogicalSize(WINDOW_WIDTH, height));
      }
    }).observe(root);

    document.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || !(e.target instanceof Element) || e.target.closest(NO_DRAG)) return;
      void win.startDragging();
    });
  });
}
