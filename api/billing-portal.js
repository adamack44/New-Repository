// ============================================================
// Billing portal — lets stylists manage subscription via Stripe
// Handles: get subscription details, cancel, create portal session
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

  const { action, customer_id, subscription_id } = req.body;

  try {
    if (action === 'get_subscription') {
      // Fetch subscription details from Stripe
      const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscription_id}`, {
        headers: { 'Authorization': `Bearer ${stripeKey}` }
      });
      const sub = await subRes.json();
      if (!subRes.ok) return res.status(400).json({ error: sub.error?.message });

      const item = sub.items?.data?.[0];
      const price = item?.price;
      return res.status(200).json({
        status: sub.status,
        cancel_at_period_end: sub.cancel_at_period_end,
        current_period_end: sub.current_period_end,
        plan: price?.recurring?.interval === 'year' ? 'annual' : 'monthly',
        amount: price?.unit_amount,
        interval: price?.recurring?.interval
      });
    }

    if (action === 'cancel') {
      // Cancel at period end — customer keeps access until billing date
      const cancelRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscription_id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ 'cancel_at_period_end': 'true' })
      });
      const result = await cancelRes.json();
      if (!cancelRes.ok) return res.status(400).json({ error: result.error?.message });
      return res.status(200).json({ success: true, cancel_at_period_end: result.cancel_at_period_end, current_period_end: result.current_period_end });
    }

    if (action === 'reactivate') {
      // Un-cancel a subscription that was set to cancel at period end
      const reactRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscription_id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ 'cancel_at_period_end': 'false' })
      });
      const result = await reactRes.json();
      if (!reactRes.ok) return res.status(400).json({ error: result.error?.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'portal') {
      // Create a Stripe Customer Portal session for full self-service
      const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          'customer': customer_id,
          'return_url': 'https://www.salonassistcx.com/dashboard.html'
        })
      });
      const portal = await portalRes.json();
      if (!portalRes.ok) return res.status(400).json({ error: portal.error?.message });
      return res.status(200).json({ url: portal.url });
    }

    if (action === 'get_invoices') {
      // Fetch last 5 invoices
      const invRes = await fetch(`https://api.stripe.com/v1/invoices?customer=${customer_id}&limit=5`, {
        headers: { 'Authorization': `Bearer ${stripeKey}` }
      });
      const invData = await invRes.json();
      if (!invRes.ok) return res.status(400).json({ error: invData.error?.message });
      return res.status(200).json({
        invoices: (invData.data || []).map(inv => ({
          id: inv.id,
          amount: inv.amount_paid,
          date: inv.created,
          status: inv.status,
          pdf: inv.invoice_pdf,
          period_start: inv.period_start,
          period_end: inv.period_end
        }))
      });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (error) {
    console.error('Billing portal error:', error);
    return res.status(500).json({ error: error.message });
  }
}
