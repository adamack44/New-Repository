// ============================================================
// Admin API — returns all stylist data for admin dashboard
// Protected by checking email against admin_users table
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.salonassistcx.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { action, email, stylist_id, data } = req.body;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // ── VERIFY ADMIN ──────────────────────────────────────────
  async function isAdmin(email) {
    const res = await fetch(`${supabaseUrl}/rest/v1/admin_users?email=eq.${encodeURIComponent(email)}&select=email`, { headers });
    const data = await res.json();
    return Array.isArray(data) && data.length > 0;
  }

  if (!email) return res.status(401).json({ error: 'Email required' });
  const adminCheck = await isAdmin(email);
  if (!adminCheck) return res.status(403).json({ error: 'Not authorized' });

  try {
    // ── GET ALL DATA ──────────────────────────────────────────
    if (action === 'get_dashboard') {
      // All stylists
      const stylistsRes = await fetch(
        `${supabaseUrl}/rest/v1/stylists?select=id,name,email,slug,salon_name,city,state,subscription_status,stripe_customer_id,stripe_subscription_id,created_at,photo_url`,
        { headers }
      );
      const stylists = await stylistsRes.json();

      // All appointments
      const apptsRes = await fetch(
        `${supabaseUrl}/rest/v1/appointments?select=id,stylist_id,status,created_at,date`,
        { headers }
      );
      const appointments = await apptsRes.json();

      // All services
      const svcsRes = await fetch(
        `${supabaseUrl}/rest/v1/services?select=stylist_id,price_cents,is_active`,
        { headers }
      );
      const services = await svcsRes.json();

      return res.status(200).json({ stylists, appointments, services });
    }

    // ── ACTIVATE / DEACTIVATE ─────────────────────────────────
    if (action === 'set_status') {
      const { status } = data;
      const r = await fetch(
        `${supabaseUrl}/rest/v1/stylists?id=eq.${stylist_id}`,
        { method: 'PATCH', headers, body: JSON.stringify({ subscription_status: status }) }
      );
      const result = await r.json();
      return res.status(200).json({ success: true, result });
    }

    // ── DELETE STYLIST ────────────────────────────────────────
    if (action === 'delete_stylist') {
      // Delete stylist row (cascades to availability, appointments, services)
      await fetch(`${supabaseUrl}/rest/v1/stylists?id=eq.${stylist_id}`, { method: 'DELETE', headers });

      // Delete auth user
      const authRes = await fetch(
        `${supabaseUrl}/auth/v1/admin/users`,
        { headers: { ...headers, 'Authorization': `Bearer ${serviceKey}` } }
      );
      const authUsers = await authRes.json();
      const stylistAuth = authUsers.users?.find(u => u.email === data.email);
      if (stylistAuth) {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${stylistAuth.id}`, { method: 'DELETE', headers });
      }

      return res.status(200).json({ success: true });
    }

    // ── GET STYLIST DETAIL ────────────────────────────────────
    if (action === 'get_stylist_detail') {
      const [apptsRes, svcsRes, availRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/appointments?stylist_id=eq.${stylist_id}&select=*&order=date.desc`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/services?stylist_id=eq.${stylist_id}&select=*`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/availability?stylist_id=eq.${stylist_id}&select=date,is_booked&order=date.desc&limit=90`, { headers })
      ]);
      const [appointments, services, availability] = await Promise.all([
        apptsRes.json(), svcsRes.json(), availRes.json()
      ]);
      return res.status(200).json({ appointments, services, availability });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
