import { afterEach, describe, expect, test } from 'bun:test';
import { PlatformObservability } from '..';

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
});

describe('PlatformObservability configuration boundary', () => {
  test('usage summary fails closed without server credentials', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await PlatformObservability.getUsageSummary('ws_test');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('OBSERVABILITY_NOT_CONFIGURED');
  });

  test('audit listing fails closed without server credentials', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await PlatformObservability.listAuditEvents('ws_test');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('OBSERVABILITY_NOT_CONFIGURED');
  });
});
