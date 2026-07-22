'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import { useAuth } from '@/lib/auth-context';
import {
  configStatusApi,
  credentialsApi,
  jobsApi,
  moduleDataApi,
  observabilityApi,
  orgsApi,
  providerRegistryApi,
  secretsApi,
  settingsApi,
  type ProviderMetadataDto,
  type ProductCredential,
  type PlatformJobStatus,
  type PlatformJobView,
  type ProviderStatusDto,
  type AuditEventView,
  type UsageSummary,
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
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Toaster } from '@/components/ui/sonner';
import { CodlokMark } from '@/components/brand/codlok-mark';
import { toast } from 'sonner';
import {
  Activity,
  ArrowLeft,
  Bell,
  BookOpen,
  CheckCircle2,
  Copy,
  ChevronRight,
  Code2,
  Cpu,
  CreditCard,
  FileText,
  FlaskConical,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  Lock,
  LogOut,
  Mail,
  Menu,
  Moon,
  Package,
  Plus,
  ScrollText,
  Settings,
  Shield,
  Smartphone,
  Sun,
  RotateCw,
  Trash2,
  Users,
  Workflow,
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

const DEFAULT_VIEW: View = { type: 'products' };

/**
 * Keep the selected dashboard location in the URL. This is deliberately UI-only:
 * authorization continues to be checked by the product APIs after a refresh.
 */
function viewFromLocation(): View {
  const params = new URLSearchParams(window.location.search);
  const page = params.get('page');
  if (page === 'product') {
    const productId = params.get('product');
    const tab = params.get('tab');
    if (productId && tab) return { type: 'product', productId, tab };
  }
  if (page === 'secret-templates') return { type: 'secret-templates' };
  if (page === 'developer') return { type: 'developer' };
  if (page === 'freeze-log') return { type: 'freeze-log' };
  return DEFAULT_VIEW;
}

function urlForView(view: View): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('page');
  url.searchParams.delete('product');
  url.searchParams.delete('tab');
  if (view.type === 'product') {
    url.searchParams.set('page', 'product');
    url.searchParams.set('product', view.productId);
    url.searchParams.set('tab', view.tab);
  } else if (view.type !== 'products') {
    url.searchParams.set('page', view.type);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

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

const OBSERVABILITY_CACHE_MS = 30_000;
const monitoringCache = new Map<string, { value: UsageSummary; at: number }>();
const auditCache = new Map<string, { value: AuditEventView[]; cursor: string | null; hasMore: boolean; at: number }>();

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

export function Dashboard() {
  const { user, loading, login, register, autoVerifyEmail, logout } = useAuth();
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);

  // Run before paint so refreshing a product tab never visibly falls back to
  // the Products home while React restores the saved location.
  useLayoutEffect(() => {
    setView(viewFromLocation());
    const onPopState = () => setView(viewFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((next: View) => {
    setView(next);
    window.history.pushState(null, '', urlForView(next));
  }, []);

  if (loading) return <DashboardBootSkeleton />;

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

  const shared = { onNavigate: navigate, userEmail: user.email, onLogout: logout };
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
          onTabChange={(tab) => navigate({ type: 'product', productId: view.productId, tab })}
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
    <div className="relative min-h-screen overflow-hidden bg-[#080a10] p-4 text-white selection:bg-[#7c8cff]/35 sm:p-6">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[30rem] w-[50rem] -translate-x-1/2 rounded-full bg-[#596cf6]/15 blur-[140px]" />
      <Toaster richColors position="top-right" />
      <a href="/" className="relative z-10 mx-auto flex w-full max-w-6xl items-center gap-2 text-sm font-medium tracking-[-0.03em] text-white/80 transition hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to Codlok</a>
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-6rem)] max-w-6xl items-center gap-10 py-10 lg:grid-cols-[1fr_420px] lg:gap-20">
        <AuthTransitDiagram />
        <Card className="w-full border-white/10 bg-[#11141d]/90 text-white shadow-2xl shadow-black/30 backdrop-blur-xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[#aeb7ff]/25 bg-[#7c8cff]/15 text-[#cbd0ff]"><CodlokMark animated className="h-8 w-9" title="Codlok rider in motion" /></div>
            <CardTitle className="text-2xl text-white">Codlok Cloud</CardTitle>
            <CardDescription className="text-white/55">{mode === 'login' ? 'Sign in to manage your products and infrastructure.' : 'Create your Codlok Cloud account.'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label className="text-white/75" htmlFor="email">Email</Label><Input className="border-white/10 bg-white/[0.04] text-white placeholder:text-white/30" id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <div className="space-y-2"><Label className="text-white/75" htmlFor="password">Password</Label><Input className="border-white/10 bg-white/[0.04] text-white placeholder:text-white/30" id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button className="w-full bg-[#7c8cff] text-white hover:bg-[#929eff]" disabled={busy || !email || password.length < 8} onClick={() => onSubmit(email, password)}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Register'}</Button>
            <Button className="text-white/65 hover:text-white" variant="link" onClick={onToggle}>{mode === 'login' ? 'Create an account' : 'Back to sign in'}</Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function AuthTransitDiagram() {
  return (
    <section className="hidden lg:block" aria-label="How Codlok safely connects products and providers">
      <div className="mb-8 max-w-xl">
        <p className="text-sm font-medium text-[#aeb7ff]">SECURED TRANSIT</p>
        <h1 className="mt-3 text-5xl font-medium leading-[0.98] tracking-[-0.065em] text-white">Your product connects.<br /><span className="text-white/50">Codlok keeps it controlled.</span></h1>
        <p className="mt-5 max-w-lg text-base leading-7 text-white/50">One governed route between your backend and the providers behind it. Scope the access, switch providers when needed, and keep every action observable.</p>
      </div>
      <div className="auth-transit relative h-[380px] overflow-hidden rounded-2xl border border-white/10 bg-[#0e111a]/80 shadow-2xl shadow-black/20">
        <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:32px_32px]" />
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 680 380" fill="none" aria-hidden="true">
          <defs><linearGradient id="transit-line" x1="80" y1="190" x2="610" y2="190" gradientUnits="userSpaceOnUse"><stop stopColor="#98A4FF" stopOpacity=".4" /><stop offset=".5" stopColor="#C7CCFF" /><stop offset="1" stopColor="#83E8D3" stopOpacity=".6" /></linearGradient></defs>
          <path d="M118 190 C210 190 220 100 334 100 S455 80 555 80" stroke="url(#transit-line)" strokeWidth="2" />
          <path d="M118 190 C210 190 220 100 334 100 S455 190 555 190" stroke="url(#transit-line)" strokeWidth="2" />
          <path d="M118 190 C210 190 220 100 334 100 S455 300 555 300" stroke="url(#transit-line)" strokeWidth="2" />
          <path d="M118 190 C210 190 220 280 334 280 S455 190 555 190" stroke="url(#transit-line)" strokeOpacity=".45" strokeWidth="2" />
          {[[118,190],[334,100],[334,280],[555,80],[555,190],[555,300]].map(([cx,cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" fill="#B8C0FF" />)}
          <circle className="auth-transit-pulse auth-transit-pulse-one" cx="0" cy="0" r="5" fill="#fff" />
          <circle className="auth-transit-pulse auth-transit-pulse-two" cx="0" cy="0" r="4" fill="#99F0DC" />
          <circle className="auth-transit-pulse auth-transit-pulse-three" cx="0" cy="0" r="4" fill="#BFC6FF" />
        </svg>
        <TransitNode className="left-[8%] top-[calc(50%-34px)]" title="Your backend" detail="DROPPDAY" tone="indigo" />
        <TransitNode className="left-[40%] top-[calc(26%-34px)]" title="Codlok" detail="Gateway" tone="bright" />
        <TransitNode className="left-[40%] top-[calc(74%-34px)]" title="Policy" detail="Scopes + audit" tone="muted" />
        <TransitNode className="right-[7%] top-[calc(21%-31px)]" title="Resend" detail="Mail" tone="green" small />
        <TransitNode className="right-[7%] top-[calc(50%-31px)]" title="Supabase" detail="Auth + data" tone="green" small />
        <TransitNode className="right-[7%] top-[calc(79%-31px)]" title="Stripe" detail="Payments" tone="green" small />
        <div className="absolute bottom-5 left-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] text-white/55"><span className="h-1.5 w-1.5 rounded-full bg-[#8cedd7] shadow-[0_0_12px_#8cedd7]" /> Live routes · provider-neutral</div>
      </div>
    </section>
  );
}

function TransitNode({ className, title, detail, tone, small = false }: { className: string; title: string; detail: string; tone: 'indigo' | 'bright' | 'muted' | 'green'; small?: boolean }) {
  const toneClass = { indigo: 'border-[#9ba7ff]/30 bg-[#6978ee]/15', bright: 'border-[#d6daff]/45 bg-[#aeb7ff]/15 shadow-[0_0_42px_rgba(139,151,255,0.22)]', muted: 'border-white/15 bg-white/[0.05]', green: 'border-[#86ead5]/30 bg-[#72e2c8]/10' }[tone];
  return <div className={`absolute z-10 ${className} ${small ? 'w-[118px] p-2.5' : 'w-[132px] p-3'} rounded-xl border ${toneClass} backdrop-blur-md`}><p className="text-xs font-medium text-white">{title}</p><p className="mt-0.5 text-[10px] text-white/45">{detail}</p></div>;
}

function PlatformShell({ children, active, onNavigate, userEmail, onLogout }: {
  children: ReactNode;
  active: string;
  onNavigate: (view: View) => void;
  userEmail: string;
  onLogout: () => void;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavigate = (next: View) => {
    setMobileNavOpen(false);
    onNavigate(next);
  };

  return (
    <div className="min-h-dvh bg-background lg:grid lg:h-dvh lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden min-h-0 border-r bg-sidebar lg:flex lg:flex-col">
        <ShellNavigation active={active} onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout} />
      </aside>
      <div className="flex min-h-dvh min-w-0 flex-col lg:min-h-0">
        <div className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2"><CodlokMark className="h-5 w-6 text-primary" /><span className="font-semibold">Codlok Cloud</span></div>
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild><Button size="icon" variant="outline" aria-label="Open navigation"><Menu className="h-4 w-4" /></Button></SheetTrigger>
            <SheetContent side="left" className="w-[18rem] gap-0 p-0 sm:max-w-[18rem]">
              <SheetTitle className="sr-only">Codlok Cloud navigation</SheetTitle>
              <ShellNavigation active={active} onNavigate={mobileNavigate} userEmail={userEmail} onLogout={onLogout} />
            </SheetContent>
          </Sheet>
        </div>
        <main className="min-w-0 flex-1 lg:overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function ShellNavigation({ active, onNavigate, userEmail, onLogout }: {
  active: string;
  onNavigate: (view: View) => void;
  userEmail: string;
  onLogout: () => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-14 shrink-0 items-center gap-2 border-b px-5"><CodlokMark className="h-5 w-6 text-primary" /><span className="font-semibold">Codlok Cloud</span></div>
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">
      <NavButton icon={Package} label="Products" active={active === 'products'} onClick={() => onNavigate({ type: 'products' })} />
      <NavButton icon={KeyRound} label="Secret Templates" active={active === 'secret-templates'} onClick={() => onNavigate({ type: 'secret-templates' })} />
      <Separator className="my-3" />
      <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">Developer</p>
      <NavButton icon={Code2} label="Developer Context" active={active === 'developer'} onClick={() => onNavigate({ type: 'developer' })} />
      <NavButton icon={FlaskConical} label="API Explorer" onClick={() => onNavigate({ type: 'coming-soon', title: 'API Explorer' })} />
      <NavButton icon={BookOpen} label="OpenAPI & SDK" onClick={() => onNavigate({ type: 'coming-soon', title: 'OpenAPI & SDK' })} />
      <NavButton icon={ScrollText} label="Freeze Log" active={active === 'freeze-log'} onClick={() => onNavigate({ type: 'freeze-log' })} />
    </nav>
    <div className="shrink-0 space-y-3 border-t p-4">
      <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
      <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
        <label htmlFor="dashboard-dark-mode" className="flex items-center gap-2 text-sm"><span className="relative h-4 w-4">{dark ? <Moon className="absolute h-4 w-4" /> : <Sun className="absolute h-4 w-4" />}</span>Dark mode</label>
        <Switch id="dashboard-dark-mode" checked={dark} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} disabled={!mounted} aria-label="Toggle dark mode" />
      </div>
      <Button className="w-full" size="sm" variant="outline" onClick={onLogout}><LogOut className="mr-2 h-4 w-4" />Sign Out</Button>
    </div>
  </div>;
}

function NavButton({ icon: Icon, label, active = false, onClick }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`flex min-h-9 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}><Icon className="h-4 w-4 shrink-0" />{label}</button>;
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
      <header className="border-b px-4 py-4 sm:px-6 lg:px-8 lg:py-5"><h1 className="text-2xl font-semibold">Products</h1><p className="text-sm text-muted-foreground">Each product is an isolated Codlok workspace.</p></header>
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row"><Input placeholder="New product name" value={name} onChange={(event) => setName(event.target.value)} /><Button className="sm:shrink-0" disabled={!name.trim()} onClick={async () => { const result = await orgsApi.createWorkspace(accessToken, name.trim()); if (result.success) { setName(''); toast.success('Product created'); await load(); } else toast.error(result.error?.message ?? 'Could not create product'); }}><Plus className="mr-2 h-4 w-4" />Create Product</Button></CardContent></Card>
        {loading ? <ProductsSkeleton /> : products.length === 0 ? <EmptyState title="No products yet" description="Create your first isolated workspace above." /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{products.map((product) => <button key={product.id} className="group rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onNavigate({ type: 'product', productId: product.id, tab: 'overview' })}><Card className="h-full transition-colors group-hover:border-primary"><CardHeader><div className="flex items-start justify-between gap-3"><CardTitle className="break-words">{product.name}</CardTitle><Badge className="shrink-0">Active</Badge></div><CardDescription className="break-words">{product.description ?? product.slug}</CardDescription></CardHeader><CardFooter className="justify-between gap-3 text-xs text-muted-foreground"><span>{formatTimestamp(product.createdAt)}</span><ChevronRight className="h-4 w-4 shrink-0" /></CardFooter></Card></button>)}</div>
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

  if (loading) return <PlatformShell active="products" onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}><ProductShellSkeleton /></PlatformShell>;
  if (!product) return <PlatformShell active="products" onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}><div className="p-4 sm:p-6 lg:p-8"><EmptyState title="Product unavailable" description="Product not found or access denied." /></div></PlatformShell>;

  const tabs = [
    ['overview', 'Overview', LayoutDashboard],
    ['modules', 'Modules', Cpu],
    ['providers', 'Providers', KeyRound],
    ['health', 'Health', Activity],
    ['team', 'Team', Users],
    ['api-keys', 'API Keys', KeyRound],
    ['jobs', 'Jobs', Workflow],
    ['monitoring', 'Monitoring', Activity],
    ['logs', 'Logs', FileText],
    ['settings', 'Settings', Settings],
  ] as const;

  return (
    <PlatformShell active="products" onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}>
      <header className="border-b">
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:px-8"><Button variant="ghost" size="sm" onClick={() => onNavigate({ type: 'products' })}><ArrowLeft className="mr-1 h-4 w-4" />Products</Button><Separator orientation="vertical" className="hidden h-6 sm:block" /><h1 className="min-w-0 truncate text-base font-semibold sm:text-lg">{product.name}</h1><Badge className="max-w-full truncate" variant="outline">{product.slug}</Badge></div>
        <div className="flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden">{tabs.map(([id, label, Icon]) => <button key={id} onClick={() => onTabChange(id)} className={`flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${tab === id || tab.startsWith(`${id}-`) ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}><Icon className="h-4 w-4" />{label}</button>)}</div>
      </header>
      <div className="p-4 sm:p-6 lg:p-8">
        {tab === 'overview' && <Overview workspaceId={productId} accessToken={accessToken} onOpenModule={(moduleId) => onTabChange(`module-${moduleId}`)} />}
        {tab === 'modules' && <ModulesView workspaceId={productId} accessToken={accessToken} onOpenModule={(moduleId) => onTabChange(`module-${moduleId}`)} />}
        {tab.startsWith('module-') && <ModuleRecordsView workspaceId={productId} accessToken={accessToken} moduleId={tab.slice('module-'.length) as ModuleId} onBack={() => onTabChange('modules')} />}
        {tab === 'providers' && <ProvidersView workspaceId={productId} accessToken={accessToken} />}
        {tab === 'health' && <HealthView workspaceId={productId} accessToken={accessToken} />}
        {tab === 'team' && <TeamView workspaceId={productId} accessToken={accessToken} />}
        {tab === 'api-keys' && <ApiKeysView workspaceId={productId} accessToken={accessToken} />}
        {tab === 'jobs' && <JobsView workspaceId={productId} accessToken={accessToken} />}
        {tab === 'monitoring' && <MonitoringView workspaceId={productId} accessToken={accessToken} />}
        {tab === 'logs' && <AuditLogsView workspaceId={productId} accessToken={accessToken} />}
        {tab === 'settings' && <ProductSettingsView product={product} accessToken={accessToken} onUpdated={setProduct} onDeleted={() => onNavigate({ type: 'products' })} />}
      </div>
    </PlatformShell>
  );
}

function MonitoringView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const cached = monitoringCache.get(workspaceId);
  const [summary, setSummary] = useState<UsageSummary | null>(cached?.value ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const result = await observabilityApi.summary(accessToken, workspaceId);
    if (result.success && result.data) { setSummary(result.data); monitoringCache.set(workspaceId, { value: result.data, at: Date.now() }); }
    else setError(result.error?.message ?? 'Usage summary could not be loaded.');
    setLoading(false);
  }, [accessToken, workspaceId]);
  useEffect(() => {
    const entry = monitoringCache.get(workspaceId);
    if (!entry || Date.now() - entry.at > OBSERVABILITY_CACHE_MS) void load();
  }, [load, workspaceId]);
  if (loading && !summary) return <MonitoringSkeleton />;
  if (error || !summary) return <EmptyState title="Monitoring unavailable" description={error || 'No summary returned.'} />;
  const max = Math.max(1, ...summary.hourly.map((bucket) => bucket.requests));
  return <div className="space-y-6">
    <div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">Usage Monitoring</h2><p className="text-sm text-muted-foreground">Gateway activity for this workspace. No request bodies or secrets are collected.</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RotateCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"><StatCard label="Last hour" value={summary.requestsLastHour} /><StatCard label="Last 24 hours" value={summary.requestsLast24Hours} /><StatCard label="Active credentials" value={summary.activeCredentialsLast24Hours} /><StatCard label="Denied" value={summary.deniedLast24Hours} /><StatCard label="Errors" value={summary.errorsLast24Hours} /></div>
    <Card><CardHeader><CardTitle className="text-base">Requests by hour</CardTitle><CardDescription>Rolling 24-hour gateway request count.</CardDescription></CardHeader><CardContent><div className="flex h-56 items-end gap-1" aria-label="Hourly gateway requests">{summary.hourly.map((bucket) => <div key={bucket.hour} className="group relative flex h-full min-w-0 flex-1 items-end"><div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(bucket.requests ? 4 : 1, (bucket.requests / max) * 100)}%` }} /><span className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background group-hover:block">{new Date(bucket.hour).toLocaleTimeString([], { hour: '2-digit' })}: {bucket.requests}</span></div>)}</div></CardContent></Card>
  </div>;
}

function AuditLogsView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const cached = auditCache.get(workspaceId);
  const [events, setEvents] = useState<AuditEventView[]>(cached?.value ?? []);
  const [cursor, setCursor] = useState<string | null>(cached?.cursor ?? null);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const load = useCallback(async (before?: string, append = false) => {
    setLoading(true); setError('');
    const result = await observabilityApi.events(accessToken, workspaceId, before);
    if (result.success && result.data) {
      setEvents((current) => {
        const nextEvents = append ? [...current, ...result.data!.items] : result.data!.items;
        auditCache.set(workspaceId, { value: nextEvents, cursor: result.data!.nextCursor, hasMore: result.data!.hasMore, at: Date.now() });
        return nextEvents;
      });
      setCursor(result.data.nextCursor); setHasMore(result.data.hasMore);
    } else setError(result.error?.message ?? 'Audit events could not be loaded.');
    setLoading(false);
  }, [accessToken, workspaceId]);
  useEffect(() => {
    const entry = auditCache.get(workspaceId);
    if (!entry || Date.now() - entry.at > OBSERVABILITY_CACHE_MS) void load();
  }, [load, workspaceId]);
  if (loading && events.length === 0) return <AuditLogsSkeleton />;
  return <div className="space-y-6">
    <div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">Gateway Audit Log</h2><p className="text-sm text-muted-foreground">Security outcomes and safe operational metadata only.</p></div><Button variant="outline" size="sm" onClick={() => void load()}><RotateCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    {error && <Card className="border-destructive"><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>}
    {!loading && events.length === 0 && !error ? <EmptyState title="No gateway events yet" description="Events will appear after a product calls a protected Codlok API." /> : <Card><CardContent className="divide-y p-0">{events.map((event) => <div key={event.eventId} className="grid gap-2 p-4 md:grid-cols-[11rem_1fr_auto]"><div className="text-xs text-muted-foreground">{formatTimestamp(event.occurredAt)}</div><div><p className="font-mono text-sm">{event.eventType}</p><p className="mt-1 text-xs text-muted-foreground">Credential {event.credentialId ? `${event.credentialId.slice(0, 14)}…` : 'not recorded'}{Object.keys(event.metadata).length ? ` · ${Object.entries(event.metadata).map(([key, value]) => `${key}=${String(value)}`).join(' · ')}` : ''}</p></div><Badge variant={event.outcome === 'allowed' ? 'default' : event.outcome === 'denied' ? 'outline' : 'destructive'}>{event.outcome}</Badge></div>)}{loading && <p className="p-4 text-sm text-muted-foreground">Loading events…</p>}</CardContent>{hasMore && <CardFooter><Button variant="outline" disabled={loading || !cursor} onClick={() => cursor && void load(cursor, true)}>Load More</Button></CardFooter>}</Card>}
  </div>;
}

function MonitoringSkeleton() {
  return <div className="space-y-6" aria-label="Preparing usage dashboard"><div className="space-y-2"><Skeleton className="h-7 w-52" /><Skeleton className="h-4 w-96 max-w-full" /></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Card key={index}><CardHeader><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-16" /></CardHeader></Card>)}</div><Card><CardHeader><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-56" /></CardHeader><CardContent><div className="flex h-56 items-end gap-2">{[30,55,25,70,45,85,40,65,35,90,50,75].map((height, index) => <Skeleton key={index} className="flex-1 rounded-t" style={{ height: `${height}%` }} />)}</div></CardContent></Card></div>;
}

function AuditLogsSkeleton() {
  return <div className="space-y-6" aria-label="Preparing audit events"><div className="space-y-2"><Skeleton className="h-7 w-44" /><Skeleton className="h-4 w-80 max-w-full" /></div><Card><CardContent className="divide-y p-0">{Array.from({ length: 6 }, (_, index) => <div key={index} className="grid gap-3 p-4 md:grid-cols-[11rem_1fr_auto]"><Skeleton className="h-4 w-32" /><div className="space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-72 max-w-full" /></div><Skeleton className="h-6 w-16 rounded-full" /></div>)}</CardContent></Card></div>;
}

const PRODUCT_SCOPES = ['auth:read', 'auth:write', 'mail:send', 'notifications:send', 'pay:read', 'pay:write', 'sms:send', 'storage:read', 'storage:write', 'verify:read', 'verify:write'];

function ApiKeysView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const [credentials, setCredentials] = useState<ProductCredential[]>([]);
  const [name, setName] = useState('Development key');
  const [environment, setEnvironment] = useState<ProductCredential['environment']>('development');
  const [scopes, setScopes] = useState<string[]>(['auth:read']);
  const [revealedKey, setRevealedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await credentialsApi.list(accessToken, workspaceId);
    if (result.success) setCredentials(result.data ?? []);
    else toast.error(result.error?.message ?? 'Could not load API keys');
    setLoading(false);
  }, [accessToken, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const showNewKey = (apiKey: string) => {
    setRevealedKey(apiKey);
    toast.success('API key created. Copy it now; it will not be shown again.');
  };

  return <div className="space-y-6">
    <div><h2 className="text-xl font-semibold">Product API Keys</h2><p className="text-sm text-muted-foreground">Workspace-scoped credentials for products and coding agents. Raw keys are shown once only.</p></div>
    {revealedKey && <Card className="border-amber-500/50 bg-amber-50/40 dark:bg-amber-950/20"><CardHeader><CardTitle className="text-base">Copy your new key now</CardTitle><CardDescription>This secret cannot be recovered after you leave this screen.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2 sm:flex-row"><Input readOnly value={revealedKey} className="font-mono" /><Button className="sm:shrink-0" variant="outline" onClick={async () => { await navigator.clipboard.writeText(revealedKey); toast.success('Copied'); }}><Copy className="mr-2 h-4 w-4" />Copy</Button></CardContent></Card>}
    <Card><CardHeader><CardTitle className="text-base">Create credential</CardTitle><CardDescription>Choose the smallest set of permissions the product needs.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-2"><Label>Environment</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={environment} onChange={(event) => setEnvironment(event.target.value as ProductCredential['environment'])}><option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option></select></div></div>
      <div className="space-y-2"><Label>Scopes</Label><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PRODUCT_SCOPES.map((scope) => <label key={scope} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" checked={scopes.includes(scope)} onChange={(event) => setScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} />{scope}</label>)}</div></div>
    </CardContent><CardFooter><Button disabled={busy || !name.trim() || scopes.length === 0} onClick={async () => { setBusy(true); const result = await credentialsApi.create(accessToken, workspaceId, { name: name.trim(), environment, scopes }); if (result.success && result.data) { showNewKey(result.data.apiKey); await load(); } else toast.error(result.error?.message ?? 'Could not create API key'); setBusy(false); }}><Plus className="mr-2 h-4 w-4" />{busy ? 'Creating…' : 'Create API Key'}</Button></CardFooter></Card>
    <Card><CardHeader><CardTitle className="text-base">Credentials</CardTitle></CardHeader><CardContent className="space-y-3">{loading ? <CredentialListSkeleton /> : credentials.length === 0 ? <p className="text-sm text-muted-foreground">No API keys yet.</p> : credentials.map((credential) => <div key={credential.credentialId} className="flex flex-col gap-3 rounded-md border p-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{credential.name}</p><Badge variant={credential.revokedAt ? 'outline' : 'default'}>{credential.revokedAt ? 'Revoked' : credential.environment}</Badge></div><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{credential.keyPrefix}••••••••</p><p className="mt-1 break-words text-xs text-muted-foreground">{credential.scopes.join(', ')} · Created {formatTimestamp(credential.createdAt)}</p></div>{!credential.revokedAt && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={async () => { const result = await credentialsApi.rotate(accessToken, workspaceId, credential.credentialId); if (result.success && result.data) { showNewKey(result.data.apiKey); await load(); } else toast.error(result.error?.message ?? 'Could not rotate key'); }}><RotateCw className="mr-2 h-4 w-4" />Rotate</Button><Button size="sm" variant="destructive" onClick={async () => { const result = await credentialsApi.revoke(accessToken, workspaceId, credential.credentialId); if (result.success) { toast.success('API key revoked'); await load(); } else toast.error(result.error?.message ?? 'Could not revoke key'); }}><Trash2 className="mr-2 h-4 w-4" />Revoke</Button></div>}</div>)}</CardContent></Card>
  </div>;
}

const JOB_STATUSES: Array<{ value: 'all' | PlatformJobStatus; label: string }> = [
  { value: 'all', label: 'All jobs' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'retry_scheduled', label: 'Retry scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'dead_letter', label: 'Dead letter' },
];

function JobsView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const [jobs, setJobs] = useState<PlatformJobView[]>([]);
  const [status, setStatus] = useState<'all' | PlatformJobStatus>('all');
  const [loading, setLoading] = useState(true);
  const [replayingId, setReplayingId] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const result = await jobsApi.list(accessToken, workspaceId, status === 'all' ? undefined : status);
    if (result.success) setJobs(result.data?.items ?? []);
    else toast.error(result.error?.message ?? 'Could not load platform jobs');
    setLoading(false);
  }, [accessToken, status, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-xl font-semibold">Durable Jobs</h2><p className="text-sm text-muted-foreground">Background platform work, retries, and dead-letter recovery for this product.</p></div><label className="flex items-center gap-2 text-sm"><ListFilter className="h-4 w-4 text-muted-foreground" /><span className="sr-only">Filter jobs</span><select className="h-9 rounded-md border bg-background px-3" value={status} onChange={(event) => setStatus(event.target.value as 'all' | PlatformJobStatus)}>{JOB_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
    {loading ? <JobsSkeleton /> : jobs.length === 0 ? <EmptyState title="No jobs found" description={status === 'all' ? 'No durable background jobs have been created for this product.' : `No ${JOB_STATUSES.find((option) => option.value === status)?.label.toLowerCase()} jobs were found.`} /> : <div className="space-y-3">{jobs.map((job) => <div key={job.jobId} className="rounded-md border bg-card p-4"><div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-sm font-medium">{job.jobType}</p><JobStatusBadge status={job.status} /></div><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{job.jobId}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>Module: {job.module}</span><span>Attempts: {job.attemptCount}/{job.maxAttempts}</span><span>Updated: {formatTimestamp(job.updatedAt)}</span>{job.lastErrorCode && <span className="text-destructive">Error: {job.lastErrorCode}</span>}</div></div>{job.status === 'dead_letter' && <div className="flex w-full flex-col gap-2 lg:max-w-sm"><Input aria-label={`Replay reason for ${job.jobId}`} placeholder="Reason for replay" value={reasons[job.jobId] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [job.jobId]: event.target.value }))} /><Button size="sm" disabled={replayingId === job.jobId || (reasons[job.jobId]?.trim().length ?? 0) < 3} onClick={async () => { setReplayingId(job.jobId); const result = await jobsApi.replay(accessToken, workspaceId, job.jobId, reasons[job.jobId]?.trim() ?? ''); if (result.success) { toast.success('Job queued for replay'); setReasons((current) => ({ ...current, [job.jobId]: '' })); await load(); } else toast.error(result.error?.message ?? 'Could not replay job'); setReplayingId(''); }}><RotateCw className="mr-2 h-4 w-4" />{replayingId === job.jobId ? 'Replaying…' : 'Replay job'}</Button></div>}</div></div>)}</div>}
  </div>;
}

function JobStatusBadge({ status }: { status: PlatformJobStatus }) {
  const label = status.replace('_', ' ');
  if (status === 'dead_letter') return <Badge variant="destructive">{label}</Badge>;
  if (status === 'completed') return <Badge>{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

function ProductSettingsView({ product, accessToken, onUpdated, onDeleted }: { product: Workspace; accessToken: string; onUpdated: (product: Workspace) => void; onDeleted: () => void }) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setName(product.name); setDescription(product.description ?? ''); }, [product]);

  return <div className="max-w-3xl space-y-6">
    <div><h2 className="text-xl font-semibold">Product Settings</h2><p className="text-sm text-muted-foreground">Manage this Codlok workspace and its dashboard identity.</p></div>
    <Card><CardHeader><CardTitle className="text-base">General</CardTitle><CardDescription>The product slug and workspace ID remain stable when its display name changes.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label htmlFor="product-name">Name</Label><Input id="product-name" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="product-description">Description</Label><Input id="product-description" placeholder="Optional product description" value={description} onChange={(event) => setDescription(event.target.value)} /></div><dl className="grid gap-3 rounded-md border bg-muted/20 p-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Slug</dt><dd className="mt-1 break-all font-mono">{product.slug}</dd></div><div><dt className="text-xs text-muted-foreground">Workspace ID</dt><dd className="mt-1 break-all font-mono">{product.id}</dd></div></dl></CardContent><CardFooter className="border-t bg-muted/20"><Button disabled={busy || !name.trim() || (name.trim() === product.name && description.trim() === (product.description ?? ''))} onClick={async () => { setBusy(true); const result = await orgsApi.updateWorkspace(accessToken, product.id, { name: name.trim(), description: description.trim() }); if (result.success && result.data) { onUpdated(result.data); toast.success('Product settings saved'); } else toast.error(result.error?.message ?? 'Could not update product'); setBusy(false); }}>{busy ? 'Saving…' : 'Save changes'}</Button></CardFooter></Card>
    <Card className="border-destructive/40"><CardHeader><CardTitle className="text-base text-destructive">Delete product</CardTitle><CardDescription>This permanently deletes the workspace. Type <strong>{product.name}</strong> to confirm.</CardDescription></CardHeader><CardContent><Input aria-label="Confirm product deletion" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={product.name} /></CardContent><CardFooter className="border-t bg-destructive/5"><Button variant="destructive" disabled={busy || confirmation !== product.name} onClick={async () => { setBusy(true); const result = await orgsApi.deleteWorkspace(accessToken, product.id); if (result.success) { toast.success('Product deleted'); onDeleted(); } else { toast.error(result.error?.message ?? 'Could not delete product'); setBusy(false); } }}><Trash2 className="mr-2 h-4 w-4" />Delete product</Button></CardFooter></Card>
  </div>;
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
  return <div className="space-y-6"><div className="grid gap-4 md:grid-cols-3"><StatCard label="Modules" value={MODULES.length} />{loading ? <Card><CardHeader className="space-y-3 pb-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-8 w-14" /></CardHeader></Card> : <StatCard label="Operational / configured" value={configured} />}<StatCard label="Workspace isolation" value="Enabled" /></div>{loading ? <ModuleGridSkeleton /> : <ModuleGrid statuses={statuses} onOpenModule={onOpenModule} />}</div>;
}

function ModulesView({ workspaceId, accessToken, onOpenModule }: { workspaceId: string; accessToken: string; onOpenModule: (id: ModuleId) => void }) {
  const { statuses, loading } = useModuleStatuses(accessToken, workspaceId);
  return <div className="space-y-4"><h2 className="text-xl font-semibold">Modules</h2>{loading ? <ModuleGridSkeleton /> : <ModuleGrid statuses={statuses} onOpenModule={onOpenModule} />}</div>;
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
  const [loading, setLoading] = useState(true);
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

  return <div className="space-y-4"><Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Modules</Button><div><h2 className="flex items-center gap-2 text-xl font-semibold"><Icon className="h-5 w-5 text-primary" />{definition.name}</h2><p className="text-sm text-muted-foreground">Infrastructure records only. Business meaning remains inside the consuming product.</p></div>{error && <Card className="border-destructive"><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>}{loading && records.length === 0 ? <RecordListSkeleton /> : !loading && records.length === 0 && !error ? <EmptyState title="No records found" description="This workspace has no records for this module." /> : <Card><CardContent className="space-y-2 p-4">{records.map((record) => { const id = String(record[definition.idField ?? 'id'] ?? 'unknown'); return <button key={id} className="w-full rounded-md border p-3 text-left hover:bg-muted" onClick={async () => { const result = await moduleDataApi.get(accessToken, moduleId, workspaceId, id); if (result.success) setSelected(result.data ?? record); else toast.error(result.error?.message ?? 'Could not load record'); }}><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><span className="break-all font-mono text-sm font-medium">{id}</span><span className="text-xs text-muted-foreground">{summarizeRecord(record)}</span></div></button>; })}{loading && <Skeleton className="h-14 w-full" />}{hasMore && <Button variant="outline" disabled={loading || !nextCursor} onClick={() => { const token = nextCursor ?? undefined; setCursor(token); void load(true, token); }}>Load More</Button>}</CardContent></Card>}{selected && <Card><CardHeader><CardTitle className="text-base">Record Detail</CardTitle><CardDescription>Only fields returned by the module public interface are displayed.</CardDescription></CardHeader><CardContent><dl className="grid gap-2 md:grid-cols-2">{Object.entries(selected).map(([key, value]) => <div key={key} className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">{key}</dt><dd className="mt-1 break-all font-mono text-sm">{formatValue(key, value)}</dd></div>)}</dl></CardContent></Card>}</div>;
}

function ProvidersView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const [providers, setProviders] = useState<ProviderMetadataDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedModuleId, setSelectedModuleId] = useState<ModuleId>('auth');
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  useEffect(() => { providerRegistryApi.listAll(accessToken).then((result) => { if (result.success) setProviders(result.data?.providers ?? []); else toast.error(result.error?.message ?? 'Could not load providers'); setLoading(false); }); }, [accessToken]);
  const selectedModule = MODULES.find((module) => module.moduleId === selectedModuleId) ?? MODULES[0];
  const SelectedModuleIcon = selectedModule.icon;
  const selectedProviders = providers.filter((provider) => provider.moduleId === selectedModule.moduleId);
  const selectedProvider = selectedProviders.find((provider) => provider.providerId === selectedProviderId) ?? selectedProviders[0];

  useEffect(() => {
    setSelectedProviderId(null);
  }, [selectedModuleId]);

  if (loading) return <ProvidersSkeleton />;

  return <div className="space-y-6">
    <div className="max-w-3xl"><h2 className="text-xl font-semibold">Provider Configuration</h2><p className="text-sm text-muted-foreground">Choose a Codlok module, then configure only the provider it uses. Credentials remain encrypted and scoped to this product.</p></div>
    <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-4 lg:sticky lg:top-6">
        <div>
          <p className="mb-2 px-1 text-xs font-medium uppercase text-muted-foreground">Provider-backed</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{MODULES.filter((module) => module.providerBacked).map((module) => <ProviderModuleButton key={module.moduleId} module={module} active={module.moduleId === selectedModuleId} count={providers.filter((provider) => provider.moduleId === module.moduleId).length} onClick={() => setSelectedModuleId(module.moduleId)} />)}</div>
        </div>
        <div>
          <p className="mb-2 px-1 text-xs font-medium uppercase text-muted-foreground">Built into Codlok</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{MODULES.filter((module) => !module.providerBacked).map((module) => <ProviderModuleButton key={module.moduleId} module={module} active={module.moduleId === selectedModuleId} onClick={() => setSelectedModuleId(module.moduleId)} />)}</div>
        </div>
      </div>
      <section className="min-w-0 space-y-5" aria-labelledby="selected-provider-module">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted"><SelectedModuleIcon className="h-5 w-5" /></div><div><h3 id="selected-provider-module" className="text-lg font-semibold">{selectedModule.name}</h3><p className="text-sm text-muted-foreground">{selectedModule.providerBacked ? `${selectedProviders.length} provider${selectedProviders.length === 1 ? '' : 's'} available for this module.` : 'A Codlok-managed module with no external provider credentials.'}</p></div></div>
          <Badge variant={selectedModule.providerBacked ? 'outline' : 'default'}>{selectedModule.providerBacked ? 'External providers' : 'Codlok managed'}</Badge>
        </div>
        {!selectedModule.providerBacked ? <InternalModulePanel module={selectedModule} /> : selectedProviders.length === 0 ? <EmptyState title="No providers registered" description="This module is ready for future provider adapters." /> : <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{selectedProviders.map((provider) => <button key={provider.providerId} onClick={() => setSelectedProviderId(provider.providerId)} className={`rounded-md border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedProvider?.providerId === provider.providerId ? 'border-primary bg-muted/60' : 'hover:border-foreground/30 hover:bg-muted/30'}`}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{provider.displayName}</p><p className="mt-1 text-xs text-muted-foreground">{provider.category}</p></div>{provider.defaultProvider && <Badge variant="outline">Default</Badge>}</div><div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span>{provider.routing}</span><span className="flex items-center gap-1">Configure <ChevronRight className="h-3.5 w-3.5" /></span></div></button>)}</div>
          {selectedProvider && <ProviderCard key={selectedProvider.providerId} provider={selectedProvider} workspaceId={workspaceId} accessToken={accessToken} />}
        </>}
      </section>
    </div>
  </div>;
}

function ProviderModuleButton({ module, active, count, onClick }: { module: ModuleDefinition; active: boolean; count?: number; onClick: () => void }) {
  const Icon = module.icon;
  return <button onClick={onClick} className={`flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}><Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate font-medium">{module.name}</span><span className={`text-xs ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{module.providerBacked ? count ?? 0 : 'Built in'}</span></button>;
}

function InternalModulePanel({ module }: { module: ModuleDefinition }) {
  return <div className="rounded-md border bg-muted/20 p-5 sm:p-6"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" /><div><p className="font-medium">Ready without provider setup</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{module.name} is supplied by Codlok Cloud and follows the workspace boundary automatically. Configuration and operational data are available from its dashboard module.</p></div></div></div>;
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
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="text-base">{provider.displayName}</CardTitle><CardDescription>{provider.category} · {provider.routing}</CardDescription></div>
          <Badge variant={providerStatus?.configured ? 'default' : 'outline'}>{statusLabel}</Badge>
        </div>
        {providerStatus?.missingKeys?.length ? <CardDescription>Missing: {providerStatus.missingKeys.join(', ')}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.length === 0 ? <p className="text-sm text-muted-foreground">No Phase 3 configuration component exists for this provider.</p> : fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <div className="flex justify-between"><Label htmlFor={`${provider.providerId}-${field.key}`}>{field.label}</Label>{configured[field.key] && <span className="text-xs text-emerald-600 dark:text-emerald-400">Configured</span>}</div>
            <div className="flex flex-col gap-2 sm:flex-row"><Input id={`${provider.providerId}-${field.key}`} type={field.secret ? 'password' : 'text'} placeholder={configured[field.key] ? 'Enter a replacement value' : field.placeholder} value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />{configured[field.key] && <Button className="sm:shrink-0" variant="outline" onClick={async () => { const result = await secretsApi.delete(accessToken, workspaceId, field.key); if (result.success) toast.success(`${field.label} removed`); else toast.error(result.error?.message ?? 'Delete failed'); await refresh(); }}>Delete</Button>}</div>
          </div>
        ))}
      </CardContent>
      <CardFooter className="flex flex-col items-stretch justify-between gap-3 border-t bg-muted/20 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2"><Button onClick={saveAll} disabled={saving || fields.every((field) => !(values[field.key] ?? '').trim())}>{saving ? 'Saving…' : active ? 'Update' : 'Save & Select'}</Button>{Object.values(configured).some(Boolean) && <Button variant="destructive" onClick={disconnect} disabled={saving}>Disconnect</Button>}</div>
        {provider.supportsTestConnection && <Button className="sm:ml-auto" variant="outline" disabled title="Provider adapter connection testing is intentionally not implemented yet.">Test Connection — Coming Soon</Button>}
      </CardFooter>
    </Card>
  );
}

function TeamView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { orgsApi.listMembersWithIdentity(accessToken, workspaceId).then((result) => { if (result.success) setMembers(result.data ?? []); else toast.error(result.error?.message ?? 'Could not load team'); setLoading(false); }); }, [accessToken, workspaceId]);
  return <div className="space-y-4"><div><h2 className="text-xl font-semibold">Team</h2><p className="text-sm text-muted-foreground">Codlok workspace access only — not the product's customers or tenants.</p></div>{loading ? <ListRowsSkeleton rows={4} /> : members.length === 0 ? <EmptyState title="No members" description="No workspace members were returned." /> : <Card><CardContent className="space-y-2 p-4">{members.map((member) => <div key={member.memberId} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-all text-sm font-medium">{member.email ?? member.userId}</p><p className="text-xs text-muted-foreground">Joined {formatTimestamp(member.joinedAt)}</p></div><Badge className="w-fit" variant={member.roleName === 'Owner' ? 'default' : 'outline'}>{member.roleName}</Badge></div>)}</CardContent></Card>}</div>;
}

function HealthView({ workspaceId, accessToken }: { workspaceId: string; accessToken: string }) {
  const { statuses, loading } = useModuleStatuses(accessToken, workspaceId);
  return <div className="space-y-4"><div><h2 className="text-xl font-semibold">Health</h2><p className="text-sm text-muted-foreground">Current configuration readiness only. Uptime and latency remain unavailable until instrumentation is implemented.</p></div>{loading ? <ModuleGridSkeleton /> : <ModuleGrid statuses={statuses} onOpenModule={() => undefined} />}</div>;
}

function DeveloperView({ onNavigate, userEmail, onLogout }: { onNavigate: (view: View) => void; userEmail: string; onLogout: () => void }) {
  return <PlatformShell active="developer" onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}><div className="border-b px-4 py-4 sm:px-6 lg:px-8 lg:py-5"><h1 className="text-2xl font-semibold">Developer Context</h1><p className="text-sm text-muted-foreground">Resources for external coding agents that build against Codlok Cloud.</p></div><div className="grid gap-4 p-4 sm:p-6 md:grid-cols-2 lg:p-8"><Card><CardHeader><CardTitle>Master Specification</CardTitle><CardDescription>The canonical module contracts, ownership rules and error shapes.</CardDescription></CardHeader><CardFooter><Button disabled>Download Context — Coming Soon</Button></CardFooter></Card><ComingSoonCard title="OpenAPI, SDK and API Explorer" /></div></PlatformShell>;
}

function FreezeLogView({ onNavigate, userEmail, onLogout }: { onNavigate: (view: View) => void; userEmail: string; onLogout: () => void }) {
  return <PlatformShell active="freeze-log" onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}><div className="border-b px-4 py-4 sm:px-6 lg:px-8 lg:py-5"><h1 className="text-2xl font-semibold">Freeze Log</h1><p className="text-sm text-muted-foreground">Static platform documentation, not editable configuration.</p></div><div className="p-4 sm:p-6 lg:p-8"><Card><CardContent className="p-0"><div className="divide-y">{MOCK_FREEZE_LOG.map((entry) => <div key={entry.module} className="grid gap-2 p-4 text-sm sm:grid-cols-[1fr_8rem_auto] sm:items-center"><span className="font-medium">{entry.module}</span><span className="font-mono text-muted-foreground">{entry.version}</span><Badge className="w-fit" variant={entry.status === 'Frozen' ? 'default' : 'outline'}>{entry.status}</Badge></div>)}</div></CardContent></Card></div></PlatformShell>;
}

function ComingSoonPage({ title, description, onNavigate, userEmail, onLogout }: { title: string; description?: string; onNavigate: (view: View) => void; userEmail: string; onLogout: () => void }) {
  return <PlatformShell active={title === 'Secret Templates' ? 'secret-templates' : ''} onNavigate={onNavigate} userEmail={userEmail} onLogout={onLogout}><div className="flex min-h-full items-center justify-center p-8"><ComingSoonCard title={title} description={description} /></div></PlatformShell>;
}

function ComingSoonCard({ title, description }: { title: string; description?: string }) {
  return <Card className="w-full max-w-2xl"><CardHeader><div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-muted"><Lock className="h-5 w-5" /></div><CardTitle>{title}</CardTitle><CardDescription>{description ?? 'This feature is deliberately marked Coming Soon because its backend contract has not been designed and frozen.'}</CardDescription></CardHeader></Card>;
}

function DashboardBootSkeleton() {
  return <div className="grid min-h-dvh bg-background lg:grid-cols-[15rem_minmax(0,1fr)]" aria-label="Loading Codlok Cloud"><aside className="hidden border-r bg-sidebar p-4 lg:block"><Skeleton className="h-7 w-36" /><div className="mt-8 space-y-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}</div></aside><main><div className="border-b p-4 sm:p-6 lg:p-8"><Skeleton className="h-7 w-44" /><Skeleton className="mt-2 h-4 w-72 max-w-full" /></div><div className="space-y-6 p-4 sm:p-6 lg:p-8"><Skeleton className="h-20 w-full" /><ProductsSkeleton /></div></main></div>;
}

function ProductsSkeleton() {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading products">{Array.from({ length: 6 }, (_, index) => <Card key={index}><CardHeader className="space-y-3"><div className="flex justify-between gap-4"><Skeleton className="h-5 w-32" /><Skeleton className="h-5 w-14 rounded-full" /></div><Skeleton className="h-4 w-40" /></CardHeader><CardFooter className="justify-between"><Skeleton className="h-3 w-24" /><Skeleton className="h-4 w-4" /></CardFooter></Card>)}</div>;
}

function ProductShellSkeleton() {
  return <div aria-label="Loading product"><div className="space-y-4 border-b px-4 py-4 sm:px-6 lg:px-8"><div className="flex items-center gap-3"><Skeleton className="h-8 w-24" /><Skeleton className="h-6 w-36" /><Skeleton className="h-6 w-24 rounded-full" /></div><div className="flex gap-3 overflow-hidden">{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-8 w-24 shrink-0" />)}</div></div><div className="space-y-6 p-4 sm:p-6 lg:p-8"><div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}</div><ModuleGridSkeleton /></div></div>;
}

function ModuleGridSkeleton() {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading modules">{Array.from({ length: 6 }, (_, index) => <Card key={index}><CardHeader><div className="flex items-center justify-between gap-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-5 w-20 rounded-full" /></div></CardHeader><CardContent><Skeleton className="h-3 w-40 max-w-full" /></CardContent></Card>)}</div>;
}

function ProvidersSkeleton() {
  return <div className="space-y-6" aria-label="Loading providers"><div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-[32rem] max-w-full" /></div><div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]"><div className="space-y-2">{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}</div><div className="space-y-5"><Skeleton className="h-16 w-full" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28 w-full" />)}</div><Skeleton className="h-80 w-full" /></div></div></div>;
}

function RecordListSkeleton() {
  return <Card aria-label="Loading records"><CardContent className="space-y-2 p-4">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}</CardContent></Card>;
}

function CredentialListSkeleton() {
  return <div className="space-y-3" aria-label="Loading credentials">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}</div>;
}

function JobsSkeleton() {
  return <div className="space-y-3" aria-label="Loading durable jobs">{Array.from({ length: 5 }, (_, index) => <div key={index} className="space-y-3 rounded-md border p-4"><div className="flex justify-between gap-4"><Skeleton className="h-4 w-48" /><Skeleton className="h-5 w-20 rounded-full" /></div><Skeleton className="h-3 w-64 max-w-full" /><Skeleton className="h-3 w-80 max-w-full" /></div>)}</div>;
}

function ListRowsSkeleton({ rows }: { rows: number }) {
  return <Card aria-label="Loading list"><CardContent className="space-y-2 p-4">{Array.from({ length: rows }, (_, index) => <div key={index} className="flex items-center justify-between gap-4 rounded-md border p-3"><div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28" /></div><Skeleton className="h-5 w-16 rounded-full" /></div>)}</CardContent></Card>;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <Card><CardContent className="p-8 text-center"><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></CardContent></Card>;
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

