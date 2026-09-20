// Runs before stylesheets to avoid a light flash when dark mode was saved.
// Appearance is device-local, so signing out or restoring a route cannot reset it.
(function () {
  const storageKey = "smart-metro-appearance";
  const normalize = value => value === "dark" ? "dark" : "light";
  let current = "light";
  try { current = normalize(window.localStorage.getItem(storageKey)); } catch { /* Private storage may be unavailable. */ }
  function apply(value) {
    current = normalize(value);
    document.documentElement.dataset.theme = current;
    document.documentElement.style.colorScheme = current;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", current === "dark" ? "#0F0D0C" : "#F6F4F3");
  }
  apply(current);
  window.smartMetroTheme = {
    storageKey,
    getTheme: () => current,
    setTheme(value) {
      apply(value);
      try { window.localStorage.setItem(storageKey, current); return true; }
      catch { return false; }
    },
  };
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) apply(event.newValue);
  });
})();
