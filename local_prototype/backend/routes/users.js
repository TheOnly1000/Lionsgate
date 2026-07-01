const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('profiles').select('*').order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data || [] });
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const allowed = ['role', 'is_active', 'name'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('profiles').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data });
});

module.exports = router;
