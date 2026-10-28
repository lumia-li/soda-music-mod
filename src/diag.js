  /* ================= 诊断 ================= */

  function probe() {
    var deep = deepScan(document, []);
    console.log('%c[倍速Mod] 诊断', 'color:#7ccfff;font-weight:600', {
      媒体元素: deep.length,
      已接管: known.length,
      AudioContext: (window.__sodaAudioContexts || []).length,
      AudioBufferSource: (window.__sodaABSNodes || []).length,
      AudioWorklet: (window.__sodaWorklets || []).join(',') || '(无)',
      目标倍速: fmt(rate),
      状态: suspended ? '已停用' : '生效中'
    });
    diagAudio('probe');
    return { rate: rate, media: deep.length };
  }

