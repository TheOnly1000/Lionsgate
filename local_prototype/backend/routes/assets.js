const express = require('express');
const router = express.Router();
const { supabase, mapAsset } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('assets')
    .select(`
      *,
      editor:assigned_editor (id, name, email, role),
      reviewer:assigned_reviewer (id, name, email, role)
    `)
    .order('sheet_row', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const assets = (data || []).map(a => ({
    ...a,
    editor_name: a.editor?.name || null,
    reviewer_name: a.reviewer?.name || null,
    editor_statuses: EDITOR_STATUSES,
    reviewer_statuses: REVIEWER_STATUSES,
    amagi_options: AMAGI_COMMENTS,
  }));

  res.json({ assets });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('assets')
    .select(`
      *,
      editor:assigned_editor (id, name, email, role),
      reviewer:assigned_reviewer (id, name, email, role)
    `)
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Asset not found' });
  res.json({ asset: mapAsset(data) });
});

router.patch('/:id', async (req, res) => {
  const { data: asset, error: fetchError } = await supabase
    .from('assets').select('*').eq('id', req.params.id).single();
  if (fetchError) return res.status(404).json({ error: 'Asset not found' });

  const allowed = ['editor_status', 'reviewer_status', 'amagi_comments', 'notes', 'assigned_editor', 'assigned_reviewer'];
  const updates = {};
  const logEntries = [];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const oldVal = asset[key];
      const newVal = req.body[key];
      if (String(oldVal || '') !== String(newVal || '')) {
        updates[key] = newVal;
        logEntries.push({ field: key, old: oldVal, new: newVal });
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.json({ asset: mapAsset(asset) });
  }

  // Auto-workflow
  if (req.body.editor_status === 'Send for approval') updates.reviewer_status = 'Need to Review';
  if (req.body.reviewer_status === 'Approved') { updates.amagi_comments = 'Approved'; updates.editor_status = 'Approved'; }
  if (req.body.reviewer_status === 'Re-Edit') updates.editor_status = 'Re-Edit';

  updates.updated_at = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('assets').update(updates).eq('id', req.params.id);
  if (updateError) return res.status(500).json({ error: updateError.message });

  // Log activity
  for (const entry of logEntries) {
    await supabase.from('activity_log').insert({
      asset_id: parseInt(req.params.id),
      user_id: req.userId,
      action: `changed ${fieldLabel(entry.field)} → ${entry.new}`,
      details: entry,
    });
  }
  if (req.body.editor_status === 'Send for approval') {
    await supabase.from('activity_log').insert({
      asset_id: parseInt(req.params.id),
      user_id: req.userId,
      action: `sent ${asset.title} for approval`,
      details: { editor_status: 'Send for approval' },
    });
  }

  const { data: updated } = await supabase
    .from('assets')
    .select(`*, editor:assigned_editor (id, name), reviewer:assigned_reviewer (id, name)`)
    .eq('id', req.params.id).single();

  res.json({ asset: mapAsset(updated) });
});

function fieldLabel(key) {
  const map = { editor_status: 'Editor Status', reviewer_status: 'Reviewer Status', amagi_comments: 'Amagi Comments', notes: 'Notes', assigned_editor: 'Editor Assignment', assigned_reviewer: 'Reviewer Assignment' };
  return map[key] || key;
}

const EDITOR_STATUSES = ["Pending","Working","Converted","Downloaded","Issue","Kept for Converting","Kept for downloading","Movie not available","Need to Review","Not Available in S3","Re-Edit","Re-Edit Done","Re-Render","Re-Upload","Re-Uploading","Re-work","Ready for Hi-Rez","Ready to upload","Renderd Hi-Res file","Rendered Prev & Hires","Rendered Preview file","Rendering Hi-Res file","Rendering Preview file","Review Done","Reviewing","Send for approval","Subtitle not available","Transcording","Uploaded","Uploading","Already Done","Uploaded - Need to verify","Re-Work"];
const REVIEWER_STATUSES = ["Need to Review","Reviewing","Review Done","Approved","Re-Edit","Re-Work","Re-Re-Render","Issue"];
const AMAGI_COMMENTS = ["Approved","Working","Pending","SharedPrev","No subtitle","Not Available in S3","Hires Uploaded","Ready to Share","Already Received Before","Location Paths Not Available","Received","Subtitle issue"];

module.exports = router;
