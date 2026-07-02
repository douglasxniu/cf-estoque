// Aplica o tema salvo (ou a preferência do sistema) o mais cedo possível, antes da
// primeira pintura, para não haver "flash" do tema errado ao carregar a página.
(function () {
  const KEY = 'niu_theme';
  function preferido() {
    const salvo = localStorage.getItem(KEY);
    if (salvo === 'light' || salvo === 'dark') return salvo;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', preferido());

  window.toggleTheme = function () {
    const atual = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const novo = atual === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', novo);
    localStorage.setItem(KEY, novo);
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: novo } }));
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.theme-toggle').forEach(btn => btn.addEventListener('click', window.toggleTheme));
  });
})();
