import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { exportOrganizationRecords, importOrganizationRecords, type OrganizationRecords } from './store';
import type { AuditLogEntry, Invitation, Member, Role, Workspace } from './types';

export type OrganizationScope =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'invitation'; token: string }
  | { kind: 'user'; userId: string }
  | { kind: 'create' }
  | { kind: 'none' };

interface LoadedRecords { records: OrganizationRecords; revision?: number; workspaceId?: string }
const EMPTY: OrganizationRecords = { workspaces: [], members: [], roles: [], invitations: [], auditLog: [] };

function client(): SupabaseClient | null {
  if (process.env.NODE_ENV === 'test') return null;
  const url=process.env.SUPABASE_URL, secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession:false, autoRefreshToken:false } });
}

function requireConfigured(db: SupabaseClient | null): void {
  if (!db && process.env.NODE_ENV === 'production') throw new Error('ORGANIZATION_STORE_NOT_CONFIGURED');
}

const workspaceRow=(w:Workspace)=>({id:w.id,name:w.name,slug:w.slug,description:w.description??null,created_by_user_id:w.createdByUserId,created_at:w.createdAt,updated_at:w.updatedAt,deleted_at:w.deletedAt??null});
const roleRow=(r:Role)=>({id:r.id,workspace_id:r.workspaceId,name:r.name,system_key:r.systemKey??null,description:r.description??null,permissions:r.permissions,built_in:r.builtIn,created_at:r.createdAt,updated_at:r.updatedAt});
const memberRow=(m:Member)=>({id:m.id,workspace_id:m.workspaceId,user_id:m.userId,role_id:m.roleId,joined_at:m.joinedAt,created_at:m.createdAt,updated_at:m.updatedAt});
const invitationRow=(i:Invitation)=>({id:i.id,workspace_id:i.workspaceId,invitee_user_id:i.inviteeUserId,inviter_user_id:i.inviterUserId,role_id:i.roleId,status:i.status,token:i.token,created_at:i.createdAt,expires_at:i.expiresAt,resolved_at:i.resolvedAt??null});
const auditRow=(a:AuditLogEntry)=>({id:a.id,workspace_id:a.workspaceId,action:a.action,actor_user_id:a.actorUserId,occurred_at:a.at,details:a.details});

function fromRows(workspaces:any[],roles:any[],members:any[],invitations:any[],audit:any[]): OrganizationRecords {
  return {
    workspaces:workspaces.map(w=>({id:w.id,name:w.name,slug:w.slug,description:w.description??undefined,createdByUserId:w.created_by_user_id,createdAt:w.created_at,updatedAt:w.updated_at,deletedAt:w.deleted_at??undefined})),
    roles:roles.map(r=>({id:r.id,workspaceId:r.workspace_id,name:r.name,systemKey:r.system_key??undefined,description:r.description??undefined,permissions:r.permissions,builtIn:r.built_in,createdAt:r.created_at,updatedAt:r.updated_at})),
    members:members.map(m=>({id:m.id,workspaceId:m.workspace_id,userId:m.user_id,roleId:m.role_id,joinedAt:m.joined_at,createdAt:m.created_at,updatedAt:m.updated_at})),
    invitations:invitations.map(i=>({id:i.id,workspaceId:i.workspace_id,inviteeUserId:i.invitee_user_id,inviterUserId:i.inviter_user_id,roleId:i.role_id,status:i.status,token:i.token,createdAt:i.created_at,expiresAt:i.expires_at,resolvedAt:i.resolved_at??undefined})),
    auditLog:audit.map(a=>({id:a.id,workspaceId:a.workspace_id,action:a.action,actorUserId:a.actor_user_id,at:a.occurred_at,details:a.details})),
  } as OrganizationRecords;
}

async function loadWorkspace(db:SupabaseClient,workspaceId:string):Promise<LoadedRecords>{
  const [w,r,m,i,a]=await Promise.all([
    db.from('codlok_workspaces').select('*').eq('id',workspaceId).maybeSingle(),
    db.from('codlok_workspace_roles').select('*').eq('workspace_id',workspaceId),
    db.from('codlok_workspace_members').select('*').eq('workspace_id',workspaceId),
    db.from('codlok_workspace_invitations').select('*').eq('workspace_id',workspaceId),
    db.from('codlok_organization_audit').select('*').eq('workspace_id',workspaceId).order('occurred_at'),
  ]);
  const error=w.error??r.error??m.error??i.error??a.error; if(error) throw new Error('ORGANIZATION_STATE_LOAD_FAILED');
  return {records:fromRows(w.data?[w.data]:[],r.data??[],m.data??[],i.data??[],a.data??[]),revision:w.data?Number(w.data.revision):undefined,workspaceId};
}

async function load(db:SupabaseClient,scope:OrganizationScope):Promise<LoadedRecords>{
  if(scope.kind==='none') return {records:EMPTY};
  if(scope.kind==='workspace') return loadWorkspace(db,scope.workspaceId);
  if(scope.kind==='invitation'){
    const found=await db.from('codlok_workspace_invitations').select('workspace_id').eq('token',scope.token).maybeSingle();
    if(found.error) throw new Error('ORGANIZATION_STATE_LOAD_FAILED');
    return found.data?loadWorkspace(db,found.data.workspace_id):{records:EMPTY};
  }
  if(scope.kind==='user'){
    const memberships=await db.from('codlok_workspace_members').select('*').eq('user_id',scope.userId);
    if(memberships.error) throw new Error('ORGANIZATION_STATE_LOAD_FAILED');
    const ids=[...new Set((memberships.data??[]).map(x=>x.workspace_id))];
    if(!ids.length) return {records:EMPTY};
    const workspaces=await db.from('codlok_workspaces').select('*').in('id',ids);
    if(workspaces.error) throw new Error('ORGANIZATION_STATE_LOAD_FAILED');
    return {records:fromRows(workspaces.data??[],[],memberships.data??[],[],[])};
  }
  const workspaces=await db.from('codlok_workspaces').select('*');
  if(workspaces.error) throw new Error('ORGANIZATION_STATE_LOAD_FAILED');
  return {records:fromRows(workspaces.data??[],[],[],[],[])};
}

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function persist(db:SupabaseClient,scope:OrganizationScope,before:LoadedRecords,after:OrganizationRecords):Promise<void>{
  if(scope.kind==='none'||scope.kind==='user'){
    if(!same(before.records,after)) throw new Error('ORGANIZATION_READ_SCOPE_MUTATED');
    return;
  }
  const oldAudit=new Set(before.records.auditLog.map(a=>a.id));
  const audit=after.auditLog.filter(a=>!oldAudit.has(a.id)).map(auditRow);
  if(scope.kind==='create'){
    const created=after.workspaces.find(w=>!before.records.workspaces.some(old=>old.id===w.id));
    if(!created) return;
    const result=await db.rpc('codlok_create_organization_workspace',{p_workspace:workspaceRow(created),p_roles:after.roles.filter(r=>r.workspaceId===created.id).map(roleRow),p_members:after.members.filter(m=>m.workspaceId===created.id).map(memberRow),p_audit_entries:audit.filter(a=>a.workspace_id===created.id)});
    if(result.error) throw new Error('ORGANIZATION_STATE_SAVE_FAILED');
    return;
  }
  if(!before.workspaceId||before.revision===undefined) {
    if(same(before.records,after)) return;
    throw new Error('ORGANIZATION_CONFLICT');
  }
  if(same(before.records,after)) return;
  const workspace=after.workspaces.find(w=>w.id===before.workspaceId); if(!workspace) throw new Error('ORGANIZATION_STATE_SAVE_FAILED');
  const result=await db.rpc('codlok_commit_organization_workspace',{p_workspace_id:before.workspaceId,p_expected_revision:before.revision,p_workspace:workspaceRow(workspace),p_roles:after.roles.filter(r=>r.workspaceId===before.workspaceId).map(roleRow),p_members:after.members.filter(m=>m.workspaceId===before.workspaceId).map(memberRow),p_invitations:after.invitations.filter(i=>i.workspaceId===before.workspaceId).map(invitationRow),p_audit_entries:audit.filter(a=>a.workspace_id===before.workspaceId)});
  if(result.error) throw new Error(String(result.error.message).includes('ORGANIZATION_CONFLICT')?'ORGANIZATION_CONFLICT':'ORGANIZATION_STATE_SAVE_FAILED');
}

export async function withDurableOrganizationRecords<T>(scope:OrganizationScope,operation:()=>Promise<T>|T):Promise<T>{
  const db=client(); requireConfigured(db); if(!db) return operation();
  for(let attempt=0;attempt<3;attempt++){
    const before=await load(db,scope); importOrganizationRecords(structuredClone(before.records));
    try { const result=await operation(); await persist(db,scope,before,exportOrganizationRecords()); return result; }
    catch(error){ if(!(error instanceof Error)||error.message!=='ORGANIZATION_CONFLICT'||attempt===2) throw error; }
  }
  throw new Error('ORGANIZATION_CONFLICT');
}
