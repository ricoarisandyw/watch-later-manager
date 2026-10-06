// Content scripts can't be ES modules directly, so this tiny file loads the real one.
(async () => {
  if (window.__mwlLoader) return;
  window.__mwlLoader = true;
  try {
    await import(chrome.runtime.getURL('content/overlay.js'));
  } catch (err) {
    console.error('[My Watch Later] could not start', err);
  }
})();
