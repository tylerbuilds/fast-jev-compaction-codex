import { buildJevRequest, parseJevResponse, type JevProvider } from './request.js';
import type { JevAsker, JevQuestions, JevResponse, JevState } from './types.js';

export interface JevClientOptions {
  /** Defaults to `typesafe`, or `process.env.FAST_JEV_PROVIDER` when set. */
  provider?: JevProvider;
  /** Defaults to the selected provider's environment variable. */
  apiKey?: string;
  /** Required for Cloudflare; defaults to `process.env.CLOUDFLARE_ACCOUNT_ID`. */
  accountId?: string;
  /** Defaults to `jev-latest` for TypeSafe or `typesafe/jev` for Cloudflare. */
  model?: string;
  /** Defaults to the selected provider's endpoint. */
  baseUrl?: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Asks Jev over HTTP with the global `fetch` (or an injected one). */
export class JevClient implements JevAsker {
  private readonly provider: JevProvider;
  private readonly apiKey: string;
  private readonly accountId: string | undefined;
  private readonly model: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(options: JevClientOptions = {}) {
    const provider = options.provider ?? process.env.FAST_JEV_PROVIDER ?? 'typesafe';
    if (provider !== 'typesafe' && provider !== 'cloudflare') {
      throw new Error(`Unsupported FAST_JEV_PROVIDER: ${provider}`);
    }
    this.provider = provider;
    this.apiKey =
      options.apiKey ??
      (this.provider === 'cloudflare'
        ? process.env.CLOUDFLARE_API_TOKEN
        : process.env.TYPESAFE_API_KEY) ??
      '';
    this.accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.fetcher = options.fetch ?? fetch;
  }

  async ask(state: JevState, questions: JevQuestions): Promise<JevResponse> {
    if (!this.apiKey) {
      throw new Error(
        this.provider === 'cloudflare'
          ? 'CLOUDFLARE_API_TOKEN is not configured'
          : 'TYPESAFE_API_KEY is not configured',
      );
    }
    const request = buildJevRequest(
      {
        apiKey: this.apiKey,
        provider: this.provider,
        accountId: this.accountId,
        model: this.model,
        baseUrl: this.baseUrl,
      },
      state,
      questions,
    );
    const response = await this.fetcher(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    return parseJevResponse(response.status, response.ok, await response.text());
  }
}
