/** 后台视觉辅助：商品/原料分类与配图（真实鸡尾酒照片） */

const DRINK_CATEGORIES = new Set(['经典', '特调', '德州主题', '无酒精', '啤酒', '酒券套餐', '团购券', '积分商城']);
const FOOD_CATEGORIES = new Set(['小吃']);

const DRINK_IMG = {
  '长岛冰茶': 'long-island.jpg',
  '尼格罗尼': 'old-fashioned.jpg',
  '古典': 'old-fashioned.jpg',
  '金汤力': 'mojito.jpg',
  '绯红佳人': 'long-island.jpg',
  '洛神玫瑰': 'mojito.jpg',
  'All IN 孤注一掷': 'old-fashioned.jpg',
  '红心皇后': 'long-island.jpg',
  '黑桃A': 'old-fashioned.jpg',
  '百香青柠气泡水': 'soda.jpg',
  '椰汁': 'soda.jpg',
  '科罗娜': 'beer.jpg',
  '1664': 'beer.jpg',
  '香辣毛豆': 'lemon.jpg',
  '薯条': 'lemon.jpg',
  '78元酒券套餐': 'old-fashioned.jpg',
  '下午场券': 'soda.jpg',
};

const INGREDIENT_IMG = {
  伏特加: 'vodka.jpg',
  威士忌: 'whiskey-bottle.jpg',
  朗姆酒: 'rum.jpg',
  金酒: 'gin.jpg',
  柠檬: 'lemon-slice.jpg',
  青柠: 'lime.jpg',
  苏打水: 'soda-water.jpg',
  薄荷叶: 'mint.jpg',
  冰块: 'ice.jpg',
  糖浆: 'syrup.jpg',
};

function productShelf(category) {
  if (FOOD_CATEGORIES.has(category)) return 'food';
  if (DRINK_CATEGORIES.has(category)) return 'drink';
  return 'other';
}

function shelfLabel(shelf) {
  const labels = { drink: '酒水', food: '小吃', other: '其他' };
  const icons = { drink: 'products', food: 'food', other: 'package' };
  const name = labels[shelf] || shelf;
  if (window.Ico) {
    return `<span class="shelf-title">${Ico.icon(icons[shelf] || 'package', 'ico ico-sm')}<span>${name}</span></span>`;
  }
  return name;
}

function productThumb(name, category) {
  if (window.Ico) {
    const key = DRINK_IMG[name] ? name : null;
    if (key) {
      const src = `/admin/assets/img/drinks/${DRINK_IMG[key]}`;
      return `<div class="thumb-wrap thumb-product"><img class="thumb-img" src="${src}" alt="${name}" /></div>`;
    }
    return Ico.productThumb(name, category);
  }
  return '';
}

function inventoryThumb(name) {
  if (window.Ico?.inventoryThumb) {
    return Ico.inventoryThumb(name);
  }
  const file = INGREDIENT_IMG[name];
  const src = file
    ? `/admin/assets/img/ingredients/${file}`
    : '/admin/assets/img/categories/ingredient.jpg';
  return `<div class="thumb-wrap thumb-inv"><img class="thumb-img" src="${src}" alt="${name}" /></div>`;
}

window.AdminUI = {
  productShelf,
  shelfLabel,
  productThumb,
  inventoryThumb,
  DRINK_CATEGORIES,
  FOOD_CATEGORIES,
};
