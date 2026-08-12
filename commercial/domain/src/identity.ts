import { z } from 'zod';

import {
  accountIdSchema,
  actorRefSchema,
  apiKeyIdSchema,
  identityProviderIdSchema,
  isoDateTimeSchema,
  recordFieldsSchema,
  serviceAccountIdSchema,
  sessionIdSchema,
  userIdSchema,
  verifiedDomainIdSchema,
  organizationIdSchema,
  workspaceIdSchema,
  commandContextSchema,
} from './common';

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

export const accountStateSchema = z.enum(['trial', 'active', 'suspended', 'closed']);
export type AccountState = z.infer<typeof accountStateSchema>;

export const accountSchema = z.strictObject({
  id: accountIdSchema,
  state: accountStateSchema,
  display_name: z.string().trim().min(1).max(200),
  primary_user_id: userIdSchema,
  ...recordFieldsSchema.shape,
});
export type Account = z.infer<typeof accountSchema>;

export const userStateSchema = z.enum(['invited', 'active', 'suspended', 'deactivated']);
export type UserState = z.infer<typeof userStateSchema>;

export const userSchema = z.strictObject({
  id: userIdSchema,
  account_id: accountIdSchema,
  email: emailSchema,
  display_name: z.string().trim().min(1).max(200),
  state: userStateSchema,
  last_authenticated_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type User = z.infer<typeof userSchema>;

export const sessionStateSchema = z.enum(['active', 'expired', 'revoked']);
export type SessionState = z.infer<typeof sessionStateSchema>;

export const sessionSchema = z.strictObject({
  id: sessionIdSchema,
  account_id: accountIdSchema,
  user_id: userIdSchema,
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  organization_id: organizationIdSchema.optional(),
  state: sessionStateSchema,
  auth_method: z.enum(['oidc', 'saml', 'password', 'api_key', 'session', 'development']),
  scopes: z.array(z.string().min(1).max(200)).readonly(),
  issued_at: isoDateTimeSchema,
  expires_at: isoDateTimeSchema,
  last_seen_at: isoDateTimeSchema,
  revoked_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type Session = z.infer<typeof sessionSchema>;

export const identityProviderTypeSchema = z.enum(['oidc', 'saml', 'local', 'scim']);
export type IdentityProviderType = z.infer<typeof identityProviderTypeSchema>;
export const identityProviderStateSchema = z.enum(['draft', 'configured', 'active', 'disabled']);

export const identityProviderSchema = z.strictObject({
  id: identityProviderIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  type: identityProviderTypeSchema,
  state: identityProviderStateSchema,
  issuer: z.string().url().optional(),
  entity_id: z.string().min(1).max(1000).optional(),
  client_id: z.string().min(1).max(500).optional(),
  secret_ref: z.string().regex(/^secret_[A-Za-z0-9._:-]+$/).optional(),
  enforced: z.boolean(),
  last_validated_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type IdentityProvider = z.infer<typeof identityProviderSchema>;

export const verifiedDomainStateSchema = z.enum(['pending', 'verified', 'revoked', 'expired']);
export const verifiedDomainSchema = z.strictObject({
  id: verifiedDomainIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  domain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+$/).max(253),
  state: verifiedDomainStateSchema,
  verification_method: z.enum(['dns_txt', 'dns_cname', 'http']),
  verification_token_hash: z.string().min(32).max(256),
  verified_at: isoDateTimeSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type VerifiedDomain = z.infer<typeof verifiedDomainSchema>;

export const serviceAccountStateSchema = z.enum(['active', 'suspended', 'revoked']);
export const serviceAccountSchema = z.strictObject({
  id: serviceAccountIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  name: z.string().trim().min(1).max(200),
  state: serviceAccountStateSchema,
  scopes: z.array(z.string().min(1).max(200)).readonly(),
  credential_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  ...recordFieldsSchema.shape,
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

export const apiKeyStateSchema = z.enum(['active', 'expired', 'revoked']);
export const apiKeySchema = z.strictObject({
  id: apiKeyIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema.optional(),
  owner_user_id: userIdSchema.optional(),
  service_account_id: serviceAccountIdSchema.optional(),
  name: z.string().trim().min(1).max(200),
  key_prefix: z.string().min(4).max(32),
  key_hash: z.string().min(32).max(512),
  state: apiKeyStateSchema,
  scopes: z.array(z.string().min(1).max(200)).readonly(),
  expires_at: isoDateTimeSchema.optional(),
  last_used_at: isoDateTimeSchema.optional(),
  rotated_from_id: apiKeyIdSchema.optional(),
  ...recordFieldsSchema.shape,
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const identityActorSchema = z.union([actorRefSchema, z.object({ user_id: userIdSchema })]);

export const createAccountInputSchema = commandContextSchema.extend({
  email: emailSchema,
  display_name: z.string().trim().min(1).max(200),
  /** Consumed by an identity adapter; never stored in an Account or User record. */
  secret: z.string().min(12).max(4096),
});
export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;
