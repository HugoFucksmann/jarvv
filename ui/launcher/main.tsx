import { createRoot } from "react-dom/client";
import { Launcher } from "./Launcher.tsx";
import { setupNativeWindow } from "./nativeWindow.ts";
import "../index.css";
import "./launcher.css";

const root = document.getElementById("root")!;
createRoot(root).render(<Launcher />);
setupNativeWindow(root);
