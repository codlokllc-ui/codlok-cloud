'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  configStatusApi,
  moduleDataApi,
  orgsApi,
  providerRegistryApi,
  secretsApi,
  settingsApi,
  type ProviderMetadataDto,
  type ProviderStatusDto,
  type TeamMember,
  type Workspace,
} from '@/lib/api';
import { formatBytes, formatTimestamp, MOCK_FREEZE_LOG } from '@/lib/mock-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import {
  Activity,
  ArrowLeft,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Code2,
  Cpu,
  CreditCard,
  FileText,
  FlaskConical,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Lock,
  Mail,
  Package,
  Plus,
  ScrollText,
  Settings,
  Shield,
  Smartphone,
  Users,
  type LucideIcon,
} from 'lucide-react';

// The dashboard intentionally contains no product-business entities. It only
// displays opaque infrastructure identifiers and data returned by module APIs.

type View =
  | { type: 'products' }
  | { type: 'product'; productId: string; tab: string }
  | { type: 'secret-templates' }
  | { type: 'developer' }
  | { type: 'freeze-log' }
  | { type: 'coming-soon'; title: string };

type ModuleId =
  | 'auth'
  | 'organizations'
  | 'configuration'
  | 'mail'
  | 'storage'
  | 'pay'
  | 'verify'
  | 'notifications'
  | 'sms';

interface ModuleDefinition {
  moduleId: ModuleId;
  name: string;
  icon: LucideIcon;
  providerBacked: boolean;
  listKey?: 'items' | 'verifications' | 'notifications';
  idField?: string;
}

const MODULES: ModuleDefinition[] = [
  { moduleId: 'auth', name: 'Auth', icon: Shield, providerBacked: true },
  { moduleId: 'organizations', name: 'Organizations', icon: Users, providerBacked: false },
  { moduleId: 'configuration', name: 'Configuration', icon: Settings, providerBacked: false },
  { moduleId: 'mail', name: 'Mail', icon: Mail, providerBacked: true, listKey: 'items', idField: 'messageId' },
  { moduleId: 'storage', name: 'Storage', icon: HardDrive, providerBacked: true, listKey: 'items', idField: 'fileId' },
  { moduleId: 'pay', name: 'Pay', icon: CreditCard, providerBacked: true, listKey: 'items', idField: 'paymentId' },
  { moduleId: 'verify', name: 'Verify', icon: CheckCircle2, providerBacked: true, listKey: 'verifications', idField: 'verificationId' },
  { moduleId: 'notifications', name: 'Notifications', icon: Bell, providerBacked: false, listKey: 'notifications', idField: 'notificationId' },
  { moduleId: 'sms', name: 'SMS', icon: Smartphone, providerBacked: true, listKey: 'items', idField: 'smsId' },
];

interface ProviderField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

const PROVIDER_FIELDS: Record<string, ProviderField[]> = {
  stripe: [
    { key: 'STRIPE_PUBLISHABLE_KEY', label: 'Publishable Key', secret: true },
    { key: 'STRIPE_SECRET_KEY', label: 'Secret Key', secret: true },
    { key: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook Secret', secret: true },
  ],
  stripe_identity: [
    { key: 'STRIPE_IDENTITY_SECRET_KEY', label: 'API Key', secret: true },
    { key: 'STRIPE_IDENTITY_WEBHOOK_SECRET', label: 'Webhook Secret', secret: true },
  ],
  resend: [{ key: 'RESEND_API_KEY', label: 'API Key', secret: true }],
  twilio: [
    { key: 'TWILIO_ACCOUNT_SID', label: 'Account SID', secret: true },
    { key: 'TWILIO_AUTH_TOKEN', label: 'Auth Token', secret: true },
  ],
  s3: [
    { key: 'STORAGE_REGION', label: 'Region', placeholder: 'us-east-1' },
    { key: 'STORAGE_BUCKET', label: 'Bucket' },
    { key: 'STORAGE_ACCESS_KEY', label: 'Access Key', secret: true },
    { key: 'STORAGE_SECRET_KEY', label: 'Secret Key', secret: true },
  ],
  supabase: [
    { key: 'SUPABASE_URL', label: 'Project URL' },
    { key: 'SUPABASE_ANON_KEY', label: 'Anon Key', secret: true },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Service Role Key', secret: true },
  ],
};

export default function Home() {
  const { user, loading, login, register, autoVerifyEmail, logout } = useAuth();
  const [view, setView] = useState<View>({ type: 'products' });
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);

  if (loading) return <CenteredMessage text="Loading Codlok Cloud…" />;

  if (!user) {
    return (
      <AuthView
        mode={authMode}
        busy={busy}
        onToggle={() => setAuthMode((value) => (value === 'login' ? 'register' : 'login'))}
        onSubmit={async (email, password) => {
          setBusy(true);
          try {
            if (authMode === 'login') {
              const result = await login(email, password);
              if (result.success) toast.success('Signed in');
              else toast.error(result.error ?? 'Login failed');
              return;
            }
            const result = await register(email, password);
            if (!result.success) {
              toast.error(result.error ?? 'Registration failed');
              return;
            }
            const devVerification = await autoVerifyEmail(email);
            toast.success(devVerification.success ? 'Registered and verified in development mode' : 'Registered. Check your email to verify your account.');
            setAuthMode('login');
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  const shared = { onNavigate: setView, userEmail: user.email, onLogout: logout };
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-right" />
      {view.type === 'products' && <ProductsView {...shared} accessToken={user.accessToken} />}
      {view.type === 'product' && (
        <ProductView
          {...shared}
          accessToken={user.accessToken}
          productId={view.productId}
          tab={view.tab}
          onTabChange={(tab) => setView({ type: 'product', productId: view.productId, tab })}
        />
      )}
      {view.type === 'secret-templates' && <ComingSoonPage {...shared} title="Secret Templates" description="Requires a separately specified platform-owned secret-template backend. No fake template data is shown." />}
      {view.type === 'developer' && <DeveloperView {...shared} />}
      {view.type === 'freeze-log' && <FreezeLogView {...shared} />}
      {view.type === 'coming-soon' && <ComingSoonPage {...shared} title={view.title} />}
    </div>
  );
}

function AuthView({ mode, busy, onToggle, onSubmit }: {
  mode: 'login' | 'register';
  busy: boolean;
  onToggle: () => void;
  onSubmit: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <Toaster richColors position="top-right" />
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Shield className="h-6 w-6" /></div>
          <CardTitle className="text-2xl">Codlok Cloud</CardTitle>
          <CardDescription>{mode === 'login' ? 'Sign in to manage your products and infrastructure.' : 'Create your Codlok Cloud account.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button className="w-full" disabled={busy || !email || password.length < 8} onClick={() => onSubmit(email, password)}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Register'}</Button>
          <Button variant="link" onClick={onToggle}>{mode === 'login' ? 'Create an account' : 'Back to sign in'}</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function PlatformShell({ children, active, onNavigate, userEmail, onLogout }: {
  children: ReactNode;
  active: string;
  onNavigate: (view: View) => void;
  userEmail: string;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-screen">
      <aside className="flex w-64 flex-col border-r bg-muted/20">
        <div className="flex h-14 items-center gap-2 border-b px-5"><Shield className="h-5 w-5 text-primary" /><span className="font-semibold">Codlok Cloud</span></div>
        <nav className="flex-1 space-y-1 p-3">
          <NavButton icon={Package} label="Products" active={active === 'products'} onClick={() => onNavigate({ type: 'products' })} />
          <NavButton icon={KeyRound} label="Secret Templates" active={active === 'secret-templates'} onClick={() => onNavigate({ type: 'secret-templates' })} />
          <Separator className="my-3" />
          <p className="px-3 text-xs font-medium text-muted-foreground">Developer</p>
          <NavButton icon={Code2} label="Developer Context" active={active === 'developer'} onClick={() => onNavigate({ type: 'developer' })} />
          <NavButton icon={FlaskConical} label="API Explorer" onClick={() => onNavigate({ type: 'coming-soon', title: 'API Explorer' })} />
          <NavButton icon={BookOpen} label="OpenAPI & SDK" onClick={() => onNavigate({ type: 'coming-soon', title: 'OpenAPI & SDK' })} />
          <NavButton icon={ScrollText} label="Freeze Log" active={active === 'freeze-log'} onClick={() => onNavigate({ type: 'freeze-log' })} />
        </nav>
        <div className="border-t p-4"><p className="truncate text-xs text-muted-foreground">{userEmail}</p><Button className="mt-2 w-full" size="sm" variant="outline" onClick={onLogout}>Sign Out</Button></div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

function NavButton({ icon: Icon, label, active = false, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="h-4 w-4" />{label}</button>;
}

function ProductsView({ accessToken, onNavigate, userEmail, onLogout }: {
  accessToken: string;
  onNavigate: (view: View) => void;
  userEmail: string;
  onLogout: () => void;
}) {
  const [products, setProducts] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const result = await orgsApi.listWorkspaces(accessToken);
    if (result.success) setProducts(result.data ?? []);
    else toast.error(result.error?.message ?? 'Could not load products');
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  return (
    <PlatformShell active="products" onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}>
      <header className="flex items-center justify-between border-b px-8 py-5"><div><h1 className="text-2xl font-semibold">Products</h1><p className="text-sm text-muted-foreground">Each product is an isolated Codlok workspace.</p></div></header>
      <div className="space-y-6 p-8">
        <Card><CardContent className="flex gap-3 p-4"><Input placeholder="New product name" value={name} onChange={(event) => setName(event.target.value)} /><Button disabled={!name.trim()} onClick={async () => { const result = await orgsApi.createWorkspace(accessToken, name.trim()); if (result.success) { setName(''); toast.success('Product created'); await load(); } else toast.error(result.error?.message ?? 'Could not create product'); }}><Plus className="mr-2 h-4 w-4" />Create Product</Button></CardContent></Card>
        {loading ? <CenteredMessage text="Loading products…" /> : products.length === 0 ? <EmptyState title="No products yet" description="Create your first isolated workspace above." /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{products.map((product) => <Card key={product.id} className="cursor-pointer hover:border-primary" onClick={() => onNavigate({ type: 'product', productId: product.id, tab: 'overview' })}><CardHeader><div className="flex items-center justify-between"><CardTitle>{product.name}</CardTitle><Badge>Active</Badge></div><CardDescription>{product.description ?? product.slug}</CardDescription></CardHeader><CardFooter className="justify-between text-xs text-muted-foreground"><span>{formatTimestamp(product.createdAt)}</span><ChevronRight className="h-4 w-4" /></CardFooter></Card>)}</div>
        )}
      </div>
    </PlatformShell>
  );
}

function ProductView({ productId, tab, accessToken, userEmail, onLogout, onNavigate, onTabChange }: {
  productId: string;
  tab: string;
  accessToken: string;
  userEmail: string;
  onLogout: () => void;
  onNavigate: (view: View) => void;
  onTabChange: (tab: string) => void;
}) {
  const [product, setProduct] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    orgsApi.getWorkspace(accessToken, productId).then((result) => {
      setProduct(result.success ? result.data ?? null : null);
      setLoading(false);
    });
  }, [accessToken, productId]);

  if (loading) return <CenteredMessage text="Loading product…" />;
  if (!product) return <CenteredMessage text="Product not found or access denied." />;

  const tabs = [
    ['overview', 'Overview', LayoutDashboard],
    ['modules', 'Modules', Cpu],
    ['providers', 'Providers', KeyRound],
    ['health', 'Health', Activity],
    ['team', 'Team', Users],
    ['api-keys', 'API Keys', KeyRound],
    ['monitoring', 'Monitoring', Activity],
    ['logs', 'Logs', FileText],
    ['settings', 'Settings', Settings],
  ] as const;

  return (
    <PlatformShell active="products" onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}>
      <header className="border-b">
        <div className="flex items-center gap-3 px-8 py-4"><Button variant="ghost" size="sm" onClick={() => onNavigate({ type: 'products' })}><ArrowLeft className="mr-1 h-4 w-4" />Products</Button><Separator orientation="vertical" className="h-6" /><h1 className="text-lg font-semibold">{product.name}</h1><Badge variant="outline">{product.slug}</Badge></div>
        <div className="flex gap-1 overflow-x-auto px-8">{tabs.map(([id, label, Icon]) => <button key={id} onClick={() => onTabChange(id)} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === id || tab.startsWith(`${id}-`) ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}><Icon className="h-4 w-4" />{label}</button>)}</div>
      </header>
      <div className="p-8">
        {tab === 'overview' && <Overview workspaceId={productId} accessToken={accessToken} onOpenModule={(moduleId) => onTabChange(`module-${moduleId}`)} />}
        {tab === 'modules' && <ModulesView workspaceId={productId} accessToken={accessToken} onOpenModule={(moduleId) => onTabChange(`module-${moduleId}`)} />}
        {tab.startsWith('module-') && <ModuleRecordsView workspaceId={productId} accessToken={accessToken} moduleId={tab.slice('module-'.length) as ModuleId} onBack={() => onTabChange('modules')} />}
        {tab === 'providers' && <ProvidersView workspaceId={productId} accessToken={accessToken} />}
        {tab === 'health' && <HealthView workspaceId={productId} accessToken={accessToken} />}
        {tab === 'team' && <TeamView workspaceId={productId} accessToken={accessToken} />}
        {['api-keys', 'monitoring', 'logs', 'settings'].includes(tab) && <ComingSoonCard title={tabs.find(([id]) => id === tab)?.[1] ?? tab} />}
      </div>
    </PlatformShell>
  );
}

function useModuleStatuses(accessToken: string, workspaceId: string) {
  const [statuses, setStatuses] = useState<Record<string, ProviderStatusDto | null>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(MODULES.map(async (module) => {
      if (!module.providerBacked) return [module.moduleId, null] as const;
      const result = await configStatusApi.getStatus(accessToken, workspaceId, module.moduleId);
      return [module.moduleId, result.success ? result.data ?? null : null] as const;
    })).then((entries) => { if (!cancelled) { setStatuses(Object.fromEntries(entries)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [accessToken, workspaceId]);
  return { statuses, loading };
}

function Overview({ workspaceId, accessToken, onOpenModule }: { workspaceId: string; accessToken: string; onOpenModule: (id: ModuleId) => void }) {
  const { statuses, loading } = useModuleStatuses(accessToken, workspaceId);
  const configured = MODULES.filter((module) => !module.providerBacked || statuses[module.moduleId]?.configured).length;
  return <div className="space-y-6"><div className="grid gap-4 md:grid-cols-3"><StatCard label="Modules" value={MODULES.length} /><StatCard label="Operational / configured" value={loading ? '…' : configured} /><StatCard label="Workspace isolation" value="Enabled" /></div><ModuleGrid statuses={statuses} onOpenModule={onOpenModule} /></div>;
}

function ModulesView({ workspaceId, accessToken, onOpenModule }: { workspaceId: string; accessToken: string; onOpenModule: (id: ModuleId) => void }) {
  const { statuses } = useModuleStatuses(accessToken, workspaceId);
  return <div className="space-y-4"><h2 className="text-xl font-semibold">Modules</h2><ModuleGrid statuses={statuses} onOpenModule={onOpenModule} /></div>;
}

function ModuleGrid({ statuses, onOpenModule }: { statuses: Record<string, ProviderStatusDto | null>; onOpenModule: (id: ModuleId) => void }) {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{MODULES.map((module) => { const status = statuses[module.moduleId]; const configured = !module.providerBacked || status?.configured; const Icon = module.icon; return <Card key={module.moduleId} className="cursor-pointer hover:border-primary" onClick={() => onOpenModule(module.moduleId)}><CardHeader><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Icon className="h-5 w-5 text-primary" /><CardTitle className="text-base">{module.name}</CardTitle></div><Badge variant={configured ? 'default' : 'outline'}>{configured ? 'Operational' : 'Not configured'}</Badge></div></CardHeader><CardContent className="text-xs text-muted-foreground">{status?.missingKeys.length ? `${status.missingKeys.length} required value(s) missing` : module.providerBacked ? 'Provider configuration complete' : 'Internal platform module'}</CardContent></Card>; })}</div>;
}

function ModuleRecordsView({ workspaceId, accessToken, moduleId, onBack }: { workspaceId: string; accessToken: string; moduleId: ModuleId; onBack: () => void }) {
  const definition = MODULES.find((module) => module.moduleId === moduleId);
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async (append = false, cursorOverride?: string) => {
    if (!definition?.listKey) return;
    setLoading(true); setError('');
    const result = await moduleDataApi.list(accessToken, moduleId, workspaceId, append ? cursorOverride : undefined);
    if (!result.success || !result.data) { setError(result.error?.message ?? 'Could not load records'); setLoading(false); return; }
    const raw = result.data;
    const items = (raw[definition.listKey] ?? []) as Record<string, unknown>[];
    setRecords((previous) => append ? [...previous, ...items] : items);
    setHasMore(Boolean(raw.hasMore));
    setNextCursor((raw.nextCursor as string | null | undefined) ?? null);
    setLoading(false);
  }, [accessToken, definition, moduleId, workspaceId]);

  useEffect(() => { setRecords([]); setCursor(undefined); setSelected(null); void load(false); }, [moduleId, workspaceId]);

  if (!definition) return <EmptyState title="Unknown module" description={moduleId} />;
  const Icon = definition.icon;
  if (!definition.listKey) return <div className="space-y-4"><Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Modules</Button><Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5" />{definition.name}</CardTitle><CardDescription>This module has no operational record collection exposed to the dashboard.</CardDescription></CardHeader></Card></div>;

  return <div className="space-y-4"><Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Modules</Button><div><h2 className="flex items-center gap-2 text-xl font-semibold"><Icon className="h-5 w-5 text-primary" />{definition.name}</h2><p className="text-sm text-muted-foreground">Infrastructure records only. Business meaning remains inside the consuming product.</p></div>{error && <Card className="border-destructive"><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>}{!loading && records.length === 0 && !error ? <EmptyState title="No records found" description="This workspace has no records for this module." /> : <Card><CardContent className="space-y-2 p-4">{records.map((record) => { const id = String(record[definition.idField ?? 'id'] ?? 'unknown'); return <button key={id} className="w-full rounded-md border p-3 text-left hover:bg-muted" onClick={async () => { const result = await moduleDataApi.get(accessToken, moduleId, workspaceId, id); if (result.success) setSelected(result.data ?? record); else toast.error(result.error?.message ?? 'Could not load record'); }}><div className="flex items-center justify-between"><span className="font-mono text-sm font-medium">{id}</span><span className="text-xs text-muted-foreground">{summarizeRecord(record)}</span></div></button>; })}{loading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}{hasMore && <Button variant="outline" disabled={loading || !nextCursor} onClick={() => { const token = nextCursor ?? undefined; setCursor(token); void load(true, token); }}>Load More</Button>}</CardContent></Card>}{selected && <Card><CardHeader><CardTitle className="text-base">Record Detail</CardTitle><CardDescription>Only fields returned by the module public interface are displayed.</CardDescription></CardHeader><CardContent><dl className="grid gap-2 md:grid-cols-2">{Object.entries(selected).map(([key, value]) => <div key={key} className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">{key}</dt><dd className="mt-1 break-all font-mono text-sm">{formatValue(key, value)}</dd></div>)}</dl></CardContent></Card>}</div>;
}

function ProvidersView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const [providers, setProviders] = useState<ProviderMetadataDto[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { providerRegistryApi.listAll(accessToken).then((result) => { if (result.success) setProviders(result.data?.providers ?? []); else toast.error(result.error?.message ?? 'Could not load providers'); setLoading(false); }); }, [accessToken]);
  if (loading) return <CenteredMessage text="Loading providers…" />;
  return <div className="space-y-5"><div><h2 className="text-xl font-semibold">Provider Configuration</h2><p className="text-sm text-muted-foreground">Credentials are encrypted and scoped to this product. No saved value is returned to the browser.</p></div><div className="grid gap-5 xl:grid-cols-2">{providers.map((provider) => <ProviderCard key={provider.providerId} provider={provider} workspaceId={workspaceId} accessToken={accessToken} />)}</div></div>;
}

function ProviderCard({ provider, workspaceId, accessToken }: { provider: ProviderMetadataDto; workspaceId: string; accessToken: string }) {
  const fields = PROVIDER_FIELDS[provider.providerId] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusDto | null>(null);

  const refresh = useCallback(async () => {
    const [checks, setting, status] = await Promise.all([
      Promise.all(fields.map(async (field) => [field.key, (await secretsApi.check(accessToken, workspaceId, field.key)).data?.configured ?? false] as const)),
      settingsApi.get(accessToken, workspaceId, `default_provider:${provider.moduleId}`),
      configStatusApi.getStatus(accessToken, workspaceId, provider.moduleId),
    ]);
    setConfigured(Object.fromEntries(checks));
    setActive(setting.success && setting.data?.value === provider.providerId);
    setProviderStatus(status.success ? status.data ?? null : null);
  }, [accessToken, fields, provider.moduleId, provider.providerId, workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveAll = async () => {
    setSaving(true);
    try {
      if (provider.providerId === 's3') await secretsApi.set(accessToken, workspaceId, 'STORAGE_PROVIDER', 's3');
      for (const field of fields) {
        const value = values[field.key]?.trim();
        if (value) {
          const result = await secretsApi.set(accessToken, workspaceId, field.key, value);
          if (!result.success) throw new Error(result.error?.message ?? `Failed to save ${field.label}`);
        }
      }
      await settingsApi.set(accessToken, workspaceId, `default_provider:${provider.moduleId}`, provider.providerId);
      setValues({});
      toast.success(`${provider.displayName} configuration saved`);
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save provider'); }
    finally { setSaving(false); }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      for (const field of fields) {
        if (configured[field.key]) await secretsApi.delete(accessToken, workspaceId, field.key);
      }
      if (provider.providerId === 's3') await secretsApi.delete(accessToken, workspaceId, 'STORAGE_PROVIDER');
      if (active) await settingsApi.delete(accessToken, workspaceId, `default_provider:${provider.moduleId}`);
      toast.success(`${provider.displayName} disconnected`);
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not disconnect provider'); }
    finally { setSaving(false); }
  };

  const statusLabel = providerStatus?.configured
    ? (active ? 'Selected & configured' : 'Configured')
    : Object.values(configured).some(Boolean)
      ? 'Partially configured'
      : 'Not configured';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div><CardTitle className="text-base">{provider.displayName}</CardTitle><CardDescription>{provider.category} · {provider.routing}</CardDescription></div>
          <Badge variant={providerStatus?.configured ? 'default' : 'outline'}>{statusLabel}</Badge>
        </div>
        {providerStatus?.missingKeys?.length ? <CardDescription>Missing: {providerStatus.missingKeys.join(', ')}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.length === 0 ? <p className="text-sm text-muted-foreground">No Phase 3 configuration component exists for this provider.</p> : fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <div className="flex justify-between"><Label htmlFor={`${provider.providerId}-${field.key}`}>{field.label}</Label>{configured[field.key] && <span className="text-xs text-emerald-600">Configured</span>}</div>
            <div className="flex gap-2"><Input id={`${provider.providerId}-${field.key}`} type={field.secret ? 'password' : 'text'} placeholder={configured[field.key] ? 'Enter a replacement value' : field.placeholder} value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />{configured[field.key] && <Button variant="outline" onClick={async () => { const result = await secretsApi.delete(accessToken, workspaceId, field.key); if (result.success) toast.success(`${field.label} removed`); else toast.error(result.error?.message ?? 'Delete failed'); await refresh(); }}>Delete</Button>}</div>
          </div>
        ))}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2"><Button onClick={saveAll} disabled={saving || fields.every((field) => !(values[field.key] ?? '').trim())}>{saving ? 'Saving…' : active ? 'Update' : 'Save & Select'}</Button>{Object.values(configured).some(Boolean) && <Button variant="destructive" onClick={disconnect} disabled={saving}>Disconnect</Button>}</div>
        {provider.supportsTestConnection && <Button variant="outline" disabled title="Provider adapter connection testing is intentionally not implemented yet.">Test Connection — Coming Soon</Button>}
      </CardFooter>
    </Card>
  );
}

function TeamView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { orgsApi.listMembersWithIdentity(accessToken, workspaceId).then((result) => { if (result.success) setMembers(result.data ?? []); else toast.error(result.error?.message ?? 'Could not load team'); setLoading(false); }); }, [accessToken, workspaceId]);
  return <div className="space-y-4"><div><h2 className="text-xl font-semibold">Team</h2><p className="text-sm text-muted-foreground">Codlok workspace access only — not the product's customers or tenants.</p></div>{loading ? <CenteredMessage text="Loading team…" /> : members.length === 0 ? <EmptyState title="No members" description="No workspace members were returned." /> : <Card><CardContent className="space-y-2 p-4">{members.map((member) => <div key={member.memberId} className="flex items-center justify-between rounded-md border p-3"><div><p className="text-sm font-medium">{member.email ?? member.userId}</p><p className="text-xs text-muted-foreground">Joined {formatTimestamp(member.joinedAt)}</p></div><Badge variant={member.roleName === 'Owner' ? 'default' : 'outline'}>{member.roleName}</Badge></div>)}</CardContent></Card>}</div>;
}

function HealthView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const { statuses, loading } = useModuleStatuses(accessToken, workspaceId);
  return <div className="space-y-4"><div><h2 className="text-xl font-semibold">Health</h2><p className="text-sm text-muted-foreground">Current configuration readiness only. Uptime and latency remain unavailable until instrumentation is implemented.</p></div>{loading ? <CenteredMessage text="Checking module configuration…" /> : <ModuleGrid statuses={statuses} onOpenModule={() => undefined} />}</div>;
}

function DeveloperView({ onNavigate, userEmail, onLogout }: { onNavigate: (view: View) => void; userEmail: string; onLogout: () => void }) {
  return <PlatformShell active="developer" onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}><div className="border-b px-8 py-5"><h1 className="text-2xl font-semibold">Developer Context</h1><p className="text-sm text-muted-foreground">Resources for external coding agents that build against Codlok Cloud.</p></div><div className="grid gap-4 p-8 md:grid-cols-2"><Card><CardHeader><CardTitle>Master Specification</CardTitle><CardDescription>The canonical module contracts, ownership rules and error shapes.</CardDescription></CardHeader><CardFooter><Button disabled>Download Context — Coming Soon</Button></CardFooter></Card><ComingSoonCard title="OpenAPI, SDK and API Explorer" /></div></PlatformShell>;
}

function FreezeLogView({ onNavigate, userEmail, onLogout }: { onNavigate: (view: View) => void; userEmail: string; onLogout: () => void }) {
  return <PlatformShell active="freeze-log" onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}><div className="border-b px-8 py-5"><h1 className="text-2xl font-semibold">Freeze Log</h1><p className="text-sm text-muted-foreground">Static platform documentation, not editable configuration.</p></div><div className="p-8"><Card><CardContent className="p-0"><div className="divide-y">{MOCK_FREEZE_LOG.map((entry) => <div key={entry.module} className="grid grid-cols-3 gap-4 p-4 text-sm"><span className="font-medium">{entry.module}</span><span className="font-mono text-muted-foreground">{entry.version}</span><Badge className="w-fit" variant={entry.status === 'Frozen' ? 'default' : 'outline'}>{entry.status}</Badge></div>)}</div></CardContent></Card></div></PlatformShell>;
}

function ComingSoonPage({ title, description, onNavigate, userEmail, onLogout }: { title: string; description?: string; onNavigate: (view: View) => void; userEmail: string; onLogout: () => void }) {
  return <PlatformShell active={title === 'Secret Templates' ? 'secret-templates' : ''} onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}><div className="flex min-h-full items-center justify-center p-8"><ComingSoonCard title={title} description={description} /></div></PlatformShell>;
}

function ComingSoonCard({ title, description }: { title: string; description?: string }) {
  return <Card className="w-full max-w-2xl"><CardHeader><div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted"><Lock className="h-5 w-5" /></div><CardTitle>{title}</CardTitle><CardDescription>{description ?? 'This feature is deliberately marked Coming Soon because its backend contract has not been designed and frozen.'}</CardDescription></CardHeader></Card>;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <Card><CardContent className="p-8 text-center"><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></CardContent></Card>;
}

function CenteredMessage({ text }: { text: string }) {
  return <div className="flex min-h-screen items-center justify-center"><p className="text-sm text-muted-foreground">{text}</p></div>;
}

function summarizeRecord(record: Record<string, unknown>): string {
  const preferred = ['status', 'overallStatus', 'deliveryStatus', 'state', 'verificationType', 'currency', 'createdAt'];
  return preferred.filter((key) => record[key] !== undefined).slice(0, 3).map((key) => `${key}: ${String(record[key])}`).join(' · ');
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (key.toLowerCase().includes('size') && typeof value === 'number') return formatBytes(value);
  if (key.endsWith('At') && typeof value === 'string') return formatTimestamp(value);
  return String(value);
}
