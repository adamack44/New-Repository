// ============================================================
// Vercel Cron Job — runs daily at 11am UTC
// Sends rebooking reminders to clients who haven't booked
// since their service-specific interval has passed
// Two-email sequence: initial + follow-up 2 weeks later
// ============================================================

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !supabaseKey || !resendKey) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };

  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Get all stylists with rebooking enabled
    const stylistsRes = await fetch(
      `${supabaseUrl}/rest/v1/stylists?rebooking_enabled=eq.true&select=id,name,email,slug,brand_accent,brand_logo_url,rebooking_default_weeks,rebooking_message,rebooking_followup_message`,
      { headers }
    );
    const stylists = await stylistsRes.json();

    let totalSent = 0;
    let totalFollowups = 0;

    for (const stylist of stylists) {
      const defaultWeeks = stylist.rebooking_default_weeks || 6;

      // Get all clients for this stylist who haven't opted out and have email
      const clientsRes = await fetch(
        `${supabaseUrl}/rest/v1/clients?stylist_id=eq.${stylist.id}&rebooking_opt_out=eq.false&email=not.is.null&select=*`,
        { headers }
      );
      const clients = await clientsRes.json();

      // Get services with rebooking intervals
      const svcsRes = await fetch(
        `${supabaseUrl}/rest/v1/services?stylist_id=eq.${stylist.id}&rebooking_weeks=not.is.null&select=name,rebooking_weeks`,
        { headers }
      );
      const services = await svcsRes.json();
      const svcMap = {};
      services.forEach(s => svcMap[s.name.toLowerCase()] = s.rebooking_weeks);

      for (const client of clients) {
        if (!client.email || !client.last_visited) continue;

        // Find the most recent appointment for this client to get their last service
        const apptRes = await fetch(
          `${supabaseUrl}/rest/v1/appointments?stylist_id=eq.${stylist.id}&customer_email=eq.${encodeURIComponent(client.email)}&status=eq.confirmed&order=date.desc&limit=1&select=date,service`,
          { headers }
        );
        const appts = await apptRes.json();
        const lastAppt = appts[0];

        // Determine interval — use service-specific or default
        let intervalWeeks = defaultWeeks;
        if (lastAppt?.service) {
          const svcKey = lastAppt.service.toLowerCase();
          const matchedSvc = Object.keys(svcMap).find(k => svcKey.includes(k) || k.includes(svcKey));
          if (matchedSvc) intervalWeeks = svcMap[matchedSvc];
        }

        const lastVisitDate = new Date(client.last_visited + 'T12:00:00');
        const daysSinceVisit = Math.floor((today - lastVisitDate) / (1000 * 60 * 60 * 24));
        const intervalDays = intervalWeeks * 7;
        const followupDays = intervalDays + 14;

        // Check if client has a future booking already
        const futureApptRes = await fetch(
          `${supabaseUrl}/rest/v1/appointments?stylist_id=eq.${stylist.id}&customer_email=eq.${encodeURIComponent(client.email)}&status=eq.confirmed&date=gte.${todayStr}&select=id`,
          { headers }
        );
        const futureAppts = await futureApptRes.json();
        if (futureAppts.length > 0) continue; // already booked, skip

        const accent = stylist.brand_accent || '#b85c38';
        const logo = stylist.brand_logo_url || 'https://www.salonassistcx.com/logo.png';
        const bookingUrl = `https://www.salonassistcx.com/${stylist.slug}`;
        const firstName = client.name.split(' ')[0];

        // ── INITIAL REMINDER ──────────────────────────────────
        if (daysSinceVisit >= intervalDays && !client.rebooking_reminder_sent_at) {
          const weeksAgo = Math.round(daysSinceVisit / 7);
          const html = buildReminderEmail({
            firstName, stylistName: stylist.name, logo, accent, bookingUrl,
            weeksAgo, isFollowup: false, clientEmail: client.email,
            customMessage: stylist.rebooking_message
          });

          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Salon Assist CX <bookings@salonassistcx.com>',
              to: [client.email],
              subject: `Time for a visit? Book with ${stylist.name} →`,
              html
            })
          });

          if (emailRes.ok) {
            await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${client.id}`, {
              method: 'PATCH', headers: { ...headers, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ rebooking_reminder_sent_at: today.toISOString() })
            });
            totalSent++;
          }
        }

        // ── FOLLOW-UP (2 weeks after initial) ─────────────────
        else if (
          daysSinceVisit >= followupDays &&
          client.rebooking_reminder_sent_at &&
          !client.rebooking_followup_sent_at
        ) {
          const html = buildReminderEmail({
            firstName, stylistName: stylist.name, logo, accent, bookingUrl,
            weeksAgo: Math.round(daysSinceVisit / 7), isFollowup: true, clientEmail: client.email,
            customMessage: stylist.rebooking_followup_message
          });

          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Salon Assist CX <bookings@salonassistcx.com>',
              to: [client.email],
              subject: `Still thinking about it? Your spot with ${stylist.name} is waiting`,
              html
            })
          });

          if (emailRes.ok) {
            await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${client.id}`, {
              method: 'PATCH', headers: { ...headers, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ rebooking_followup_sent_at: today.toISOString() })
            });
            totalFollowups++;
          }
        }
      }
    }

    return res.status(200).json({
      message: 'Rebooking reminders processed',
      initial: totalSent,
      followups: totalFollowups
    });

  } catch (error) {
    console.error('Rebooking error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function buildReminderEmail({ firstName, stylistName, logo, accent, bookingUrl, weeksAgo, isFollowup, clientEmail, customMessage }) {
  const unsubUrl = bookingUrl + '?unsubscribe=' + encodeURIComponent(clientEmail);

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body { font-family: Georgia, serif; background: #faf6f1; margin: 0; padding: 0; -webkit-text-size-adjust:100%; }
  .wrapper { max-width: 560px; margin: 0 auto; padding: 20px 16px; }
  .card { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(92,64,51,.08); }
  .header { background: #fff; padding: 24px 20px; text-align: center; border-bottom: 2px solid #e0ccb8; }
  .header img { width: 64px; height: 64px; object-fit: contain; display: block; margin: 0 auto 10px; }
  .header h1 { color: ${accent}; font-size: 1.2rem; margin: 0; font-weight: 400; }
  .body { padding: 28px 24px; }
  .body p { font-size: 0.92rem; color: #5c3d2a; line-height: 1.8; margin-bottom: 14px; }
  .highlight { background: #faf6f1; border-left: 3px solid ${accent}; padding: 14px 18px; border-radius: 0 10px 10px 0; margin: 20px 0; font-size: 0.88rem; color: #5c3d2a; font-style: italic; line-height: 1.7; }
  .btn { display: block; background: ${accent}; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 0.92rem; margin: 24px 0 8px; text-align: center; font-family: Georgia, serif; }
  .footer { text-align: center; padding: 16px 20px; color: #9c7a6a; font-size: 0.72rem; border-top: 1px solid #e0ccb8; line-height: 1.8; }
  .footer a { color: ${accent}; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="card">
    <div class="header">
      <img src="${logo}" alt="${stylistName}">
      <h1>Hi ${firstName}! ${isFollowup ? 'Still thinking about it?' : "It's been a while."}</h1>
    </div>
    <div class="body">
      ${customMessage
        ? `<div class="highlight">${customMessage.replace('[first name]', firstName).split('\n').join('<br>')}</div>`
        : isFollowup
          ? `<p>We noticed you have not had a chance to rebook yet — no worries, life gets busy!</p>
             <p>${stylistName} still has some great availability and would love to see you again.</p>
             <div class="highlight">When you are ready, booking takes less than a minute through the link below.</div>`
          : `<p>It has been about ${weeksAgo} week${weeksAgo !== 1 ? 's' : ''} since your last visit with <strong>${stylistName}</strong> — your hair might be ready for some attention!</p>
             <div class="highlight">Fresh cuts and happy clients — that is what ${stylistName} does best. Grab a spot before the best times fill up.</div>`
      }
      <a href="${bookingUrl}" class="btn">Book with ${stylistName} →</a>
      <p style="font-size:0.8rem;color:#9c7a6a;text-align:center;margin:0;">Takes less than 2 minutes</p>
    </div>
    <div class="footer">
      You're receiving this because you've visited ${stylistName} before.<br>
      <a href="${unsubUrl}">Unsubscribe from rebooking reminders</a> &nbsp;·&nbsp;
      Powered by <a href="https://www.salonassistcx.com">Salon Assist CX</a>
    </div>
  </div>
</div>
</body>
</html>`;
}
