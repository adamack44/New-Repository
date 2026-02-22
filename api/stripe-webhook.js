export const config = {
  api: {
    bodyParser: true,
  },
};

async function updateSupabase(table, updates, matchColumn, matchValue) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error: ${text}`);
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const event = req.body;
    console.log('Webhook event:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const stylist_id = session.metadata?.stylist_id;
      const subscription_id = session.subscription;
      const customer_id = session.customer;

      console.log('Activating stylist_id:', stylist_id);

      if (!stylist_id) {
        return res.status(400).json({ error: 'No stylist_id in metadata' });
      }

      await updateSupabase('stylists', {
        subscription_status: 'active',
        stripe_customer_id: customer_id,
        stripe_subscription_id: subscription_id
      }, 'id', stylist_id);

      console.log('✅ Stylist activated:', stylist_id);
    }

    if (event.type === 'customer.subscription.deleted' ||
        event.type === 'customer.subscription.paused') {
      const sub = event.data.object;
      await updateSupabase('stylists', 
        { subscription_status: 'inactive' },
        'stripe_subscription_id', sub.id
      );
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const status = sub.status === 'active' ? 'active' : 'inactive';
      await updateSupabase('stylists',
        { subscription_status: status },
        'stripe_subscription_id', sub.id
      );
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
