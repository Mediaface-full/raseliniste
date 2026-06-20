/* Gideon Admin · merge the shared icon-set.js into GIc as React components.
   Load AFTER gideon-ui.jsx (which defines GIc) and AFTER icon-set.js.
   Existing GIc keys are NOT overwritten — the curated originals win. */
(function () {
  const SET = window.GIDEON_ICONS;
  if (!SET || typeof GIc === 'undefined') return;
  const camel = s => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  for (const group of Object.values(SET)) {
    for (const [name, inner] of Object.entries(group)) {
      if (GIc[name]) continue; // keep curated originals
      const jsx = inner
        .replace(/stroke-width/g, 'strokeWidth')
        .replace(/stroke-linecap/g, 'strokeLinecap')
        .replace(/stroke-linejoin/g, 'strokeLinejoin');
      GIc[name] = (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: jsx }} {...p} />;
    }
  }
  window.GIc = GIc;
})();
