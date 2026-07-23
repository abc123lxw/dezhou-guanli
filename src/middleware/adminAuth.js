export function adminAuthMiddleware(db) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '请先登录吧台账号' });

    const admin = db.prepare('SELECT id, username, display_name, role FROM admin_users WHERE id = ? AND enabled = 1')
      .get(token);
    if (!admin) return res.status(401).json({ error: '登录已失效' });

    req.admin = admin;
    next();
  };
}
