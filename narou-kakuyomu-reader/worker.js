/**
 * worker.js - 超軽量 Cloudflare Worker CORSプロキシ (無料)
 * 
 * 【使い方】
 * 1. https://dash.cloudflare.com/ に無料登録・ログイン
 * 2. 左メニュー「Workers & Pages」 -> 「Create Application」 -> 「Create Worker」
 * 3. コードエディタにこのファイルの内容を丸ごと貼り付けて「Deploy」
 * 4. 発行されたURL (例: https://my-proxy.subdomain.workers.dev/?url= ) を
 *    リーダーアプリ右上の「⚙️ 設定」のプロキシ欄に入力して保存するだけ！
 */

export default {
    async fetch(request) {
        // CORS preflight (OPTIONS)
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, User-Agent",
                    "Access-Control-Max-Age": "86400",
                },
            });
        }

        const url = new URL(request.url);
        let targetUrl = url.searchParams.get("url");

        if (!targetUrl) {
            return new Response("CORS Proxy is Running. Usage: /?url=https://...", {
                status: 200,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
        }

        try {
            const clientHeaders = new Headers();
            clientHeaders.set(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NarouKakuyomuReader/2.0"
            );

            const res = await fetch(targetUrl, {
                method: "GET",
                headers: clientHeaders,
            });

            const newHeaders = new Headers(res.headers);
            newHeaders.set("Access-Control-Allow-Origin", "*");
            newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            newHeaders.set("Cache-Control", "no-cache");

            return new Response(res.body, {
                status: res.status,
                statusText: res.statusText,
                headers: newHeaders,
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), {
                status: 500,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }
    },
};
