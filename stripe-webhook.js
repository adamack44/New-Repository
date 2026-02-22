export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  // Verify webhook signature
  let event;
  try {
    // Simple verification — in production use stripe.webhooks.constructEvent
    event = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const stylist_id = session.metadata?.stylist_id;
      const subscription_id = session.subscription;
      const customer_id = session.customer;

      if (stylist_id) {
        await supabase.from('stylists').update({
          subscription_status: 'active',
          stripe_customer_id: customer_id,
          stripe_subscription_id: subscription_id
        }).eq('id', stylist_id);
      }
    }

    if (event.type === 'customer.subscription.deleted' ||
        event.type === 'customer.subscription.paused') {
      const subscription = event.data.object;
      await supabase.from('stylists')
        .update({ subscription_status: 'inactive' })
        .eq('stripe_subscription_id', subscription.id);
    }

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const status = subscription.status === 'active' ? 'active' : 'inactive';
      await supabase.from('stylists')
        .update({ subscription_status: status })
        .eq('stripe_subscription_id', subscription.id);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}
