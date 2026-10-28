  /* ================= 睡眠定时器（末尾渐弱淡出） ================= */

  var SLEEP_PRESETS = [0, 15, 30, 60];
  var SLEEP_FADE_MS = 20000;   // 最后 20 秒开始渐弱
  var sleepUntil = 0;
  var sleepTimer = 0;
  var sleepBase = null;        // 渐弱前的原始音量
  var sleepPick = 0;
  var sleepShownSec = -1;

  function mmss(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function sleepRemainMs() {
    return sleepUntil ? Math.max(0, sleepUntil - Date.now()) : 0;
  }

  function nextSleepMinutes() {
    var i = SLEEP_PRESETS.indexOf(sleepPick);
    return SLEEP_PRESETS[(i + 1) % SLEEP_PRESETS.length];
  }

  /* 播放器藏在 Shadow DOM 里的可能性不大，但 deepScan 更保险 */
  function allMedia() {
    var out = [];
    var list = document.querySelectorAll('audio,video');
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    var deep = deepScan(document, []);
    for (var j = 0; j < deep.length; j++) if (out.indexOf(deep[j]) < 0) out.push(deep[j]);
    return out;
  }

  function eachMediaVolume(v) {
    var els = allMedia();
    for (var i = 0; i < els.length; i++) { try { els[i].volume = v; } catch (e) {} }
  }

  function currentVolume() {
    var els = allMedia();
    for (var i = 0; i < els.length; i++) {
      if (typeof els[i].volume === 'number' && els[i].volume > 0) return els[i].volume;
    }
    return 1;
  }

  function anyPlaying() {
    var els = allMedia();
    for (var i = 0; i < els.length; i++) if (!els[i].paused) return true;
    return false;
  }

  function endSleep() {
    if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = 0; }
    sleepUntil = 0;
    sleepPick = 0;
    sleepShownSec = -1;

    if (anyPlaying()) {
      var wasPlaying = playbarToggle();   // 走 App 自己的播放/暂停逻辑，图标状态不会不同步
      var els = allMedia();
      for (var i = 0; i < els.length; i++) { try { els[i].pause(); } catch (e) {} }
      if (wasPlaying) logDbg('睡眠定时: 已淡出并暂停播放');
    }
    if (sleepBase !== null) { eachMediaVolume(sleepBase); sleepBase = null; }
    renderPopup();
  }

  function sleepTick() {
    var left = sleepRemainMs();
    if (!left) { endSleep(); return; }
    if (left <= SLEEP_FADE_MS) {
      if (sleepBase === null) sleepBase = currentVolume();
      eachMediaVolume(sleepBase * (left / SLEEP_FADE_MS));
    }
    var sec = Math.ceil(left / 1000);
    if (sec !== sleepShownSec) { sleepShownSec = sec; renderPopup(); }
  }

  function setSleep(minutes) {
    if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = 0; }
    if (sleepBase !== null) { eachMediaVolume(sleepBase); sleepBase = null; }
    sleepShownSec = -1;
    sleepPick = minutes;
    if (!minutes) {
      sleepUntil = 0;
      renderPopup();
      return;
    }
    sleepUntil = Date.now() + minutes * 60000;
    sleepTimer = setInterval(sleepTick, 200);
    logDbg('睡眠定时: ' + minutes + ' 分钟后渐弱暂停');
    renderPopup();
  }

