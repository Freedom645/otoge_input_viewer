// レーン型(ロングノーツ風)表示の共通エンジン。
// 各HTMLが window.LANE_CONFIG にレーン構成を定義してから読み込む。
//
// LANE_CONFIG = {
//   lanes: [ { key:'s0', kind:'scratch', colorVar:'--note-iidx-scratch' },
//            { key:'k0_0', kind:'key',     colorVar:'--note-iidx-white' }, ... ],
//   scratchTimeout: 120  // 皿がこのms間動かなければノーツを離す
// }
(function () {
    'use strict';

    var config = window.LANE_CONFIG || { lanes: [], scratchTimeout: 120 };
    var scratchTimeout = config.scratchTimeout || 120;

    var ws = null;
    var lanes = {};        // key -> { el, kind, activeNote, startTime, lastSeen }
    var rootStyle = getComputedStyle(document.documentElement);

    function cssNum(name, fallback) {
        var v = parseFloat(rootStyle.getPropertyValue(name));
        return isNaN(v) ? fallback : v;
    }

    // ===== レーンDOMの構築 =====
    function buildLanes() {
        var container = document.querySelector('.lanes');
        if (!container) return;
        config.lanes.forEach(function (def) {
            if (def.kind === 'spacer') { // レーン間の余白(DP中央など)
                var sp = document.createElement('div');
                sp.className = 'lane-spacer';
                container.appendChild(sp);
                return;
            }
            var lane = document.createElement('div');
            lane.className = 'lane' + (def.kind === 'scratch' ? ' scratch' : '');
            lane.dataset.key = def.key;
            var color = rootStyle.getPropertyValue(def.colorVar).trim();
            lane.style.setProperty('--note-color', color);
            container.appendChild(lane);
            lanes[def.key] = {
                el: lane,
                kind: def.kind,
                notes: [],       // このレーンを流れているノーツ群
                activeNote: null,// 押下中(末尾を生成し続けている)ノーツ
                lastSeen: 0,
                lastDir: -1      // 皿の直前の回転方向(反転検出用)
            };
        });
    }

    // ===== ノーツの開始(押下) =====
    // 押した瞬間にレーン上部から先頭が出現し、下へ流れ始める。
    // 押している間は末尾(top)が上端に留まり、ノーツが伸び続ける。
    function pressLane(key, now) {
        var lane = lanes[key];
        if (!lane) return;
        lane.lastSeen = now;
        if (lane.activeNote) return; // 既に押下中(末尾を生成中)
        var el = document.createElement('div');
        el.className = 'note';
        lane.el.appendChild(el);
        var note = { el: el, tDown: now, tUp: null };
        lane.notes.push(note);
        lane.activeNote = note;
    }

    // ===== ノーツの終了(離す) =====
    // 末尾を上端から切り離し、以降は生成済み部分がそのまま下へ流れて消える。
    function releaseLane(key, now) {
        var lane = lanes[key];
        if (!lane || !lane.activeNote) return;
        lane.activeNote.tUp = now;
        lane.activeNote = null;
    }

    // ===== 毎フレーム、全ノーツを上から下へ流す =====
    function tick(now) {
        var speed = cssNum('--note-scroll-speed', 600); // px/秒
        for (var key in lanes) {
            var lane = lanes[key];
            if (lane.notes.length === 0) continue;
            var H = lane.el.clientHeight;
            var kept = [];
            for (var i = 0; i < lane.notes.length; i++) {
                var note = lane.notes[i];
                // 先頭(下端)は押下時刻から、末尾(上端)は離した時刻から流れ始める
                var yBottom = speed * (now - note.tDown) / 1000;
                var yTop = note.tUp === null ? 0 : speed * (now - note.tUp) / 1000;
                if (yTop >= H) { // 末尾まで判定ライン下へ抜けた → 消去
                    if (note.el.parentNode) note.el.parentNode.removeChild(note.el);
                    continue;
                }
                // 始点(下端)が判定ライン下へ抜けるとレーンのoverflow:hiddenで
                // 自動的に隠れる(=長押し中は暗い帯だけが残る)ため高さは丸めない
                note.el.style.top = yTop + 'px';
                note.el.style.height = (yBottom - yTop) + 'px';
                kept.push(note);
            }
            lane.notes = kept;
        }
        requestAnimationFrame(tick);
    }

    // ===== 皿の自動リリース監視 =====
    function checkScratch() {
        var now = performance.now();
        for (var key in lanes) {
            var lane = lanes[key];
            if (lane.kind !== 'scratch') continue;
            if (lane.activeNote && now - lane.lastSeen > scratchTimeout) {
                releaseLane(key, now);
            }
        }
    }

    // ===== WebSocket =====
    function open() {
        if (ws != null) return;
        var host = rootStyle.getPropertyValue('--host').trim().replace(/['"]/g, '');
        var port = rootStyle.getPropertyValue('--port').trim();
        var url = 'ws://' + host + ':' + port;
        console.log('WebSocket URL: ' + url);
        ws = new WebSocket(url);
        ws.onmessage = onMessage;
        ws.onclose = onClose;
    }

    function onMessage(event) {
        try {
            var data = JSON.parse(event.data);
            var events = Array.isArray(data) ? data : [data];
            var now = performance.now();
            events.forEach(function (e) {
                $('warning').html('');
                if (e.type === 'button') {
                    var side = e.controller_side || 0;
                    var key = 'k' + side + '_' + e.button;
                    if (e.state === 'down') pressLane(key, now);
                    else releaseLane(key, now);
                } else if (e.type === 'axis') {
                    var s = 's' + (e.controller_side || 0);
                    var scr = lanes[s];
                    var dir = e.direction; // 0/1が回転方向(初回のみ-1)
                    if (scr && dir !== -1 && dir !== undefined) {
                        // 回転方向が反転したら、その境目に始点(明るい先頭)を出すため
                        // 現在のノーツを一旦切って新しいノーツを開始する
                        if (scr.activeNote && scr.lastDir !== -1 && scr.lastDir !== dir) {
                            releaseLane(s, now);
                        }
                        scr.lastDir = dir;
                    }
                    pressLane(s, now); // 皿は動いている間だけ押下扱い
                } else if (e.type === 'release') {
                    $('release').html(e.value);
                } else if (e.type === 'density') {
                    $('density').html(e.value);
                } else if (e.type === 'notes') {
                    $('notes').html(e.value);
                }
                // release_eachkey はレーン表示では使用しない
            });
        } catch (err) {
            console.error('データ解析エラー:', err);
        }
    }

    function onClose() {
        console.log('切断されました');
        $('warning').html('Not Connected!!');
        ws = null;
        setTimeout(open, 3000);
    }

    function init() {
        buildLanes();
        requestAnimationFrame(tick);
        setInterval(checkScratch, 50);
        open();
    }

    $(init);
})();
