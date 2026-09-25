// WebSocketの接続先URLを返す。
// アプリからHTTP配信されている場合(http://<IP>:<port>/xxx.html)はページと同じホスト・ポートに接続する。
// ローカルファイルとして読み込まれた場合はproperty.css/websocket.cssの--host/--portを使う。
function oivWebSocketUrl() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
        return 'ws://' + location.host;
    }
    var style = getComputedStyle(document.documentElement);
    var host = style.getPropertyValue('--host').trim().replace(/['"]/g, '') || 'localhost';
    var port = style.getPropertyValue('--port').trim() || '8765';
    return 'ws://' + host + ':' + port;
}
