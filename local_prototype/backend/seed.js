const { supabase } = require('./db');

async function seedDatabase() {
  // Check if tables exist
  const { error: tableCheck } = await supabase.from('assets').select('id').limit(1);
  if (tableCheck && tableCheck.message && tableCheck.message.includes('schema cache')) {
    console.error('Tables not found in Supabase. Did you run the SQL schema in SQL Editor?');
    console.error('Open backend/supabase-schema.sql and run it in your Supabase dashboard.');
    return;
  }
  // Check if already seeded
  const { data: existing } = await supabase.from('assets').select('id').limit(1);
  if (existing && existing.length > 0) return;

  console.log('Seeding database...');

  // Assets
  const assets = [
    { sheet_row: 2, files_available: 'June', title: 'COOTIES', video_location: '/amagicloud-lionsgate/Media/S3/MOVSP/9382654.mp4', cc_location: '', first_air_date: '6/24', amagi_comments: 'Hires Uploaded', notes: '', editor_status: 'Working', reviewer_status: 'Pending', extra_col_h: '1' },
    { sheet_row: 3, files_available: 'June', title: 'THE BANK JOB', video_location: '/amagicloud-lionsgate/Media/S3/MOVSP/9381995.mp4', first_air_date: '6/24', amagi_comments: 'Hires Uploaded', editor_status: 'Pending', reviewer_status: 'Pending' },
    { sheet_row: 4, files_available: 'June', title: 'HARD CANDY', video_location: '/amagicloud-lionsgate/Media/S3/MOVSP/9381734.mp4', first_air_date: '6/24', amagi_comments: 'Pending', notes: 'Fix CC timing', editor_status: 'Re-Edit', reviewer_status: 'Re-Edit' },
    { sheet_row: 5, files_available: 'June', title: 'ANNA (2019)', video_location: '/amagicloud-lionsgate/Intermediate/hi-res/2550459.mp4', first_air_date: '6/24', amagi_comments: 'Hires Uploaded', editor_status: 'Pending', reviewer_status: 'Pending' },
    { sheet_row: 6, files_available: 'June', title: 'MATADOR, THE', video_location: '/amagicloud-lionsgate/Intermediate/hi-res/3770075.mp4', first_air_date: '6/24', amagi_comments: 'Hires Uploaded', editor_status: 'Pending', reviewer_status: 'Pending' },
    { sheet_row: 7, files_available: 'June', title: 'WAXWORK', video_location: '/amagicloud-lionsgate/Intermediate/hi-res/1001336.mp4', first_air_date: '6/24', amagi_comments: 'Hires Uploaded', editor_status: 'Working', reviewer_status: 'Pending' },
    { sheet_row: 8, files_available: 'June', title: 'JULIET, NAKED', video_location: '/amagicloud-lionsgate/Media/S3/MOVSP/9382801.mp4', first_air_date: '6/30', amagi_comments: 'Hires Uploaded', editor_status: 'Pending', reviewer_status: 'Pending' },
    { sheet_row: 9, files_available: 'June', title: 'HUNTERS PRAYER', video_location: '/amagicloud-lionsgate/Intermediate/hi-res/3150012.mp4', first_air_date: '6/30', amagi_comments: 'Hires Uploaded', editor_status: 'Working', reviewer_status: 'Pending' },
    { sheet_row: 10, files_available: 'June', title: 'BLEEDING STEEL', video_location: '/amagicloud-lionsgate/Intermediate/hi-res/1620605.mp4', first_air_date: '6/30', amagi_comments: 'Hires Uploaded', editor_status: 'Pending', reviewer_status: 'Pending' },
    { sheet_row: 11, files_available: 'June', title: 'RARE BIRDS', video_location: '/amagicloud-lionsgate/Intermediate/hi-res/9380213.mp4', first_air_date: '7/8', amagi_comments: 'Hires Uploaded', editor_status: 'Rendered Prev & Hires', reviewer_status: 'Need to Review' },
    { sheet_row: 12, files_available: 'June', title: 'SHOT CALLER', video_location: '/amagicloud-lionsgate/Intermediate/hi-res/3150021.mp4', first_air_date: '7/8', amagi_comments: 'Hires Uploaded', editor_status: 'Downloaded', reviewer_status: 'Pending' },
    { sheet_row: 13, files_available: 'June', title: 'CELL', video_location: '/amagicloud-lionsgate/Intermediate/hi-res/3150005.mp4', first_air_date: '8/19', amagi_comments: 'Pending', notes: '', editor_status: 'Uploaded - Need to verify', reviewer_status: 'Pending' },
    { sheet_row: 14, files_available: 'June', title: 'WAXWORK II', video_location: '/amagicloud-lionsgate/Intermediate/hi-res/1001336.mp4', first_air_date: '6/24', amagi_comments: 'Hires Uploaded', editor_status: 'Send for approval', reviewer_status: 'Need to Review' },
  ];

  const { error: assetError } = await supabase.from('assets').insert(assets);
  if (assetError) console.error('Seed assets error:', assetError.message);

  // Activity log
  const { error: activityError } = await supabase.from('activity_log').insert([
    { action: 'System initialized database', details: {} },
    { action: 'Seeded 13 assets from sheet', details: {} },
  ]);
  if (activityError) console.error('Seed activity error:', activityError.message);

  console.log('Database seeded successfully');
}

module.exports = { seedDatabase };
