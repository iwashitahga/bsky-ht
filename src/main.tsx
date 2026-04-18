import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// dev で localhost アクセスだと OAuth の redirect_uri (127.0.0.1) と
// オリジンが一致せず session storage が分離するので 127.0.0.1 に揃える
if (
  import.meta.env.DEV &&
  window.location.hostname === "localhost"
) {
  window.location.replace(
    window.location.href.replace(
      /^http:\/\/localhost(:|\/)/,
      "http://127.0.0.1$1",
    ),
  );
} else {
  // NOTE: StrictMode を外してある
  // OAuth の init() が dev で二重実行されると DPoP 鍵が競合する可能性があるため
  createRoot(document.getElementById("root")!).render(<App />);
}
