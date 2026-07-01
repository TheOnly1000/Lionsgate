const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  let query = supabase
    .from('activity_log')
    .select(`*, user:user_id (id, name), asset:asset_id (title)`)
    .order('created_at', { ascending: false });

  if (req.query.user_id) query = query.eq('user_id', req.query.user_id);
  if (req.query.asset_id) query = query.eq('asset_id', req.query.asset_id);

  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const { count } = await supabase.from('activity_log').select('*', { count: 'exact', head: true });

  const activities = (data || []).map(a => ({
    ...a,
    user_name: a.user?.name || null,
    asset_title: a.asset?.title || null,
  }));

  res.json({ activities, total: count });
});

module.exports = router;
