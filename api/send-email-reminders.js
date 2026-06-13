// ============================================================
// Vercel Cron Job — runs every day at 10am UTC
// Sends 24-hour appointment reminder EMAILS to customers
// ============================================================

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !supabaseKey || !resendKey) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    console.log('Checking email reminders for:', tomorrowStr);

    // Fetch confirmed appointments tomorrow that haven't been reminded
    const apptRes = await fetch(
      `${supabaseUrl}/rest/v1/appointments?date=eq.${tomorrowStr}&status=eq.confirmed&reminder_sent=eq.false&select=*`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );
    const appointments = await apptRes.json();
    console.log(`Found ${appointments.length} appointments to remind`);

    if (!appointments.length) {
      return res.status(200).json({ message: 'No reminders to send', count: 0 });
    }

    // Fetch stylist info
    const stylistIds = [...new Set(appointments.map(a => a.stylist_id))];
    const stylistRes = await fetch(
      `${supabaseUrl}/rest/v1/stylists?id=in.(${stylistIds.join(',')})&select=id,name,salon_name,phone,slug`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );
    const stylists = await stylistRes.json();
    const stylistMap = {};
    stylists.forEach(s => stylistMap[s.id] = s);

    let sent = 0;
    let failed = 0;

    for (const appt of appointments) {
      if (!appt.customer_email) { console.log('No email for:', appt.id); continue; }

      const stylist = stylistMap[appt.stylist_id];
      const stylistName = stylist?.name || 'your stylist';
      const salonName = stylist?.salon_name || '';

      const apptDate = new Date(appt.date + 'T12:00:00');
      const dateLabel = apptDate.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
      const manageUrl = `https://www.salonassistcx.com/appointments.html`;

      const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Georgia, serif; background: #faf6f1; margin: 0; padding: 0; }
  .wrapper { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
  .card { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(92,64,51,0.08); }
  .header { background: #ffffff; padding: 32px; text-align: center; border-bottom: 2px solid #e0ccb8; }
  .header img { width: 108px; height: 108px; object-fit: contain; display: block; margin: 0 auto 12px; }
  .header h1 { color: #b85c38; font-size: 1.4rem; margin: 0; font-weight: 400; }
  .body { padding: 32px; }
  .greeting { font-size: 1rem; color: #2d1f18; margin-bottom: 20px; }
  .appt-box { background: #faf6f1; border: 1px solid #e0ccb8; border-radius: 12px; padding: 0 20px; margin: 20px 0; }
  .appt-row { display: table; width: 100%; padding: 14px 0; border-bottom: 1px solid #e0ccb8; font-size: 0.9rem; }
  .appt-row:last-child { border-bottom: none; }
  .appt-label { display: table-cell; color: #7a5c4a; font-weight: 400; width: 40%; padding-right: 16px; }
  .appt-value { display: table-cell; color: #2d1f18; font-weight: 600; }
  .btn { display: inline-block; background: linear-gradient(135deg, #b85c38 0%, #8b3a1e 100%); color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 0.9rem; margin: 20px 0; }
  .footer { text-align: center; padding: 20px 32px; color: #9c7a6a; font-size: 0.78rem; border-top: 1px solid #e0ccb8; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="card">
    <div class="header">
      <img src="https://www.salonassistcx.com/logo.png" alt="Salon Assist CX">
      <h1>Appointment Reminder</h1>
    </div>
    <div class="body">
      <p class="greeting">Hi ${appt.customer_name}! Just a friendly reminder that you have an appointment <strong>tomorrow</strong>.</p>
      <div class="appt-box">
        <div class="appt-row"><span class="appt-label">Stylist</span><span class="appt-value">${stylistName}${salonName ? ' · ' + salonName : ''}</span></div>
        <div class="appt-row"><span class="appt-label">Date</span><span class="appt-value">${dateLabel}</span></div>
        <div class="appt-row"><span class="appt-label">Time</span><span class="appt-value">${appt.time}</span></div>
        ${appt.service ? '<div class="appt-row"><span class="appt-label">Service</span><span class="appt-value">' + appt.service + '</span></div>' : ''}
      </div>
      <p style="color:#7a5c4a;font-size:0.88rem;">Need to make changes? You can view or cancel your appointment below.</p>
      <a href="${manageUrl}" class="btn">Manage My Appointment →</a>
    </div>
    <div class="footer">
      You're receiving this because you booked an appointment through Salon Assist CX.<br>
      <a href="${manageUrl}" style="color:#b85c38;">Cancel appointment</a>
    </div>
  </div>
</div>
</body>
</html>`;

      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Salon Assist CX <bookings@salonassistcx.com>',
            to: [appt.customer_email],
            subject: `Reminder: Your appointment with ${stylistName} is tomorrow`,
            html
          })
        });

        if (emailRes.ok) {
          // Mark reminder sent
          await fetch(`${supabaseUrl}/rest/v1/appointments?id=eq.${appt.id}`, {
            method: 'PATCH',
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ reminder_sent: true })
          });
          sent++;
          console.log('✅ Reminder sent to:', appt.customer_email);
        } else {
          failed++;
          console.error('Email failed for:', appt.id);
        }
      } catch (e) {
        failed++;
        console.error('Email error:', e.message);
      }
    }

    return res.status(200).json({ message: 'Reminders processed', sent, failed, date: tomorrowStr });

  } catch (error) {
    console.error('Reminder error:', error);
    return res.status(500).json({ error: error.message });
  }
}
