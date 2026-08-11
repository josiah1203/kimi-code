declare const __SPIDERBYTE_VERSION__: string | undefined;
declare const __SPIDERBYTE_CHANNEL__: string | undefined;
declare const __SPIDERBYTE_COMMIT__: string | undefined;
declare const __SPIDERBYTE_BUILD_TARGET__: string | undefined;

export interface SpiderByteBuildInfo {
  readonly version?: string;
  readonly channel?: string;
  readonly commit?: string;
  readonly buildTarget?: string;
}

function optionalBuildString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const SPIDERBYTE_BUILD_INFO: SpiderByteBuildInfo = {
  version:
    typeof __SPIDERBYTE_VERSION__ === 'string'
      ? optionalBuildString(__SPIDERBYTE_VERSION__)
      : undefined,
  channel:
    typeof __SPIDERBYTE_CHANNEL__ === 'string'
      ? optionalBuildString(__SPIDERBYTE_CHANNEL__)
      : undefined,
  commit:
    typeof __SPIDERBYTE_COMMIT__ === 'string'
      ? optionalBuildString(__SPIDERBYTE_COMMIT__)
      : undefined,
  buildTarget:
    typeof __SPIDERBYTE_BUILD_TARGET__ === 'string'
      ? optionalBuildString(__SPIDERBYTE_BUILD_TARGET__)
      : undefined,
};
