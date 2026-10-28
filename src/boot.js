  /* ================= 启动 ================= */

  /* 单个注入任务出错不要拖垮同一轮里的其它任务 */
  function runSafely(fn) {
    try { fn(); } catch (e) { logDbg('任务异常: ' + ((e && e.message) || e)); }
  }

  function boot() {
    applyAll();
    injectBrand();
    ls('sodaSpeedMod.anchorOffset', '');   // 清掉旧版手动校准的残留，避免影响自动定位

    /* 排障日志先注册：即使下面 startVis 抛错，也能在日志里看到「脚本跑过了」以及架构信息 */
    setTimeout(function () { diagAudio('8s'); }, 8000);
    setTimeout(function () { diagAudio('25s'); }, 25000);

    if (spectrumOn) {
      try { startVis(); } catch (e) { logDbg('频谱初始化失败: ' + ((e && e.message) || e)); }
    }

    /* 只把「外部（App 自己）」的变动当触发源：我们插封面 / 挪爱心产生的变动
       不再触发下一轮扫描。否则滚动时每 120ms 就会自激一次全页扫描 + 组件树遍历，
       表现就是「一滚动列表就一直刷新」。 */
    var scanTimer = 0;
    new MutationObserver(function (records) {
      var external = 0;
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (ourRecord(r)) continue;
        external++;
        stat.add += r.addedNodes.length;
        stat.del += r.removedNodes.length;
        for (var a = 0; a < r.addedNodes.length && stat.samples.length < 3; a++) {
          stat.samples.push('+' + nodeBrief(r.addedNodes[a]));
        }
        for (var b = 0; b < r.removedNodes.length && stat.samples.length < 3; b++) {
          stat.samples.push('-' + nodeBrief(r.removedNodes[b]));
        }
      }
      if (!external) { stat.selfBatches++; return; }
      stat.batches++;
      stat.recs += external;
      if (scanTimer) return;
      scanTimer = setTimeout(function () {
        scanTimer = 0;
        stat.passes++;
        runSafely(injectBrand);
        runSafely(injectMenuItems);
        if (isSettingsAboutPage()) {
          /* 关于页只用原生内容：把已经插进去的 Mod 设置行摘干净，并停止这一轮的注入 */
          runSafely(removeInjectedSettingRows);
        } else {
          runSafely(injectWheelSwitchRow);
          runSafely(injectSpectrumColorRow);
          runSafely(injectResumeRow);
          runSafely(injectWidgetStyleRow);
          runSafely(injectWidgetButtonsCard);
          runSafely(injectClearBgRow);
          runSafely(injectClearBgCard);
          runSafely(injectBrandFxCard);
          runSafely(injectHiddenButtonsCard);
          runSafely(injectRowCoverRow);
        }
        runSafely(applyClearBg);
        runSafely(clearViewportPaints);   // 面板被重建时立刻补扫，别等 4 秒的定时
        runSafely(dumpPlayerBar);
        runSafely(syncRowCovers);
        runSafely(resetSongQueryOnNav);
        runSafely(injectSongSearch);
        runSafely(syncUnplayable);
        runSafely(injectPlaylistMenu);
      }, 120);
    }).observe(document.documentElement, { childList: true, subtree: true });

    logDbg('引导 r2 已生效（app-dir/CDP 通道，含滚动修复）');

    setInterval(function () {
      if (suspended) return;
      for (var i = 0; i < known.length; i++) normalize(known[i]);
      applyAudioNodes();
      runSafely(applyClearBg);   // 兜底：定时补一次，保证清背景一直生效
    }, 1000);

    setInterval(function () {
      if (suspended) return;
      var found = deepScan(document, []);
      for (var i = 0; i < found.length; i++) remember(found[i]);
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.__sodaSpeedMod = {
    get rate() { return rate; },
    set rate(v) { setRate(v); },
    setRate: setRate,
    suspend: suspend,
    show: showPopup,
    hide: hidePopup,
    probe: probe,
    get suspended() { return suspended; },
    get wheelSwitch() { return wheelOn; },
    set wheelSwitch(v) { setWheelSwitch(v); },
    get keepPitch() { return CFG.keepPitch; },
    set keepPitch(v) { setKeepPitch(v); },
    get spectrum() { return spectrumOn; },
    set spectrum(v) { setSpectrum(v); },
    get sleepMs() { return sleepRemainMs(); },
    setSleep: setSleep,
    get brandFx() { return brandFx; },
    set brandFx(v) { setBrandFx(v); },
    get brandFxSpeed() { return fxSpeed; },
    set brandFxSpeed(v) { setFxSpeed(v); },
    get brandFxSat() { return fxSat; },
    set brandFxSat(v) { setFxSat(v); },
    get rowCover() { return rowCoverOn; },
    set rowCover(v) { setRowCover(v); },
    get hideUnplayable() { return hideUnplayable; },
    set hideUnplayable(v) { setHideUnplayable(v); },
    get hiddenButtons() { return hideReadList(); },
    showHiddenButtons: showHiddenButtons,
    clearHiddenButtons: showHiddenButtons,
    get widgetStyle() { return widgetStyleGet(); },
    set widgetStyle(v) { widgetStyleSet(v); }
  };
