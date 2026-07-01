const express = require('express');
const router = express.Router();
const { supabase } = require('../db');

router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: name || email.split('@')[0] },
  });

  if (authError) return res.status(400).json({ error: authError.message, detail: 'createUser failed' });
  if (!authData?.user) return res.status(500).json({ error: 'User creation returned no user', detail: JSON.stringify(authData) });

  // Profile should be created by DB trigger. If not, create manually.
  let { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();
  if (profileError && profileError.code !== 'PGRST116') { // PGRST116 = not found
    console.error('Profile fetch error:', profileError);
  }

  if (!profile) {
    const insertResult = await supabase.from('profiles').insert({
      id: authData.user.id,
      email,
      name: name || email.split('@')[0],
      role: 'editor',
    }).select().single();
    if (insertResult.error) {
      console.error('Profile insert error:', insertResult.error);
      return res.status(500).json({ error: 'Failed to create profile: ' + insertResult.error.message });
    }
    profile = insertResult.data;
  } else if (name) {
    await supabase.from('profiles').update({ name }).eq('id', authData.user.id);
    profile.name = name;
  }

  res.json({ user: profile });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
  if (!profile || !profile.is_active) return res.status(401).json({ error: 'Account inactive' });

  res.json({
    session: data.session,
    user: profile,
  });
});

router.post('/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    await supabase.auth.admin.signOut(token);
  }
  res.json({ success: true });
});

router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (!profile || !profile.is_active) return res.status(401).json({ error: 'Account inactive' });

  res.json({ user: profile });
});

module.exports = router;
