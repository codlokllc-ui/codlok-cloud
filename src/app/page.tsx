'use client';

/**
 * Codlok Cloud Dashboard v1.0 — Track A (Frontend, Mock Data)
 *
 * Per Master Spec §23. Mock data throughout — no backend calls.
 *
 * Binding Rules (§23):
 * - Every module detail page shows ONLY opaque infrastructure IDs, status,
 *   timestamps, provider name. Never business names/filenames/entity descriptions.
 * - "Team" (not "Organizations") for the in-product people page.
 * - Secret Templates: copy-not-inherit. "Apply Template" is mocked UI only.
 * - OpenAPI/SDK/API Explorer are "Coming Soon" placeholders.
 * - No Retry Policy UI anywhere.
 */

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import {
  LayoutDashboard, Package, KeyRound, Bot, FileText, Settings,
  Activity, Users, ChevronRight, Plus, Lock, ArrowLeft,
  Shield, Cpu, Mail, HardDrive, CreditCard, CheckCircle2,
  Smartphone, Bell, AlertTriangle, Eye, FileBox, Clock,
  BookOpen, Code2, FlaskConical, ScrollText
} from 'lucide-react';
import {
  MOCK_PRODUCTS, getMockModules, MOCK_TEAM,
  MOCK_VERIFY_RECORDS, MOCK_STORAGE_RECORDS, MOCK_PAY_RECORDS,
  MOCK_NOTIFICATION_RECORDS, MOCK_SMS_RECORDS,
  MOCK_SECRET_TEMPLATES, MOCK_FREEZE_LOG,
  formatBytes, formatMinorUnits, formatTimestamp,
  type Product, type ModuleStatus,
} from '@/lib/mock-data';

// ===========================================================================
// Types
// ===========================================================================

type View =
  | { type: 'login' }
  | { type: 'products' }
  | { type: 'product'; productId: string; tab: string }
  | { type: 'secret-templates' }
  | { type: 'ai-builder' }
  | { type: 'freeze-log' }
  | { type: 'coming-soon'; title: string };

// ===========================================================================
// Main Component
// ===========================================================================

export default function Home() {
  const [view, setView] = useState<View>({ type: 'login' });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-right" />
      {view.type === 'login' && <LoginView onLogin={() => setView({ type: 'products' })} />}
      {view.type === 'products' && (
        <ProductsView
          onNavigate={setView}
        />
      )}
      {view.type === 'product' && (
        <ProductView
          productId={view.productId}
          tab={view.tab}
          onNavigate={setView}
          onTabChange={(tab) => setView({ type: 'product', productId: view.productId, tab })}
        />
      )}
      {view.type === 'secret-templates' && <SecretTemplatesView onNavigate={setView} />}
      {view.type === 'ai-builder' && <AIBuilderView onNavigate={setView} />}
      {view.type === 'freeze-log' && <FreezeLogView onNavigate={setView} />}
      {view.type === 'coming-soon' && <ComingSoonView title={view.title} onNavigate={setView} />}
    </div>
  );
}

// ===========================================================================
// Login View
// ===========================================================================

function LoginView({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <Shield className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Codlok Cloud</CardTitle>
          <CardDescription>Sign in to your platform dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="admin@codlok.cloud" defaultValue="admin@codlok.cloud" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="••••••••" defaultValue="demo" />
          </div>
        </CardContent>
        <CardFooter>
          <Button className="w-full" onClick={onLogin}>Sign In</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// ===========================================================================
// Shared Sidebar (Platform-level navigation)
// ===========================================================================

function PlatformSidebar({ onNavigate, active }: { onNavigate: (v: View) => void; active: string }) {
  return (
    <div className="flex h-screen w-64 flex-col border-r bg-muted/30">
      <div className="flex h-14 items-center gap-2 border-b px-6">
        <Shield className="h-5 w-5 text-primary" />
        <span className="font-semibold">Codlok Cloud</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        <SidebarLink icon={Package} label="Products" active={active === 'products'} onClick={() => onNavigate({ type: 'products' })} />
        <SidebarLink icon={KeyRound} label="Secret Templates" active={active === 'secret-templates'} onClick={() => onNavigate({ type: 'secret-templates' })} />
        <Separator className="my-3" />
        <div className="px-3 py-1 text-xs font-medium text-muted-foreground">Developer</div>
        <SidebarLink icon={Bot} label="AI Builder" active={active === 'ai-builder'} onClick={() => onNavigate({ type: 'ai-builder' })} />
        <SidebarLink icon={Code2} label="OpenAPI" active={false} onClick={() => onNavigate({ type: 'coming-soon', title: 'OpenAPI' })} />
        <SidebarLink icon={BookOpen} label="SDK" active={false} onClick={() => onNavigate({ type: 'coming-soon', title: 'SDK' })} />
        <SidebarLink icon={FlaskConical} label="API Explorer" active={false} onClick={() => onNavigate({ type: 'coming-soon', title: 'API Explorer' })} />
        <SidebarLink icon={ScrollText} label="Freeze Log" active={active === 'freeze-log'} onClick={() => onNavigate({ type: 'freeze-log' })} />
        <Separator className="my-3" />
        <SidebarLink icon={Settings} label="Account" active={false} onClick={() => onNavigate({ type: 'coming-soon', title: 'Account' })} />
      </nav>
    </div>
  );
}

function SidebarLink({ icon: Icon, label, active, onClick }: { icon: React.ElementType; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

// ===========================================================================
// Products View
// ===========================================================================

function ProductsView({ onNavigate }: { onNavigate: (v: View) => void }) {
  return (
    <div className="flex h-screen">
      <PlatformSidebar onNavigate={onNavigate} active="products" />
      <div className="flex-1 overflow-y-auto">
        <div className="border-b px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Products</h1>
            <Button size="sm" onClick={() => toast.info('Create Product is not available in Track A (mock).')}>
              <Plus className="mr-1 h-4 w-4" /> Create Product
            </Button>
          </div>
        </div>
        <div className="grid gap-4 p-8 md:grid-cols-2 lg:grid-cols-3">
          {MOCK_PRODUCTS.map((p) => (
            <Card key={p.id} className="cursor-pointer hover:border-primary transition-colors" onClick={() => onNavigate({ type: 'product', productId: p.id, tab: 'overview' })}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{p.name}</CardTitle>
                  <Badge variant={p.status === 'active' ? 'default' : 'destructive'}>{p.status}</Badge>
                </div>
                <CardDescription>{p.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Created {formatTimestamp(p.createdAt)}</p>
              </CardContent>
              <CardFooter className="flex items-center justify-end">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Product View (with tabs: Overview, Modules, Health, Team, etc.)
// ===========================================================================

function ProductView({ productId, tab, onNavigate, onTabChange }: {
  productId: string;
  tab: string;
  onNavigate: (v: View) => void;
  onTabChange: (tab: string) => void;
}) {
  const product = MOCK_PRODUCTS.find((p) => p.id === productId);
  if (!product) return <div>Product not found</div>;
  const modules = getMockModules(productId);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'modules', label: 'Modules', icon: Cpu },
    { id: 'health', label: 'Health', icon: Activity },
    { id: 'team', label: 'Team', icon: Users },
    { id: 'api-keys', label: 'API Keys', icon: KeyRound },
    { id: 'monitoring', label: 'Monitoring', icon: Activity },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen">
      <PlatformSidebar onNavigate={onNavigate} active="products" />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Product header with tabs */}
        <div className="border-b">
          <div className="flex items-center gap-3 px-8 py-3">
            <Button variant="ghost" size="sm" onClick={() => onNavigate({ type: 'products' })}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Products
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <h1 className="text-lg font-semibold">{product.name}</h1>
            <Badge variant="outline" className="text-xs">{product.slug}</Badge>
          </div>
          <div className="flex gap-1 px-8 pb-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-8">
          {tab.startsWith('module-') && (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => onTabChange('modules')}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Back to Modules
              </Button>
              <ModuleDetailPage moduleId={tab.replace('module-', '')} productId={productId} />
            </div>
          )}
          {tab === 'overview' && <OverviewTab product={product} modules={modules} onNavigate={onNavigate} />}
          {tab === 'modules' && <ModulesTab productId={productId} onNavigate={onNavigate} />}
          {tab === 'health' && <HealthTab modules={modules} />}
          {tab === 'team' && <TeamTab />}
          {tab === 'api-keys' && <PlaceholderTab title="API Keys" />}
          {tab === 'monitoring' && <PlaceholderTab title="Monitoring" />}
          {tab === 'logs' && <PlaceholderTab title="Logs" />}
          {tab === 'settings' && <PlaceholderTab title="Settings" />}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Overview Tab
// ===========================================================================

function OverviewTab({ product, modules, onNavigate }: { product: Product; modules: ModuleStatus[]; onNavigate: (v: View) => void }) {
  const operational = modules.filter((m) => m.status === 'operational').length;
  const notConfigured = modules.filter((m) => m.status === 'not_configured').length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Modules" value={modules.length} icon={Cpu} />
        <StatCard label="Operational" value={operational} icon={CheckCircle2} />
        <StatCard label="Not Configured" value={notConfigured} icon={AlertTriangle} />
        <StatCard label="Status" value={product.status === 'active' ? 'Active' : 'Suspended'} icon={Activity} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Module List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {modules.map((m) => (
              <div key={m.moduleId} className="flex items-center justify-between rounded-md border px-4 py-3">
                <div className="flex items-center gap-3">
                  <ModuleIcon moduleId={m.moduleId} />
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.provider !== '—' ? `Provider: ${m.provider}` : 'No provider'}
                      {' · '}
                      {m.recordCount} records
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={m.status} />
                  <Button variant="ghost" size="sm"
                    onClick={() => onNavigate({ type: 'product', productId: product.id, tab: `module-${m.moduleId}` })}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// Modules Tab (list + detail pages)
// ===========================================================================

function ModulesTab({ productId, onNavigate }: { productId: string; onNavigate: (v: View) => void }) {
  const modules = getMockModules(productId);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Modules</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {modules.map((m) => (
          <Card key={m.moduleId} className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => onNavigate({ type: 'product', productId, tab: `module-${m.moduleId}` })}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ModuleIcon moduleId={m.moduleId} />
                  <CardTitle className="text-base">{m.name}</CardTitle>
                </div>
                <StatusBadge status={m.status} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Provider: {m.provider ?? 'Not configured'} · {m.recordCount} records
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Module Detail Pages (opaque IDs only — §23 Binding Display Rule)
// ===========================================================================

function ModuleDetailPage({ moduleId, productId }: { moduleId: string; productId: string }) {
  const product = MOCK_PRODUCTS.find((p) => p.id === productId);
  if (!product) return <div>Product not found</div>;
  const modules = getMockModules(productId);
  const moduleInfo = modules.find((m) => m.moduleId === moduleId);
  if (!moduleInfo) return <div>Module not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ModuleIcon moduleId={moduleId} />
        <div>
          <h2 className="text-lg font-semibold">{moduleInfo.name}</h2>
          <p className="text-xs text-muted-foreground">
            Provider: {moduleInfo.provider ?? 'Not configured'} · {moduleInfo.recordCount} records
          </p>
        </div>
      </div>
      {moduleId === 'verify' && <VerifyDetail />}
      {moduleId === 'storage' && <StorageDetail />}
      {moduleId === 'pay' && <PayDetail />}
      {moduleId === 'notifications' && <NotificationsDetail />}
      {moduleId === 'sms' && <SmsDetail />}
      {moduleId === 'auth' && <SimpleModuleDetail moduleInfo={moduleInfo} fields={['userId', 'email', 'emailVerified']} />}
      {moduleId === 'organizations' && <SimpleModuleDetail moduleInfo={moduleInfo} fields={['workspaceId', 'role', 'permissions']} />}
      {moduleId === 'configuration' && <SimpleModuleDetail moduleInfo={moduleInfo} fields={['key', 'version', 'updatedAt']} />}
      {moduleId === 'mail' && <SimpleModuleDetail moduleInfo={moduleInfo} fields={['messageId', 'status', 'provider']} />}
    </div>
  );
}

function VerifyDetail() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Verification Records</CardTitle>
        <CardDescription>Opaque IDs only — no business entity names (§20 Data Minimization, §23 Display Rule)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {MOCK_VERIFY_RECORDS.map((r) => (
            <div key={r.verificationId} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
              <div className="flex items-center gap-4">
                <span className="font-mono font-medium">{r.verificationId}</span>
                <Badge variant="outline">{r.status}</Badge>
                <span className="text-muted-foreground">{r.verificationType}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{r.provider}</span>
                <span>{formatTimestamp(r.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StorageDetail() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">File Records</CardTitle>
        <CardDescription>Opaque IDs only — no filenames (§3.10 File Ownership, §23 Display Rule)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {MOCK_STORAGE_RECORDS.map((r) => (
            <div key={r.fileId} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
              <div className="flex items-center gap-4">
                <span className="font-mono font-medium">{r.fileId}</span>
                <Badge variant="outline">{r.state}</Badge>
                <span className="text-muted-foreground">{r.mimeType}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{r.state === 'UPLOADED' ? formatBytes(r.sizeBytes) : '—'}</span>
                <span>{formatTimestamp(r.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PayDetail() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payment Records</CardTitle>
        <CardDescription>Opaque IDs only — no business labels (§3.12 Financial Ownership, §23 Display Rule)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {MOCK_PAY_RECORDS.map((r) => (
            <div key={r.paymentId} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
              <div className="flex items-center gap-4">
                <span className="font-mono font-medium">{r.paymentId}</span>
                <Badge variant="outline">{r.status}</Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatMinorUnits(r.amountMinorUnits, r.currency)}</span>
                <span>{r.provider}</span>
                <span>{formatTimestamp(r.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationsDetail() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notification Records</CardTitle>
        <CardDescription>Opaque IDs only — no business labels (§23 Display Rule)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {MOCK_NOTIFICATION_RECORDS.map((r) => (
            <div key={r.notificationId} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
              <div className="flex items-center gap-4">
                <span className="font-mono font-medium">{r.notificationId}</span>
                <Badge variant="outline">{r.overallStatus}</Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  {Object.entries(r.channels).map(([ch, v]) => `${ch}: ${v.status}`).join(', ') || '—'}
                </span>
                <span>{formatTimestamp(r.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SmsDetail() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">SMS Records</CardTitle>
        <CardDescription>Opaque IDs only — no recipient phone numbers (§22, §23 Display Rule)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {MOCK_SMS_RECORDS.map((r) => (
            <div key={r.smsId} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
              <div className="flex items-center gap-4">
                <span className="font-mono font-medium">{r.smsId}</span>
                <Badge variant="outline">{r.status}</Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{r.provider}</span>
                <span>{formatTimestamp(r.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SimpleModuleDetail({ moduleInfo, fields }: { moduleInfo: ModuleStatus; fields: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{moduleInfo.name} Records</CardTitle>
        <CardDescription>Opaque infrastructure data only — {fields.join(', ')}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {moduleInfo.recordCount} records · Provider: {moduleInfo.provider ?? 'N/A'} · Status: {moduleInfo.status}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Last activity: {formatTimestamp(moduleInfo.lastActivity)}
        </p>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Health Tab
// ===========================================================================

function HealthTab({ modules }: { modules: ModuleStatus[] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">System Health</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {modules.map((m) => (
          <Card key={m.moduleId}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ModuleIcon moduleId={m.moduleId} />
                  <CardTitle className="text-base">{m.name}</CardTitle>
                </div>
                <StatusBadge status={m.status} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Provider: {m.provider ?? 'N/A'} · Last activity: {formatTimestamp(m.lastActivity)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Team Tab (§23: "Team" not "Organizations")
// ===========================================================================

function TeamTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Team</h2>
          <p className="text-sm text-muted-foreground">
            Codlok access control for this product (Owner/Admin/Member per §12). Not a product's own customers.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => toast.info('Invite is not available in Track A (mock).')}>
          <Plus className="mr-1 h-4 w-4" /> Invite Member
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="space-y-1 p-4">
            {MOCK_TEAM.map((m) => (
              <div key={m.userId} className="flex items-center justify-between rounded-md border px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {m.email[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{m.email}</p>
                    <p className="text-xs text-muted-foreground">Joined {formatTimestamp(m.joinedAt)}</p>
                  </div>
                </div>
                <Badge variant={m.role === 'Owner' ? 'default' : 'outline'}>{m.role}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// Secret Templates View (§23: copy-not-inherit, mocked Apply Template)
// ===========================================================================

function SecretTemplatesView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [applying, setApplying] = useState<string | null>(null);

  const handleApply = (templateId: string, templateName: string) => {
    setApplying(templateId);
    // Mock: simulate a brief delay then show success.
    setTimeout(() => {
      setApplying(null);
      toast.success(`Template "${templateName}" would be copied into the selected product's Configuration store. (Mocked — Track B required for real wiring.)`);
    }, 800);
  };

  return (
    <div className="flex h-screen">
      <PlatformSidebar onNavigate={onNavigate} active="secret-templates" />
      <div className="flex-1 overflow-y-auto">
        <div className="border-b px-8 py-4">
          <h1 className="text-xl font-semibold">Secret Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Templates are copied into each product's Configuration when applied. Editing a template never changes existing products.
          </p>
        </div>
        <div className="p-8">
          <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex items-start gap-3 py-4">
              <Lock className="mt-0.5 h-5 w-5 text-amber-500" />
              <div className="text-sm">
                <p className="font-medium">Secret Templates backend is not yet built (Track B).</p>
                <p className="text-muted-foreground">
                  "Apply Template" is a mocked UI interaction only. Real wiring requires an additive Configuration v1.3
                  extension for platform-owned secrets — not yet designed or frozen.
                </p>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {MOCK_SECRET_TEMPLATES.map((t) => (
              <Card key={t.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <Badge variant="outline">{t.keys.length} keys</Badge>
                  </div>
                  <CardDescription>{t.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {t.keys.map((k) => (
                      <div key={k.key} className="flex items-center gap-2 text-xs">
                        <KeyRound className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono">{k.key}</span>
                        <span className="text-muted-foreground">— {k.description}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Last updated: {formatTimestamp(t.lastUpdated)}</p>
                </CardContent>
                <CardFooter>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={applying === t.id}
                    onClick={() => handleApply(t.id, t.name)}
                  >
                    {applying === t.id ? 'Applying...' : 'Apply Template'}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// AI Builder View
// ===========================================================================

function AIBuilderView({ onNavigate }: { onNavigate: (v: View) => void }) {
  return (
    <div className="flex h-screen">
      <PlatformSidebar onNavigate={onNavigate} active="ai-builder" />
      <div className="flex-1 overflow-y-auto">
        <div className="border-b px-8 py-4">
          <h1 className="text-xl font-semibold">AI Builder</h1>
        </div>
        <div className="p-8">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">AI-Powered Module Integration</CardTitle>
              </div>
              <CardDescription>
                Describe what you want to build, and the AI Builder will suggest which Codlok modules to use and how to wire them together.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="prompt">What are you building?</Label>
                <textarea
                  id="prompt"
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder="e.g. I want to verify a student's identity, charge an admission fee, and send them an SMS confirmation..."
                />
              </div>
              <Button onClick={() => toast.info('AI Builder is a mock in Track A. Real integration requires the AI module (not yet built).')}>
                <Bot className="mr-1 h-4 w-4" /> Generate Integration Plan
              </Button>
              <div className="rounded-md border bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">
                  The AI Builder will eventually use the Codlok module specs to suggest:
                </p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>• Which modules to call (Auth → Verify → Pay → SMS)</li>
                  <li>• The correct function call sequence per frozen specs</li>
                  <li>• Required Configuration keys per workspace</li>
                  <li>• Webhook handler boilerplate</li>
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  This requires the AI module (not yet built) and MCP Gateway (not yet designed).
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Freeze Log View
// ===========================================================================

function FreezeLogView({ onNavigate }: { onNavigate: (v: View) => void }) {
  return (
    <div className="flex h-screen">
      <PlatformSidebar onNavigate={onNavigate} active="freeze-log" />
      <div className="flex-1 overflow-y-auto">
        <div className="border-b px-8 py-4">
          <h1 className="text-xl font-semibold">Freeze Log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform module status — frozen public interfaces cannot change without a Blocker Report (§15).
          </p>
        </div>
        <div className="p-8">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="px-4 py-3 font-medium">Module</th>
                      <th className="px-4 py-3 font-medium">Version</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Depends On</th>
                      <th className="px-4 py-3 font-medium">Tests</th>
                      <th className="px-4 py-3 font-medium">Known Backlog</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MOCK_FREEZE_LOG.map((e, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">{e.module}</td>
                        <td className="px-4 py-3 text-muted-foreground">{e.version}</td>
                        <td className="px-4 py-3">{e.status}</td>
                        <td className="px-4 py-3 text-muted-foreground">{e.dependsOn}</td>
                        <td className="px-4 py-3 text-muted-foreground">{e.tests}</td>
                        <td className="px-4 py-3 text-muted-foreground">{e.knownBacklog}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Coming Soon View
// ===========================================================================

function ComingSoonView({ title, onNavigate }: { title: string; onNavigate: (v: View) => void }) {
  return (
    <div className="flex h-screen">
      <PlatformSidebar onNavigate={onNavigate} active="" />
      <div className="flex flex-1 items-center justify-center">
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Clock className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>Coming Soon</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-sm text-muted-foreground">
              This feature has not been designed yet. No ownership pass has been done —
              same discipline applied to dashboard features as to backend modules.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ===========================================================================
// Placeholder Tab (for API Keys, Monitoring, Logs, Settings)
// ===========================================================================

function PlaceholderTab({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <Card className="max-w-md">
        <CardHeader className="text-center">
          <Clock className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-sm text-muted-foreground">
            This section is part of the dashboard IA but not fully specified in Track A.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// Shared UI Components
// ===========================================================================

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ElementType }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    operational: 'default',
    degraded: 'secondary',
    down: 'destructive',
    not_configured: 'outline',
  };
  const label: Record<string, string> = {
    operational: 'Operational',
    degraded: 'Degraded',
    down: 'Down',
    not_configured: 'Not Configured',
  };
  return <Badge variant={variant[status] ?? 'outline'}>{label[status] ?? status}</Badge>;
}

function ModuleIcon({ moduleId }: { moduleId: string }) {
  const icons: Record<string, React.ElementType> = {
    auth: Shield,
    organizations: Users,
    configuration: Settings,
    mail: Mail,
    storage: HardDrive,
    pay: CreditCard,
    verify: Eye,
    notifications: Bell,
    sms: Smartphone,
  };
  const Icon = icons[moduleId] ?? Cpu;
  return <Icon className="h-4 w-4 text-muted-foreground" />;
}
