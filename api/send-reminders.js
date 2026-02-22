// ============================================================
// Vercel Cron Job — runs every day at 10am UTC
// Sends 24-hour appointment reminders to customers
// ============================================================

export const config = {
  maxDuration: 30
};

export default async function handler(req, res) {
  // Allow manual trigger via POST, or cron via GET
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!supabaseUrl || !supabaseKey || !accountSid || !authToken || !fromNumber) {
      return res.status(500).json({ error: 'Missing environment variables' });
    }

    // Get tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    console.log('Checking reminders for:', tomorrowStr);

    // Fetch all confirmed appointments for tomorrow that haven't been reminded
    const apptRes = await fetch(
      `${supabaseUrl}/rest/v1/appointments?date=eq.${tomorrowStr}&status=eq.confirmed&reminder_sent=eq.false&select=*`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );

    const appointments = await apptRes.json();
    console.log(`Found ${appointments.length} appointments to remind`);

    if (!appointments.length) {
      return res.status(200).json({ message: 'No reminders to send', count: 0 });
    }

    // Fetch stylist names for each appointment
    const stylistIds = [...new Set(appointments.map(a => a.stylist_id))];
    const stylistRes = await fetch(
      `${supabaseUrl}/rest/v1/stylists?id=in.(${stylistIds.join(',')})&select=id,name,phone`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );
    const stylists = await stylistRes.json();
    const stylistMap = {};
    stylists.forEach(s => stylistMap[s.id] = s);

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    let sent = 0;
    let failed = 0;

    for (const appt of appointments) {
      // Skip if no customer phone
      if (!appt.customer_phone) {
        console.log('No phone for appointment:', appt.id);
        continue;
      }

      const stylist = stylistMap[appt.stylist_id];
      const stylistName = stylist?.name || 'your stylist';

      // Format date nicely
      const apptDate = new Date(appt.date + 'T12:00:00');
      const dateLabel = apptDate.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric'
      });

      const message = `Hi ${appt.customer_name}! 👋 Just a reminder that you have an appointment with ${stylistName} tomorrow, ${dateLabel} at ${appt.time}${appt.service ? ` for ${appt.service}` : ''}. See you then! 💇‍♀️\n\nReply STOP to unsubscribe.`;

      // Clean phone number
      let phone = appt.customer_phone.replace(/\D/g, '');
      if (phone.length === 10) phone = '1' + phone;
      if (!phone.startsWith('+')) phone = '+' + phone;

      try {
        const smsRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${credentials}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              From: fromNumber,
              To: phone,
              Body: message
            })
          }
        );

        const smsData = await smsRes.json();

        if (smsRes.ok) {
          // Mark reminder as sent
          await fetch(
            `${supabaseUrl}/rest/v1/appointments?id=eq.${appt.id}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({ reminder_sent: true })
            }
          );
          console.log('✅ Reminder sent to:', phone);
          sent++;
        } else {
          console.error('SMS failed:', smsData.message);
          failed++;
        }
      } catch (smsError) {
        console.error('SMS error for', appt.id, ':', smsError.message);
        failed++;
      }
    }

    return res.status(200).json({
      message: `Reminders processed`,
      sent,
      failed,
      date: tomorrowStr
    });

  } catch (error) {
    console.error('Reminder error:', error);
    return res.status(500).json({ error: error.message });
  }
}
