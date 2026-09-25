"""html配下のファイルをWebSocketサーバと同じポートでHTTP配信する。

OBSのブラウザソースから http://<IP>:<port>/iidx_1p.html のように読み込めるようにし、
WebSocketの接続先はページ側で location.host から決定する。
"""

import html
import mimetypes
import re
import socket
from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote, urlsplit

from websockets.datastructures import Headers
from websockets.http11 import Response

HTML_DIR = Path("html")

# ページ一覧に表示する推奨サイズと説明(ファイル名 -> (推奨サイズ, 説明))
PAGE_INFO = {
    "iidx_1p.html": ("700×400", "IIDX 1P側"),
    "iidx_2p.html": ("700×400", "IIDX 2P側"),
    "iidx_dp.html": ("1400×400", "IIDX DP"),
    "sdvx.html": ("870×430", "SDVX"),
    "popn.html": ("650×320", "pop'n music (9ボタン)"),
    "iidx_1p_color.html": ("580×370", "IIDX 1P側、リリースタイム色分け表示"),
    "iidx_2p_color.html": ("580×370", "IIDX 2P側、リリースタイム色分け表示"),
    "iidx_dp_color.html": ("1200×370", "IIDX DP、リリースタイム色分け表示"),
    "sdvx_color.html": ("870×430", "SDVX、リリースタイム色分け表示"),
    "stats_only.html": ("800×100", "リリース、密度、ノーツ数の数値のみ"),
    "iidx_1p_lane.html": ("640×620", "IIDX 1P、レーン型表示"),
    "iidx_2p_lane.html": ("640×620", "IIDX 2P、レーン型表示"),
    "iidx_dp_lane.html": ("1200×620", "IIDX DP、レーン型表示"),
    "popn_lane.html": ("760×620", "pop'n music、レーン型表示"),
    "sdvx_lane.html": ("640×620", "SDVX、レーン型表示"),
    "scratch_speed.html": ("", "皿の回転速度表示"),
}

EXTRA_TYPES = {
    ".woff2": "font/woff2",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
}


def get_lan_addresses() -> list[str]:
    """このPCのLAN側IPv4アドレス一覧を返す(取得できなければ空)"""
    addresses = []
    try:
        # UDPのconnectはパケットを送らないため、既定経路のアドレス取得にだけ使う
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))
            addresses.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addr = info[4][0]
            if addr not in addresses and not addr.startswith("127."):
                addresses.append(addr)
    except OSError:
        pass
    return addresses


def _response(status: HTTPStatus, body: bytes, content_type: str) -> Response:
    headers = Headers()
    headers["Content-Type"] = content_type
    headers["Content-Length"] = str(len(body))
    # CSSを編集した際にOBS側のキャッシュ更新なしで反映されるようにする
    headers["Cache-Control"] = "no-cache"
    headers["Connection"] = "close"
    return Response(status.value, status.phrase, headers, body)


def _page_title(path: Path) -> str:
    try:
        m = re.search(r"<title>(.*?)</title>", path.read_text(encoding="utf-8"), re.S)
        return m.group(1).strip() if m else path.stem
    except OSError:
        return path.stem


def build_index_page() -> bytes:
    rows = []
    for path in sorted(HTML_DIR.glob("*.html")):
        size, desc = PAGE_INFO.get(path.name, ("", _page_title(path)))
        name = html.escape(path.name)
        rows.append(
            f'<tr><td><a href="{name}" target="_blank">{name}</a></td>'
            f"<td>{html.escape(size)}</td><td>{html.escape(desc)}</td>"
            f'<td><code class="url" data-path="{name}"></code></td>'
            f'<td><button data-path="{name}">コピー</button></td></tr>'
        )
    page = f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>Otoge Input Viewer ページ一覧</title>
<style>
  body {{ font-family: sans-serif; background: #1e1e1e; color: #ddd; margin: 16px; }}
  h1 {{ font-size: 20px; }}
  p {{ font-size: 14px; line-height: 1.6; }}
  table {{ border-collapse: collapse; }}
  th, td {{ border: 1px solid #555; padding: 4px 8px; font-size: 14px; }}
  th {{ background: #333; }}
  a {{ color: #7cc4ff; }}
  code {{ color: #fc9; }}
  button {{ cursor: pointer; }}
</style>
</head>
<body>
<h1>Otoge Input Viewer ページ一覧</h1>
<p>OBSのブラウザソースで「ローカルファイル」のチェックを外し、URL欄に下記のURLを貼り付けてください。<br>
幅・高さには推奨サイズを設定してください。</p>
<table>
<tr><th>ページ</th><th>推奨サイズ</th><th>内容</th><th>URL</th><th></th></tr>
{"".join(rows)}
</table>
<script>
  document.querySelectorAll('code.url').forEach(function (el) {{
    el.textContent = location.origin + '/' + el.dataset.path;
  }});
  document.querySelectorAll('button[data-path]').forEach(function (btn) {{
    btn.addEventListener('click', function () {{
      var url = location.origin + '/' + btn.dataset.path;
      var done = function () {{ btn.textContent = 'コピーしました'; setTimeout(function () {{ btn.textContent = 'コピー'; }}, 1500); }};
      if (navigator.clipboard && window.isSecureContext) {{
        navigator.clipboard.writeText(url).then(done);
      }} else {{
        var ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      }}
    }});
  }});
</script>
</body>
</html>
"""
    return page.encode("utf-8")


def process_request(connection, request):
    """websockets.serve の process_request フック。

    WebSocketのアップグレード要求はNoneを返してそのまま通し、
    それ以外のGETはhtml配下の静的ファイルとして応答する。
    """
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return None

    path = unquote(urlsplit(request.path).path)
    if path in ("/", "/index.html"):
        return _response(HTTPStatus.OK, build_index_page(), EXTRA_TYPES[".html"])

    root = HTML_DIR.resolve()
    target = (root / path.lstrip("/")).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        return _response(HTTPStatus.NOT_FOUND, b"404 Not Found", "text/plain; charset=utf-8")

    content_type = EXTRA_TYPES.get(target.suffix.lower()) or (
        mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    )
    return _response(HTTPStatus.OK, target.read_bytes(), content_type)
