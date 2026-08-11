import type { PluginSummary } from '@spiderbyte/sdk';

export const OFFICIAL_BADGE = 'official';
export const CURATED_BADGE = 'curated';
export const THIRD_PARTY_BADGE = 'third-party';

export type PluginTrustLabel = 'official' | 'curated' | 'third-party';

/**
 * Human-readable provenance label for a plugin, suitable for inline display
 * in `/plugins` overviews and lists.
 *
 * - github source → `github <owner>/<repo>@<ref>`
 * - zip-url with parseable URL → `via <host[:port]>`
 * - everything else → raw source kind (`local-path`, `zip-url`)
 */
export function formatPluginSourceLabel(plugin: PluginSummary): string {
  if (plugin.source === 'github' && plugin.github !== undefined) {
    return `github ${plugin.github.owner}/${plugin.github.repo}@${plugin.github.ref.value}`;
  }
  if (plugin.source === 'zip-url' && plugin.originalSource !== undefined) {
    const host = hostFromUrl(plugin.originalSource);
    if (host !== undefined) return `via ${host}`;
  }
  return plugin.source;
}

/**
 * Return the trust label that can be established from Open Core metadata.
 *
 * The Open Core checkout does not ship a SpiderByte-controlled plugin CDN or
 * signing authority. Marketplace tiers are descriptive metadata only; every
 * install therefore requires the same explicit trust decision.
 */
export function pluginTrustLabel(plugin: PluginSummary): PluginTrustLabel {
  void plugin;
  return 'third-party';
}

/**
 * Open Core has no trusted hosted plugin source. Keep this explicit false
 * result so a future hosted distribution must add a reviewed trust authority
 * instead of accidentally inheriting one from the legacy product.
 */
export function isOfficialPluginSource(_source: string): boolean {
  return false;
}

/**
 * Open Core never treats an installed plugin as trusted solely from its
 * source URL. A hosted distribution may provide a separate verified signer.
 */
export function isOfficialPluginInstall(_plugin: PluginSummary): boolean {
  return false;
}

function hostFromUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.port.length > 0) return `${url.hostname}:${url.port}`;
    return url.hostname;
  } catch {
    return undefined;
  }
}
