// Applies 화면 모드 (시스템/라이트/다크) before the styles load, so dark mode
// does not flash light. The app keeps it in step afterwards (src/web/app.js).
(function () {
  let mode = "system";
  try { mode = localStorage.getItem("inochi-theme-mode") || "system"; } catch { /* storage may be blocked */ }
  const dark = mode === "dark" || (mode !== "light" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
