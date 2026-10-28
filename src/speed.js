  /* ================= 速率控制核心 ================= */

  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var Orig = window[name];
    if (typeof Orig !== 'function') return;
    window[name] = class extends Orig {
      constructor() {
        super(...arguments);
        (window.__sodaAudioContexts || (window.__sodaAudioContexts = [])).push(this);
      }
    };
  });

  var mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  var rateDesc = mediaProto && Object.getOwnPropertyDescriptor(mediaProto, 'playbackRate');

  if (rateDesc && rateDesc.set) {
    Object.defineProperty(mediaProto, 'playbackRate', {
      configurable: true,
      enumerable: rateDesc.enumerable,
      get: rateDesc.get,
      set: function (value) {
        rateDesc.set.call(this, suspended ? value : rate);
      }
    });
  }

  var known = [];

  function normalize(el) {
    try { if (el.preservesPitch !== CFG.keepPitch) el.preservesPitch = CFG.keepPitch; } catch (e) {}
    if (!rateDesc || suspended) return;
    if (Math.abs(el.playbackRate - rate) > 1e-6) rateDesc.set.call(el, rate);
  }

  function remember(el) {
    for (var i = 0; i < known.length; i++) if (known[i] === el) return;
    known.push(el);
    normalize(el);
  }

  function deepScan(root, out) {
    out = out || [];
    var scope = root || document;
    if (!scope.querySelectorAll) return out;
    var list = scope.querySelectorAll('audio,video');
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    var nodes;
    try { nodes = scope.querySelectorAll('*'); } catch (e) { return out; }
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j].shadowRoot) deepScan(nodes[j].shadowRoot, out);
    }
    return out;
  }

  if (mediaProto && typeof mediaProto.play === 'function') {
    var origPlay = mediaProto.play;
    mediaProto.play = function () {
      remember(this);
      var self = this;
      Promise.resolve().then(function () { normalize(self); });
      return origPlay.apply(this, arguments);
    };
  }

  if (mediaProto && typeof mediaProto.load === 'function') {
    var origLoad = mediaProto.load;
    mediaProto.load = function () {
      remember(this);
      return origLoad.apply(this, arguments);
    };
  }

  function trackAudioNode(node) {
    (window.__sodaABSNodes || (window.__sodaABSNodes = [])).push(node);
    try { node.playbackRate.value = suspended ? 1 : rate; } catch (e) {}
    tapAnalyser(node);
    return node;
  }

  /* 频谱采集。
     汽水音乐的音频既不走 createBufferSource，也没有 <audio> 元素，
     而是 AudioWorklet 直接输出，所以按「谁连到 destination 就 tap 谁」来兜，
     任何音频架构最后都必须连到 destination，这条规则覆盖得到。 */
  var origNodeConnect = null;
  var nodeProto = window.AudioNode && window.AudioNode.prototype;
  if (nodeProto && typeof nodeProto.connect === 'function') {
    origNodeConnect = nodeProto.connect;
    nodeProto.connect = function (dest) {
      var r = origNodeConnect.apply(this, arguments);
      try {
        var ctx = this.context;
        if (dest && ctx && dest === ctx.destination) tapAnalyser(this);
      } catch (e) { /* ignore */ }
      return r;
    };
  }

  /* 内部接线一律走原始 connect，避免触发上面的 hook 造成自我连接/反馈环 */
  function nodeConnect(n, target) {
    return origNodeConnect ? origNodeConnect.call(n, target) : n.connect(target);
  }

  /* 给音源额外接一条 AnalyserNode 分支；不接回 destination 就取不到数（见下方 gain=0 回流） */
  function tapAnalyser(node) {
    try {
      var ctx = node && node.context;
      if (!ctx || typeof ctx.createAnalyser !== 'function') return;
      if (node.__sodaTapped) { visAnalyser = ctx.__sodaAnalyser || visAnalyser; return; }
      node.__sodaTapped = true;

      var a = ctx.__sodaAnalyser;
      if (!a) {
        a = ctx.createAnalyser();
        a.fftSize = 2048;
        a.smoothingTimeConstant = 0.8;
        ctx.__sodaAnalyser = a;
        /* 让 analyser 在渲染图里「可达」：只接输入、输出悬空时，浏览器可能整条子图都不处理，
           读出来永远是 0。用 gain=0 接回 destination，既保证被处理，又不会多出一份声音。 */
        try {
          var mute = ctx.createGain();
          mute.gain.value = 0;
          nodeConnect(a, mute);
          nodeConnect(mute, ctx.destination);
        } catch (e) { /* 接不上就只靠原路径 */ }
      }
      if (!visAnalyser) {
        logDbg('频谱: 已接管音源 ' + ((node.constructor && node.constructor.name) || 'unknown'));
      }
      nodeConnect(node, a);
      visAnalyser = a;
      // 切歌常常会换一个 AudioContext：拿到新音源就把已经停摆的频谱循环重新唤醒
      if (spectrumOn && !visRaf) startVis();
    } catch (e) { /* 采不到就不显示频谱 */ }
  }

  var baseProto = (window.BaseAudioContext || window.AudioContext || {}).prototype;
  if (baseProto && typeof baseProto.createBufferSource === 'function') {
    var origCBS = baseProto.createBufferSource;
    baseProto.createBufferSource = function () {
      return trackAudioNode(origCBS.apply(this, arguments));
    };
  }

  if (baseProto && typeof baseProto.createMediaElementSource === 'function') {
    var origCMES = baseProto.createMediaElementSource;
    baseProto.createMediaElementSource = function () {
      var n = origCMES.apply(this, arguments);
      tapAnalyser(n);
      return n;
    };
  }

  var absProto = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
  if (absProto && typeof absProto.start === 'function') {
    var origStart = absProto.start;
    absProto.start = function () {
      trackAudioNode(this);
      return origStart.apply(this, arguments);
    };
  }

  if (window.AudioWorkletNode) {
    var OrigAWN = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends OrigAWN {
      constructor() {
        super(...arguments);
        (window.__sodaWorklets || (window.__sodaWorklets = [])).push(String(arguments[1] || 'anon'));
        tapAnalyser(this);   // worklet 往往就是最终出声的那一级，先接上
      }
    };
  }

  function applyAudioNodes() {
    var nodes = window.__sodaABSNodes;
    if (!nodes) return;
    var target = suspended ? 1 : rate;
    for (var i = 0; i < nodes.length; i++) {
      try { if (nodes[i].playbackRate) nodes[i].playbackRate.value = target; } catch (e) {}
    }
  }

  function applyAll(root) {
    for (var i = 0; i < known.length; i++) normalize(known[i]);
    if (root && root.nodeType === 1 && root.matches && root.matches('audio,video')) remember(root);
    var scope = root || document;
    if (scope.querySelectorAll) {
      var list = scope.querySelectorAll('audio,video');
      for (var k = 0; k < list.length; k++) remember(list[k]);
    }
    if (!suspended) applyAudioNodes();
  }

  function restore() {
    for (var i = 0; i < known.length; i++) if (rateDesc) rateDesc.set.call(known[i], 1);
    var list = document.querySelectorAll('audio,video');
    for (var j = 0; j < list.length; j++) if (rateDesc) rateDesc.set.call(list[j], 1);
    var nodes = window.__sodaABSNodes || [];
    for (var k = 0; k < nodes.length; k++) {
      try { nodes[k].playbackRate.value = 1; } catch (e) {}
    }
  }

  function setRate(next) {
    rate = snap(next);
    suspended = false;
    ls(CFG.rateKey, String(rate));
    applyAll();
    renderPopup();
  }

  function suspend(on) {
    suspended = on === undefined ? !suspended : !!on;
    if (suspended) restore(); else applyAll();
    renderPopup();
  }

