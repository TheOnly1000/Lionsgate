const supabase = require('./supabase');

// Map DB row (snake_case) to camelCase for frontend
function mapAsset(row) {
  if (!row) return null;
  return {
    ...row,
    editor_name: row.editor_name || null,
    reviewer_name: row.reviewer_name || null,
    editor_statuses: EDITOR_STATUSES,
    reviewer_statuses: REVIEWER_STATUSES,
    amagi_options: AMAGI_COMMENTS,
  };
}

function mapTicket(row) {
  if (!row) return null;
  return row;
}

const EDITOR_STATUSES = ["Pending","Working","Converted","Downloaded","Issue","Kept for Converting","Kept for downloading","Movie not available","Need to Review","Not Available in S3","Re-Edit","Re-Edit Done","Re-Render","Re-Upload","Re-Uploading","Re-work","Ready for Hi-Rez","Ready to upload","Renderd Hi-Res file","Rendered Prev & Hires","Rendered Preview file","Rendering Hi-Res file","Rendering Preview file","Review Done","Reviewing","Send for approval","Subtitle not available","Transcording","Uploaded","Uploading","Already Done","Uploaded - Need to verify","Re-Work"];
const REVIEWER_STATUSES = ["Need to Review","Reviewing","Review Done","Approved","Re-Edit","Re-Work","Re-Re-Render","Issue"];
const AMAGI_COMMENTS = ["Approved","Working","Pending","SharedPrev","No subtitle","Not Available in S3","Hires Uploaded","Ready to Share","Already Received Before","Location Paths Not Available","Received","Subtitle issue"];

module.exports = { supabase, mapAsset, mapTicket, EDITOR_STATUSES, REVIEWER_STATUSES, AMAGI_COMMENTS };
