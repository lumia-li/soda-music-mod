  /* ================= 变速不变调开关 ================= */

  function setKeepPitch(on) {
    CFG.keepPitch = !!on;
    ls(CFG.pitchKey, CFG.keepPitch ? '1' : '0');
    applyAll();
    renderPopup();
  }

