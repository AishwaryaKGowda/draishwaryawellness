# Dr Aishwarya Wellness

Responsive wellness-center website with Supabase customer accounts, saved
enquiries, appointment and product checkout, Razorpay payments, and email
payment receipts.

## Starter catalog and fees

- Wellness appointment types: ₹500 each.
- Ashwagandha: 60 capsules, ₹350.
- Chyawanprash: 500 g, ₹350.
- Product delivery: ₹50 per order within India.

Product catalog prices, pack sizes, and descriptions are seeded by
[`supabase/schema.sql`](./supabase/schema.sql). Update the database catalog when
changing product details. The appointment fee and product delivery charge are
validated server-side in `netlify/functions/create-order.js`; update the
checkout summary in `index.html`/`script.js` at the same time.

Product copy is intentionally factual and does not make health-treatment
claims. Check all pack details, product labeling, regulatory requirements, and
availability before selling.

## Supabase setup

1. In the Supabase SQL Editor for project `nestxckkpbyfjpwsuiqu`, run
   [`supabase/schema.sql`](./supabase/schema.sql).
2. Confirm the `profiles`, `products`, `bookings`, `orders`, `order_items`, and
   `enquiries` tables have row-level security enabled and the policies from that
   script. `bookings` stores appointments; `orders` and `order_items` store
   product purchases.
3. Configure Supabase Auth email confirmation and production SMTP so customers
   can verify their email and receive account messages.
4. The Supabase URL and anon key in `script.js` are public browser settings.
   Never add a Supabase service-role key to browser code.

## Netlify environment variables

Set these in **Netlify → Site configuration → Environment variables** for
production and deploy previews as needed. Do not put secret values in Git,
source code, or chat.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public API key, also used to validate customer sessions |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key for trusted server-side database writes |
| `RAZORPAY_KEY_ID` | Current Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | Current Razorpay secret; server-side only |
| `RAZORPAY_WEBHOOK_SECRET` | Secret configured for the Razorpay webhook |
| `RESEND_API_KEY` | Resend API key |
| `RECEIPT_FROM_EMAIL` | Sender address verified with Resend |

After changing Netlify variables, trigger a new deploy so the Functions receive
the updated values.

### Payment and email setup

1. Revoke any Razorpay live credentials that were shared or exposed. Create a
   new key pair, test with Razorpay test credentials first, then add the
   approved production credentials directly in Netlify.
2. In Razorpay, add a webhook for
   `https://draishwaryak.netlify.app/.netlify/functions/razorpay-webhook`,
   select the `payment.captured` event, and set its webhook secret in Netlify.
3. Verify a sending domain/address with Resend, then set its API key and the
   matching sender address in Netlify.
4. This version emails payment receipts, not formal GST/tax invoices.

## What gets stored

- Supabase Auth stores customer login credentials; passwords are never stored
  by this site.
- Customer name and phone are saved in `profiles`.
- Successful and pending appointment payments are stored in `bookings`.
- Product orders and their purchased item snapshots are stored in `orders` and
  `order_items`.
- Enquiries are saved before the customer is redirected to WhatsApp.
- Payment confirmation is validated server-side and also reconciled through
  the Razorpay webhook.
- The database stores address, contact, order, and payment-reference data needed
  to fulfil purchases. Do not submit sensitive medical information.

Customers can read only their own profiles, bookings, orders, order items, and
enquiries. The product list is public; payment and order writes are restricted
to Netlify Functions using the service-role key.

## Deploy

The site uses Netlify Functions and requires no third-party npm packages. The
Netlify build settings are in `netlify.toml`. Push the project to the connected
GitHub `main` branch; Netlify will build and publish the static site and
Functions. The Supabase schema and Netlify environment variables above must be
configured before account, checkout, email, and saved-enquiry flows can work.
