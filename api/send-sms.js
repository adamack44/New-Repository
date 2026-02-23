export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'to and message are required' });
  }

  // Clean phone number — ensure it starts with +1
  let phone = to.replace(/\D/g, '');
  if (phone.length === 10) phone = '1' + phone;
  if (!phone.startsWith('+')) phone = '+' + phone;

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return res.status(500).json({ error: 'Twilio credentials not configured' });
    }

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await fetch(
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

    const data = await response.json();

    if (!response.ok) {
      console.error('Twilio error:', data);
      return res.status(400).json({ error: data.message || 'Twilio error' });
    }

    console.log('✅ SMS sent to:', phone, 'SID:', data.sid);
    return res.status(200).json({ success: true, sid: data.sid });

  } catch (error) {
    console.error('SMS error:', error);
    return res.status(500).json({ error: error.message });
  }
}
