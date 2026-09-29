/* 共享：今日页背景注入 + 浅/深主题切换 */
(function () {
  var sparkles = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

  var backdrop = document.createElement('div');
  backdrop.className = 'today-bg';
  backdrop.innerHTML =
    '<div class="today-topbar">' +
      '<div><h2>下午好</h2><p>9月26日 星期五 · 规律的小事，也值得认真对待。</p></div>' +
      '<span class="today-ai-pill">' + sparkles + 'AI 助手</span>' +
    '</div>' +
    '<div class="week-strip">' +
      '<span>一<br>22</span><span>二<br>23</span><span>三<br>24</span><span>四<br>25</span>' +
      '<span class="is-today">五<br>26</span><span>六<br>27</span><span>日<br>28</span>' +
    '</div>' +
    '<div class="today-progress">' +
      '<div class="ring"><i>66%</i></div>' +
      '<div><strong>今日已服 2 / 3 次</strong><span>下一次：21:30 瑞舒伐他汀</span></div>' +
    '</div>' +
    '<div class="today-med"><span class="dot"></span><div><b>阿司匹林</b><small>08:00 · 每次 1 片 · 饭后</small></div><em>已服</em></div>' +
    '<div class="today-med"><span class="dot"></span><div><b>维生素 C</b><small>12:30 · 每次 1 片</small></div><em>已服</em></div>' +
    '<div class="today-med"><span class="dot"></span><div><b>瑞舒伐他汀</b><small>21:30 · 每次 1 片</small></div><em class="warn">待服</em></div>';

  var tabbar = document.createElement('div');
  tabbar.className = 'tabbar-skeleton';
  tabbar.innerHTML = '<i class="on"></i><i></i><i></i><i></i>';

  var screen = document.querySelector('.screen');
  screen.prepend(backdrop);
  screen.appendChild(tabbar);

  var toggle = document.querySelector('.theme-toggle');
  var phone = document.querySelector('.phone');
  if (toggle && phone) {
    toggle.addEventListener('click', function () {
      var dark = phone.getAttribute('data-theme') === 'dark';
      phone.setAttribute('data-theme', dark ? 'light' : 'dark');
      toggle.querySelector('span').textContent = dark ? '深色预览' : '浅色预览';
    });
  }
})();
