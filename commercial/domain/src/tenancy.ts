import { z } from 'zod';

import {
  accountIdSchema,
  commandContextSchema,
  groupIdSchema,
  isoDateTimeSchema,
  membershipIdSchema,
  organizationIdSchema,
  permissionIdSchema,
  recordFieldsSchema,
  roleIdSchema,
  teamIdSchema,
  userIdSchema,
  workspaceIdSchema,
} from './common';
import { emailSchema } from './identity';

export const organizationStateSchema = z.enum(['active', 'suspended', 'archived']);
export const organizationSchema = z.strictObject({
  id: organizationIdSchema,
  account_id: accountIdSchema,
  owner_user_id: userIdSchema,
  name: z.string().trim().min(1).max(200),
  state: organizationStateSchema,
  enforced_sso: z.boolean(),
  default_workspace_id: workspaceIdSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type Organization = z.infer<typeof organizationSchema>;

export const workspaceStateSchema = z.enum(['provisioning', 'active', 'suspended', 'archived']);
export const workspaceSchema = z.strictObject({
  id: workspaceIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  state: workspaceStateSchema,
  region: z.string().trim().min(1).max(100),
  local_workspace_id: z.string().min(1).max(256).optional(),
  ...recordFieldsSchema.shape,
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const teamStateSchema = z.enum(['active', 'archived']);
export const teamSchema = z.strictObject({
  id: teamIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  name: z.string().trim().min(1).max(200),
  state: teamStateSchema,
  workspace_ids: z.array(workspaceIdSchema).readonly(),
  ...recordFieldsSchema.shape,
});
export type Team = z.infer<typeof teamSchema>;

export const groupStateSchema = z.enum(['active', 'archived']);
export const groupSchema = z.strictObject({
  id: groupIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  name: z.string().trim().min(1).max(200),
  state: groupStateSchema,
  member_user_ids: z.array(userIdSchema).readonly(),
  ...recordFieldsSchema.shape,
});
export type Group = z.infer<typeof groupSchema>;

export const permissionSchema = z.strictObject({
  id: permissionIdSchema,
  key: z.string().regex(/^[a-z][a-z0-9_.:-]{1,199}$/),
  description: z.string().trim().min(1).max(500),
  ...recordFieldsSchema.shape,
});
export type Permission = z.infer<typeof permissionSchema>;

export const roleKindSchema = z.enum(['system', 'custom']);
export const roleSchema = z.strictObject({
  id: roleIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  name: z.string().trim().min(1).max(100),
  kind: roleKindSchema,
  permission_keys: z.array(z.string().regex(/^[a-z][a-z0-9_.:-]{1,199}$/)).readonly(),
  state: z.enum(['active', 'archived']),
  ...recordFieldsSchema.shape,
});
export type Role = z.infer<typeof roleSchema>;

export const membershipStateSchema = z.enum(['invited', 'active', 'suspended', 'removed']);
export const membershipTargetSchema = z.enum(['organization', 'workspace', 'team']);
export const membershipSchema = z.strictObject({
  id: membershipIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  user_id: userIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  team_id: teamIdSchema.optional(),
  target: membershipTargetSchema,
  role_ids: z.array(roleIdSchema).min(1).readonly(),
  state: membershipStateSchema,
  invited_at: isoDateTimeSchema.optional(),
  joined_at: isoDateTimeSchema.optional(),
  removed_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type Membership = z.infer<typeof membershipSchema>;

export const invitationStateSchema = z.enum(['pending', 'accepted', 'expired', 'revoked']);
export const invitationSchema = z.strictObject({
  id: z.string().regex(/^invite_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  team_id: teamIdSchema.optional(),
  email: emailSchema,
  role_ids: z.array(roleIdSchema).min(1).readonly(),
  token_hash: z.string().min(32).max(512),
  state: invitationStateSchema,
  expires_at: isoDateTimeSchema,
  accepted_by_user_id: userIdSchema.optional(),
  accepted_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type Invitation = z.infer<typeof invitationSchema>;

export const organizationPolicySchema = z.strictObject({
  id: z.string().regex(/^policy_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  inherited: z.boolean(),
  rules: z.record(z.string().min(1), z.unknown()),
  state: z.enum(['active', 'archived']),
  ...recordFieldsSchema.shape,
});
export type OrganizationPolicy = z.infer<typeof organizationPolicySchema>;

export const createOrganizationInputSchema = commandContextSchema.extend({
  name: z.string().trim().min(1).max(200),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const createWorkspaceInputSchema = commandContextSchema.extend({
  organization_id: organizationIdSchema,
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  region: z.string().trim().min(1).max(100).default('local'),
  local_workspace_id: z.string().min(1).max(256).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const inviteMemberInputSchema = commandContextSchema.extend({
  organization_id: organizationIdSchema,
  email: emailSchema,
  role_ids: z.array(roleIdSchema).min(1).readonly(),
  workspace_id: workspaceIdSchema.optional(),
  team_id: teamIdSchema.optional(),
  expires_at: isoDateTimeSchema,
});
export type InviteMemberInput = z.infer<typeof inviteMemberInputSchema>;

export const acceptInvitationInputSchema = commandContextSchema.extend({
  invitation_id: invitationSchema.shape.id,
  token: z.string().min(16).max(2048),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>;

export const membershipStateInputSchema = commandContextSchema.extend({
  membership_id: membershipIdSchema,
  state: z.enum(['active', 'suspended', 'removed']),
});
export type MembershipStateInput = z.infer<typeof membershipStateInputSchema>;
