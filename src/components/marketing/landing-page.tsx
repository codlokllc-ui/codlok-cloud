'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  Box,
  Braces,
  Check,
  ChevronRight,
  CreditCard,
  Database,
  FileKey2,
  HardDrive,
  Mail,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UsersRound,
} from 'lucide-react';

const modules = [
  { title: 'Identity', detail: 'Authentication, workspaces and roles that stay separate by default.', icon: ShieldCheck },
  { title: 'Payments', detail: 'One payment boundary for checkout, subscriptions and provider webhooks.', icon: CreditCard },
  { title: 'Messaging', detail: 'Transactional mail, SMS and notifications with controlled delivery.', icon: MessageSquare },
  { title: 'Storage', detail: 'Workspace-scoped files, signed URLs and durable upload lifecycle.', icon: HardDrive },
  { title: 'Configuration', detail: 'Encrypted provider settings without sending secrets to agents.', icon: FileKey2 },
  { title: 'Observability', detail: 'Usage, audits and rate limits that make every operation visible.', icon: TimerReset },
];

const guardrails = [
  'Workspace-scoped credentials',
  'Provider secrets stay private',
  'Rate limits and audit events',
  'Idempotent product operations',
];

export function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#07090d] text-[#f7f8fa] selection:bg-[#7c8cff]/30">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(113,123,255,0.18),transparent_34%),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:auto,48px_48px,48px_48px]" />
      <header className="relative z-10 mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[-0.04em]">
          <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-[9px] ring-1 ring-white/15"><Image src="/logo.svg" alt="" width={32} height={32} /></span>
          <span>Codlok</span><span className="font-normal text-white/40">Cloud</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-white/55 md:flex">
          <a className="transition hover:text-white" href="#platform">Platform</a>
          <a className="transition hover:text-white" href="#security">Security</a>
          <a className="transition hover:text-white" href="#developers">Developers</a>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/app" className="hidden text-white/65 transition hover:text-white sm:block">Sign in</Link>
          <Link href="/app" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 font-medium text-[#0b0d12] transition hover:bg-[#dfe3ff]">Open Console <ArrowRight size={14} /></Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 pt-20 text-center lg:px-8 lg:pb-28 lg:pt-28">
        <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-[#9ba7ff]/20 bg-[#7c8cff]/10 px-3 py-1.5 text-xs text-[#c9ceff] shadow-[0_0_35px_rgba(110,122,255,0.12)]"><span className="h-1.5 w-1.5 rounded-full bg-[#9cabff]" /> Built for the products you build next</div>
        <h1 className="mx-auto max-w-5xl text-balance text-5xl font-medium leading-[0.97] tracking-[-0.07em] sm:text-7xl lg:text-[84px]">The secure backend<br /><span className="bg-gradient-to-r from-[#aeb7ff] via-white to-[#95f0df] bg-clip-text text-transparent">for every product.</span></h1>
        <p className="mx-auto mt-7 max-w-2xl text-pretty text-base leading-7 text-white/55 sm:text-lg">Codlok Cloud gives your team and coding agents one reliable control plane for identity, payments, messaging, storage, provider configuration and observability.</p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/app" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#7c8cff] px-5 py-3 text-sm font-medium text-white shadow-[0_12px_40px_rgba(100,112,255,0.28)] transition hover:bg-[#929eff]">Create your first product <ArrowRight size={16} /></Link>
          <a href="#developers" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-5 py-3 text-sm text-white/80 transition hover:bg-white/[0.08]">Explore the platform <ChevronRight size={16} /></a>
        </div>

        <div className="mx-auto mt-16 max-w-5xl rounded-2xl border border-white/10 bg-[#0c0f17]/90 p-2 text-left shadow-2xl shadow-black/30 backdrop-blur sm:p-3">
          <div className="overflow-hidden rounded-xl border border-white/8 bg-[#0a0c12]">
            <div className="flex h-11 items-center gap-2 border-b border-white/8 px-4"><span className="h-2.5 w-2.5 rounded-full bg-[#fb6a74]" /><span className="h-2.5 w-2.5 rounded-full bg-[#edbb5f]" /><span className="h-2.5 w-2.5 rounded-full bg-[#65cf92]" /><span className="ml-3 font-mono text-[11px] text-white/30">console.codlok.cloud / droppday</span><span className="ml-auto rounded-full border border-[#73e5cb]/20 bg-[#73e5cb]/10 px-2 py-0.5 text-[10px] text-[#9bf2df]">Healthy</span></div>
            <div className="grid min-h-[330px] md:grid-cols-[180px_1fr]">
              <aside className="hidden border-r border-white/8 p-3 text-xs text-white/45 md:block"><div className="mb-5 flex items-center gap-2 px-2 text-white/80"><Box size={14} /> DROPPDAY</div>{['Overview','API keys','Monitoring','Audit logs','Settings'].map((item, i) => <div key={item} className={`mb-1 rounded-md px-2.5 py-2 ${i === 0 ? 'bg-white/[0.08] text-white' : ''}`}>{item}</div>)}</aside>
              <div className="p-5 sm:p-7"><div className="flex items-start justify-between"><div><p className="text-xs text-white/40">Product overview</p><h2 className="mt-1 text-xl font-medium tracking-[-0.04em]">DROPPDAY <span className="text-white/35">/ production</span></h2></div><button className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/65">Manage</button></div><div className="mt-7 grid gap-3 sm:grid-cols-3"><Metric value="12,842" label="Requests today" /><Metric value="4" label="Active credentials" /><Metric value="99.98%" label="Gateway success" /></div><div className="mt-5 rounded-xl border border-white/8 bg-white/[0.025] p-4"><div className="mb-5 flex items-center justify-between"><span className="text-sm text-white/75">Gateway activity</span><span className="font-mono text-xs text-[#9bf2df]">+18.4%</span></div><div className="flex h-20 items-end gap-1.5">{[28,42,34,56,45,72,58,76,63,88,69,94,78,98,82,72,92,83].map((h,i) => <span key={i} style={{height:`${h}%`}} className="flex-1 rounded-t-sm bg-gradient-to-t from-[#6272f4]/30 to-[#aeb7ff]" />)}</div></div></div>
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="relative z-10 border-y border-white/8 bg-[#0a0c12]/80 py-20 lg:py-28"><div className="mx-auto max-w-7xl px-6 lg:px-8"><div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr]"><div><p className="text-sm font-medium text-[#aeb7ff]">ONE PLATFORM, CLEAR BOUNDARIES</p><h2 className="mt-4 max-w-md text-4xl font-medium tracking-[-0.06em] sm:text-5xl">Build products, not the same backend again.</h2><p className="mt-5 max-w-md leading-7 text-white/50">Codlok is designed as a stable core for a growing portfolio—not a pile of shared shortcuts that become risky later.</p><a href="#developers" className="mt-7 inline-flex items-center gap-2 text-sm text-white transition hover:text-[#b8c0ff]">See how agents work safely <ArrowRight size={15} /></a></div><div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">{modules.map(({title, detail, icon: Icon}) => <article key={title} className="min-h-52 bg-[#0a0c12] p-6 transition hover:bg-[#10131d]"><span className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-[#b5bdff]"><Icon size={17} /></span><h3 className="mt-8 text-base font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-white/45">{detail}</p></article>)}</div></div></div></section>

      <section id="security" className="relative z-10 mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28"><div className="grid items-center gap-12 lg:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-gradient-to-b from-[#14192b] to-[#0c0e15] p-6 shadow-[inset_0_1px_rgba(255,255,255,0.08)] sm:p-9"><div className="flex items-center justify-between border-b border-white/10 pb-5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-[#79e6cd]/10 text-[#8ef1da]"><ShieldCheck size={18} /></span><div><p className="text-sm">Credential policy</p><p className="text-xs text-white/40">production / droppday</p></div></div><span className="text-xs text-[#9bf2df]">Enforced</span></div><div className="mt-6 space-y-4">{guardrails.map((rule) => <div key={rule} className="flex items-center gap-3 text-sm text-white/70"><span className="grid h-5 w-5 place-items-center rounded-full border border-[#7ce5cd]/30 bg-[#7ce5cd]/10 text-[#9bf2df]"><Check size={12} /></span>{rule}</div>)}</div><div className="mt-8 rounded-lg border border-white/8 bg-black/20 p-4 font-mono text-xs leading-6 text-white/45"><span className="text-[#b5bdff]">POST</span> /api/data/v1/storage/uploads<br/><span className="text-[#9bf2df]">✓</span> credential scope: storage:write<br/><span className="text-[#9bf2df]">✓</span> workspace derived from key</div></div><div><p className="text-sm font-medium text-[#91ead5]">SECURED TRANSIT</p><h2 className="mt-4 text-4xl font-medium tracking-[-0.06em] sm:text-5xl">Agents move fast. Your secrets stay put.</h2><p className="mt-5 max-w-xl text-base leading-7 text-white/50">Give agents a scoped Codlok credential, not a collection of provider keys. Every request is governed, rate-limited and recorded at the platform boundary.</p><div className="mt-7 flex gap-7 text-sm"><div><strong className="block text-2xl font-medium tracking-[-0.05em]">Scoped</strong><span className="text-white/40">per product</span></div><div><strong className="block text-2xl font-medium tracking-[-0.05em]">Audited</strong><span className="text-white/40">by default</span></div><div><strong className="block text-2xl font-medium tracking-[-0.05em]">Isolated</strong><span className="text-white/40">per workspace</span></div></div></div></div></section>

      <section id="developers" className="relative z-10 border-t border-white/8 bg-[#0a0c12] py-20 text-center lg:py-28"><div className="mx-auto max-w-3xl px-6"><span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-[#aeb7ff]"><Braces size={21} /></span><h2 className="mt-6 text-4xl font-medium tracking-[-0.06em] sm:text-5xl">One dependable interface for the products ahead.</h2><p className="mx-auto mt-5 max-w-xl leading-7 text-white/50">Create your Codlok workspace today. Start with the infrastructure you need, then add modules without redesigning your foundation.</p><Link href="/app" className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#0b0d12] transition hover:bg-[#dfe3ff]">Open Codlok Cloud <ArrowRight size={16} /></Link></div></section>

      <footer className="relative z-10 border-t border-white/8 px-6 py-8 text-xs text-white/35 lg:px-8"><div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-white/65"><Image src="/logo.svg" alt="Codlok" width={20} height={20} /> Codlok Cloud</div><p>© {new Date().getFullYear()} Codlok. Secured transit for products.</p><div className="flex gap-4"><a className="hover:text-white" href="#security">Security</a><Link className="hover:text-white" href="/app">Console</Link></div></div></footer>
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-lg border border-white/8 bg-white/[0.025] p-3"><p className="text-lg font-medium tracking-[-0.04em]">{value}</p><p className="mt-1 text-[11px] text-white/40">{label}</p></div>;
}
