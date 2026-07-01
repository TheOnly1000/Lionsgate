const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const assetsRoutes = require('./routes/assets');
const ticketsRoutes = require('./routes/tickets');
const activityRoutes = require('./routes/activity');
const usersRoutes = require('./routes/users');
const { seedDatabase } = require('./seed');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Seed database on first run
seedDatabase().catch(console.error);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/users', usersRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..')));

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found' });
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Lionsgate Backend running on http://localhost:${PORT}`);
});
