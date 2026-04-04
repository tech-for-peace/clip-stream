import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ffmpegSafeBoot } from "./utils/ffmpegCleanup";

// Clear leftover FFmpeg caches from previous crashed sessions
ffmpegSafeBoot();

createRoot(document.getElementById("root")!).render(<App />);
