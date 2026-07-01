const express = require('express');
const router = express.Router();
const { supabase } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  let query = supabase
    .from('tickets')
    .select(`*, creator:created_by (id, name), assignee:assigned_to (id, name), asset:asset_id (title)`)
    .order('created_at', { ascending: false });

  if (req.query.asset_id) query = query.eq('asset_id', req.query.asset_id);
  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.assigned_to) query = query.eq('assigned_to', req.query.assigned_to);
  if (req.query.created_by) query = query.eq('created_by', req.query.created_by);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const tickets = (data || []).map(t => ({
    ...t,
    creator_name: t.creator?.name || null,
    assignee_name: t.assignee?.name || null,
    asset_title: t.asset?.title || null,
  }));

  res.json({ tickets });
});

router.get('/:id', async (req, res) => {
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(`*, creator:created_by (id, name), assignee:assigned_to (id, name), asset:asset_id (title)`)
    .eq('id', req.params.id).single();

  if (error) return res.status(404).json({ error: 'Ticket not found' });

  const { data: comments } = await supabase
    .from('ticket_comments')
    .select(`*, user:user_id (id, name)`)
    .eq('ticket_id', req.params.id)
    .order('created_at', { ascending: true });

  res.json({
    ticket: { ...ticket, creator_name: ticket.creator?.name, assignee_name: ticket.assignee?.name, asset_title: ticket.asset?.title },
    comments: (comments || []).map(c => ({ ...c, user_name: c.user?.name })),
  });
});

router.post('/', async (req, res) => {
  const { asset_id, title, description, priority, assigned_to } = req.body;
  if (!asset_id || !title) return res.status(400).json({ error: 'asset_id and title required' });

  const { data: asset } = await supabase.from('assets').select('title').eq('id', asset_id).single();
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const { data: ticket, error } = await supabase.from('tickets').insert({
    asset_id,
    title,
    description: description || '',
    priority: priority || 'medium',
    created_by: req.userId,
    assigned_to: assigned_to || null,
  }).select(`*, creator:created_by (name), asset:asset_id (title)`).single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('activity_log').insert({
    asset_id, user_id: req.userId,
    action: `created ticket on ${asset.title}`,
    details: { ticket_id: ticket.id, title },
  });

  res.status(201).json({ ticket: { ...ticket, creator_name: ticket.creator?.name, asset_title: ticket.asset?.title } });
});

router.patch('/:id', async (req, res) => {
  const { data: existing } = await supabase.from('tickets').select('*').eq('id', req.params.id).single();
  if (!existing) return res.status(404).json({ error: 'Ticket not found' });

  const allowed = ['status', 'priority', 'assigned_to', 'title', 'description'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) return res.json({ ticket: existing });

  updates.updated_at = new Date().toISOString();
  const { error } = await supabase.from('tickets').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('activity_log').insert({
    asset_id: existing.asset_id, user_id: req.userId,
    action: `updated ticket #${existing.id}`,
    details: updates,
  });

  const { data: ticket } = await supabase
    .from('tickets')
    .select(`*, creator:created_by (name), assignee:assigned_to (name), asset:asset_id (title)`)
    .eq('id', req.params.id).single();

  res.json({ ticket: { ...ticket, creator_name: ticket.creator?.name, assignee_name: ticket.assignee?.name, asset_title: ticket.asset?.title } });
});

router.delete('/:id', async (req, res) => {
  const { data: existing } = await supabase.from('tickets').select('*').eq('id', req.params.id).single();
  if (!existing) return res.status(404).json({ error: 'Ticket not found' });

  await supabase.from('tickets').delete().eq('id', req.params.id);
  await supabase.from('activity_log').insert({
    asset_id: existing.asset_id, user_id: req.userId,
    action: `deleted ticket #${existing.id}`,
    details: {},
  });
  res.json({ success: true });
});

router.post('/:id/comments', async (req, res) => {
  const { data: ticket } = await supabase.from('tickets').select('*').eq('id', req.params.id).single();
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });

  const { data: comment, error } = await supabase.from('ticket_comments').insert({
    ticket_id: parseInt(req.params.id), user_id: req.userId, content,
  }).select(`*, user:user_id (name)`).single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('activity_log').insert({
    asset_id: ticket.asset_id, user_id: req.userId,
    action: `commented on ticket #${ticket.id}`,
    details: {},
  });

  res.status(201).json({ comment: { ...comment, user_name: comment.user?.name } });
});

module.exports = router;
