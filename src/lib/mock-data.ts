/**
 * Codlok Cloud Dashboard — Mock Data (Track A)
 *
 * Per §23: all data is mocked. No backend calls.
 * Per §23 Binding Display Rule: mock data contains ONLY opaque infrastructure
 * IDs, status, timestamps, provider name — never business names, filenames,
 * or entity descriptions. Codlok's modules structurally don't have that info.
 */

// ---------------------------------------------------------------------------
// Types (mirror what the frozen module specs actually return)
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  createdAt: string;
  status: 'active' | 'suspended';
}

export interface ModuleStatus {
  moduleId: string;
  name: string;
  configured: boolean;
  provider: string | null;
  status: 'operational' | 'degraded' | 'down' | 'not_configured';
  recordCount: number;
  lastActivity: string;
}

export interface TeamMember {
  userId: string;
  email: string;
  role: 'Owner' | 'Admin' | 'Member';
  joinedAt: string;
}

export interface VerifyRecord {
  verificationId: string;
  status: 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired';
  provider: string;
  verificationType: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageRecord {
  fileId: string;
  mimeType: string;
  sizeBytes: number;
  state: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'DELETED' | 'FAILED';
  createdAt: string;
}

export interface PayRecord {
  paymentId: string;
  status: string;
  amountMinorUnits: number;
  currency: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRecord {
  notificationId: string;
  overallStatus: 'queued' | 'dispatching' | 'completed' | 'cancelled';
  channels: Record<string, { status: string }>;
  createdAt: string;
}

export interface SmsRecord {
  smsId: string;
  provider: string;
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed';
  createdAt: string;
}

export interface SecretTemplate {
  id: string;
  name: string;
  description: string;
  keys: { key: string; description: string }[];
  lastUpdated: string;
}

export interface FreezeLogEntry {
  module: string;
  version: string;
  status: string;
  dependsOn: string;
  tests: string;
  knownBacklog: string;
}

// ---------------------------------------------------------------------------
// Mock Products
// ---------------------------------------------------------------------------

export const MOCK_PRODUCTS: Product[] = [
  {
    id: 'ws_acadid',
    name: 'AcadID',
    slug: 'acadid',
    description: 'Identity verification platform for educational institutions.',
    createdAt: '2026-06-15T10:00:00Z',
    status: 'active',
  },
  {
    id: 'ws_srema',
    name: 'SREMA',
    slug: 'srema',
    description: 'SREMA Platform — site reliability monitoring.',
    createdAt: '2026-06-20T14:30:00Z',
    status: 'active',
  },
  {
    id: 'ws_droppday',
    name: 'Droppday',
    slug: 'droppday',
    description: 'Delivery logistics platform.',
    createdAt: '2026-07-01T09:15:00Z',
    status: 'active',
  },
];

// ---------------------------------------------------------------------------
// Mock Module Status (per product)
// ---------------------------------------------------------------------------

export function getMockModules(productId: string): ModuleStatus[] {
  return [
    {
      moduleId: 'auth',
      name: 'Auth',
      configured: true,
      provider: 'supabase',
      status: 'operational',
      recordCount: 1247,
      lastActivity: '2026-07-13T14:35:00Z',
    },
    {
      moduleId: 'organizations',
      name: 'Organizations',
      configured: true,
      provider: '—',
      status: 'operational',
      recordCount: 8,
      lastActivity: '2026-07-13T12:20:00Z',
    },
    {
      moduleId: 'configuration',
      name: 'Configuration',
      configured: true,
      provider: '—',
      status: 'operational',
      recordCount: 23,
      lastActivity: '2026-07-13T14:30:00Z',
    },
    {
      moduleId: 'mail',
      name: 'Mail',
      configured: true,
      provider: 'resend',
      status: 'operational',
      recordCount: 4521,
      lastActivity: '2026-07-13T14:35:00Z',
    },
    {
      moduleId: 'storage',
      name: 'Storage',
      configured: true,
      provider: 's3',
      status: 'operational',
      recordCount: 892,
      lastActivity: '2026-07-13T14:02:00Z',
    },
    {
      moduleId: 'pay',
      name: 'Pay',
      configured: productId === 'ws_acadid',
      provider: productId === 'ws_acadid' ? 'stripe' : null,
      status: productId === 'ws_acadid' ? 'operational' : 'not_configured',
      recordCount: productId === 'ws_acadid' ? 156 : 0,
      lastActivity: productId === 'ws_acadid' ? '2026-07-13T14:30:00Z' : '—',
    },
    {
      moduleId: 'verify',
      name: 'Verify',
      configured: productId === 'ws_acadid',
      provider: productId === 'ws_acadid' ? 'stripe_identity' : null,
      status: productId === 'ws_acadid' ? 'operational' : 'not_configured',
      recordCount: productId === 'ws_acadid' ? 342 : 0,
      lastActivity: productId === 'ws_acadid' ? '2026-07-13T14:35:00Z' : '—',
    },
    {
      moduleId: 'notifications',
      name: 'Notifications',
      configured: true,
      provider: '—',
      status: 'operational',
      recordCount: 2103,
      lastActivity: '2026-07-13T14:03:00Z',
    },
    {
      moduleId: 'sms',
      name: 'SMS',
      configured: true,
      provider: 'twilio',
      status: 'operational',
      recordCount: 5634,
      lastActivity: '2026-07-13T14:01:00Z',
    },
  ];
}

// ---------------------------------------------------------------------------
// Mock Team Members (§23: "Team" not "Organizations")
// ---------------------------------------------------------------------------

export const MOCK_TEAM: TeamMember[] = [
  {
    userId: 'user_001',
    email: 'founder@codlok.cloud',
    role: 'Owner',
    joinedAt: '2026-06-15T10:00:00Z',
  },
  {
    userId: 'user_002',
    email: 'dev@codlok.cloud',
    role: 'Admin',
    joinedAt: '2026-06-16T08:30:00Z',
  },
  {
    userId: 'user_003',
    email: 'ops@codlok.cloud',
    role: 'Member',
    joinedAt: '2026-07-01T09:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Mock Module Detail Records (opaque IDs only — §23 Binding Display Rule)
// ---------------------------------------------------------------------------

export const MOCK_VERIFY_RECORDS: VerifyRecord[] = [
  { verificationId: 'VER-7C82D91', status: 'approved', provider: 'stripe_identity', verificationType: 'INDIVIDUAL_IDENTITY', createdAt: '2026-07-13T14:35:00Z', updatedAt: '2026-07-13T14:38:00Z' },
  { verificationId: 'VER-3F1AB20', status: 'in_review', provider: 'stripe_identity', verificationType: 'DOCUMENT_VERIFICATION', createdAt: '2026-07-13T14:20:00Z', updatedAt: '2026-07-13T14:20:00Z' },
  { verificationId: 'VER-9D4E567', status: 'pending', provider: 'stripe_identity', verificationType: 'INDIVIDUAL_IDENTITY', createdAt: '2026-07-13T14:40:00Z', updatedAt: '2026-07-13T14:40:00Z' },
  { verificationId: 'VER-2A8BC33', status: 'rejected', provider: 'stripe_identity', verificationType: 'ADDRESS_VERIFICATION', createdAt: '2026-07-13T13:10:00Z', updatedAt: '2026-07-13T13:25:00Z' },
  { verificationId: 'VER-5E7F901', status: 'expired', provider: 'stripe_identity', verificationType: 'AGE_VERIFICATION', createdAt: '2026-07-12T18:00:00Z', updatedAt: '2026-07-12T19:00:00Z' },
];

export const MOCK_STORAGE_RECORDS: StorageRecord[] = [
  { fileId: 'FIL-1A82B', mimeType: 'application/pdf', sizeBytes: 12582912, state: 'UPLOADED', createdAt: '2026-07-13T14:02:00Z' },
  { fileId: 'FIL-3C45D', mimeType: 'image/png', sizeBytes: 524288, state: 'UPLOADED', createdAt: '2026-07-13T13:50:00Z' },
  { fileId: 'FIL-7E91F', mimeType: 'image/jpeg', sizeBytes: 2048576, state: 'UPLOADED', createdAt: '2026-07-13T13:45:00Z' },
  { fileId: 'FIL-2B63A', mimeType: 'application/pdf', sizeBytes: 0, state: 'DELETED', createdAt: '2026-07-13T12:30:00Z' },
  { fileId: 'FIL-9F01C', mimeType: 'image/png', sizeBytes: 0, state: 'FAILED', createdAt: '2026-07-13T11:15:00Z' },
];

export const MOCK_PAY_RECORDS: PayRecord[] = [
  { paymentId: 'PAY-92AAB', status: 'succeeded', amountMinorUnits: 5000000, currency: 'NGN', provider: 'stripe', createdAt: '2026-07-13T14:30:00Z', updatedAt: '2026-07-13T14:31:00Z' },
  { paymentId: 'PAY-1B3CD', status: 'refunded', amountMinorUnits: 2500000, currency: 'NGN', provider: 'stripe', createdAt: '2026-07-13T13:00:00Z', updatedAt: '2026-07-13T13:30:00Z' },
  { paymentId: 'PAY-7E8FG', status: 'partially_refunded', amountMinorUnits: 3000000, currency: 'NGN', provider: 'stripe', createdAt: '2026-07-13T12:15:00Z', updatedAt: '2026-07-13T12:45:00Z' },
  { paymentId: 'PAY-4A5HI', status: 'failed', amountMinorUnits: 1500000, currency: 'NGN', provider: 'stripe', createdAt: '2026-07-13T11:30:00Z', updatedAt: '2026-07-13T11:30:00Z' },
  { paymentId: 'PAY-6D9JK', status: 'disputed', amountMinorUnits: 5000000, currency: 'NGN', provider: 'stripe', createdAt: '2026-07-12T16:00:00Z', updatedAt: '2026-07-13T09:00:00Z' },
];

export const MOCK_NOTIFICATION_RECORDS: NotificationRecord[] = [
  { notificationId: 'NOT-821AB', overallStatus: 'completed', channels: { email: { status: 'dispatched' }, sms: { status: 'dispatched' } }, createdAt: '2026-07-13T14:03:00Z' },
  { notificationId: 'NOT-3C45D', overallStatus: 'completed', channels: { email: { status: 'dispatched' } }, createdAt: '2026-07-13T13:50:00Z' },
  { notificationId: 'NOT-7E91F', overallStatus: 'completed', channels: { email: { status: 'failed', }, sms: { status: 'dispatched' } }, createdAt: '2026-07-13T13:30:00Z' },
  { notificationId: 'NOT-2B63A', overallStatus: 'cancelled', channels: {}, createdAt: '2026-07-13T12:00:00Z' },
];

export const MOCK_SMS_RECORDS: SmsRecord[] = [
  { smsId: 'SMS-1BC8D', provider: 'twilio', status: 'delivered', createdAt: '2026-07-13T14:01:00Z' },
  { smsId: 'SMS-3EF45', provider: 'twilio', status: 'sent', createdAt: '2026-07-13T13:55:00Z' },
  { smsId: 'SMS-7GH89', provider: 'twilio', status: 'failed', createdAt: '2026-07-13T13:30:00Z' },
  { smsId: 'SMS-2IJ12', provider: 'twilio', status: 'delivered', createdAt: '2026-07-13T12:45:00Z' },
  { smsId: 'SMS-5KL34', provider: 'twilio', status: 'sent', createdAt: '2026-07-13T12:15:00Z' },
];

// ---------------------------------------------------------------------------
// Mock Secret Templates (§23: copy-not-inherit)
// ---------------------------------------------------------------------------

export const MOCK_SECRET_TEMPLATES: SecretTemplate[] = [
  {
    id: 'tpl_stripe',
    name: 'Stripe (Payments + Identity)',
    description: 'Stripe secret key + webhook secret for Pay and Verify modules.',
    keys: [
      { key: 'STRIPE_SECRET_KEY', description: 'Stripe API secret key' },
      { key: 'STRIPE_WEBHOOK_SECRET', description: 'Stripe webhook signing secret (Pay)' },
      { key: 'STRIPE_IDENTITY_SECRET_KEY', description: 'Stripe Identity secret key (Verify)' },
      { key: 'STRIPE_IDENTITY_WEBHOOK_SECRET', description: 'Stripe Identity webhook signing secret' },
    ],
    lastUpdated: '2026-07-10T10:00:00Z',
  },
  {
    id: 'tpl_twilio',
    name: 'Twilio (SMS)',
    description: 'Twilio Account SID + Auth Token for the SMS module.',
    keys: [
      { key: 'TWILIO_ACCOUNT_SID', description: 'Twilio Account SID' },
      { key: 'TWILIO_AUTH_TOKEN', description: 'Twilio Auth Token' },
    ],
    lastUpdated: '2026-07-08T14:00:00Z',
  },
  {
    id: 'tpl_resend',
    name: 'Resend (Mail)',
    description: 'Resend API key for the Mail module.',
    keys: [
      { key: 'RESEND_API_KEY', description: 'Resend API key' },
    ],
    lastUpdated: '2026-07-05T09:00:00Z',
  },
  {
    id: 'tpl_supabase',
    name: 'Supabase (Auth)',
    description: 'Supabase URL + keys for the Auth module.',
    keys: [
      { key: 'SUPABASE_URL', description: 'Supabase project URL' },
      { key: 'SUPABASE_ANON_KEY', description: 'Supabase anon key' },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', description: 'Supabase service role key' },
    ],
    lastUpdated: '2026-06-20T12:00:00Z',
  },
  {
    id: 'tpl_s3',
    name: 'Amazon S3 (Storage)',
    description: 'S3 provider config for the Storage module.',
    keys: [
      { key: 'STORAGE_PROVIDER', description: 'Storage provider name (s3)' },
      { key: 'STORAGE_BUCKET', description: 'S3 bucket name' },
      { key: 'STORAGE_ACCESS_KEY', description: 'S3 access key' },
      { key: 'STORAGE_SECRET_KEY', description: 'S3 secret key' },
    ],
    lastUpdated: '2026-06-25T16:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Mock Freeze Log (mirrors Platform Freeze Log from the spec)
// ---------------------------------------------------------------------------

export const MOCK_FREEZE_LOG: FreezeLogEntry[] = [
  { module: 'Core Spec', version: '—', status: '🟢 Frozen', dependsOn: '—', tests: '—', knownBacklog: '—' },
  { module: 'Auth', version: 'v1.1', status: '🟢 Frozen', dependsOn: 'Configuration, Mail', tests: '36', knownBacklog: '—' },
  { module: 'Organizations', version: 'v1.0', status: '🟢 Frozen', dependsOn: 'Auth, Configuration, Mail', tests: '69', knownBacklog: '—' },
  { module: 'Configuration', version: 'v1.0', status: '🟢 Frozen', dependsOn: '—', tests: '48', knownBacklog: 'Key rotation (env-var swap only)' },
  { module: 'Mail', version: 'v1.2', status: '🟢 Frozen', dependsOn: 'Configuration', tests: '48', knownBacklog: 'Cross-provider failover not in v1' },
  { module: 'Storage', version: 'v1.0', status: '🟢 Frozen', dependsOn: 'Configuration', tests: '53', knownBacklog: 'No virus scanning, no multipart upload' },
  { module: 'Pay', version: 'v1.0', status: '🟢 Frozen', dependsOn: 'Configuration', tests: '62', knownBacklog: 'No multi-currency conversion, no provider failover' },
  { module: 'Verify', version: 'v1.0', status: '🟢 Frozen', dependsOn: 'Configuration', tests: '52', knownBacklog: 'No multi-provider fallback' },
  { module: 'Notifications', version: 'v1.0', status: '🟢 Frozen', dependsOn: 'Mail, SMS', tests: '41', knownBacklog: 'No cross-channel fallback in v1' },
  { module: 'SMS', version: 'v1.0', status: '🟢 Frozen', dependsOn: 'Configuration', tests: '48', knownBacklog: 'Audit retention is an Open Design Decision' },
  { module: 'Dashboard (Track A)', version: 'v1.0', status: '🟡 IA approved, not built', dependsOn: '9 modules (mock data)', tests: '—', knownBacklog: 'Frontend only; Secret Templates UI mocked pending Track B' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatMinorUnits(minorUnits: number, currency: string): string {
  const major = minorUnits / 100;
  const symbols: Record<string, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€', JPY: '¥' };
  const symbol = symbols[currency] ?? `${currency} `;
  if (currency === 'JPY') return `${symbol}${minorUnits}`;
  return `${symbol}${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTimestamp(iso: string): string {
  if (iso === '—') return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';
}
