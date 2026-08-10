/** SpiderByte account authentication commands.
 *
 * These commands own the paid-platform account credential. The existing
 * top-level `login` command remains the Kimi provider compatibility flow.
 */

import { createServer } from 'node:http';
import { join } from 'node:path';

import {
  FileSpiderByteTokenStorage,
  SpiderByteIdentityClient,
  SpiderByteIdentityError,
  type SpiderByteDeviceAuthorization,
  type SpiderByteIdentityConfig,
} from '@moonshot-ai/kimi-code-oauth';
import { resolveKimiHome } from '@moonshot-ai/kimi-code-sdk';
import type { Command } from 'commander';

import { openUrl } from '#/utils/open-url';

const ENV = {
  issuer: 'SPIDERBYTE_AUTH_ISSUER',
  clientId: 'SPIDERBYTE_AUTH_CLIENT_ID',
  scope: 'SPIDERBYTE_AUTH_SCOPE',
  redirectUri: 'SPIDERBYTE_AUTH_REDIRECT_URI',
  authorizationEndpoint: 'SPIDERBYTE_AUTH_AUTHORIZATION_ENDPOINT',
  tokenEndpoint: 'SPIDERBYTE_AUTH_TOKEN_ENDPOINT',
  deviceAuthorizationEndpoint: 'SPIDERBYTE_AUTH_DEVICE_AUTHORIZATION_ENDPOINT',
  revocationEndpoint: 'SPIDERBYTE_AUTH_REVOCATION_ENDPOINT',
  userInfoEndpoint: 'SPIDERBYTE_AUTH_USERINFO_ENDPOINT',
} as const;

interface AuthCommandOptions {
  readonly device?: boolean;
  readonly json?: boolean;
}

interface AuthEnvironment {
  readonly [key: string]: string | undefined;
}

export function registerAuthCommands(parent: Command): void {
  const auth = parent.command('auth').description('Manage the SpiderByte paid-platform account.');
  auth
    .command('status')
    .option('--json', 'Print machine-readable JSON.')
    .action(async (options: AuthCommandOptions) => {
      await runAuthCommand(async () => {
        const config = readConfig(process.env);
        if (config === undefined) {
          writeStatus({ mode: 'local', authenticated: false, account_token: false }, options.json === true);
          return;
        }
        const client = createClient(config);
        const status = await client.status();
        writeStatus(
          {
            mode: 'hosted',
            authenticated: status.authenticated,
            account_token: status.authenticated,
            authority: status.authority,
            expires_at: status.expiresAt,
          },
          options.json === true,
        );
      });
    });

  auth
    .command('login')
    .option('--device', 'Use OAuth device authorization instead of browser PKCE.')
    .action(async (options: AuthCommandOptions) => {
      await runAuthCommand(async () => {
        const config = requireConfig(process.env);
        const client = createClient(config);
        if (options.device === true || config.redirectUri === undefined) {
          await runDeviceLogin(client);
        } else {
          await runBrowserLogin(client, config.redirectUri);
        }
        process.stdout.write('Signed in to SpiderByte.\n');
      });
    });

  auth
    .command('logout')
    .action(async () => {
      await runAuthCommand(async () => {
        const config = readConfig(process.env);
        if (config !== undefined) await createClient(config).revoke();
        process.stdout.write('Signed out of SpiderByte.\n');
      });
    });
}

function createClient(config: SpiderByteIdentityConfig): SpiderByteIdentityClient {
  return new SpiderByteIdentityClient({
    config,
    storage: new FileSpiderByteTokenStorage(join(resolveKimiHome(), 'credentials', 'spiderbyte-account')),
  });
}

function readConfig(env: AuthEnvironment): SpiderByteIdentityConfig | undefined {
  const issuer = env[ENV.issuer];
  const clientId = env[ENV.clientId];
  if (issuer === undefined || clientId === undefined) return undefined;
  return {
    issuer,
    clientId,
    scope: env[ENV.scope],
    redirectUri: env[ENV.redirectUri],
    authorizationEndpoint: env[ENV.authorizationEndpoint],
    tokenEndpoint: env[ENV.tokenEndpoint],
    deviceAuthorizationEndpoint: env[ENV.deviceAuthorizationEndpoint],
    revocationEndpoint: env[ENV.revocationEndpoint],
    userInfoEndpoint: env[ENV.userInfoEndpoint],
  };
}

function requireConfig(env: AuthEnvironment): SpiderByteIdentityConfig {
  const config = readConfig(env);
  if (config === undefined) {
    throw new SpiderByteIdentityError(
      `hosted SpiderByte identity is not configured; set ${ENV.issuer} and ${ENV.clientId}`,
    );
  }
  return config;
}

async function runDeviceLogin(client: SpiderByteIdentityClient): Promise<void> {
  let device: SpiderByteDeviceAuthorization;
  try {
    device = await client.requestDeviceAuthorization();
  } catch (error) {
    throw new SpiderByteIdentityError(
      `device login unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const url = device.verificationUriComplete ?? device.verificationUri;
  process.stderr.write(
    [
      '',
      `Opening SpiderByte account login: ${url}`,
      `If the browser did not open, visit the URL and enter code: ${device.userCode}`,
      `Code expires in ${device.expiresIn}s.`,
      'Waiting for authorization to complete...',
      '',
    ].join('\n'),
  );
  try {
    openUrl(url);
  } catch {
    // The printed URL and code are the manual fallback.
  }
  const deadline = Date.now() + device.expiresIn * 1000;
  let interval = device.interval;
  while (Date.now() < deadline) {
    const result = await client.pollDeviceAuthorization(device.deviceCode);
    if (result.kind === 'success') return;
    if (result.kind === 'expired') throw new SpiderByteIdentityError('SpiderByte device code expired.');
    if (result.kind === 'denied') {
      throw new SpiderByteIdentityError(`SpiderByte account login denied${result.description ? `: ${result.description}` : ''}`);
    }
    if (result.errorCode === 'slow_down') interval += 5;
    await sleep(interval * 1000);
  }
  throw new SpiderByteIdentityError('SpiderByte device login timed out.');
}

async function runBrowserLogin(client: SpiderByteIdentityClient, redirectUri: string): Promise<void> {
  const request = await client.createAuthorizationRequest({ redirectUri });
  const callback = new URL(redirectUri);
  if (callback.hostname !== '127.0.0.1' && callback.hostname !== 'localhost' && callback.hostname !== '[::1]') {
    throw new SpiderByteIdentityError('SpiderByte CLI PKCE redirect URI must use a loopback host.');
  }
  const server = createServer();
  const result = new Promise<{ readonly code: string; readonly state: string }>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new SpiderByteIdentityError('SpiderByte browser login timed out.')), 5 * 60 * 1000);
    server.on('request', (incoming, response) => {
      const url = new URL(incoming.url ?? '/', `http://${callback.host}`);
      if (url.pathname !== callback.pathname) {
        response.statusCode = 404;
        response.end('Not found');
        return;
      }
      const error = url.searchParams.get('error');
      if (error !== null) {
        clearTimeout(timeout);
        response.statusCode = 400;
        response.end('SpiderByte login was denied. You may close this window.');
        reject(new SpiderByteIdentityError(`SpiderByte browser login denied: ${error}`));
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (code === null || state === null) {
        response.statusCode = 400;
        response.end('Missing OAuth callback parameters.');
        return;
      }
      clearTimeout(timeout);
      response.statusCode = 200;
      response.end('SpiderByte login complete. You may close this window.');
      resolve({ code, state });
    });
  });
  try {
    await listen(server, callback.hostname, Number(callback.port || 80));
    process.stderr.write(`Opening SpiderByte account login in your browser: ${request.url}\n`);
    openUrl(request.url);
    const received = await result;
    if (received.state !== request.state) throw new SpiderByteIdentityError('SpiderByte OAuth state validation failed.');
    await client.exchangeAuthorizationCode(received.code, request.codeVerifier, request.redirectUri);
  } finally {
    await close(server);
  }
}

function listen(server: ReturnType<typeof createServer>, hostname: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function runAuthCommand(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    process.stderr.write(`SpiderByte auth failed: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

function writeStatus(status: Record<string, unknown>, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    status['mode'] === 'local'
      ? 'SpiderByte accountless local mode (not signed in).\n'
      : `SpiderByte hosted account: ${status['authenticated'] === true ? 'signed in' : 'not signed in'}.\n`,
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
