import { buildJevRequest, parseJevResponse } from './request.js';
/** Asks Jev over HTTP with the global `fetch` (or an injected one). */
export class JevClient {
    provider;
    apiKey;
    accountId;
    model;
    baseUrl;
    fetcher;
    constructor(options = {}) {
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
    async ask(state, questions) {
        if (!this.apiKey) {
            throw new Error(this.provider === 'cloudflare'
                ? 'CLOUDFLARE_API_TOKEN is not configured'
                : 'TYPESAFE_API_KEY is not configured');
        }
        const request = buildJevRequest({
            apiKey: this.apiKey,
            provider: this.provider,
            accountId: this.accountId,
            model: this.model,
            baseUrl: this.baseUrl,
        }, state, questions);
        const response = await this.fetcher(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
        });
        return parseJevResponse(response.status, response.ok, await response.text());
    }
}
//# sourceMappingURL=client.js.map