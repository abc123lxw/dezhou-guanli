import { Router } from 'express';
import { cacheGet, cacheSet } from '../lib/memoryCache.js';

const PRODUCTS_KEY = 'products:all';
const PRODUCTS_TTL = 60_000;

function loadProducts(db) {
  const cached = cacheGet(PRODUCTS_KEY);
  if (cached) return cached;

  const products = db.prepare(`
    SELECT id, name, category, price_cents, points_reward, points_redeem_cost, image_url, description
    FROM products WHERE enabled = 1 AND sold_out = 0 ORDER BY sort_order, category, name
  `).all();
  const categories = [...new Set(products.map((p) => p.category))];
  const payload = { products, categories };
  cacheSet(PRODUCTS_KEY, payload, PRODUCTS_TTL);
  return payload;
}

export function productRoutes(db) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(loadProducts(db));
  });

  return router;
}
