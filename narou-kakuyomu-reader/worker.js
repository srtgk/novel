export default {
    async fetch(request) {
        // 1. CORSの事前リクエスト（OPTIONS）に対する即時応答
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Max-Age": "86400",
                },
            });
        }

        const url = new URL(request.url);
        let targetUrl = url.searchParams.get("url");

        // クエリパラメータが無い場合、パスの続きをターゲットURLとして解釈する
        if (!targetUrl) {
            // パス先頭の余分なスラッシュや "/proxy" などを綺麗に取り除く
            const rawPath = url.pathname.replace(/^\/+/, '').replace(/^proxy\/?/, '');
            if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
                targetUrl = rawPath + url.search;
            }
        }

        // それでもURLが見つからない場合のみ、挨拶文を返す（CORSヘッダー付き）
        if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
            return new Response("Proxy is active.", {
                status: 200,
                headers: { 
                    "Content-Type": "text/plain; charset=utf-8", 
                    "Access-Control-Allow-Origin": "*" 
                },
            });
        }

        try {
            // 2. 実際のターゲットサイトへリクエストを転送（ブラウザ偽装ヘッダー付き）
            const res = await fetch(targetUrl, {
                method: request.method,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
                    "Referer": "https://ncode.syosetu.com/"
                },
                redirect: "follow"
            });

            // 3. 取得したレスポンスに必ずCORS許可ヘッダーを付与する
            const newHeaders = new Headers(res.headers);
            newHeaders.set("Access-Control-Allow-Origin", "*");
            newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            newHeaders.set("Access-Control-Allow-Headers", "*");
            newHeaders.set("Cache-Control", "no-cache");

            return new Response(res.body, { 
                status: res.status, 
                statusText: res.statusText, 
                headers: newHeaders 
            });

        } catch (e) {
            // 4. 万が一エラーが起きても、CORSエラーとしてブラウザに弾かれないようヘッダーを付けて返す
            return new Response(JSON.stringify({ error: e.message }), {
                status: 500,
                headers: { 
                    "Content-Type": "application/json", 
                    "Access-Control-Allow-Origin": "*" 
                },
            });
        }
    },
};
