try {
  var t = localStorage.getItem('papertrade-terminal.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
