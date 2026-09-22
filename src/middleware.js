export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Steam 로그인이 필요합니다.' });
  }
  next();
}
