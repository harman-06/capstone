import { createResetHandler } from './handler.mjs';

Deno.serve(createResetHandler({
  url: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  origin: Deno.env.get('NEXORA_DEMO_RESET_ORIGIN') ?? 'https://harman-06.github.io',
  factor: Deno.env.get('NEXORA_DEMO_RESET_FACTOR_ID'),
  enabled: Deno.env.get('NEXORA_DEMO_RESET_ENABLED') === 'true'
}));
