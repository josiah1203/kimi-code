import { PROVIDER_CONFIGURATION_REQUIRED_CODE } from '../constant/spiderbyte-tui';

export function combineStartupNotice(
  existing: string | undefined,
  next: string | undefined,
): string | undefined {
  if (existing !== undefined && next !== undefined) {
    return `${existing}\n${next}`;
  }
  return existing ?? next;
}

export function isProviderConfigurationRequiredError(error: unknown): boolean {
  return (error as { readonly code?: unknown }).code === PROVIDER_CONFIGURATION_REQUIRED_CODE;
}
