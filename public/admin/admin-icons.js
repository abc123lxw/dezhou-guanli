/** 统一 SVG 图标 + 分类配图 */
(function () {
  const IMG = '/admin/assets/img/categories';

  const SVG_ATTR = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

  const PATHS = {
    board: '<rect x="3" y="3" width="7" height="18" rx="1.5"/><rect x="14" y="3" width="7" height="10" rx="1.5"/><rect x="14" y="17" width="7" height="4" rx="1"/>',
    floor: '<ellipse cx="12" cy="14" rx="9" ry="5"/><path d="M5 14v2c0 2.8 3.1 5 7 5s7-2.2 7-5v-2"/><path d="M12 9v5"/><circle cx="12" cy="7" r="2"/>',
    redeem: '<path d="M4 8h16v12H4z"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M9 13h6"/>',
    history: '<path d="M3 6h18"/><path d="M7 6v14"/><path d="M11 10h7"/><path d="M11 14h5"/><path d="M11 18h7"/>',
    members: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    products: '<path d="M8 4h8l1 4H7l1-4z"/><path d="M6 8h12v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8z"/><path d="M10 12h4"/>',
    inventory: '<path d="M4 7h16v13H4z"/><path d="M8 7V5h8v2"/><path d="M8 11h8"/><path d="M8 15h5"/>',
    stats: '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19V11"/>',
    tools: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    bell: '<path d="M18 16V11a6 6 0 1 0-12 0v5l-2 2h16l-2-2z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    sound: '<path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    soundOff: '<path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>',
    fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    warning: '<path d="M12 9v4"/><circle cx="12" cy="16" r=".8" fill="currentColor" stroke="none"/><path d="M10.3 4.3h3.4L20 18a1.5 1.5 0 0 1-1.3 2.2H5.3A1.5 1.5 0 0 1 4 18L10.3 4.3z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    drink: '<path d="M8 3h8v3l-2 14H10L8 6V3z"/><path d="M8 6h8"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    ticket: '<path d="M4 8h16v8H4z"/><path d="M8 8V6h8v2"/><path d="M12 8v8"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10h.01M18 14h.01"/>',
    star: '<path d="M12 2l2.9 6.1L22 9.3l-4.8 4.2L18.2 22 12 18.6 5.8 22l1-8.5L2 9.3l7.1-1.2L12 2z"/>',
    groupon: '<circle cx="9" cy="9" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7.5 16.5L16.5 7.5"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-3-3"/>',
    table: '<rect x="3" y="10" width="18" height="3" rx="1"/><path d="M6 13v5M18 13v5"/>',
    package: '<path d="M12 2l8 4.5v7L12 22l-8-8.5v-7L12 2z"/><path d="M12 22V11"/><path d="M20 6.5L12 11 4 6.5"/>',
    food: '<path d="M4 15h16"/><path d="M7 15V9a2 2 0 0 1 4 0v6"/><path d="M11 15V7a2 2 0 0 1 4 0v8"/><path d="M15 15V10a2 2 0 0 1 4 0v5"/>',
  };

  const THUMB_MAP = {
    cocktail: `${IMG}/cocktail.jpg`,
    beer: `${IMG}/beer.jpg`,
    food: `${IMG}/food.jpg`,
    soda: `${IMG}/soda.jpg`,
    whiskey: `${IMG}/cocktail.jpg`,
    ticket: `${IMG}/ticket.jpg`,
    groupon: `${IMG}/groupon.jpg`,
    points: `${IMG}/points.jpg`,
    cash: `${IMG}/cash.jpg`,
    ingredient: `${IMG}/ingredient.jpg`,
    poker: `${IMG}/groupon.jpg`,
    default: `${IMG}/cocktail.jpg`,
  };

  function icon(name, className = 'ico') {
    const body = PATHS[name];
    if (!body) return '';
    return `<svg class="${className}" ${SVG_ATTR} aria-hidden="true">${body}</svg>`;
  }

  function thumb(key, alt = '') {
    const src = THUMB_MAP[key] || THUMB_MAP.default;
    const safeAlt = String(alt).replace(/"/g, '&quot;');
    return `<img class="thumb-img" src="${src}" alt="${safeAlt}" loading="lazy" />`;
  }

  function thumbWrap(key, alt = '', extraClass = '') {
    return `<div class="thumb-wrap ${extraClass}">${thumb(key, alt)}</div>`;
  }

  function shelfLabel(shelf) {
    const labels = { drink: '酒水', food: '小吃', other: '其他' };
    const icons = { drink: 'products', food: 'food', other: 'package' };
    const k = icons[shelf] || 'package';
    const imgKey = { drink: 'cocktail', food: 'food', other: 'ingredient' }[shelf] || 'default';
    return `<span class="shelf-title">${icon(k, 'ico ico-sm')}${labels[shelf] || shelf}</span>`;
  }

  function injectStaticIcons() {
    document.querySelectorAll('[data-icon]').forEach((el) => {
      const name = el.dataset.icon;
      const cls = el.dataset.iconClass || (el.classList.contains('nav-ico') ? 'ico ico-nav' : 'ico');
      el.innerHTML = icon(name, cls);
    });
    document.querySelectorAll('[data-thumb]').forEach((el) => {
      const key = el.dataset.thumb;
      const alt = el.dataset.thumbAlt || '';
      el.innerHTML = thumb(key, alt);
    });
  }

  function productThumbKey(name, category) {
    if (name?.includes('美团') || name?.includes('抖音')) return 'groupon';
    if (name?.includes('薯条') || name?.includes('毛豆') || name?.includes('小吃')) return 'food';
    if (name?.includes('科罗娜') || name?.includes('1664') || name?.includes('啤酒')) return 'beer';
    if (name?.includes('苏打') || name?.includes('可乐') || name?.includes('无酒精')) return 'soda';
    if (name?.includes('威士忌') || name?.includes('古典') || name?.includes('尼格罗尼')) return 'whiskey';
    if (category === '团购券' || category === '酒券套餐') return 'ticket';
    if (category === '积分商城') return 'points';
    if (category === '德州主题') return 'poker';
    if (category === '啤酒') return 'beer';
    if (category === '小吃') return 'food';
    if (category === '无酒精') return 'soda';
    if (category === '特调' || category === '经典') return 'cocktail';
    return 'cocktail';
  }

  function inventoryThumbKey(name) {
    if (name?.includes('啤酒')) return 'beer';
    if (name?.includes('柠檬') || name?.includes('青柠') || name?.includes('薄荷')) return 'ingredient';
    if (name?.includes('威士忌') || name?.includes('伏特加') || name?.includes('朗姆') || name?.includes('金酒')) return 'whiskey';
    return 'ingredient';
  }

  function productThumb(name, category) {
    return thumbWrap(productThumbKey(name, category), name, 'thumb-product');
  }

  function inventoryThumb(name) {
    return thumbWrap(inventoryThumbKey(name), name, 'thumb-inv');
  }

  window.Ico = {
    icon, thumb, thumbWrap, injectStaticIcons, productThumb, inventoryThumb, productThumbKey, inventoryThumbKey,
  };
})();
