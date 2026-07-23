import { Router } from 'express';

/** 小程序公开配置（不含密钥） */
export function configRoutes() {
  const router = Router();

  router.get('/public', (_req, res) => {
    res.json({
      subscribeTemplates: {
        orderDone: process.env.WX_SUBSCRIBE_TEMPLATE_ORDER_DONE || '',
      },
      devMode: process.env.DEV_MODE !== 'false',
    });
  });

  return router;
}
