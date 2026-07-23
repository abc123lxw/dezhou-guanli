/** 限制仅老板/指定角色可访问 */
export function requireAdminRole(...roles) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: '未登录' });
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ error: '当前账号无此操作权限' });
    }
    next();
  };
}
