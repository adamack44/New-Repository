// ============================================================
// Referral API
// Actions: generate_code, apply_code, get_referrals, apply_discount
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };

  const { action } = req.body;

  try {

    // ── GENERATE CODE FOR NEW STYLIST ──────────────────────
    if (action === 'generate_code') {
      const { stylist_id, name } = req.body;
      // Build code from first name + random 3-digit number
      const base = name.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
      const suffix = Math.floor(100 + Math.random() * 900);
      const code = base + suffix;

      const updateRes = await fetch(`${supabaseUrl}/rest/v1/stylists?id=eq.${stylist_id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ referral_code: code })
      });

      return res.status(200).json({ code });
    }

    // ── VALIDATE A CODE (check at signup) ─────────────────
    if (action === 'validate_code') {
      const { code } = req.body;
      const upper = code.toUpperCase().trim();

      // Check stylists table
      const stylistRes = await fetch(
        `${supabaseUrl}/rest/v1/stylists?referral_code=eq.${upper}&select=id,name,referral_code`,
        { headers }
      );
      const stylists = await stylistRes.json();
      if (stylists.length) return res.status(200).json({ valid: true, type: 'stylist', name: stylists[0].name });

      // Check affiliates table
      const affRes = await fetch(
        `${supabaseUrl}/rest/v1/affiliates?referral_code=eq.${upper}&status=eq.active&select=id,name`,
        { headers }
      );
      const affs = await affRes.json();
      if (affs.length) return res.status(200).json({ valid: true, type: 'affiliate', name: affs[0].name });

      return res.status(200).json({ valid: false });
    }

    // ── RECORD REFERRAL AT SIGNUP ──────────────────────────
    if (action === 'record_referral') {
      const { code, referee_stylist_id } = req.body;
      const upper = code.toUpperCase().trim();

      let referrer_stylist_id = null;
      let referrer_affiliate_id = null;

      // Find referrer
      const stylistRes = await fetch(
        `${supabaseUrl}/rest/v1/stylists?referral_code=eq.${upper}&select=id`,
        { headers }
      );
      const stylists = await stylistRes.json();
      if (stylists.length) referrer_stylist_id = stylists[0].id;

      if (!referrer_stylist_id) {
        const affRes = await fetch(
          `${supabaseUrl}/rest/v1/affiliates?referral_code=eq.${upper}&select=id`,
          { headers }
        );
        const affs = await affRes.json();
        if (affs.length) referrer_affiliate_id = affs[0].id;
      }

      if (!referrer_stylist_id && !referrer_affiliate_id) {
        return res.status(400).json({ error: 'Invalid referral code' });
      }

      // Save referred_by on the new stylist
      await fetch(`${supabaseUrl}/rest/v1/stylists?id=eq.${referee_stylist_id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ referred_by: upper })
      });

      // Create referral record
      await fetch(`${supabaseUrl}/rest/v1/referrals`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ referral_code: upper, referee_stylist_id, referrer_stylist_id, referrer_affiliate_id })
      });

      // Increment affiliate total_referrals if applicable
      if (referrer_affiliate_id) {
        const affDataRes = await fetch(
          `${supabaseUrl}/rest/v1/affiliates?id=eq.${referrer_affiliate_id}&select=total_referrals`,
          { headers }
        );
        const affData = await affDataRes.json();
        if (affData.length) {
          await fetch(`${supabaseUrl}/rest/v1/affiliates?id=eq.${referrer_affiliate_id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ total_referrals: (affData[0].total_referrals || 0) + 1 })
          });
        }
      }

      return res.status(200).json({ success: true });
    }

    // ── GET REFERRALS FOR A STYLIST ───────────────────────
    if (action === 'get_referrals') {
      const { stylist_id } = req.body;

      // Get this stylist's referral code
      const stylistRes = await fetch(
        `${supabaseUrl}/rest/v1/stylists?id=eq.${stylist_id}&select=referral_code,referred_by,referral_discount_cents`,
        { headers }
      );
      const stylistData = await stylistRes.json();
      if (!stylistData.length) return res.status(404).json({ error: 'Stylist not found' });
      const { referral_code, referred_by, referral_discount_cents } = stylistData[0];

      // Get all active referrals this stylist has made
      const refRes = await fetch(
        `${supabaseUrl}/rest/v1/referrals?referrer_stylist_id=eq.${stylist_id}&select=id,status,created_at,referee_stylist_id`,
        { headers }
      );
      const referrals = await refRes.json();
      const activeCount = referrals.filter(r => r.status === 'active').length;
      const monthlyDiscount = activeCount * 500; // $5 = 500 cents per referral

      return res.status(200).json({
        referral_code,
        referred_by,
        referral_discount_cents: monthlyDiscount,
        total_referrals: referrals.length,
        active_referrals: activeCount,
        referrals
      });
    }

    // ── APPLY STRIPE DISCOUNT ────────────────────────────
    if (action === 'apply_discount') {
      const { stylist_id } = req.body;

      // Get subscription + referral count
      const stylistRes = await fetch(
        `${supabaseUrl}/rest/v1/stylists?id=eq.${stylist_id}&select=stripe_subscription_id,stripe_customer_id`,
        { headers }
      );
      const stylistData = await stylistRes.json();
      if (!stylistData.length || !stylistData[0].stripe_subscription_id) {
        return res.status(400).json({ error: 'No active subscription' });
      }

      const refRes = await fetch(
        `${supabaseUrl}/rest/v1/referrals?referrer_stylist_id=eq.${stylist_id}&status=eq.active&select=id`,
        { headers }
      );
      const refs = await refRes.json();
      const discountCents = refs.length * 500;

      if (discountCents === 0) return res.status(200).json({ success: true, discount: 0 });

      // Create a Stripe coupon for exact amount
      const couponRes = await fetch('https://api.stripe.com/v1/coupons', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          'amount_off': String(discountCents),
          'currency': 'usd',
          'duration': 'repeating',
          'duration_in_months': '1',
          'name': `Referral discount — ${refs.length} active referral${refs.length !== 1 ? 's' : ''}`
        })
      });
      const coupon = await couponRes.json();
      if (!couponRes.ok) return res.status(400).json({ error: coupon.error?.message });

      // Apply to subscription
      const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${stylistData[0].stripe_subscription_id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ 'coupon': coupon.id })
      });

      return res.status(200).json({ success: true, discount_cents: discountCents, coupon_id: coupon.id });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (error) {
    console.error('Referral error:', error);
    return res.status(500).json({ error: error.message });
  }
}
