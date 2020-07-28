"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

require("source-map-support/register");

var _logger = _interopRequireDefault(require("../logger.js"));

var _helpers = require("../helpers.js");

var _path = _interopRequireDefault(require("path"));

var _lodash = _interopRequireDefault(require("lodash"));

var _appiumSupport = require("appium-support");

var _os = require("os");

var _logcat = _interopRequireDefault(require("../logcat"));

var _asyncbox = require("asyncbox");

var _teen_process = require("teen_process");

var _bluebird = _interopRequireDefault(require("bluebird"));

const MAX_SHELL_BUFFER_LENGTH = 1000;
const NOT_CHANGEABLE_PERM_ERROR = /not a changeable permission type/i;
const IGNORED_PERM_ERRORS = [NOT_CHANGEABLE_PERM_ERROR, /Unknown permission/i];
const MAX_PGREP_PATTERN_LEN = 15;
const HIDDEN_API_POLICY_KEYS = ['hidden_api_policy_pre_p_apps', 'hidden_api_policy_p_apps', 'hidden_api_policy'];
const PID_COLUMN_TITLE = 'PID';
const PROCESS_NAME_COLUMN_TITLE = 'NAME';
const PS_TITLE_PATTERN = new RegExp(`^(.*\\b${PID_COLUMN_TITLE}\\b.*\\b${PROCESS_NAME_COLUMN_TITLE}\\b.*)$`, 'm');
let methods = {};

methods.getAdbWithCorrectAdbPath = async function getAdbWithCorrectAdbPath() {
  this.executable.path = await this.getSdkBinaryPath('adb');
  return this.adb;
};

methods.initAapt = async function initAapt() {
  await this.getSdkBinaryPath('aapt');
};

methods.initAapt2 = async function initAapt2() {
  await this.getSdkBinaryPath('aapt2');
};

methods.initZipAlign = async function initZipAlign() {
  await this.getSdkBinaryPath('zipalign');
};

methods.initBundletool = async function initBundletool() {
  try {
    this.binaries.bundletool = await _appiumSupport.fs.which('bundletool.jar');
  } catch (err) {
    throw new Error('bundletool.jar binary is expected to be present in PATH. ' + 'Visit https://github.com/google/bundletool for more details.');
  }
};

methods.getApiLevel = async function getApiLevel() {
  if (!_lodash.default.isInteger(this._apiLevel)) {
    try {
      const strOutput = await this.getDeviceProperty('ro.build.version.sdk');
      let apiLevel = parseInt(strOutput.trim(), 10);
      const charCodeQ = 'q'.charCodeAt(0);
      const apiLevelDiff = apiLevel - 28;
      const codename = String.fromCharCode(charCodeQ + apiLevelDiff);

      if (apiLevelDiff >= 0 && (await this.getPlatformVersion()).toLowerCase() === codename) {
        _logger.default.debug(`Release version is ${codename.toUpperCase()} but found API Level ${apiLevel}. Setting API Level to ${apiLevel + 1}`);

        apiLevel++;
      }

      this._apiLevel = apiLevel;

      _logger.default.debug(`Device API level: ${this._apiLevel}`);

      if (isNaN(this._apiLevel)) {
        throw new Error(`The actual output '${strOutput}' cannot be converted to an integer`);
      }
    } catch (e) {
      throw new Error(`Error getting device API level. Original error: ${e.message}`);
    }
  }

  return this._apiLevel;
};

methods.getPlatformVersion = async function getPlatformVersion() {
  _logger.default.info('Getting device platform version');

  try {
    return await this.getDeviceProperty('ro.build.version.release');
  } catch (e) {
    throw new Error(`Error getting device platform version. Original error: ${e.message}`);
  }
};

methods.isDeviceConnected = async function isDeviceConnected() {
  let devices = await this.getConnectedDevices();
  return devices.length > 0;
};

methods.mkdir = async function mkdir(remotePath) {
  return await this.shell(['mkdir', '-p', remotePath]);
};

methods.isValidClass = function isValidClass(classString) {
  return new RegExp(/^[a-zA-Z0-9./_]+$/).exec(classString);
};

methods.forceStop = async function forceStop(pkg) {
  return await this.shell(['am', 'force-stop', pkg]);
};

methods.killPackage = async function killPackage(pkg) {
  return await this.shell(['am', 'kill', pkg]);
};

methods.clear = async function clear(pkg) {
  return await this.shell(['pm', 'clear', pkg]);
};

methods.grantAllPermissions = async function grantAllPermissions(pkg, apk) {
  const apiLevel = await this.getApiLevel();
  let targetSdk = 0;
  let dumpsysOutput = null;

  try {
    if (!apk) {
      dumpsysOutput = await this.shell(['dumpsys', 'package', pkg]);
      targetSdk = await this.targetSdkVersionUsingPKG(pkg, dumpsysOutput);
    } else {
      targetSdk = await this.targetSdkVersionFromManifest(apk);
    }
  } catch (e) {
    _logger.default.warn(`Ran into problem getting target SDK version; ignoring...`);
  }

  if (apiLevel >= 23 && targetSdk >= 23) {
    dumpsysOutput = dumpsysOutput || (await this.shell(['dumpsys', 'package', pkg]));
    const requestedPermissions = await this.getReqPermissions(pkg, dumpsysOutput);
    const grantedPermissions = await this.getGrantedPermissions(pkg, dumpsysOutput);

    const permissionsToGrant = _lodash.default.difference(requestedPermissions, grantedPermissions);

    if (_lodash.default.isEmpty(permissionsToGrant)) {
      _logger.default.info(`${pkg} contains no permissions available for granting`);
    } else {
      await this.grantPermissions(pkg, permissionsToGrant);
    }
  }
};

methods.grantPermissions = async function grantPermissions(pkg, permissions) {
  _logger.default.debug(`Granting permissions ${JSON.stringify(permissions)} to '${pkg}'`);

  const commands = [];
  let cmdChunk = [];

  for (const permission of permissions) {
    const nextCmd = ['pm', 'grant', pkg, permission, ';'];

    if (nextCmd.join(' ').length + cmdChunk.join(' ').length >= MAX_SHELL_BUFFER_LENGTH) {
      commands.push(cmdChunk);
      cmdChunk = [];
    }

    cmdChunk = [...cmdChunk, ...nextCmd];
  }

  if (!_lodash.default.isEmpty(cmdChunk)) {
    commands.push(cmdChunk);
  }

  _logger.default.debug(`Got the following command chunks to execute: ${JSON.stringify(commands)}`);

  let lastError = null;

  for (const cmd of commands) {
    try {
      await this.shell(cmd);
    } catch (e) {
      if (!IGNORED_PERM_ERRORS.some(msgRegex => msgRegex.test(e.stderr || e.message))) {
        lastError = e;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
};

methods.grantPermission = async function grantPermission(pkg, permission) {
  try {
    await this.shell(['pm', 'grant', pkg, permission]);
  } catch (e) {
    if (!NOT_CHANGEABLE_PERM_ERROR.test(e.stderr || e.message)) {
      throw e;
    }
  }
};

methods.revokePermission = async function revokePermission(pkg, permission) {
  try {
    await this.shell(['pm', 'revoke', pkg, permission]);
  } catch (e) {
    if (!NOT_CHANGEABLE_PERM_ERROR.test(e.stderr || e.message)) {
      throw e;
    }
  }
};

methods.getGrantedPermissions = async function getGrantedPermissions(pkg, cmdOutput = null) {
  _logger.default.debug('Retrieving granted permissions');

  const stdout = cmdOutput || (await this.shell(['dumpsys', 'package', pkg]));
  return (0, _helpers.extractMatchingPermissions)(stdout, ['install', 'runtime'], true);
};

methods.getDeniedPermissions = async function getDeniedPermissions(pkg, cmdOutput = null) {
  _logger.default.debug('Retrieving denied permissions');

  const stdout = cmdOutput || (await this.shell(['dumpsys', 'package', pkg]));
  return (0, _helpers.extractMatchingPermissions)(stdout, ['install', 'runtime'], false);
};

methods.getReqPermissions = async function getReqPermissions(pkg, cmdOutput = null) {
  _logger.default.debug('Retrieving requested permissions');

  const stdout = cmdOutput || (await this.shell(['dumpsys', 'package', pkg]));
  return (0, _helpers.extractMatchingPermissions)(stdout, ['requested']);
};

methods.getLocationProviders = async function getLocationProviders() {
  let stdout = await this.getSetting('secure', 'location_providers_allowed');
  return stdout.trim().split(',').map(p => p.trim()).filter(Boolean);
};

methods.toggleGPSLocationProvider = async function toggleGPSLocationProvider(enabled) {
  await this.setSetting('secure', 'location_providers_allowed', `${enabled ? '+' : '-'}gps`);
};

methods.setHiddenApiPolicy = async function setHiddenApiPolicy(value, ignoreError = false) {
  try {
    await this.shell(HIDDEN_API_POLICY_KEYS.map(k => `settings put global ${k} ${value}`).join(';'));
  } catch (e) {
    if (!ignoreError) {
      throw e;
    }

    _logger.default.info(`Failed to set setting keys '${HIDDEN_API_POLICY_KEYS}' to '${value}'. Original error: ${e.message}`);
  }
};

methods.setDefaultHiddenApiPolicy = async function setDefaultHiddenApiPolicy(ignoreError = false) {
  try {
    await this.shell(HIDDEN_API_POLICY_KEYS.map(k => `settings delete global ${k}`).join(';'));
  } catch (e) {
    if (!ignoreError) {
      throw e;
    }

    _logger.default.info(`Failed to delete keys '${HIDDEN_API_POLICY_KEYS}'. Original error: ${e.message}`);
  }
};

methods.stopAndClear = async function stopAndClear(pkg) {
  try {
    await this.forceStop(pkg);
    await this.clear(pkg);
  } catch (e) {
    throw new Error(`Cannot stop and clear ${pkg}. Original error: ${e.message}`);
  }
};

methods.availableIMEs = async function availableIMEs() {
  try {
    return (0, _helpers.getIMEListFromOutput)(await this.shell(['ime', 'list', '-a']));
  } catch (e) {
    throw new Error(`Error getting available IME's. Original error: ${e.message}`);
  }
};

methods.enabledIMEs = async function enabledIMEs() {
  try {
    return (0, _helpers.getIMEListFromOutput)(await this.shell(['ime', 'list']));
  } catch (e) {
    throw new Error(`Error getting enabled IME's. Original error: ${e.message}`);
  }
};

methods.enableIME = async function enableIME(imeId) {
  await this.shell(['ime', 'enable', imeId]);
};

methods.disableIME = async function disableIME(imeId) {
  await this.shell(['ime', 'disable', imeId]);
};

methods.setIME = async function setIME(imeId) {
  await this.shell(['ime', 'set', imeId]);
};

methods.defaultIME = async function defaultIME() {
  try {
    let engine = await this.getSetting('secure', 'default_input_method');

    if (engine === 'null') {
      return null;
    }

    return engine.trim();
  } catch (e) {
    throw new Error(`Error getting default IME. Original error: ${e.message}`);
  }
};

methods.keyevent = async function keyevent(keycode) {
  let code = parseInt(keycode, 10);
  await this.shell(['input', 'keyevent', code]);
};

methods.inputText = async function inputText(text) {
  text = text.replace(/\\/g, '\\\\').replace(/\(/g, '\(').replace(/\)/g, '\)').replace(/</g, '\<').replace(/>/g, '\>').replace(/\|/g, '\|').replace(/;/g, '\;').replace(/&/g, '\&').replace(/\*/g, '\*').replace(/~/g, '\~').replace(/"/g, '\"').replace(/'/g, "\'").replace(/ /g, '%s');
  await this.shell(['input', 'text', text]);
};

methods.clearTextField = async function clearTextField(length = 100) {
  _logger.default.debug(`Clearing up to ${length} characters`);

  if (length === 0) {
    return;
  }

  let args = ['input', 'keyevent'];

  for (let i = 0; i < length; i++) {
    args.push('67', '112');
  }

  await this.shell(args);
};

methods.lock = async function lock() {
  if (await this.isScreenLocked()) {
    _logger.default.debug('Screen is already locked. Doing nothing.');

    return;
  }

  _logger.default.debug('Pressing the KEYCODE_POWER button to lock screen');

  await this.keyevent(26);
  const timeoutMs = 5000;

  try {
    await (0, _asyncbox.waitForCondition)(async () => await this.isScreenLocked(), {
      waitMs: timeoutMs,
      intervalMs: 500
    });
  } catch (e) {
    throw new Error(`The device screen is still locked after ${timeoutMs}ms timeout`);
  }
};

methods.back = async function back() {
  _logger.default.debug('Pressing the BACK button');

  await this.keyevent(4);
};

methods.goToHome = async function goToHome() {
  _logger.default.debug('Pressing the HOME button');

  await this.keyevent(3);
};

methods.getAdbPath = function getAdbPath() {
  return this.executable.path;
};

methods.getScreenOrientation = async function getScreenOrientation() {
  let stdout = await this.shell(['dumpsys', 'input']);
  return (0, _helpers.getSurfaceOrientation)(stdout);
};

methods.isScreenLocked = async function isScreenLocked() {
  let stdout = await this.shell(['dumpsys', 'window']);

  if (process.env.APPIUM_LOG_DUMPSYS) {
    let dumpsysFile = _path.default.resolve(process.cwd(), 'dumpsys.log');

    _logger.default.debug(`Writing dumpsys output to ${dumpsysFile}`);

    await _appiumSupport.fs.writeFile(dumpsysFile, stdout);
  }

  return (0, _helpers.isShowingLockscreen)(stdout) || (0, _helpers.isCurrentFocusOnKeyguard)(stdout) || !(0, _helpers.isScreenOnFully)(stdout);
};

methods.isSoftKeyboardPresent = async function isSoftKeyboardPresent() {
  try {
    const stdout = await this.shell(['dumpsys', 'input_method']);
    const inputShownMatch = /mInputShown=(\w+)/.exec(stdout);
    const inputViewShownMatch = /mIsInputViewShown=(\w+)/.exec(stdout);
    return {
      isKeyboardShown: !!(inputShownMatch && inputShownMatch[1] === 'true'),
      canCloseKeyboard: !!(inputViewShownMatch && inputViewShownMatch[1] === 'true')
    };
  } catch (e) {
    throw new Error(`Error finding softkeyboard. Original error: ${e.message}`);
  }
};

methods.sendTelnetCommand = async function sendTelnetCommand(command) {
  return await this.execEmuConsoleCommand(command, {
    port: await this.getEmulatorPort()
  });
};

methods.isAirplaneModeOn = async function isAirplaneModeOn() {
  let stdout = await this.getSetting('global', 'airplane_mode_on');
  return parseInt(stdout, 10) !== 0;
};

methods.setAirplaneMode = async function setAirplaneMode(on) {
  await this.setSetting('global', 'airplane_mode_on', on ? 1 : 0);
};

methods.broadcastAirplaneMode = async function broadcastAirplaneMode(on) {
  await this.shell(['am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', on ? 'true' : 'false']);
};

methods.isWifiOn = async function isWifiOn() {
  let stdout = await this.getSetting('global', 'wifi_on');
  return parseInt(stdout, 10) !== 0;
};

methods.isDataOn = async function isDataOn() {
  let stdout = await this.getSetting('global', 'mobile_data');
  return parseInt(stdout, 10) !== 0;
};

methods.setWifiAndData = async function setWifiAndData({
  wifi,
  data
}, isEmulator = false) {
  if (_appiumSupport.util.hasValue(wifi)) {
    await this.setWifiState(wifi, isEmulator);
  }

  if (_appiumSupport.util.hasValue(data)) {
    await this.setDataState(data, isEmulator);
  }
};

methods.isAnimationOn = async function isAnimationOn() {
  let animator_duration_scale = await this.getSetting('global', 'animator_duration_scale');
  let transition_animation_scale = await this.getSetting('global', 'transition_animation_scale');
  let window_animation_scale = await this.getSetting('global', 'window_animation_scale');
  return _lodash.default.some([animator_duration_scale, transition_animation_scale, window_animation_scale], setting => setting !== '0.0');
};

methods.rimraf = async function rimraf(path) {
  await this.shell(['rm', '-rf', path]);
};

methods.push = async function push(localPath, remotePath, opts) {
  await this.mkdir(_path.default.posix.dirname(remotePath));
  await this.adbExec(['push', localPath, remotePath], opts);
};

methods.pull = async function pull(remotePath, localPath) {
  await this.adbExec(['pull', remotePath, localPath], {
    timeout: 60000
  });
};

methods.processExists = async function processExists(processName) {
  return !_lodash.default.isEmpty(await this.getPIDsByName(processName));
};

methods.getForwardList = async function getForwardList() {
  _logger.default.debug(`List forwarding ports`);

  const connections = await this.adbExec(['forward', '--list']);
  return connections.split(_os.EOL).filter(line => Boolean(line.trim()));
};

methods.forwardPort = async function forwardPort(systemPort, devicePort) {
  _logger.default.debug(`Forwarding system: ${systemPort} to device: ${devicePort}`);

  await this.adbExec(['forward', `tcp:${systemPort}`, `tcp:${devicePort}`]);
};

methods.removePortForward = async function removePortForward(systemPort) {
  _logger.default.debug(`Removing forwarded port socket connection: ${systemPort} `);

  await this.adbExec(['forward', `--remove`, `tcp:${systemPort}`]);
};

methods.getReverseList = async function getReverseList() {
  _logger.default.debug(`List reverse forwarding ports`);

  const connections = await this.adbExec(['reverse', '--list']);
  return connections.split(_os.EOL).filter(line => Boolean(line.trim()));
};

methods.reversePort = async function reversePort(devicePort, systemPort) {
  _logger.default.debug(`Forwarding device: ${devicePort} to system: ${systemPort}`);

  await this.adbExec(['reverse', `tcp:${devicePort}`, `tcp:${systemPort}`]);
};

methods.removePortReverse = async function removePortReverse(devicePort) {
  _logger.default.debug(`Removing reverse forwarded port socket connection: ${devicePort} `);

  await this.adbExec(['reverse', `--remove`, `tcp:${devicePort}`]);
};

methods.forwardAbstractPort = async function forwardAbstractPort(systemPort, devicePort) {
  _logger.default.debug(`Forwarding system: ${systemPort} to abstract device: ${devicePort}`);

  await this.adbExec(['forward', `tcp:${systemPort}`, `localabstract:${devicePort}`]);
};

methods.ping = async function ping() {
  let stdout = await this.shell(['echo', 'ping']);

  if (stdout.indexOf('ping') === 0) {
    return true;
  }

  throw new Error(`ADB ping failed, returned ${stdout}`);
};

methods.restart = async function restart() {
  try {
    await this.stopLogcat();
    await this.restartAdb();
    await this.waitForDevice(60);
    await this.startLogcat(this._logcatStartupParams);
  } catch (e) {
    throw new Error(`Restart failed. Original error: ${e.message}`);
  }
};

methods.startLogcat = async function startLogcat(opts = {}) {
  if (!_lodash.default.isEmpty(this.logcat)) {
    throw new Error("Trying to start logcat capture but it's already started!");
  }

  this.logcat = new _logcat.default({
    adb: this.executable,
    debug: false,
    debugTrace: false,
    clearDeviceLogsOnStart: !!this.clearDeviceLogsOnStart
  });
  await this.logcat.startCapture(opts);
  this._logcatStartupParams = opts;
};

methods.stopLogcat = async function stopLogcat() {
  if (_lodash.default.isEmpty(this.logcat)) {
    return;
  }

  try {
    await this.logcat.stopCapture();
  } finally {
    this.logcat = null;
  }
};

methods.getLogcatLogs = function getLogcatLogs() {
  if (_lodash.default.isEmpty(this.logcat)) {
    throw new Error("Can't get logcat logs since logcat hasn't started");
  }

  return this.logcat.getLogs();
};

methods.setLogcatListener = function setLogcatListener(listener) {
  if (_lodash.default.isEmpty(this.logcat)) {
    throw new Error("Logcat process hasn't been started");
  }

  this.logcat.on('output', listener);
};

methods.removeLogcatListener = function removeLogcatListener(listener) {
  if (_lodash.default.isEmpty(this.logcat)) {
    throw new Error("Logcat process hasn't been started");
  }

  this.logcat.removeListener('output', listener);
};

methods.getNameByPid = async function getNameByPid(pid) {
  if (isNaN(pid)) {
    throw new Error(`The PID value must be a valid number. '${pid}' is given instead`);
  }

  pid = parseInt(pid, 10);
  const stdout = await this.shell(['ps']);
  const titleMatch = PS_TITLE_PATTERN.exec(stdout);

  if (!titleMatch) {
    _logger.default.debug(stdout);

    throw new Error(`Could not get the process name for PID '${pid}'`);
  }

  const allTitles = titleMatch[1].trim().split(/\s+/);
  const pidIndex = allTitles.indexOf(PID_COLUMN_TITLE);
  const nameOffset = allTitles.indexOf(PROCESS_NAME_COLUMN_TITLE) - allTitles.length;
  const pidRegex = new RegExp(`^(.*\\b${pid}\\b.*)$`, 'gm');
  let matchedLine;

  while (matchedLine = pidRegex.exec(stdout)) {
    const items = matchedLine[1].trim().split(/\s+/);

    if (parseInt(items[pidIndex], 10) === pid && items[items.length + nameOffset]) {
      return items[items.length + nameOffset];
    }
  }

  _logger.default.debug(stdout);

  throw new Error(`Could not get the process name for PID '${pid}'`);
};

methods.getPIDsByName = async function getPIDsByName(name) {
  _logger.default.debug(`Getting IDs of all '${name}' processes`);

  if (!this.isValidClass(name)) {
    throw new Error(`Invalid process name: '${name}'`);
  }

  if ((await this.getApiLevel()) >= 23) {
    if (!_lodash.default.isBoolean(this._isPgrepAvailable)) {
      const pgrepOutput = _lodash.default.trim(await this.shell(['pgrep --help; echo $?']));

      this._isPgrepAvailable = parseInt(_lodash.default.last(pgrepOutput.split(/\s+/)), 10) === 0;

      if (this._isPgrepAvailable) {
        this._canPgrepUseFullCmdLineSearch = /^-f\b/m.test(pgrepOutput);
      } else {
        this._isPidofAvailable = parseInt(await this.shell(['pidof --help > /dev/null; echo $?']), 10) === 0;
      }
    }

    if (this._isPgrepAvailable || this._isPidofAvailable) {
      const shellCommand = this._isPgrepAvailable ? this._canPgrepUseFullCmdLineSearch ? ['pgrep', '-f', _lodash.default.escapeRegExp(name)] : [`pgrep ^${_lodash.default.escapeRegExp(name.slice(-MAX_PGREP_PATTERN_LEN))}$ || pgrep ^${_lodash.default.escapeRegExp(name.slice(0, MAX_PGREP_PATTERN_LEN))}$`] : ['pgrep', name];

      try {
        return (await this.shell(shellCommand)).split(" 5037")[0].split(/\s+/).map(x => parseInt(x, 10)).filter(x => _lodash.default.isInteger(x));
      } catch (e) {
        if (e.code === 1) {
          return [];
        }

        throw new Error(`Could not extract process ID of '${name}': ${e.message}`);
      }
    }
  }

  _logger.default.debug('Using ps-based PID detection');

  const stdout = await this.shell(['ps']);
  const titleMatch = PS_TITLE_PATTERN.exec(stdout);

  if (!titleMatch) {
    _logger.default.debug(stdout);

    throw new Error(`Could not extract PID of '${name}' from ps output`);
  }

  const allTitles = titleMatch[1].trim().split(/\s+/);
  const pidIndex = allTitles.indexOf(PID_COLUMN_TITLE);
  const pids = [];
  const processNameRegex = new RegExp(`^(.*\\b\\d+\\b.*\\b${_lodash.default.escapeRegExp(name)}\\b.*)$`, 'gm');
  let matchedLine;

  while (matchedLine = processNameRegex.exec(stdout)) {
    const items = matchedLine[1].trim().split(/\s+/);

    if (pidIndex >= allTitles.length || isNaN(items[pidIndex])) {
      _logger.default.debug(stdout);

      throw new Error(`Could not extract PID of '${name}' from '${matchedLine[1].trim()}'`);
    }

    pids.push(parseInt(items[pidIndex], 10));
  }

  return pids;
};

methods.killProcessesByName = async function killProcessesByName(name) {
  try {
    _logger.default.debug(`Attempting to kill all ${name} processes`);

    const pids = await this.getPIDsByName(name);

    if (_lodash.default.isEmpty(pids)) {
      _logger.default.info(`No '${name}' process has been found`);
    } else {
      await _bluebird.default.all(pids.map(p => this.killProcessByPID(p)));
    }
  } catch (e) {
    throw new Error(`Unable to kill ${name} processes. Original error: ${e.message}`);
  }
};

methods.killProcessByPID = async function killProcessByPID(pid) {
  _logger.default.debug(`Attempting to kill process ${pid}`);

  const noProcessFlag = 'No such process';

  try {
    await this.shell(['kill', pid]);
  } catch (e) {
    if (_lodash.default.includes(e.stderr, noProcessFlag)) {
      return;
    }

    if (!_lodash.default.includes(e.stderr, 'Operation not permitted')) {
      throw e;
    }

    _logger.default.info(`Cannot kill PID ${pid} due to insufficient permissions. Retrying as root`);

    try {
      await this.shell(['kill', pid], {
        privileged: true
      });
    } catch (e1) {
      if (_lodash.default.includes(e1.stderr, noProcessFlag)) {
        return;
      }

      throw e1;
    }
  }
};

methods.broadcastProcessEnd = async function broadcastProcessEnd(intent, processName) {
  this.broadcast(intent);
  let start = Date.now();
  let timeoutMs = 40000;

  try {
    while (Date.now() - start < timeoutMs) {
      if (await this.processExists(processName)) {
        await (0, _asyncbox.sleep)(400);
        continue;
      }

      return;
    }

    throw new Error(`Process never died within ${timeoutMs} ms`);
  } catch (e) {
    throw new Error(`Unable to broadcast process end. Original error: ${e.message}`);
  }
};

methods.broadcast = async function broadcast(intent) {
  if (!this.isValidClass(intent)) {
    throw new Error(`Invalid intent ${intent}`);
  }

  _logger.default.debug(`Broadcasting: ${intent}`);

  await this.shell(['am', 'broadcast', '-a', intent]);
};

methods.endAndroidCoverage = async function endAndroidCoverage() {
  if (this.instrumentProc && this.instrumentProc.isRunning) {
    await this.instrumentProc.stop();
  }
};

methods.instrument = async function instrument(pkg, activity, instrumentWith) {
  if (activity[0] !== '.') {
    pkg = '';
  }

  let pkgActivity = (pkg + activity).replace(/\.+/g, '.');
  let stdout = await this.shell(['am', 'instrument', '-e', 'main_activity', pkgActivity, instrumentWith]);

  if (stdout.indexOf('Exception') !== -1) {
    throw new Error(`Unknown exception during instrumentation. Original error ${stdout.split('\n')[0]}`);
  }
};

methods.androidCoverage = async function androidCoverage(instrumentClass, waitPkg, waitActivity) {
  if (!this.isValidClass(instrumentClass)) {
    throw new Error(`Invalid class ${instrumentClass}`);
  }

  return await new _bluebird.default(async (resolve, reject) => {
    let args = this.executable.defaultArgs.concat(['shell', 'am', 'instrument', '-e', 'coverage', 'true', '-w']).concat([instrumentClass]);

    _logger.default.debug(`Collecting coverage data with: ${[this.executable.path].concat(args).join(' ')}`);

    try {
      this.instrumentProc = new _teen_process.SubProcess(this.executable.path, args);
      await this.instrumentProc.start(0);
      this.instrumentProc.on('output', (stdout, stderr) => {
        if (stderr) {
          reject(new Error(`Failed to run instrumentation. Original error: ${stderr}`));
        }
      });
      await this.waitForActivity(waitPkg, waitActivity);
      resolve();
    } catch (e) {
      reject(new Error(`Android coverage failed. Original error: ${e.message}`));
    }
  });
};

methods.getDeviceProperty = async function getDeviceProperty(property) {
  let stdout = await this.shell(['getprop', property]);
  let val = stdout.trim();

  _logger.default.debug(`Current device property '${property}': ${val}`);

  return val;
};

methods.setDeviceProperty = async function setDeviceProperty(prop, val, opts = {}) {
  const {
    privileged = true
  } = opts;

  _logger.default.debug(`Setting device property '${prop}' to '${val}'`);

  await this.shell(['setprop', prop, val], {
    privileged
  });
};

methods.getDeviceSysLanguage = async function getDeviceSysLanguage() {
  return await this.getDeviceProperty('persist.sys.language');
};

methods.getDeviceSysCountry = async function getDeviceSysCountry() {
  return await this.getDeviceProperty('persist.sys.country');
};

methods.getDeviceSysLocale = async function getDeviceSysLocale() {
  return await this.getDeviceProperty('persist.sys.locale');
};

methods.getDeviceProductLanguage = async function getDeviceProductLanguage() {
  return await this.getDeviceProperty('ro.product.locale.language');
};

methods.getDeviceProductCountry = async function getDeviceProductCountry() {
  return await this.getDeviceProperty('ro.product.locale.region');
};

methods.getDeviceProductLocale = async function getDeviceProductLocale() {
  return await this.getDeviceProperty('ro.product.locale');
};

methods.getModel = async function getModel() {
  return await this.getDeviceProperty('ro.product.model');
};

methods.getManufacturer = async function getManufacturer() {
  return await this.getDeviceProperty('ro.product.manufacturer');
};

methods.getScreenSize = async function getScreenSize() {
  let stdout = await this.shell(['wm', 'size']);
  let size = new RegExp(/Physical size: ([^\r?\n]+)*/g).exec(stdout);

  if (size && size.length >= 2) {
    return size[1].trim();
  }

  return null;
};

methods.getScreenDensity = async function getScreenDensity() {
  let stdout = await this.shell(['wm', 'density']);
  let density = new RegExp(/Physical density: ([^\r?\n]+)*/g).exec(stdout);

  if (density && density.length >= 2) {
    let densityNumber = parseInt(density[1].trim(), 10);
    return isNaN(densityNumber) ? null : densityNumber;
  }

  return null;
};

methods.setHttpProxy = async function setHttpProxy(proxyHost, proxyPort) {
  let proxy = `${proxyHost}:${proxyPort}`;

  if (_lodash.default.isUndefined(proxyHost)) {
    throw new Error(`Call to setHttpProxy method with undefined proxy_host: ${proxy}`);
  }

  if (_lodash.default.isUndefined(proxyPort)) {
    throw new Error(`Call to setHttpProxy method with undefined proxy_port ${proxy}`);
  }

  const httpProxySettins = [['http_proxy', proxy], ['global_http_proxy_host', proxyHost], ['global_http_proxy_port', proxyPort]];

  for (const [settingKey, settingValue] of httpProxySettins) {
    await this.setSetting('global', settingKey, settingValue);
  }
};

methods.deleteHttpProxy = async function deleteHttpProxy() {
  const httpProxySettins = ['http_proxy', 'global_http_proxy_host', 'global_http_proxy_port', 'global_http_proxy_exclusion_list'];

  for (const setting of httpProxySettins) {
    await this.shell(['settings', 'delete', 'global', setting]);
  }
};

methods.setSetting = async function setSetting(namespace, setting, value) {
  return await this.shell(['settings', 'put', namespace, setting, value]);
};

methods.getSetting = async function getSetting(namespace, setting) {
  return await this.shell(['settings', 'get', namespace, setting]);
};

methods.bugreport = async function bugreport(timeout = 120000) {
  return await this.adbExec(['bugreport'], {
    timeout
  });
};

methods.screenrecord = function screenrecord(destination, options = {}) {
  const cmd = ['screenrecord'];
  const {
    videoSize,
    bitRate,
    timeLimit,
    bugReport
  } = options;

  if (_appiumSupport.util.hasValue(videoSize)) {
    cmd.push('--size', videoSize);
  }

  if (_appiumSupport.util.hasValue(timeLimit)) {
    cmd.push('--time-limit', timeLimit);
  }

  if (_appiumSupport.util.hasValue(bitRate)) {
    cmd.push('--bit-rate', bitRate);
  }

  if (bugReport) {
    cmd.push('--bugreport');
  }

  cmd.push(destination);
  const fullCmd = [...this.executable.defaultArgs, 'shell', ...cmd];

  _logger.default.debug(`Building screenrecord process with the command line: adb ${_appiumSupport.util.quote(fullCmd)}`);

  return new _teen_process.SubProcess(this.executable.path, fullCmd);
};

methods.runInImeContext = async function runInImeContext(ime, fn) {
  const originalIme = await this.defaultIME();

  if (originalIme === ime) {
    _logger.default.debug(`The original IME is the same as '${ime}'. There is no need to reset it`);
  } else {
    await this.enableIME(ime);
    await this.setIME(ime);
  }

  try {
    return await fn();
  } finally {
    if (originalIme !== ime) {
      await this.setIME(originalIme);
    }
  }
};

methods.getTimeZone = async function getTimeZone() {
  _logger.default.debug('Getting current timezone');

  try {
    return await this.getDeviceProperty('persist.sys.timezone');
  } catch (e) {
    throw new Error(`Error getting timezone. Original error: ${e.message}`);
  }
};

methods.listFeatures = async function listFeatures() {
  this._memoizedFeatures = this._memoizedFeatures || _lodash.default.memoize(async () => await this.adbExec(['features']), () => this.curDeviceId);

  try {
    return (await this._memoizedFeatures()).split(/\s+/).map(x => x.trim()).filter(Boolean);
  } catch (e) {
    if (_lodash.default.includes(e.stderr, 'unknown command')) {
      return [];
    }

    throw e;
  }
};

methods.isStreamedInstallSupported = async function isStreamedInstallSupported() {
  const proto = Object.getPrototypeOf(this);
  proto._helpOutput = proto._helpOutput || (await this.adbExec(['help']));
  return proto._helpOutput.includes('--streaming') && (await this.listFeatures()).includes('cmd');
};

methods.isIncrementalInstallSupported = async function isIncrementalInstallSupported() {
  const {
    binary
  } = await this.getVersion();

  if (!binary) {
    return false;
  }

  return _appiumSupport.util.compareVersions(binary.version, '>=', '30.0.1') && (await this.listFeatures()).includes('abb_exec');
};

var _default = methods;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi90b29scy9hZGItY29tbWFuZHMuanMiXSwibmFtZXMiOlsiTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEgiLCJOT1RfQ0hBTkdFQUJMRV9QRVJNX0VSUk9SIiwiSUdOT1JFRF9QRVJNX0VSUk9SUyIsIk1BWF9QR1JFUF9QQVRURVJOX0xFTiIsIkhJRERFTl9BUElfUE9MSUNZX0tFWVMiLCJQSURfQ09MVU1OX1RJVExFIiwiUFJPQ0VTU19OQU1FX0NPTFVNTl9USVRMRSIsIlBTX1RJVExFX1BBVFRFUk4iLCJSZWdFeHAiLCJtZXRob2RzIiwiZ2V0QWRiV2l0aENvcnJlY3RBZGJQYXRoIiwiZXhlY3V0YWJsZSIsInBhdGgiLCJnZXRTZGtCaW5hcnlQYXRoIiwiYWRiIiwiaW5pdEFhcHQiLCJpbml0QWFwdDIiLCJpbml0WmlwQWxpZ24iLCJpbml0QnVuZGxldG9vbCIsImJpbmFyaWVzIiwiYnVuZGxldG9vbCIsImZzIiwid2hpY2giLCJlcnIiLCJFcnJvciIsImdldEFwaUxldmVsIiwiXyIsImlzSW50ZWdlciIsIl9hcGlMZXZlbCIsInN0ck91dHB1dCIsImdldERldmljZVByb3BlcnR5IiwiYXBpTGV2ZWwiLCJwYXJzZUludCIsInRyaW0iLCJjaGFyQ29kZVEiLCJjaGFyQ29kZUF0IiwiYXBpTGV2ZWxEaWZmIiwiY29kZW5hbWUiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJnZXRQbGF0Zm9ybVZlcnNpb24iLCJ0b0xvd2VyQ2FzZSIsImxvZyIsImRlYnVnIiwidG9VcHBlckNhc2UiLCJpc05hTiIsImUiLCJtZXNzYWdlIiwiaW5mbyIsImlzRGV2aWNlQ29ubmVjdGVkIiwiZGV2aWNlcyIsImdldENvbm5lY3RlZERldmljZXMiLCJsZW5ndGgiLCJta2RpciIsInJlbW90ZVBhdGgiLCJzaGVsbCIsImlzVmFsaWRDbGFzcyIsImNsYXNzU3RyaW5nIiwiZXhlYyIsImZvcmNlU3RvcCIsInBrZyIsImtpbGxQYWNrYWdlIiwiY2xlYXIiLCJncmFudEFsbFBlcm1pc3Npb25zIiwiYXBrIiwidGFyZ2V0U2RrIiwiZHVtcHN5c091dHB1dCIsInRhcmdldFNka1ZlcnNpb25Vc2luZ1BLRyIsInRhcmdldFNka1ZlcnNpb25Gcm9tTWFuaWZlc3QiLCJ3YXJuIiwicmVxdWVzdGVkUGVybWlzc2lvbnMiLCJnZXRSZXFQZXJtaXNzaW9ucyIsImdyYW50ZWRQZXJtaXNzaW9ucyIsImdldEdyYW50ZWRQZXJtaXNzaW9ucyIsInBlcm1pc3Npb25zVG9HcmFudCIsImRpZmZlcmVuY2UiLCJpc0VtcHR5IiwiZ3JhbnRQZXJtaXNzaW9ucyIsInBlcm1pc3Npb25zIiwiSlNPTiIsInN0cmluZ2lmeSIsImNvbW1hbmRzIiwiY21kQ2h1bmsiLCJwZXJtaXNzaW9uIiwibmV4dENtZCIsImpvaW4iLCJwdXNoIiwibGFzdEVycm9yIiwiY21kIiwic29tZSIsIm1zZ1JlZ2V4IiwidGVzdCIsInN0ZGVyciIsImdyYW50UGVybWlzc2lvbiIsInJldm9rZVBlcm1pc3Npb24iLCJjbWRPdXRwdXQiLCJzdGRvdXQiLCJnZXREZW5pZWRQZXJtaXNzaW9ucyIsImdldExvY2F0aW9uUHJvdmlkZXJzIiwiZ2V0U2V0dGluZyIsInNwbGl0IiwibWFwIiwicCIsImZpbHRlciIsIkJvb2xlYW4iLCJ0b2dnbGVHUFNMb2NhdGlvblByb3ZpZGVyIiwiZW5hYmxlZCIsInNldFNldHRpbmciLCJzZXRIaWRkZW5BcGlQb2xpY3kiLCJ2YWx1ZSIsImlnbm9yZUVycm9yIiwiayIsInNldERlZmF1bHRIaWRkZW5BcGlQb2xpY3kiLCJzdG9wQW5kQ2xlYXIiLCJhdmFpbGFibGVJTUVzIiwiZW5hYmxlZElNRXMiLCJlbmFibGVJTUUiLCJpbWVJZCIsImRpc2FibGVJTUUiLCJzZXRJTUUiLCJkZWZhdWx0SU1FIiwiZW5naW5lIiwia2V5ZXZlbnQiLCJrZXljb2RlIiwiY29kZSIsImlucHV0VGV4dCIsInRleHQiLCJyZXBsYWNlIiwiY2xlYXJUZXh0RmllbGQiLCJhcmdzIiwiaSIsImxvY2siLCJpc1NjcmVlbkxvY2tlZCIsInRpbWVvdXRNcyIsIndhaXRNcyIsImludGVydmFsTXMiLCJiYWNrIiwiZ29Ub0hvbWUiLCJnZXRBZGJQYXRoIiwiZ2V0U2NyZWVuT3JpZW50YXRpb24iLCJwcm9jZXNzIiwiZW52IiwiQVBQSVVNX0xPR19EVU1QU1lTIiwiZHVtcHN5c0ZpbGUiLCJyZXNvbHZlIiwiY3dkIiwid3JpdGVGaWxlIiwiaXNTb2Z0S2V5Ym9hcmRQcmVzZW50IiwiaW5wdXRTaG93bk1hdGNoIiwiaW5wdXRWaWV3U2hvd25NYXRjaCIsImlzS2V5Ym9hcmRTaG93biIsImNhbkNsb3NlS2V5Ym9hcmQiLCJzZW5kVGVsbmV0Q29tbWFuZCIsImNvbW1hbmQiLCJleGVjRW11Q29uc29sZUNvbW1hbmQiLCJwb3J0IiwiZ2V0RW11bGF0b3JQb3J0IiwiaXNBaXJwbGFuZU1vZGVPbiIsInNldEFpcnBsYW5lTW9kZSIsIm9uIiwiYnJvYWRjYXN0QWlycGxhbmVNb2RlIiwiaXNXaWZpT24iLCJpc0RhdGFPbiIsInNldFdpZmlBbmREYXRhIiwid2lmaSIsImRhdGEiLCJpc0VtdWxhdG9yIiwidXRpbCIsImhhc1ZhbHVlIiwic2V0V2lmaVN0YXRlIiwic2V0RGF0YVN0YXRlIiwiaXNBbmltYXRpb25PbiIsImFuaW1hdG9yX2R1cmF0aW9uX3NjYWxlIiwidHJhbnNpdGlvbl9hbmltYXRpb25fc2NhbGUiLCJ3aW5kb3dfYW5pbWF0aW9uX3NjYWxlIiwic2V0dGluZyIsInJpbXJhZiIsImxvY2FsUGF0aCIsIm9wdHMiLCJwb3NpeCIsImRpcm5hbWUiLCJhZGJFeGVjIiwicHVsbCIsInRpbWVvdXQiLCJwcm9jZXNzRXhpc3RzIiwicHJvY2Vzc05hbWUiLCJnZXRQSURzQnlOYW1lIiwiZ2V0Rm9yd2FyZExpc3QiLCJjb25uZWN0aW9ucyIsIkVPTCIsImxpbmUiLCJmb3J3YXJkUG9ydCIsInN5c3RlbVBvcnQiLCJkZXZpY2VQb3J0IiwicmVtb3ZlUG9ydEZvcndhcmQiLCJnZXRSZXZlcnNlTGlzdCIsInJldmVyc2VQb3J0IiwicmVtb3ZlUG9ydFJldmVyc2UiLCJmb3J3YXJkQWJzdHJhY3RQb3J0IiwicGluZyIsImluZGV4T2YiLCJyZXN0YXJ0Iiwic3RvcExvZ2NhdCIsInJlc3RhcnRBZGIiLCJ3YWl0Rm9yRGV2aWNlIiwic3RhcnRMb2djYXQiLCJfbG9nY2F0U3RhcnR1cFBhcmFtcyIsImxvZ2NhdCIsIkxvZ2NhdCIsImRlYnVnVHJhY2UiLCJjbGVhckRldmljZUxvZ3NPblN0YXJ0Iiwic3RhcnRDYXB0dXJlIiwic3RvcENhcHR1cmUiLCJnZXRMb2djYXRMb2dzIiwiZ2V0TG9ncyIsInNldExvZ2NhdExpc3RlbmVyIiwibGlzdGVuZXIiLCJyZW1vdmVMb2djYXRMaXN0ZW5lciIsInJlbW92ZUxpc3RlbmVyIiwiZ2V0TmFtZUJ5UGlkIiwicGlkIiwidGl0bGVNYXRjaCIsImFsbFRpdGxlcyIsInBpZEluZGV4IiwibmFtZU9mZnNldCIsInBpZFJlZ2V4IiwibWF0Y2hlZExpbmUiLCJpdGVtcyIsIm5hbWUiLCJpc0Jvb2xlYW4iLCJfaXNQZ3JlcEF2YWlsYWJsZSIsInBncmVwT3V0cHV0IiwibGFzdCIsIl9jYW5QZ3JlcFVzZUZ1bGxDbWRMaW5lU2VhcmNoIiwiX2lzUGlkb2ZBdmFpbGFibGUiLCJzaGVsbENvbW1hbmQiLCJlc2NhcGVSZWdFeHAiLCJzbGljZSIsIngiLCJwaWRzIiwicHJvY2Vzc05hbWVSZWdleCIsImtpbGxQcm9jZXNzZXNCeU5hbWUiLCJCIiwiYWxsIiwia2lsbFByb2Nlc3NCeVBJRCIsIm5vUHJvY2Vzc0ZsYWciLCJpbmNsdWRlcyIsInByaXZpbGVnZWQiLCJlMSIsImJyb2FkY2FzdFByb2Nlc3NFbmQiLCJpbnRlbnQiLCJicm9hZGNhc3QiLCJzdGFydCIsIkRhdGUiLCJub3ciLCJlbmRBbmRyb2lkQ292ZXJhZ2UiLCJpbnN0cnVtZW50UHJvYyIsImlzUnVubmluZyIsInN0b3AiLCJpbnN0cnVtZW50IiwiYWN0aXZpdHkiLCJpbnN0cnVtZW50V2l0aCIsInBrZ0FjdGl2aXR5IiwiYW5kcm9pZENvdmVyYWdlIiwiaW5zdHJ1bWVudENsYXNzIiwid2FpdFBrZyIsIndhaXRBY3Rpdml0eSIsInJlamVjdCIsImRlZmF1bHRBcmdzIiwiY29uY2F0IiwiU3ViUHJvY2VzcyIsIndhaXRGb3JBY3Rpdml0eSIsInByb3BlcnR5IiwidmFsIiwic2V0RGV2aWNlUHJvcGVydHkiLCJwcm9wIiwiZ2V0RGV2aWNlU3lzTGFuZ3VhZ2UiLCJnZXREZXZpY2VTeXNDb3VudHJ5IiwiZ2V0RGV2aWNlU3lzTG9jYWxlIiwiZ2V0RGV2aWNlUHJvZHVjdExhbmd1YWdlIiwiZ2V0RGV2aWNlUHJvZHVjdENvdW50cnkiLCJnZXREZXZpY2VQcm9kdWN0TG9jYWxlIiwiZ2V0TW9kZWwiLCJnZXRNYW51ZmFjdHVyZXIiLCJnZXRTY3JlZW5TaXplIiwic2l6ZSIsImdldFNjcmVlbkRlbnNpdHkiLCJkZW5zaXR5IiwiZGVuc2l0eU51bWJlciIsInNldEh0dHBQcm94eSIsInByb3h5SG9zdCIsInByb3h5UG9ydCIsInByb3h5IiwiaXNVbmRlZmluZWQiLCJodHRwUHJveHlTZXR0aW5zIiwic2V0dGluZ0tleSIsInNldHRpbmdWYWx1ZSIsImRlbGV0ZUh0dHBQcm94eSIsIm5hbWVzcGFjZSIsImJ1Z3JlcG9ydCIsInNjcmVlbnJlY29yZCIsImRlc3RpbmF0aW9uIiwib3B0aW9ucyIsInZpZGVvU2l6ZSIsImJpdFJhdGUiLCJ0aW1lTGltaXQiLCJidWdSZXBvcnQiLCJmdWxsQ21kIiwicXVvdGUiLCJydW5JbkltZUNvbnRleHQiLCJpbWUiLCJmbiIsIm9yaWdpbmFsSW1lIiwiZ2V0VGltZVpvbmUiLCJsaXN0RmVhdHVyZXMiLCJfbWVtb2l6ZWRGZWF0dXJlcyIsIm1lbW9pemUiLCJjdXJEZXZpY2VJZCIsImlzU3RyZWFtZWRJbnN0YWxsU3VwcG9ydGVkIiwicHJvdG8iLCJPYmplY3QiLCJnZXRQcm90b3R5cGVPZiIsIl9oZWxwT3V0cHV0IiwiaXNJbmNyZW1lbnRhbEluc3RhbGxTdXBwb3J0ZWQiLCJiaW5hcnkiLCJnZXRWZXJzaW9uIiwiY29tcGFyZVZlcnNpb25zIiwi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QU8xRCxDQUFQLEVBQVU7QUFDVixRQUFJcEIsZ0JBQUU0TixRQUFGLENBQVd4TSxDQUFDLENBQUM4QyxNQUFiLEVBQXFCLGlCQUFyQixDQUFKLEVBQTZDO0FBQzNDLGFBQU8sRUFBUDtBQUNEOztBQUNELFVBQU05QyxDQUFOO0FBQ0Q7QUFDRixDQWREOztBQTZCQXJDLE9BQU8sQ0FBQ3FULDBCQUFSLEdBQXFDLGVBQWVBLDBCQUFmLEdBQTZDO0FBQ2hGLFFBQU1DLEtBQUssR0FBR0MsTUFBTSxDQUFDQyxjQUFQLENBQXNCLElBQXRCLENBQWQ7QUFDQUYsRUFBQUEsS0FBSyxDQUFDRyxXQUFOLEdBQW9CSCxLQUFLLENBQUNHLFdBQU4sS0FBcUIsTUFBTSxLQUFLN0ksT0FBTCxDQUFhLENBQUMsTUFBRCxDQUFiLENBQTNCLENBQXBCO0FBQ0EsU0FBTzBJLEtBQUssQ0FBQ0csV0FBTixDQUFrQjVFLFFBQWxCLENBQTJCLGFBQTNCLEtBQ0YsQ0FBQyxNQUFNLEtBQUtvRSxZQUFMLEVBQVAsRUFBNEJwRSxRQUE1QixDQUFxQyxLQUFyQyxDQURMO0FBRUQsQ0FMRDs7QUFlQTdPLE9BQU8sQ0FBQzBULDZCQUFSLEdBQXdDLGVBQWVBLDZCQUFmLEdBQWdEO0FBQ3RGLFFBQU07QUFBQ0MsSUFBQUE7QUFBRCxNQUFXLE1BQU0sS0FBS0MsVUFBTCxFQUF2Qjs7QUFDQSxNQUFJLENBQUNELE1BQUwsRUFBYTtBQUNYLFdBQU8sS0FBUDtBQUNEOztBQUNELFNBQU83SixvQkFBSytKLGVBQUwsQ0FBcUJGLE1BQU0sQ0FBQ0csT0FBNUIsRUFBcUMsSUFBckMsRUFBMkMsUUFBM0MsS0FDRixDQUFDLE1BQU0sS0FBS2IsWUFBTCxFQUFQLEVBQTRCcEUsUUFBNUIsQ0FBcUMsVUFBckMsQ0FETDtBQUVELENBUEQ7O2VBU2U3TyxPIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGxvZyBmcm9tICcuLi9sb2dnZXIuanMnO1xuaW1wb3J0IHtcbiAgZ2V0SU1FTGlzdEZyb21PdXRwdXQsIGlzU2hvd2luZ0xvY2tzY3JlZW4sIGlzQ3VycmVudEZvY3VzT25LZXlndWFyZCxcbiAgZ2V0U3VyZmFjZU9yaWVudGF0aW9uLCBpc1NjcmVlbk9uRnVsbHksIGV4dHJhY3RNYXRjaGluZ1Blcm1pc3Npb25zLFxufSBmcm9tICcuLi9oZWxwZXJzLmpzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB7IGZzLCB1dGlsIH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xuaW1wb3J0IHsgRU9MIH0gZnJvbSAnb3MnO1xuaW1wb3J0IExvZ2NhdCBmcm9tICcuLi9sb2djYXQnO1xuaW1wb3J0IHsgc2xlZXAsIHdhaXRGb3JDb25kaXRpb24gfSBmcm9tICdhc3luY2JveCc7XG5pbXBvcnQgeyBTdWJQcm9jZXNzIH0gZnJvbSAndGVlbl9wcm9jZXNzJztcbmltcG9ydCBCIGZyb20gJ2JsdWViaXJkJztcblxuY29uc3QgTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEggPSAxMDAwO1xuY29uc3QgTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUiA9IC9ub3QgYSBjaGFuZ2VhYmxlIHBlcm1pc3Npb24gdHlwZS9pO1xuY29uc3QgSUdOT1JFRF9QRVJNX0VSUk9SUyA9IFtcbiAgTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUixcbiAgL1Vua25vd24gcGVybWlzc2lvbi9pLFxuXTtcbmNvbnN0IE1BWF9QR1JFUF9QQVRURVJOX0xFTiA9IDE1O1xuY29uc3QgSElEREVOX0FQSV9QT0xJQ1lfS0VZUyA9IFtcbiAgJ2hpZGRlbl9hcGlfcG9saWN5X3ByZV9wX2FwcHMnLFxuICAnaGlkZGVuX2FwaV9wb2xpY3lfcF9hcHBzJyxcbiAgJ2hpZGRlbl9hcGlfcG9saWN5J1xuXTtcbmNvbnN0IFBJRF9DT0xVTU5fVElUTEUgPSAnUElEJztcbmNvbnN0IFBST0NFU1NfTkFNRV9DT0xVTU5fVElUTEUgPSAnTkFNRSc7XG5jb25zdCBQU19USVRMRV9QQVRURVJOID0gbmV3IFJlZ0V4cChgXiguKlxcXFxiJHtQSURfQ09MVU1OX1RJVExFfVxcXFxiLipcXFxcYiR7UFJPQ0VTU19OQU1FX0NPTFVNTl9USVRMRX1cXFxcYi4qKSRgLCAnbScpO1xuXG5cbmxldCBtZXRob2RzID0ge307XG5cbi8qKlxuICogR2V0IHRoZSBwYXRoIHRvIGFkYiBleGVjdXRhYmxlIGFtZCBhc3NpZ24gaXRcbiAqIHRvIHRoaXMuZXhlY3V0YWJsZS5wYXRoIGFuZCB0aGlzLmJpbmFyaWVzLmFkYiBwcm9wZXJ0aWVzLlxuICpcbiAqIEByZXR1cm4ge0FEQn0gQURCIGluc3RhbmNlLlxuICovXG5tZXRob2RzLmdldEFkYldpdGhDb3JyZWN0QWRiUGF0aCA9IGFzeW5jIGZ1bmN0aW9uIGdldEFkYldpdGhDb3JyZWN0QWRiUGF0aCAoKSB7XG4gIHRoaXMuZXhlY3V0YWJsZS5wYXRoID0gYXdhaXQgdGhpcy5nZXRTZGtCaW5hcnlQYXRoKCdhZGInKTtcbiAgcmV0dXJuIHRoaXMuYWRiO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGZ1bGwgcGF0aCB0byBhYXB0IHRvb2wgYW5kIGFzc2lnbiBpdCB0b1xuICogdGhpcy5iaW5hcmllcy5hYXB0IHByb3BlcnR5XG4gKi9cbm1ldGhvZHMuaW5pdEFhcHQgPSBhc3luYyBmdW5jdGlvbiBpbml0QWFwdCAoKSB7XG4gIGF3YWl0IHRoaXMuZ2V0U2RrQmluYXJ5UGF0aCgnYWFwdCcpO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGZ1bGwgcGF0aCB0byBhYXB0MiB0b29sIGFuZCBhc3NpZ24gaXQgdG9cbiAqIHRoaXMuYmluYXJpZXMuYWFwdDIgcHJvcGVydHlcbiAqL1xubWV0aG9kcy5pbml0QWFwdDIgPSBhc3luYyBmdW5jdGlvbiBpbml0QWFwdDIgKCkge1xuICBhd2FpdCB0aGlzLmdldFNka0JpbmFyeVBhdGgoJ2FhcHQyJyk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgZnVsbCBwYXRoIHRvIHppcGFsaWduIHRvb2wgYW5kIGFzc2lnbiBpdCB0b1xuICogdGhpcy5iaW5hcmllcy56aXBhbGlnbiBwcm9wZXJ0eVxuICovXG5tZXRob2RzLmluaXRaaXBBbGlnbiA9IGFzeW5jIGZ1bmN0aW9uIGluaXRaaXBBbGlnbiAoKSB7XG4gIGF3YWl0IHRoaXMuZ2V0U2RrQmluYXJ5UGF0aCgnemlwYWxpZ24nKTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBmdWxsIHBhdGggdG8gYnVuZGxldG9vbCBiaW5hcnkgYW5kIGFzc2lnbiBpdCB0b1xuICogdGhpcy5iaW5hcmllcy5idW5kbGV0b29sIHByb3BlcnR5XG4gKi9cbm1ldGhvZHMuaW5pdEJ1bmRsZXRvb2wgPSBhc3luYyBmdW5jdGlvbiBpbml0QnVuZGxldG9vbCAoKSB7XG4gIHRyeSB7XG4gICAgdGhpcy5iaW5hcmllcy5idW5kbGV0b29sID0gYXdhaXQgZnMud2hpY2goJ2J1bmRsZXRvb2wuamFyJyk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignYnVuZGxldG9vbC5qYXIgYmluYXJ5IGlzIGV4cGVjdGVkIHRvIGJlIHByZXNlbnQgaW4gUEFUSC4gJyArXG4gICAgICAnVmlzaXQgaHR0cHM6Ly9naXRodWIuY29tL2dvb2dsZS9idW5kbGV0b29sIGZvciBtb3JlIGRldGFpbHMuJyk7XG4gIH1cbn07XG5cbi8qKlxuICogUmV0cmlldmUgdGhlIEFQSSBsZXZlbCBvZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7bnVtYmVyfSBUaGUgQVBJIGxldmVsIGFzIGludGVnZXIgbnVtYmVyLCBmb3IgZXhhbXBsZSAyMSBmb3JcbiAqICAgICAgICAgICAgICAgICAgQW5kcm9pZCBMb2xsaXBvcC4gVGhlIHJlc3VsdCBvZiB0aGlzIG1ldGhvZCBpcyBjYWNoZWQsIHNvIGFsbCB0aGUgZnVydGhlclxuICogY2FsbHMgcmV0dXJuIHRoZSBzYW1lIHZhbHVlIGFzIHRoZSBmaXJzdCBvbmUuXG4gKi9cbm1ldGhvZHMuZ2V0QXBpTGV2ZWwgPSBhc3luYyBmdW5jdGlvbiBnZXRBcGlMZXZlbCAoKSB7XG4gIGlmICghXy5pc0ludGVnZXIodGhpcy5fYXBpTGV2ZWwpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0ck91dHB1dCA9IGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLmJ1aWxkLnZlcnNpb24uc2RrJyk7XG4gICAgICBsZXQgYXBpTGV2ZWwgPSBwYXJzZUludChzdHJPdXRwdXQudHJpbSgpLCAxMCk7XG5cbiAgICAgIC8vIFdvcmthcm91bmQgZm9yIHByZXZpZXcvYmV0YSBwbGF0Zm9ybSBBUEkgbGV2ZWxcbiAgICAgIGNvbnN0IGNoYXJDb2RlUSA9ICdxJy5jaGFyQ29kZUF0KDApO1xuICAgICAgLy8gMjggaXMgdGhlIGZpcnN0IEFQSSBMZXZlbCwgd2hlcmUgQW5kcm9pZCBTREsgc3RhcnRlZCByZXR1cm5pbmcgbGV0dGVycyBpbiByZXNwb25zZSB0byBnZXRQbGF0Zm9ybVZlcnNpb25cbiAgICAgIGNvbnN0IGFwaUxldmVsRGlmZiA9IGFwaUxldmVsIC0gMjg7XG4gICAgICBjb25zdCBjb2RlbmFtZSA9IFN0cmluZy5mcm9tQ2hhckNvZGUoY2hhckNvZGVRICsgYXBpTGV2ZWxEaWZmKTtcbiAgICAgIGlmIChhcGlMZXZlbERpZmYgPj0gMCAmJiAoYXdhaXQgdGhpcy5nZXRQbGF0Zm9ybVZlcnNpb24oKSkudG9Mb3dlckNhc2UoKSA9PT0gY29kZW5hbWUpIHtcbiAgICAgICAgbG9nLmRlYnVnKGBSZWxlYXNlIHZlcnNpb24gaXMgJHtjb2RlbmFtZS50b1VwcGVyQ2FzZSgpfSBidXQgZm91bmQgQVBJIExldmVsICR7YXBpTGV2ZWx9LiBTZXR0aW5nIEFQSSBMZXZlbCB0byAke2FwaUxldmVsICsgMX1gKTtcbiAgICAgICAgYXBpTGV2ZWwrKztcbiAgICAgIH1cblxuICAgICAgdGhpcy5fYXBpTGV2ZWwgPSBhcGlMZXZlbDtcbiAgICAgIGxvZy5kZWJ1ZyhgRGV2aWNlIEFQSSBsZXZlbDogJHt0aGlzLl9hcGlMZXZlbH1gKTtcbiAgICAgIGlmIChpc05hTih0aGlzLl9hcGlMZXZlbCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUaGUgYWN0dWFsIG91dHB1dCAnJHtzdHJPdXRwdXR9JyBjYW5ub3QgYmUgY29udmVydGVkIHRvIGFuIGludGVnZXJgKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZGV2aWNlIEFQSSBsZXZlbC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGhpcy5fYXBpTGV2ZWw7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBwbGF0Zm9ybSB2ZXJzaW9uIG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBwbGF0Zm9ybSB2ZXJzaW9uIGFzIGEgc3RyaW5nLCBmb3IgZXhhbXBsZSAnNS4wJyBmb3JcbiAqIEFuZHJvaWQgTG9sbGlwb3AuXG4gKi9cbm1ldGhvZHMuZ2V0UGxhdGZvcm1WZXJzaW9uID0gYXN5bmMgZnVuY3Rpb24gZ2V0UGxhdGZvcm1WZXJzaW9uICgpIHtcbiAgbG9nLmluZm8oJ0dldHRpbmcgZGV2aWNlIHBsYXRmb3JtIHZlcnNpb24nKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8uYnVpbGQudmVyc2lvbi5yZWxlYXNlJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZGV2aWNlIHBsYXRmb3JtIHZlcnNpb24uIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBWZXJpZnkgd2hldGhlciBhIGRldmljZSBpcyBjb25uZWN0ZWQuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiBhdCBsZWFzdCBvbmUgZGV2aWNlIGlzIHZpc2libGUgdG8gYWRiLlxuICovXG5tZXRob2RzLmlzRGV2aWNlQ29ubmVjdGVkID0gYXN5bmMgZnVuY3Rpb24gaXNEZXZpY2VDb25uZWN0ZWQgKCkge1xuICBsZXQgZGV2aWNlcyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGVkRGV2aWNlcygpO1xuICByZXR1cm4gZGV2aWNlcy5sZW5ndGggPiAwO1xufTtcblxuLyoqXG4gKiBSZWN1cnNpdmVseSBjcmVhdGUgYSBuZXcgZm9sZGVyIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSBuZXcgcGF0aCB0byBiZSBjcmVhdGVkLlxuICogQHJldHVybiB7c3RyaW5nfSBta2RpciBjb21tYW5kIG91dHB1dC5cbiAqL1xubWV0aG9kcy5ta2RpciA9IGFzeW5jIGZ1bmN0aW9uIG1rZGlyIChyZW1vdGVQYXRoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnbWtkaXInLCAnLXAnLCByZW1vdGVQYXRoXSk7XG59O1xuXG4vKipcbiAqIFZlcmlmeSB3aGV0aGVyIHRoZSBnaXZlbiBhcmd1bWVudCBpcyBhXG4gKiB2YWxpZCBjbGFzcyBuYW1lLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBjbGFzc1N0cmluZyAtIFRoZSBhY3R1YWwgY2xhc3MgbmFtZSB0byBiZSB2ZXJpZmllZC5cbiAqIEByZXR1cm4gez9BcnJheS48TWF0Y2g+fSBUaGUgcmVzdWx0IG9mIFJlZ2V4cC5leGVjIG9wZXJhdGlvblxuICogICAgICAgICAgICAgICAgICAgICAgICAgIG9yIF9udWxsXyBpZiBubyBtYXRjaGVzIGFyZSBmb3VuZC5cbiAqL1xubWV0aG9kcy5pc1ZhbGlkQ2xhc3MgPSBmdW5jdGlvbiBpc1ZhbGlkQ2xhc3MgKGNsYXNzU3RyaW5nKSB7XG4gIC8vIHNvbWUucGFja2FnZS9zb21lLnBhY2thZ2UuQWN0aXZpdHlcbiAgcmV0dXJuIG5ldyBSZWdFeHAoL15bYS16QS1aMC05Li9fXSskLykuZXhlYyhjbGFzc1N0cmluZyk7XG59O1xuXG4vKipcbiAqIEZvcmNlIGFwcGxpY2F0aW9uIHRvIHN0b3Agb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHN0b3BwZWQuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBvdXRwdXQgb2YgdGhlIGNvcnJlc3BvbmRpbmcgYWRiIGNvbW1hbmQuXG4gKi9cbm1ldGhvZHMuZm9yY2VTdG9wID0gYXN5bmMgZnVuY3Rpb24gZm9yY2VTdG9wIChwa2cpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydhbScsICdmb3JjZS1zdG9wJywgcGtnXSk7XG59O1xuXG4vKlxuICogS2lsbCBhcHBsaWNhdGlvblxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHN0b3BwZWQuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBvdXRwdXQgb2YgdGhlIGNvcnJlc3BvbmRpbmcgYWRiIGNvbW1hbmQuXG4gKi9cbm1ldGhvZHMua2lsbFBhY2thZ2UgPSBhc3luYyBmdW5jdGlvbiBraWxsUGFja2FnZSAocGtnKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnYW0nLCAna2lsbCcsIHBrZ10pO1xufTtcblxuLyoqXG4gKiBDbGVhciB0aGUgdXNlciBkYXRhIG9mIHRoZSBwYXJ0aWN1bGFyIGFwcGxpY2F0aW9uIG9uIHRoZSBkZXZpY2VcbiAqIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgY2xlYXJlZC5cbiAqIEByZXR1cm4ge3N0cmluZ30gVGhlIG91dHB1dCBvZiB0aGUgY29ycmVzcG9uZGluZyBhZGIgY29tbWFuZC5cbiAqL1xubWV0aG9kcy5jbGVhciA9IGFzeW5jIGZ1bmN0aW9uIGNsZWFyIChwa2cpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdjbGVhcicsIHBrZ10pO1xufTtcblxuLyoqXG4gKiBHcmFudCBhbGwgcGVybWlzc2lvbnMgcmVxdWVzdGVkIGJ5IHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKiBUaGlzIG1ldGhvZCBpcyBvbmx5IHVzZWZ1bCBvbiBBbmRyb2lkIDYuMCsgYW5kIGZvciBhcHBsaWNhdGlvbnNcbiAqIHRoYXQgc3VwcG9ydCBjb21wb25lbnRzLWJhc2VkIHBlcm1pc3Npb25zIHNldHRpbmcuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGFwayAtIFRoZSBwYXRoIHRvIHRoZSBhY3R1YWwgYXBrIGZpbGUuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGdyYW50aW5nIHBlcm1pc3Npb25zXG4gKi9cbm1ldGhvZHMuZ3JhbnRBbGxQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdyYW50QWxsUGVybWlzc2lvbnMgKHBrZywgYXBrKSB7XG4gIGNvbnN0IGFwaUxldmVsID0gYXdhaXQgdGhpcy5nZXRBcGlMZXZlbCgpO1xuICBsZXQgdGFyZ2V0U2RrID0gMDtcbiAgbGV0IGR1bXBzeXNPdXRwdXQgPSBudWxsO1xuICB0cnkge1xuICAgIGlmICghYXBrKSB7XG4gICAgICAvKipcbiAgICAgICAqIElmIGFwayBub3QgcHJvdmlkZWQsIGNvbnNpZGVyaW5nIGFwayBhbHJlYWR5IGluc3RhbGxlZCBvbiB0aGUgZGV2aWNlXG4gICAgICAgKiBhbmQgZmV0Y2hpbmcgdGFyZ2V0U2RrIHVzaW5nIHBhY2thZ2UgbmFtZS5cbiAgICAgICAqL1xuICAgICAgZHVtcHN5c091dHB1dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ3BhY2thZ2UnLCBwa2ddKTtcbiAgICAgIHRhcmdldFNkayA9IGF3YWl0IHRoaXMudGFyZ2V0U2RrVmVyc2lvblVzaW5nUEtHKHBrZywgZHVtcHN5c091dHB1dCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhcmdldFNkayA9IGF3YWl0IHRoaXMudGFyZ2V0U2RrVmVyc2lvbkZyb21NYW5pZmVzdChhcGspO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIC8vYXZvaWRpbmcgbG9nZ2luZyBlcnJvciBzdGFjaywgYXMgY2FsbGluZyBsaWJyYXJ5IGZ1bmN0aW9uIHdvdWxkIGhhdmUgbG9nZ2VkXG4gICAgbG9nLndhcm4oYFJhbiBpbnRvIHByb2JsZW0gZ2V0dGluZyB0YXJnZXQgU0RLIHZlcnNpb247IGlnbm9yaW5nLi4uYCk7XG4gIH1cbiAgaWYgKGFwaUxldmVsID49IDIzICYmIHRhcmdldFNkayA+PSAyMykge1xuICAgIC8qKlxuICAgICAqIElmIHRoZSBkZXZpY2UgaXMgcnVubmluZyBBbmRyb2lkIDYuMChBUEkgMjMpIG9yIGhpZ2hlciwgYW5kIHlvdXIgYXBwJ3MgdGFyZ2V0IFNESyBpcyAyMyBvciBoaWdoZXI6XG4gICAgICogVGhlIGFwcCBoYXMgdG8gbGlzdCB0aGUgcGVybWlzc2lvbnMgaW4gdGhlIG1hbmlmZXN0LlxuICAgICAqIHJlZmVyOiBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS90cmFpbmluZy9wZXJtaXNzaW9ucy9yZXF1ZXN0aW5nLmh0bWxcbiAgICAgKi9cbiAgICBkdW1wc3lzT3V0cHV0ID0gZHVtcHN5c091dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gICAgY29uc3QgcmVxdWVzdGVkUGVybWlzc2lvbnMgPSBhd2FpdCB0aGlzLmdldFJlcVBlcm1pc3Npb25zKHBrZywgZHVtcHN5c091dHB1dCk7XG4gICAgY29uc3QgZ3JhbnRlZFBlcm1pc3Npb25zID0gYXdhaXQgdGhpcy5nZXRHcmFudGVkUGVybWlzc2lvbnMocGtnLCBkdW1wc3lzT3V0cHV0KTtcbiAgICBjb25zdCBwZXJtaXNzaW9uc1RvR3JhbnQgPSBfLmRpZmZlcmVuY2UocmVxdWVzdGVkUGVybWlzc2lvbnMsIGdyYW50ZWRQZXJtaXNzaW9ucyk7XG4gICAgaWYgKF8uaXNFbXB0eShwZXJtaXNzaW9uc1RvR3JhbnQpKSB7XG4gICAgICBsb2cuaW5mbyhgJHtwa2d9IGNvbnRhaW5zIG5vIHBlcm1pc3Npb25zIGF2YWlsYWJsZSBmb3IgZ3JhbnRpbmdgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5ncmFudFBlcm1pc3Npb25zKHBrZywgcGVybWlzc2lvbnNUb0dyYW50KTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogR3JhbnQgbXVsdGlwbGUgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKiBUaGlzIGNhbGwgaXMgbW9yZSBwZXJmb3JtYW50IHRoYW4gYGdyYW50UGVybWlzc2lvbmAgb25lLCBzaW5jZSBpdCBjb21iaW5lc1xuICogbXVsdGlwbGUgYGFkYiBzaGVsbGAgY2FsbHMgaW50byBhIHNpbmdsZSBjb21tYW5kLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gcGVybWlzc2lvbnMgLSBUaGUgbGlzdCBvZiBwZXJtaXNzaW9ucyB0byBiZSBncmFudGVkLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBjaGFuZ2luZyBwZXJtaXNzaW9ucy5cbiAqL1xubWV0aG9kcy5ncmFudFBlcm1pc3Npb25zID0gYXN5bmMgZnVuY3Rpb24gZ3JhbnRQZXJtaXNzaW9ucyAocGtnLCBwZXJtaXNzaW9ucykge1xuICAvLyBBcyBpdCBjb25zdW1lcyBtb3JlIHRpbWUgZm9yIGdyYW50aW5nIGVhY2ggcGVybWlzc2lvbixcbiAgLy8gdHJ5aW5nIHRvIGdyYW50IGFsbCBwZXJtaXNzaW9uIGJ5IGZvcm1pbmcgZXF1aXZhbGVudCBjb21tYW5kLlxuICAvLyBBbHNvLCBpdCBpcyBuZWNlc3NhcnkgdG8gc3BsaXQgbG9uZyBjb21tYW5kcyBpbnRvIGNodW5rcywgc2luY2UgdGhlIG1heGltdW0gbGVuZ3RoIG9mXG4gIC8vIGFkYiBzaGVsbCBidWZmZXIgaXMgbGltaXRlZFxuICBsb2cuZGVidWcoYEdyYW50aW5nIHBlcm1pc3Npb25zICR7SlNPTi5zdHJpbmdpZnkocGVybWlzc2lvbnMpfSB0byAnJHtwa2d9J2ApO1xuICBjb25zdCBjb21tYW5kcyA9IFtdO1xuICBsZXQgY21kQ2h1bmsgPSBbXTtcbiAgZm9yIChjb25zdCBwZXJtaXNzaW9uIG9mIHBlcm1pc3Npb25zKSB7XG4gICAgY29uc3QgbmV4dENtZCA9IFsncG0nLCAnZ3JhbnQnLCBwa2csIHBlcm1pc3Npb24sICc7J107XG4gICAgaWYgKG5leHRDbWQuam9pbignICcpLmxlbmd0aCArIGNtZENodW5rLmpvaW4oJyAnKS5sZW5ndGggPj0gTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEgpIHtcbiAgICAgIGNvbW1hbmRzLnB1c2goY21kQ2h1bmspO1xuICAgICAgY21kQ2h1bmsgPSBbXTtcbiAgICB9XG4gICAgY21kQ2h1bmsgPSBbLi4uY21kQ2h1bmssIC4uLm5leHRDbWRdO1xuICB9XG4gIGlmICghXy5pc0VtcHR5KGNtZENodW5rKSkge1xuICAgIGNvbW1hbmRzLnB1c2goY21kQ2h1bmspO1xuICB9XG4gIGxvZy5kZWJ1ZyhgR290IHRoZSBmb2xsb3dpbmcgY29tbWFuZCBjaHVua3MgdG8gZXhlY3V0ZTogJHtKU09OLnN0cmluZ2lmeShjb21tYW5kcyl9YCk7XG4gIGxldCBsYXN0RXJyb3IgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNtZCBvZiBjb21tYW5kcykge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnNoZWxsKGNtZCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gdGhpcyBpcyB0byBnaXZlIHRoZSBtZXRob2QgYSBjaGFuY2UgdG8gYXNzaWduIGFsbCB0aGUgcmVxdWVzdGVkIHBlcm1pc3Npb25zXG4gICAgICAvLyBiZWZvcmUgdG8gcXVpdCBpbiBjYXNlIHdlJ2QgbGlrZSB0byBpZ25vcmUgdGhlIGVycm9yIG9uIHRoZSBoaWdoZXIgbGV2ZWxcbiAgICAgIGlmICghSUdOT1JFRF9QRVJNX0VSUk9SUy5zb21lKChtc2dSZWdleCkgPT4gbXNnUmVnZXgudGVzdChlLnN0ZGVyciB8fCBlLm1lc3NhZ2UpKSkge1xuICAgICAgICBsYXN0RXJyb3IgPSBlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAobGFzdEVycm9yKSB7XG4gICAgdGhyb3cgbGFzdEVycm9yO1xuICB9XG59O1xuXG4vKipcbiAqIEdyYW50IHNpbmdsZSBwZXJtaXNzaW9uIGZvciB0aGUgcGFydGljdWxhciBwYWNrYWdlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBwZXJtaXNzaW9uIC0gVGhlIGZ1bGwgbmFtZSBvZiB0aGUgcGVybWlzc2lvbiB0byBiZSBncmFudGVkLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBjaGFuZ2luZyBwZXJtaXNzaW9ucy5cbiAqL1xubWV0aG9kcy5ncmFudFBlcm1pc3Npb24gPSBhc3luYyBmdW5jdGlvbiBncmFudFBlcm1pc3Npb24gKHBrZywgcGVybWlzc2lvbikge1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdncmFudCcsIHBrZywgcGVybWlzc2lvbl0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKCFOT1RfQ0hBTkdFQUJMRV9QRVJNX0VSUk9SLnRlc3QoZS5zdGRlcnIgfHwgZS5tZXNzYWdlKSkge1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogUmV2b2tlIHNpbmdsZSBwZXJtaXNzaW9uIGZyb20gdGhlIHBhcnRpY3VsYXIgcGFja2FnZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGtnIC0gVGhlIHBhY2thZ2UgbmFtZSB0byBiZSBwcm9jZXNzZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gcGVybWlzc2lvbiAtIFRoZSBmdWxsIG5hbWUgb2YgdGhlIHBlcm1pc3Npb24gdG8gYmUgcmV2b2tlZC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgY2hhbmdpbmcgcGVybWlzc2lvbnMuXG4gKi9cbm1ldGhvZHMucmV2b2tlUGVybWlzc2lvbiA9IGFzeW5jIGZ1bmN0aW9uIHJldm9rZVBlcm1pc3Npb24gKHBrZywgcGVybWlzc2lvbikge1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdyZXZva2UnLCBwa2csIHBlcm1pc3Npb25dKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmICghTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUi50ZXN0KGUuc3RkZXJyIHx8IGUubWVzc2FnZSkpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGdyYW50ZWQgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGNtZE91dHB1dCBbbnVsbF0gLSBPcHRpb25hbCBwYXJhbWV0ZXIgY29udGFpbmluZyBjb21tYW5kIG91dHB1dCBvZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfZHVtcHN5cyBwYWNrYWdlXyBjb21tYW5kLiBJdCBtYXkgc3BlZWQgdXAgdGhlIG1ldGhvZCBleGVjdXRpb24uXG4gKiBAcmV0dXJuIHtBcnJheTxTdHJpbmc+fSBUaGUgbGlzdCBvZiBncmFudGVkIHBlcm1pc3Npb25zIG9yIGFuIGVtcHR5IGxpc3QuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGNoYW5naW5nIHBlcm1pc3Npb25zLlxuICovXG5tZXRob2RzLmdldEdyYW50ZWRQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdldEdyYW50ZWRQZXJtaXNzaW9ucyAocGtnLCBjbWRPdXRwdXQgPSBudWxsKSB7XG4gIGxvZy5kZWJ1ZygnUmV0cmlldmluZyBncmFudGVkIHBlcm1pc3Npb25zJyk7XG4gIGNvbnN0IHN0ZG91dCA9IGNtZE91dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gIHJldHVybiBleHRyYWN0TWF0Y2hpbmdQZXJtaXNzaW9ucyhzdGRvdXQsIFsnaW5zdGFsbCcsICdydW50aW1lJ10sIHRydWUpO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBkZW5pZWQgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGNtZE91dHB1dCBbbnVsbF0gLSBPcHRpb25hbCBwYXJhbWV0ZXIgY29udGFpbmluZyBjb21tYW5kIG91dHB1dCBvZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfZHVtcHN5cyBwYWNrYWdlXyBjb21tYW5kLiBJdCBtYXkgc3BlZWQgdXAgdGhlIG1ldGhvZCBleGVjdXRpb24uXG4gKiBAcmV0dXJuIHtBcnJheTxTdHJpbmc+fSBUaGUgbGlzdCBvZiBkZW5pZWQgcGVybWlzc2lvbnMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqL1xubWV0aG9kcy5nZXREZW5pZWRQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdldERlbmllZFBlcm1pc3Npb25zIChwa2csIGNtZE91dHB1dCA9IG51bGwpIHtcbiAgbG9nLmRlYnVnKCdSZXRyaWV2aW5nIGRlbmllZCBwZXJtaXNzaW9ucycpO1xuICBjb25zdCBzdGRvdXQgPSBjbWRPdXRwdXQgfHwgYXdhaXQgdGhpcy5zaGVsbChbJ2R1bXBzeXMnLCAncGFja2FnZScsIHBrZ10pO1xuICByZXR1cm4gZXh0cmFjdE1hdGNoaW5nUGVybWlzc2lvbnMoc3Rkb3V0LCBbJ2luc3RhbGwnLCAncnVudGltZSddLCBmYWxzZSk7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIHJlcXVlc3RlZCBwZXJtaXNzaW9ucyBmb3IgdGhlIHBhcnRpY3VsYXIgcGFja2FnZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGtnIC0gVGhlIHBhY2thZ2UgbmFtZSB0byBiZSBwcm9jZXNzZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gY21kT3V0cHV0IFtudWxsXSAtIE9wdGlvbmFsIHBhcmFtZXRlciBjb250YWluaW5nIGNvbW1hbmQgb3V0cHV0IG9mXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9kdW1wc3lzIHBhY2thZ2VfIGNvbW1hbmQuIEl0IG1heSBzcGVlZCB1cCB0aGUgbWV0aG9kIGV4ZWN1dGlvbi5cbiAqIEByZXR1cm4ge0FycmF5PFN0cmluZz59IFRoZSBsaXN0IG9mIHJlcXVlc3RlZCBwZXJtaXNzaW9ucyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmdldFJlcVBlcm1pc3Npb25zID0gYXN5bmMgZnVuY3Rpb24gZ2V0UmVxUGVybWlzc2lvbnMgKHBrZywgY21kT3V0cHV0ID0gbnVsbCkge1xuICBsb2cuZGVidWcoJ1JldHJpZXZpbmcgcmVxdWVzdGVkIHBlcm1pc3Npb25zJyk7XG4gIGNvbnN0IHN0ZG91dCA9IGNtZE91dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gIHJldHVybiBleHRyYWN0TWF0Y2hpbmdQZXJtaXNzaW9ucyhzdGRvdXQsIFsncmVxdWVzdGVkJ10pO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBsb2NhdGlvbiBwcm92aWRlcnMgZm9yIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGxvY2F0aW9uIHByb3ZpZGVycyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmdldExvY2F0aW9uUHJvdmlkZXJzID0gYXN5bmMgZnVuY3Rpb24gZ2V0TG9jYXRpb25Qcm92aWRlcnMgKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdzZWN1cmUnLCAnbG9jYXRpb25fcHJvdmlkZXJzX2FsbG93ZWQnKTtcbiAgcmV0dXJuIHN0ZG91dC50cmltKCkuc3BsaXQoJywnKVxuICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59O1xuXG4vKipcbiAqIFRvZ2dsZSB0aGUgc3RhdGUgb2YgR1BTIGxvY2F0aW9uIHByb3ZpZGVyLlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gZW5hYmxlZCAtIFdoZXRoZXIgdG8gZW5hYmxlICh0cnVlKSBvciBkaXNhYmxlIChmYWxzZSkgdGhlIEdQUyBwcm92aWRlci5cbiAqL1xubWV0aG9kcy50b2dnbGVHUFNMb2NhdGlvblByb3ZpZGVyID0gYXN5bmMgZnVuY3Rpb24gdG9nZ2xlR1BTTG9jYXRpb25Qcm92aWRlciAoZW5hYmxlZCkge1xuICBhd2FpdCB0aGlzLnNldFNldHRpbmcoJ3NlY3VyZScsICdsb2NhdGlvbl9wcm92aWRlcnNfYWxsb3dlZCcsIGAke2VuYWJsZWQgPyAnKycgOiAnLSd9Z3BzYCk7XG59O1xuXG4vKipcbiAqIFNldCBoaWRkZW4gYXBpIHBvbGljeSB0byBtYW5hZ2UgYWNjZXNzIHRvIG5vbi1TREsgQVBJcy5cbiAqIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvcmVzdHJpY3Rpb25zLW5vbi1zZGstaW50ZXJmYWNlc1xuICpcbiAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gdmFsdWUgLSBUaGUgQVBJIGVuZm9yY2VtZW50IHBvbGljeS5cbiAqICAgICBGb3IgQW5kcm9pZCBQXG4gKiAgICAgMDogRGlzYWJsZSBub24tU0RLIEFQSSB1c2FnZSBkZXRlY3Rpb24uIFRoaXMgd2lsbCBhbHNvIGRpc2FibGUgbG9nZ2luZywgYW5kIGFsc28gYnJlYWsgdGhlIHN0cmljdCBtb2RlIEFQSSxcbiAqICAgICAgICBkZXRlY3ROb25TZGtBcGlVc2FnZSgpLiBOb3QgcmVjb21tZW5kZWQuXG4gKiAgICAgMTogXCJKdXN0IHdhcm5cIiAtIHBlcm1pdCBhY2Nlc3MgdG8gYWxsIG5vbi1TREsgQVBJcywgYnV0IGtlZXAgd2FybmluZ3MgaW4gdGhlIGxvZy5cbiAqICAgICAgICBUaGUgc3RyaWN0IG1vZGUgQVBJIHdpbGwga2VlcCB3b3JraW5nLlxuICogICAgIDI6IERpc2FsbG93IHVzYWdlIG9mIGRhcmsgZ3JleSBhbmQgYmxhY2sgbGlzdGVkIEFQSXMuXG4gKiAgICAgMzogRGlzYWxsb3cgdXNhZ2Ugb2YgYmxhY2tsaXN0ZWQgQVBJcywgYnV0IGFsbG93IHVzYWdlIG9mIGRhcmsgZ3JleSBsaXN0ZWQgQVBJcy5cbiAqXG4gKiAgICAgRm9yIEFuZHJvaWQgUVxuICogICAgIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvbm9uLXNkay1xI2VuYWJsZS1ub24tc2RrLWFjY2Vzc1xuICogICAgIDA6IERpc2FibGUgYWxsIGRldGVjdGlvbiBvZiBub24tU0RLIGludGVyZmFjZXMuIFVzaW5nIHRoaXMgc2V0dGluZyBkaXNhYmxlcyBhbGwgbG9nIG1lc3NhZ2VzIGZvciBub24tU0RLIGludGVyZmFjZSB1c2FnZVxuICogICAgICAgIGFuZCBwcmV2ZW50cyB5b3UgZnJvbSB0ZXN0aW5nIHlvdXIgYXBwIHVzaW5nIHRoZSBTdHJpY3RNb2RlIEFQSS4gVGhpcyBzZXR0aW5nIGlzIG5vdCByZWNvbW1lbmRlZC5cbiAqICAgICAxOiBFbmFibGUgYWNjZXNzIHRvIGFsbCBub24tU0RLIGludGVyZmFjZXMsIGJ1dCBwcmludCBsb2cgbWVzc2FnZXMgd2l0aCB3YXJuaW5ncyBmb3IgYW55IG5vbi1TREsgaW50ZXJmYWNlIHVzYWdlLlxuICogICAgICAgIFVzaW5nIHRoaXMgc2V0dGluZyBhbHNvIGFsbG93cyB5b3UgdG8gdGVzdCB5b3VyIGFwcCB1c2luZyB0aGUgU3RyaWN0TW9kZSBBUEkuXG4gKiAgICAgMjogRGlzYWxsb3cgdXNhZ2Ugb2Ygbm9uLVNESyBpbnRlcmZhY2VzIHRoYXQgYmVsb25nIHRvIGVpdGhlciB0aGUgYmxhY2sgbGlzdFxuICogICAgICAgIG9yIHRvIGEgcmVzdHJpY3RlZCBncmV5bGlzdCBmb3IgeW91ciB0YXJnZXQgQVBJIGxldmVsLlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaWdub3JlRXJyb3IgW2ZhbHNlXSBXaGV0aGVyIHRvIGlnbm9yZSBhbiBleGNlcHRpb24gaW4gJ2FkYiBzaGVsbCBzZXR0aW5ncyBwdXQgZ2xvYmFsJyBjb21tYW5kXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIGFuZCBpZ25vcmVFcnJvciB3YXMgdHJ1ZSB3aGlsZSBleGVjdXRpbmcgJ2FkYiBzaGVsbCBzZXR0aW5ncyBwdXQgZ2xvYmFsJ1xuICogICAgICAgICAgICAgICAgIGNvbW1hbmQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLnNldEhpZGRlbkFwaVBvbGljeSA9IGFzeW5jIGZ1bmN0aW9uIHNldEhpZGRlbkFwaVBvbGljeSAodmFsdWUsIGlnbm9yZUVycm9yID0gZmFsc2UpIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCB0aGlzLnNoZWxsKEhJRERFTl9BUElfUE9MSUNZX0tFWVMubWFwKChrKSA9PiBgc2V0dGluZ3MgcHV0IGdsb2JhbCAke2t9ICR7dmFsdWV9YCkuam9pbignOycpKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmICghaWdub3JlRXJyb3IpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICAgIGxvZy5pbmZvKGBGYWlsZWQgdG8gc2V0IHNldHRpbmcga2V5cyAnJHtISURERU5fQVBJX1BPTElDWV9LRVlTfScgdG8gJyR7dmFsdWV9Jy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFJlc2V0IGFjY2VzcyB0byBub24tU0RLIEFQSXMgdG8gaXRzIGRlZmF1bHQgc2V0dGluZy5cbiAqIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvcmVzdHJpY3Rpb25zLW5vbi1zZGstaW50ZXJmYWNlc1xuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaWdub3JlRXJyb3IgW2ZhbHNlXSBXaGV0aGVyIHRvIGlnbm9yZSBhbiBleGNlcHRpb24gaW4gJ2FkYiBzaGVsbCBzZXR0aW5ncyBkZWxldGUgZ2xvYmFsJyBjb21tYW5kXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIGFuZCBpZ25vcmVFcnJvciB3YXMgdHJ1ZSB3aGlsZSBleGVjdXRpbmcgJ2FkYiBzaGVsbCBzZXR0aW5ncyBkZWxldGUgZ2xvYmFsJ1xuICogICAgICAgICAgICAgICAgIGNvbW1hbmQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLnNldERlZmF1bHRIaWRkZW5BcGlQb2xpY3kgPSBhc3luYyBmdW5jdGlvbiBzZXREZWZhdWx0SGlkZGVuQXBpUG9saWN5IChpZ25vcmVFcnJvciA9IGZhbHNlKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChISURERU5fQVBJX1BPTElDWV9LRVlTLm1hcCgoaykgPT4gYHNldHRpbmdzIGRlbGV0ZSBnbG9iYWwgJHtrfWApLmpvaW4oJzsnKSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoIWlnbm9yZUVycm9yKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgICBsb2cuaW5mbyhgRmFpbGVkIHRvIGRlbGV0ZSBrZXlzICcke0hJRERFTl9BUElfUE9MSUNZX0tFWVN9Jy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFN0b3AgdGhlIHBhcnRpY3VsYXIgcGFja2FnZSBpZiBpdCBpcyBydW5uaW5nIGFuZCBjbGVhcnMgaXRzIGFwcGxpY2F0aW9uIGRhdGEuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICovXG5tZXRob2RzLnN0b3BBbmRDbGVhciA9IGFzeW5jIGZ1bmN0aW9uIHN0b3BBbmRDbGVhciAocGtnKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgdGhpcy5mb3JjZVN0b3AocGtnKTtcbiAgICBhd2FpdCB0aGlzLmNsZWFyKHBrZyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzdG9wIGFuZCBjbGVhciAke3BrZ30uIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBhdmFpbGFibGUgaW5wdXQgbWV0aG9kcyAoSU1FcykgZm9yIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIGxpc3Qgb2YgSU1FIG5hbWVzIG9yIGFuIGVtcHR5IGxpc3QuXG4gKi9cbm1ldGhvZHMuYXZhaWxhYmxlSU1FcyA9IGFzeW5jIGZ1bmN0aW9uIGF2YWlsYWJsZUlNRXMgKCkge1xuICB0cnkge1xuICAgIHJldHVybiBnZXRJTUVMaXN0RnJvbU91dHB1dChhd2FpdCB0aGlzLnNoZWxsKFsnaW1lJywgJ2xpc3QnLCAnLWEnXSkpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBnZXR0aW5nIGF2YWlsYWJsZSBJTUUncy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGVuYWJsZWQgaW5wdXQgbWV0aG9kcyAoSU1FcykgZm9yIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIGxpc3Qgb2YgZW5hYmxlZCBJTUUgbmFtZXMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqL1xubWV0aG9kcy5lbmFibGVkSU1FcyA9IGFzeW5jIGZ1bmN0aW9uIGVuYWJsZWRJTUVzICgpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZ2V0SU1FTGlzdEZyb21PdXRwdXQoYXdhaXQgdGhpcy5zaGVsbChbJ2ltZScsICdsaXN0J10pKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZ2V0dGluZyBlbmFibGVkIElNRSdzLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogRW5hYmxlIHRoZSBwYXJ0aWN1bGFyIGlucHV0IG1ldGhvZCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGltZUlkIC0gT25lIG9mIGV4aXN0aW5nIElNRSBpZHMuXG4gKi9cbm1ldGhvZHMuZW5hYmxlSU1FID0gYXN5bmMgZnVuY3Rpb24gZW5hYmxlSU1FIChpbWVJZCkge1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnaW1lJywgJ2VuYWJsZScsIGltZUlkXSk7XG59O1xuXG4vKipcbiAqIERpc2FibGUgdGhlIHBhcnRpY3VsYXIgaW5wdXQgbWV0aG9kIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gaW1lSWQgLSBPbmUgb2YgZXhpc3RpbmcgSU1FIGlkcy5cbiAqL1xubWV0aG9kcy5kaXNhYmxlSU1FID0gYXN5bmMgZnVuY3Rpb24gZGlzYWJsZUlNRSAoaW1lSWQpIHtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ2ltZScsICdkaXNhYmxlJywgaW1lSWRdKTtcbn07XG5cbi8qKlxuICogU2V0IHRoZSBwYXJ0aWN1bGFyIGlucHV0IG1ldGhvZCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGltZUlkIC0gT25lIG9mIGV4aXN0aW5nIElNRSBpZHMuXG4gKi9cbm1ldGhvZHMuc2V0SU1FID0gYXN5bmMgZnVuY3Rpb24gc2V0SU1FIChpbWVJZCkge1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnaW1lJywgJ3NldCcsIGltZUlkXSk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgZGVmYXVsdCBpbnB1dCBtZXRob2Qgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4gez9zdHJpbmd9IFRoZSBuYW1lIG9mIHRoZSBkZWZhdWx0IGlucHV0IG1ldGhvZFxuICovXG5tZXRob2RzLmRlZmF1bHRJTUUgPSBhc3luYyBmdW5jdGlvbiBkZWZhdWx0SU1FICgpIHtcbiAgdHJ5IHtcbiAgICBsZXQgZW5naW5lID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdzZWN1cmUnLCAnZGVmYXVsdF9pbnB1dF9tZXRob2QnKTtcbiAgICBpZiAoZW5naW5lID09PSAnbnVsbCcpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICByZXR1cm4gZW5naW5lLnRyaW0oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZ2V0dGluZyBkZWZhdWx0IElNRS4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFNlbmQgdGhlIHBhcnRpY3VsYXIga2V5Y29kZSB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBrZXljb2RlIC0gVGhlIGFjdHVhbCBrZXkgY29kZSB0byBiZSBzZW50LlxuICovXG5tZXRob2RzLmtleWV2ZW50ID0gYXN5bmMgZnVuY3Rpb24ga2V5ZXZlbnQgKGtleWNvZGUpIHtcbiAgLy8ga2V5Y29kZSBtdXN0IGJlIGFuIGludC5cbiAgbGV0IGNvZGUgPSBwYXJzZUludChrZXljb2RlLCAxMCk7XG4gIGF3YWl0IHRoaXMuc2hlbGwoWydpbnB1dCcsICdrZXlldmVudCcsIGNvZGVdKTtcbn07XG5cbi8qKlxuICogU2VuZCB0aGUgcGFydGljdWxhciB0ZXh0IHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gdGV4dCAtIFRoZSBhY3R1YWwgdGV4dCB0byBiZSBzZW50LlxuICovXG5tZXRob2RzLmlucHV0VGV4dCA9IGFzeW5jIGZ1bmN0aW9uIGlucHV0VGV4dCAodGV4dCkge1xuICAvKiBlc2xpbnQtZGlzYWJsZSBuby11c2VsZXNzLWVzY2FwZSAqL1xuICAvLyBuZWVkIHRvIGVzY2FwZSB3aGl0ZXNwYWNlIGFuZCAoICkgPCA+IHwgOyAmICogXFwgfiBcIiAnXG4gIHRleHQgPSB0ZXh0XG4gICAgICAgICAgLnJlcGxhY2UoL1xcXFwvZywgJ1xcXFxcXFxcJylcbiAgICAgICAgICAucmVwbGFjZSgvXFwoL2csICdcXCgnKVxuICAgICAgICAgIC5yZXBsYWNlKC9cXCkvZywgJ1xcKScpXG4gICAgICAgICAgLnJlcGxhY2UoLzwvZywgJ1xcPCcpXG4gICAgICAgICAgLnJlcGxhY2UoLz4vZywgJ1xcPicpXG4gICAgICAgICAgLnJlcGxhY2UoL1xcfC9nLCAnXFx8JylcbiAgICAgICAgICAucmVwbGFjZSgvOy9nLCAnXFw7JylcbiAgICAgICAgICAucmVwbGFjZSgvJi9nLCAnXFwmJylcbiAgICAgICAgICAucmVwbGFjZSgvXFwqL2csICdcXConKVxuICAgICAgICAgIC5yZXBsYWNlKC9+L2csICdcXH4nKVxuICAgICAgICAgIC5yZXBsYWNlKC9cIi9nLCAnXFxcIicpXG4gICAgICAgICAgLnJlcGxhY2UoLycvZywgXCJcXCdcIilcbiAgICAgICAgICAucmVwbGFjZSgvIC9nLCAnJXMnKTtcbiAgLyogZXNsaW50LWRpc2FibGUgbm8tdXNlbGVzcy1lc2NhcGUgKi9cbiAgYXdhaXQgdGhpcy5zaGVsbChbJ2lucHV0JywgJ3RleHQnLCB0ZXh0XSk7XG59O1xuXG4vKipcbiAqIENsZWFyIHRoZSBhY3RpdmUgdGV4dCBmaWVsZCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QgYnkgc2VuZGluZ1xuICogc3BlY2lhbCBrZXlldmVudHMgdG8gaXQuXG4gKlxuICogQHBhcmFtIHtudW1iZXJ9IGxlbmd0aCBbMTAwXSAtIFRoZSBtYXhpbXVtIGxlbmd0aCBvZiB0aGUgdGV4dCBpbiB0aGUgZmllbGQgdG8gYmUgY2xlYXJlZC5cbiAqL1xubWV0aG9kcy5jbGVhclRleHRGaWVsZCA9IGFzeW5jIGZ1bmN0aW9uIGNsZWFyVGV4dEZpZWxkIChsZW5ndGggPSAxMDApIHtcbiAgLy8gYXNzdW1lcyB0aGF0IHRoZSBFZGl0VGV4dCBmaWVsZCBhbHJlYWR5IGhhcyBmb2N1c1xuICBsb2cuZGVidWcoYENsZWFyaW5nIHVwIHRvICR7bGVuZ3RofSBjaGFyYWN0ZXJzYCk7XG4gIGlmIChsZW5ndGggPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cbiAgbGV0IGFyZ3MgPSBbJ2lucHV0JywgJ2tleWV2ZW50J107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAvLyB3ZSBjYW5ub3Qga25vdyB3aGVyZSB0aGUgY3Vyc29yIGlzIGluIHRoZSB0ZXh0IGZpZWxkLCBzbyBkZWxldGUgYm90aCBiZWZvcmVcbiAgICAvLyBhbmQgYWZ0ZXIgc28gdGhhdCB3ZSBnZXQgcmlkIG9mIGV2ZXJ5dGhpbmdcbiAgICAvLyBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvYW5kcm9pZC92aWV3L0tleUV2ZW50Lmh0bWwjS0VZQ09ERV9ERUxcbiAgICAvLyBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvYW5kcm9pZC92aWV3L0tleUV2ZW50Lmh0bWwjS0VZQ09ERV9GT1JXQVJEX0RFTFxuICAgIGFyZ3MucHVzaCgnNjcnLCAnMTEyJyk7XG4gIH1cbiAgYXdhaXQgdGhpcy5zaGVsbChhcmdzKTtcbn07XG5cbi8qKlxuICogU2VuZCB0aGUgc3BlY2lhbCBrZXljb2RlIHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdCBpbiBvcmRlciB0byBsb2NrIGl0LlxuICovXG5tZXRob2RzLmxvY2sgPSBhc3luYyBmdW5jdGlvbiBsb2NrICgpIHtcbiAgaWYgKGF3YWl0IHRoaXMuaXNTY3JlZW5Mb2NrZWQoKSkge1xuICAgIGxvZy5kZWJ1ZygnU2NyZWVuIGlzIGFscmVhZHkgbG9ja2VkLiBEb2luZyBub3RoaW5nLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBsb2cuZGVidWcoJ1ByZXNzaW5nIHRoZSBLRVlDT0RFX1BPV0VSIGJ1dHRvbiB0byBsb2NrIHNjcmVlbicpO1xuICBhd2FpdCB0aGlzLmtleWV2ZW50KDI2KTtcblxuICBjb25zdCB0aW1lb3V0TXMgPSA1MDAwO1xuICB0cnkge1xuICAgIGF3YWl0IHdhaXRGb3JDb25kaXRpb24oYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5pc1NjcmVlbkxvY2tlZCgpLCB7XG4gICAgICB3YWl0TXM6IHRpbWVvdXRNcyxcbiAgICAgIGludGVydmFsTXM6IDUwMCxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVGhlIGRldmljZSBzY3JlZW4gaXMgc3RpbGwgbG9ja2VkIGFmdGVyICR7dGltZW91dE1zfW1zIHRpbWVvdXRgKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZW5kIHRoZSBzcGVjaWFsIGtleWNvZGUgdG8gdGhlIGRldmljZSB1bmRlciB0ZXN0IGluIG9yZGVyIHRvIGVtdWxhdGVcbiAqIEJhY2sgYnV0dG9uIHRhcC5cbiAqL1xubWV0aG9kcy5iYWNrID0gYXN5bmMgZnVuY3Rpb24gYmFjayAoKSB7XG4gIGxvZy5kZWJ1ZygnUHJlc3NpbmcgdGhlIEJBQ0sgYnV0dG9uJyk7XG4gIGF3YWl0IHRoaXMua2V5ZXZlbnQoNCk7XG59O1xuXG4vKipcbiAqIFNlbmQgdGhlIHNwZWNpYWwga2V5Y29kZSB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QgaW4gb3JkZXIgdG8gZW11bGF0ZVxuICogSG9tZSBidXR0b24gdGFwLlxuICovXG5tZXRob2RzLmdvVG9Ib21lID0gYXN5bmMgZnVuY3Rpb24gZ29Ub0hvbWUgKCkge1xuICBsb2cuZGVidWcoJ1ByZXNzaW5nIHRoZSBIT01FIGJ1dHRvbicpO1xuICBhd2FpdCB0aGlzLmtleWV2ZW50KDMpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IHRoZSBhY3R1YWwgcGF0aCB0byBhZGIgZXhlY3V0YWJsZS5cbiAqL1xubWV0aG9kcy5nZXRBZGJQYXRoID0gZnVuY3Rpb24gZ2V0QWRiUGF0aCAoKSB7XG4gIHJldHVybiB0aGlzLmV4ZWN1dGFibGUucGF0aDtcbn07XG5cbi8qKlxuICogUmV0cmlldmUgY3VycmVudCBzY3JlZW4gb3JpZW50YXRpb24gb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge251bWJlcn0gVGhlIGN1cnJlbnQgb3JpZW50YXRpb24gZW5jb2RlZCBhcyBhbiBpbnRlZ2VyIG51bWJlci5cbiAqL1xubWV0aG9kcy5nZXRTY3JlZW5PcmllbnRhdGlvbiA9IGFzeW5jIGZ1bmN0aW9uIGdldFNjcmVlbk9yaWVudGF0aW9uICgpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ2lucHV0J10pO1xuICByZXR1cm4gZ2V0U3VyZmFjZU9yaWVudGF0aW9uKHN0ZG91dCk7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBzY3JlZW4gbG9jayBzdGF0ZSBvZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgZGV2aWNlIGlzIGxvY2tlZC5cbiAqL1xubWV0aG9kcy5pc1NjcmVlbkxvY2tlZCA9IGFzeW5jIGZ1bmN0aW9uIGlzU2NyZWVuTG9ja2VkICgpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ3dpbmRvdyddKTtcbiAgaWYgKHByb2Nlc3MuZW52LkFQUElVTV9MT0dfRFVNUFNZUykge1xuICAgIC8vIG9wdGlvbmFsIGRlYnVnZ2luZ1xuICAgIC8vIGlmIHRoZSBtZXRob2QgaXMgbm90IHdvcmtpbmcsIHR1cm4gaXQgb24gYW5kIHNlbmQgdXMgdGhlIG91dHB1dFxuICAgIGxldCBkdW1wc3lzRmlsZSA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnZHVtcHN5cy5sb2cnKTtcbiAgICBsb2cuZGVidWcoYFdyaXRpbmcgZHVtcHN5cyBvdXRwdXQgdG8gJHtkdW1wc3lzRmlsZX1gKTtcbiAgICBhd2FpdCBmcy53cml0ZUZpbGUoZHVtcHN5c0ZpbGUsIHN0ZG91dCk7XG4gIH1cbiAgcmV0dXJuIChpc1Nob3dpbmdMb2Nrc2NyZWVuKHN0ZG91dCkgfHwgaXNDdXJyZW50Rm9jdXNPbktleWd1YXJkKHN0ZG91dCkgfHxcbiAgICAgICAgICAhaXNTY3JlZW5PbkZ1bGx5KHN0ZG91dCkpO1xufTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBLZXlib2FyZFN0YXRlXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGlzS2V5Ym9hcmRTaG93biAtIFdoZXRoZXIgc29mdCBrZXlib2FyZCBpcyBjdXJyZW50bHkgdmlzaWJsZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY2FuQ2xvc2VLZXlib2FyZCAtIFdoZXRoZXIgdGhlIGtleWJvYXJkIGNhbiBiZSBjbG9zZWQuXG4gKi9cblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgc3RhdGUgb2YgdGhlIHNvZnR3YXJlIGtleWJvYXJkIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtLZXlib2FyZFN0YXRlfSBUaGUga2V5Ym9hcmQgc3RhdGUuXG4gKi9cbm1ldGhvZHMuaXNTb2Z0S2V5Ym9hcmRQcmVzZW50ID0gYXN5bmMgZnVuY3Rpb24gaXNTb2Z0S2V5Ym9hcmRQcmVzZW50ICgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdpbnB1dF9tZXRob2QnXSk7XG4gICAgY29uc3QgaW5wdXRTaG93bk1hdGNoID0gL21JbnB1dFNob3duPShcXHcrKS8uZXhlYyhzdGRvdXQpO1xuICAgIGNvbnN0IGlucHV0Vmlld1Nob3duTWF0Y2ggPSAvbUlzSW5wdXRWaWV3U2hvd249KFxcdyspLy5leGVjKHN0ZG91dCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzS2V5Ym9hcmRTaG93bjogISEoaW5wdXRTaG93bk1hdGNoICYmIGlucHV0U2hvd25NYXRjaFsxXSA9PT0gJ3RydWUnKSxcbiAgICAgIGNhbkNsb3NlS2V5Ym9hcmQ6ICEhKGlucHV0Vmlld1Nob3duTWF0Y2ggJiYgaW5wdXRWaWV3U2hvd25NYXRjaFsxXSA9PT0gJ3RydWUnKSxcbiAgICB9O1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBmaW5kaW5nIHNvZnRrZXlib2FyZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFNlbmQgYW4gYXJiaXRyYXJ5IFRlbG5ldCBjb21tYW5kIHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gY29tbWFuZCAtIFRoZSBjb21tYW5kIHRvIGJlIHNlbnQuXG4gKlxuICogQHJldHVybiB7c3RyaW5nfSBUaGUgYWN0dWFsIG91dHB1dCBvZiB0aGUgZ2l2ZW4gY29tbWFuZC5cbiAqL1xubWV0aG9kcy5zZW5kVGVsbmV0Q29tbWFuZCA9IGFzeW5jIGZ1bmN0aW9uIHNlbmRUZWxuZXRDb21tYW5kIChjb21tYW5kKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmV4ZWNFbXVDb25zb2xlQ29tbWFuZChjb21tYW5kLCB7cG9ydDogYXdhaXQgdGhpcy5nZXRFbXVsYXRvclBvcnQoKX0pO1xufTtcblxuLyoqXG4gKiBDaGVjayB0aGUgc3RhdGUgb2YgQWlycGxhbmUgbW9kZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiBBaXJwbGFuZSBtb2RlIGlzIGVuYWJsZWQuXG4gKi9cbm1ldGhvZHMuaXNBaXJwbGFuZU1vZGVPbiA9IGFzeW5jIGZ1bmN0aW9uIGlzQWlycGxhbmVNb2RlT24gKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnYWlycGxhbmVfbW9kZV9vbicpO1xuICByZXR1cm4gcGFyc2VJbnQoc3Rkb3V0LCAxMCkgIT09IDA7XG59O1xuXG4vKipcbiAqIENoYW5nZSB0aGUgc3RhdGUgb2YgQWlycGxhbmUgbW9kZSBpbiBTZXR0aW5ncyBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtib29sZWFufSBvbiAtIFRydWUgdG8gZW5hYmxlIHRoZSBBaXJwbGFuZSBtb2RlIGluIFNldHRpbmdzIGFuZCBmYWxzZSB0byBkaXNhYmxlIGl0LlxuICovXG5tZXRob2RzLnNldEFpcnBsYW5lTW9kZSA9IGFzeW5jIGZ1bmN0aW9uIHNldEFpcnBsYW5lTW9kZSAob24pIHtcbiAgYXdhaXQgdGhpcy5zZXRTZXR0aW5nKCdnbG9iYWwnLCAnYWlycGxhbmVfbW9kZV9vbicsIG9uID8gMSA6IDApO1xufTtcblxuLyoqXG4gKiBCcm9hZGNhc3QgdGhlIHN0YXRlIG9mIEFpcnBsYW5lIG1vZGUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICogVGhpcyBtZXRob2Qgc2hvdWxkIGJlIGNhbGxlZCBhZnRlciB7QGxpbmsgI3NldEFpcnBsYW5lTW9kZX0sIG90aGVyd2lzZVxuICogdGhlIG1vZGUgY2hhbmdlIGlzIG5vdCBnb2luZyB0byBiZSBhcHBsaWVkIGZvciB0aGUgZGV2aWNlLlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb24gLSBUcnVlIHRvIGJyb2FkY2FzdCBlbmFibGUgYW5kIGZhbHNlIHRvIGJyb2FkY2FzdCBkaXNhYmxlLlxuICovXG5tZXRob2RzLmJyb2FkY2FzdEFpcnBsYW5lTW9kZSA9IGFzeW5jIGZ1bmN0aW9uIGJyb2FkY2FzdEFpcnBsYW5lTW9kZSAob24pIHtcbiAgYXdhaXQgdGhpcy5zaGVsbChbXG4gICAgJ2FtJywgJ2Jyb2FkY2FzdCcsXG4gICAgJy1hJywgJ2FuZHJvaWQuaW50ZW50LmFjdGlvbi5BSVJQTEFORV9NT0RFJyxcbiAgICAnLS1leicsICdzdGF0ZScsIG9uID8gJ3RydWUnIDogJ2ZhbHNlJ1xuICBdKTtcbn07XG5cbi8qKlxuICogQ2hlY2sgdGhlIHN0YXRlIG9mIFdpRmkgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgV2lGaSBpcyBlbmFibGVkLlxuICovXG5tZXRob2RzLmlzV2lmaU9uID0gYXN5bmMgZnVuY3Rpb24gaXNXaWZpT24gKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnd2lmaV9vbicpO1xuICByZXR1cm4gKHBhcnNlSW50KHN0ZG91dCwgMTApICE9PSAwKTtcbn07XG5cbi8qKlxuICogQ2hlY2sgdGhlIHN0YXRlIG9mIERhdGEgdHJhbnNmZXIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgRGF0YSB0cmFuc2ZlciBpcyBlbmFibGVkLlxuICovXG5tZXRob2RzLmlzRGF0YU9uID0gYXN5bmMgZnVuY3Rpb24gaXNEYXRhT24gKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnbW9iaWxlX2RhdGEnKTtcbiAgcmV0dXJuIChwYXJzZUludChzdGRvdXQsIDEwKSAhPT0gMCk7XG59O1xuXG4vKipcbiAqIENoYW5nZSB0aGUgc3RhdGUgb2YgV2lGaSBhbmQvb3IgRGF0YSB0cmFuc2ZlciBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtib29sZWFufSB3aWZpIC0gVHJ1ZSB0byBlbmFibGUgYW5kIGZhbHNlIHRvIGRpc2FibGUgV2lGaS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gZGF0YSAtIFRydWUgdG8gZW5hYmxlIGFuZCBmYWxzZSB0byBkaXNhYmxlIERhdGEgdHJhbnNmZXIuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGlzRW11bGF0b3IgW2ZhbHNlXSAtIFNldCBpdCB0byB0cnVlIGlmIHRoZSBkZXZpY2UgdW5kZXIgdGVzdFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpcyBhbiBlbXVsYXRvciByYXRoZXIgdGhhbiBhIHJlYWwgZGV2aWNlLlxuICovXG5tZXRob2RzLnNldFdpZmlBbmREYXRhID0gYXN5bmMgZnVuY3Rpb24gc2V0V2lmaUFuZERhdGEgKHt3aWZpLCBkYXRhfSwgaXNFbXVsYXRvciA9IGZhbHNlKSB7XG4gIGlmICh1dGlsLmhhc1ZhbHVlKHdpZmkpKSB7XG4gICAgYXdhaXQgdGhpcy5zZXRXaWZpU3RhdGUod2lmaSwgaXNFbXVsYXRvcik7XG4gIH1cbiAgaWYgKHV0aWwuaGFzVmFsdWUoZGF0YSkpIHtcbiAgICBhd2FpdCB0aGlzLnNldERhdGFTdGF0ZShkYXRhLCBpc0VtdWxhdG9yKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDaGVjayB0aGUgc3RhdGUgb2YgYW5pbWF0aW9uIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIGF0IGxlYXN0IG9uZSBvZiBhbmltYXRpb24gc2NhbGUgc2V0dGluZ3NcbiAqICAgICAgICAgICAgICAgICAgIGlzIG5vdCBlcXVhbCB0byAnMC4wJy5cbiAqL1xubWV0aG9kcy5pc0FuaW1hdGlvbk9uID0gYXN5bmMgZnVuY3Rpb24gaXNBbmltYXRpb25PbiAoKSB7XG4gIGxldCBhbmltYXRvcl9kdXJhdGlvbl9zY2FsZSA9IGF3YWl0IHRoaXMuZ2V0U2V0dGluZygnZ2xvYmFsJywgJ2FuaW1hdG9yX2R1cmF0aW9uX3NjYWxlJyk7XG4gIGxldCB0cmFuc2l0aW9uX2FuaW1hdGlvbl9zY2FsZSA9IGF3YWl0IHRoaXMuZ2V0U2V0dGluZygnZ2xvYmFsJywgJ3RyYW5zaXRpb25fYW5pbWF0aW9uX3NjYWxlJyk7XG4gIGxldCB3aW5kb3dfYW5pbWF0aW9uX3NjYWxlID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnd2luZG93X2FuaW1hdGlvbl9zY2FsZScpO1xuICByZXR1cm4gXy5zb21lKFthbmltYXRvcl9kdXJhdGlvbl9zY2FsZSwgdHJhbnNpdGlvbl9hbmltYXRpb25fc2NhbGUsIHdpbmRvd19hbmltYXRpb25fc2NhbGVdLFxuICAgICAgICAgICAgICAgIChzZXR0aW5nKSA9PiBzZXR0aW5nICE9PSAnMC4wJyk7XG59O1xuXG4vKipcbiAqIEZvcmNlZnVsbHkgcmVjdXJzaXZlbHkgcmVtb3ZlIGEgcGF0aCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBCZSBjYXJlZnVsIHdoaWxlIGNhbGxpbmcgdGhpcyBtZXRob2QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBUaGUgcGF0aCB0byBiZSByZW1vdmVkIHJlY3Vyc2l2ZWx5LlxuICovXG5tZXRob2RzLnJpbXJhZiA9IGFzeW5jIGZ1bmN0aW9uIHJpbXJhZiAocGF0aCkge1xuICBhd2FpdCB0aGlzLnNoZWxsKFsncm0nLCAnLXJmJywgcGF0aF0pO1xufTtcblxuLyoqXG4gKiBTZW5kIGEgZmlsZSB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsUGF0aCAtIFRoZSBwYXRoIHRvIHRoZSBmaWxlIG9uIHRoZSBsb2NhbCBmaWxlIHN5c3RlbS5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZW1vdGVQYXRoIC0gVGhlIGRlc3RpbmF0aW9uIHBhdGggb24gdGhlIHJlbW90ZSBkZXZpY2UuXG4gKiBAcGFyYW0ge29iamVjdH0gb3B0cyAtIEFkZGl0aW9uYWwgb3B0aW9ucyBtYXBwaW5nLiBTZWVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9ub2RlLXRlZW5fcHJvY2VzcyxcbiAqICAgICAgICAgICAgICAgICAgICAgICAgX2V4ZWNfIG1ldGhvZCBvcHRpb25zLCBmb3IgbW9yZSBpbmZvcm1hdGlvbiBhYm91dCBhdmFpbGFibGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucy5cbiAqL1xubWV0aG9kcy5wdXNoID0gYXN5bmMgZnVuY3Rpb24gcHVzaCAobG9jYWxQYXRoLCByZW1vdGVQYXRoLCBvcHRzKSB7XG4gIGF3YWl0IHRoaXMubWtkaXIocGF0aC5wb3NpeC5kaXJuYW1lKHJlbW90ZVBhdGgpKTtcbiAgYXdhaXQgdGhpcy5hZGJFeGVjKFsncHVzaCcsIGxvY2FsUGF0aCwgcmVtb3RlUGF0aF0sIG9wdHMpO1xufTtcblxuLyoqXG4gKiBSZWNlaXZlIGEgZmlsZSBmcm9tIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSBzb3VyY2UgcGF0aCBvbiB0aGUgcmVtb3RlIGRldmljZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhbFBhdGggLSBUaGUgZGVzdGluYXRpb24gcGF0aCB0byB0aGUgZmlsZSBvbiB0aGUgbG9jYWwgZmlsZSBzeXN0ZW0uXG4gKi9cbm1ldGhvZHMucHVsbCA9IGFzeW5jIGZ1bmN0aW9uIHB1bGwgKHJlbW90ZVBhdGgsIGxvY2FsUGF0aCkge1xuICAvLyBwdWxsIGZvbGRlciBjYW4gdGFrZSBtb3JlIHRpbWUsIGluY3JlYXNpbmcgdGltZSBvdXQgdG8gNjAgc2Vjc1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydwdWxsJywgcmVtb3RlUGF0aCwgbG9jYWxQYXRoXSwge3RpbWVvdXQ6IDYwMDAwfSk7XG59O1xuXG4vKipcbiAqIENoZWNrIHdoZXRoZXIgdGhlIHByb2Nlc3Mgd2l0aCB0aGUgcGFydGljdWxhciBuYW1lIGlzIHJ1bm5pbmcgb24gdGhlIGRldmljZVxuICogdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcHJvY2Vzc05hbWUgLSBUaGUgbmFtZSBvZiB0aGUgcHJvY2VzcyB0byBiZSBjaGVja2VkLlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgZ2l2ZW4gcHJvY2VzcyBpcyBydW5uaW5nLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBnaXZlbiBwcm9jZXNzIG5hbWUgaXMgbm90IGEgdmFsaWQgY2xhc3MgbmFtZS5cbiAqL1xubWV0aG9kcy5wcm9jZXNzRXhpc3RzID0gYXN5bmMgZnVuY3Rpb24gcHJvY2Vzc0V4aXN0cyAocHJvY2Vzc05hbWUpIHtcbiAgcmV0dXJuICFfLmlzRW1wdHkoYXdhaXQgdGhpcy5nZXRQSURzQnlOYW1lKHByb2Nlc3NOYW1lKSk7XG59O1xuXG4vKipcbiAqIEdldCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqIEByZXR1cm4ge0FycmF5LjxTdHJpbmc+fSBUaGUgb3V0cHV0IG9mIHRoZSBjb3JyZXNwb25kaW5nIGFkYiBjb21tYW5kLiBBbiBhcnJheSBjb250YWlucyBlYWNoIGZvcndhcmRpbmcgbGluZSBvZiBvdXRwdXRcbiAqL1xubWV0aG9kcy5nZXRGb3J3YXJkTGlzdCA9IGFzeW5jIGZ1bmN0aW9uIGdldEZvcndhcmRMaXN0ICgpIHtcbiAgbG9nLmRlYnVnKGBMaXN0IGZvcndhcmRpbmcgcG9ydHNgKTtcbiAgY29uc3QgY29ubmVjdGlvbnMgPSBhd2FpdCB0aGlzLmFkYkV4ZWMoWydmb3J3YXJkJywgJy0tbGlzdCddKTtcbiAgcmV0dXJuIGNvbm5lY3Rpb25zLnNwbGl0KEVPTCkuZmlsdGVyKChsaW5lKSA9PiBCb29sZWFuKGxpbmUudHJpbSgpKSk7XG59O1xuXG4vKipcbiAqIFNldHVwIFRDUCBwb3J0IGZvcndhcmRpbmcgd2l0aCBhZGIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gc3lzdGVtUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIGxvY2FsIHN5c3RlbSBwb3J0LlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBkZXZpY2VQb3J0IC0gVGhlIG51bWJlciBvZiB0aGUgcmVtb3RlIGRldmljZSBwb3J0LlxuICovXG5tZXRob2RzLmZvcndhcmRQb3J0ID0gYXN5bmMgZnVuY3Rpb24gZm9yd2FyZFBvcnQgKHN5c3RlbVBvcnQsIGRldmljZVBvcnQpIHtcbiAgbG9nLmRlYnVnKGBGb3J3YXJkaW5nIHN5c3RlbTogJHtzeXN0ZW1Qb3J0fSB0byBkZXZpY2U6ICR7ZGV2aWNlUG9ydH1gKTtcbiAgYXdhaXQgdGhpcy5hZGJFeGVjKFsnZm9yd2FyZCcsIGB0Y3A6JHtzeXN0ZW1Qb3J0fWAsIGB0Y3A6JHtkZXZpY2VQb3J0fWBdKTtcbn07XG5cbi8qKlxuICogUmVtb3ZlIFRDUCBwb3J0IGZvcndhcmRpbmcgd2l0aCBhZGIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LiBUaGUgZm9yd2FyZGluZ1xuICogZm9yIHRoZSBnaXZlbiBwb3J0IHNob3VsZCBiZSBzZXR1cCB3aXRoIHtAbGluayAjZm9yd2FyZFBvcnR9IGZpcnN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gc3lzdGVtUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIGxvY2FsIHN5c3RlbSBwb3J0XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0byByZW1vdmUgZm9yd2FyZGluZyBvbi5cbiAqL1xubWV0aG9kcy5yZW1vdmVQb3J0Rm9yd2FyZCA9IGFzeW5jIGZ1bmN0aW9uIHJlbW92ZVBvcnRGb3J3YXJkIChzeXN0ZW1Qb3J0KSB7XG4gIGxvZy5kZWJ1ZyhgUmVtb3ZpbmcgZm9yd2FyZGVkIHBvcnQgc29ja2V0IGNvbm5lY3Rpb246ICR7c3lzdGVtUG9ydH0gYCk7XG4gIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ2ZvcndhcmQnLCBgLS1yZW1vdmVgLCBgdGNwOiR7c3lzdGVtUG9ydH1gXSk7XG59O1xuXG4vKipcbiAqIEdldCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqIEByZXR1cm4ge0FycmF5LjxTdHJpbmc+fSBUaGUgb3V0cHV0IG9mIHRoZSBjb3JyZXNwb25kaW5nIGFkYiBjb21tYW5kLiBBbiBhcnJheSBjb250YWlucyBlYWNoIGZvcndhcmRpbmcgbGluZSBvZiBvdXRwdXRcbiAqL1xubWV0aG9kcy5nZXRSZXZlcnNlTGlzdCA9IGFzeW5jIGZ1bmN0aW9uIGdldFJldmVyc2VMaXN0ICgpIHtcbiAgbG9nLmRlYnVnKGBMaXN0IHJldmVyc2UgZm9yd2FyZGluZyBwb3J0c2ApO1xuICBjb25zdCBjb25uZWN0aW9ucyA9IGF3YWl0IHRoaXMuYWRiRXhlYyhbJ3JldmVyc2UnLCAnLS1saXN0J10pO1xuICByZXR1cm4gY29ubmVjdGlvbnMuc3BsaXQoRU9MKS5maWx0ZXIoKGxpbmUpID0+IEJvb2xlYW4obGluZS50cmltKCkpKTtcbn07XG5cbi8qKlxuICogU2V0dXAgVENQIHBvcnQgZm9yd2FyZGluZyB3aXRoIGFkYiBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBPbmx5IGF2YWlsYWJsZSBmb3IgQVBJIDIxKy5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IGRldmljZVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSByZW1vdGUgZGV2aWNlIHBvcnQuXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHN5c3RlbVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSBsb2NhbCBzeXN0ZW0gcG9ydC5cbiAqL1xubWV0aG9kcy5yZXZlcnNlUG9ydCA9IGFzeW5jIGZ1bmN0aW9uIHJldmVyc2VQb3J0IChkZXZpY2VQb3J0LCBzeXN0ZW1Qb3J0KSB7XG4gIGxvZy5kZWJ1ZyhgRm9yd2FyZGluZyBkZXZpY2U6ICR7ZGV2aWNlUG9ydH0gdG8gc3lzdGVtOiAke3N5c3RlbVBvcnR9YCk7XG4gIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ3JldmVyc2UnLCBgdGNwOiR7ZGV2aWNlUG9ydH1gLCBgdGNwOiR7c3lzdGVtUG9ydH1gXSk7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC4gVGhlIGZvcndhcmRpbmdcbiAqIGZvciB0aGUgZ2l2ZW4gcG9ydCBzaG91bGQgYmUgc2V0dXAgd2l0aCB7QGxpbmsgI2ZvcndhcmRQb3J0fSBmaXJzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IGRldmljZVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSByZW1vdGUgZGV2aWNlIHBvcnRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvIHJlbW92ZSBmb3J3YXJkaW5nIG9uLlxuICovXG5tZXRob2RzLnJlbW92ZVBvcnRSZXZlcnNlID0gYXN5bmMgZnVuY3Rpb24gcmVtb3ZlUG9ydFJldmVyc2UgKGRldmljZVBvcnQpIHtcbiAgbG9nLmRlYnVnKGBSZW1vdmluZyByZXZlcnNlIGZvcndhcmRlZCBwb3J0IHNvY2tldCBjb25uZWN0aW9uOiAke2RldmljZVBvcnR9IGApO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydyZXZlcnNlJywgYC0tcmVtb3ZlYCwgYHRjcDoke2RldmljZVBvcnR9YF0pO1xufTtcblxuLyoqXG4gKiBTZXR1cCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC4gVGhlIGRpZmZlcmVuY2VcbiAqIGJldHdlZW4ge0BsaW5rICNmb3J3YXJkUG9ydH0gaXMgdGhhdCB0aGlzIG1ldGhvZCBkb2VzIHNldHVwIGZvciBhbiBhYnN0cmFjdFxuICogbG9jYWwgcG9ydC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHN5c3RlbVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSBsb2NhbCBzeXN0ZW0gcG9ydC5cbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gZGV2aWNlUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIHJlbW90ZSBkZXZpY2UgcG9ydC5cbiAqL1xubWV0aG9kcy5mb3J3YXJkQWJzdHJhY3RQb3J0ID0gYXN5bmMgZnVuY3Rpb24gZm9yd2FyZEFic3RyYWN0UG9ydCAoc3lzdGVtUG9ydCwgZGV2aWNlUG9ydCkge1xuICBsb2cuZGVidWcoYEZvcndhcmRpbmcgc3lzdGVtOiAke3N5c3RlbVBvcnR9IHRvIGFic3RyYWN0IGRldmljZTogJHtkZXZpY2VQb3J0fWApO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydmb3J3YXJkJywgYHRjcDoke3N5c3RlbVBvcnR9YCwgYGxvY2FsYWJzdHJhY3Q6JHtkZXZpY2VQb3J0fWBdKTtcbn07XG5cbi8qKlxuICogRXhlY3V0ZSBwaW5nIHNoZWxsIGNvbW1hbmQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIGNvbW1hbmQgb3V0cHV0IGNvbnRhaW5zICdwaW5nJyBzdWJzdHJpbmcuXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGV4ZWN1dGluZyAncGluZycgY29tbWFuZCBvbiB0aGVcbiAqICAgICAgICAgICAgICAgICBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5waW5nID0gYXN5bmMgZnVuY3Rpb24gcGluZyAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnZWNobycsICdwaW5nJ10pO1xuICBpZiAoc3Rkb3V0LmluZGV4T2YoJ3BpbmcnKSA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgQURCIHBpbmcgZmFpbGVkLCByZXR1cm5lZCAke3N0ZG91dH1gKTtcbn07XG5cbi8qKlxuICogUmVzdGFydCB0aGUgZGV2aWNlIHVuZGVyIHRlc3QgdXNpbmcgYWRiIGNvbW1hbmRzLlxuICpcbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiBzdGFydCBmYWlscy5cbiAqL1xubWV0aG9kcy5yZXN0YXJ0ID0gYXN5bmMgZnVuY3Rpb24gcmVzdGFydCAoKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgdGhpcy5zdG9wTG9nY2F0KCk7XG4gICAgYXdhaXQgdGhpcy5yZXN0YXJ0QWRiKCk7XG4gICAgYXdhaXQgdGhpcy53YWl0Rm9yRGV2aWNlKDYwKTtcbiAgICBhd2FpdCB0aGlzLnN0YXJ0TG9nY2F0KHRoaXMuX2xvZ2NhdFN0YXJ0dXBQYXJhbXMpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBSZXN0YXJ0IGZhaWxlZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IExvZ2NhdE9wdHNcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmb3JtYXQgVGhlIGxvZyBwcmludCBmb3JtYXQsIHdoZXJlIDxmb3JtYXQ+IGlzIG9uZSBvZjpcbiAqICAgYnJpZWYgcHJvY2VzcyB0YWcgdGhyZWFkIHJhdyB0aW1lIHRocmVhZHRpbWUgbG9uZ1xuICogYHRocmVhZHRpbWVgIGlzIHRoZSBkZWZhdWx0IHZhbHVlLlxuICogQHByb3BlcnR5IHtBcnJheTxzdHJpbmc+fSBmaWx0ZXJTcGVjcyBTZXJpZXMgb2YgPHRhZz5bOnByaW9yaXR5XVxuICogd2hlcmUgPHRhZz4gaXMgYSBsb2cgY29tcG9uZW50IHRhZyAob3IgKiBmb3IgYWxsKSBhbmQgcHJpb3JpdHkgaXM6XG4gKiAgViAgICBWZXJib3NlXG4gKiAgRCAgICBEZWJ1Z1xuICogIEkgICAgSW5mb1xuICogIFcgICAgV2FyblxuICogIEUgICAgRXJyb3JcbiAqICBGICAgIEZhdGFsXG4gKiAgUyAgICBTaWxlbnQgKHN1cHJlc3MgYWxsIG91dHB1dClcbiAqXG4gKiAnKicgbWVhbnMgJyo6ZCcgYW5kIDx0YWc+IGJ5IGl0c2VsZiBtZWFucyA8dGFnPjp2XG4gKlxuICogSWYgbm90IHNwZWNpZmllZCBvbiB0aGUgY29tbWFuZGxpbmUsIGZpbHRlcnNwZWMgaXMgc2V0IGZyb20gQU5EUk9JRF9MT0dfVEFHUy5cbiAqIElmIG5vIGZpbHRlcnNwZWMgaXMgZm91bmQsIGZpbHRlciBkZWZhdWx0cyB0byAnKjpJJ1xuICovXG5cbi8qKlxuICogU3RhcnQgdGhlIGxvZ2NhdCBwcm9jZXNzIHRvIGdhdGhlciBsb2dzLlxuICpcbiAqIEBwYXJhbSB7P0xvZ2NhdE9wdHN9IG9wdHNcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiByZXN0YXJ0IGZhaWxzLlxuICovXG5tZXRob2RzLnN0YXJ0TG9nY2F0ID0gYXN5bmMgZnVuY3Rpb24gc3RhcnRMb2djYXQgKG9wdHMgPSB7fSkge1xuICBpZiAoIV8uaXNFbXB0eSh0aGlzLmxvZ2NhdCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcnlpbmcgdG8gc3RhcnQgbG9nY2F0IGNhcHR1cmUgYnV0IGl0J3MgYWxyZWFkeSBzdGFydGVkIVwiKTtcbiAgfVxuXG4gIHRoaXMubG9nY2F0ID0gbmV3IExvZ2NhdCh7XG4gICAgYWRiOiB0aGlzLmV4ZWN1dGFibGUsXG4gICAgZGVidWc6IGZhbHNlLFxuICAgIGRlYnVnVHJhY2U6IGZhbHNlLFxuICAgIGNsZWFyRGV2aWNlTG9nc09uU3RhcnQ6ICEhdGhpcy5jbGVhckRldmljZUxvZ3NPblN0YXJ0LFxuICB9KTtcbiAgYXdhaXQgdGhpcy5sb2djYXQuc3RhcnRDYXB0dXJlKG9wdHMpO1xuICB0aGlzLl9sb2djYXRTdGFydHVwUGFyYW1zID0gb3B0cztcbn07XG5cbi8qKlxuICogU3RvcCB0aGUgYWN0aXZlIGxvZ2NhdCBwcm9jZXNzIHdoaWNoIGdhdGhlcnMgbG9ncy5cbiAqIFRoZSBjYWxsIHdpbGwgYmUgaWdub3JlZCBpZiBubyBsb2djYXQgcHJvY2VzcyBpcyBydW5uaW5nLlxuICovXG5tZXRob2RzLnN0b3BMb2djYXQgPSBhc3luYyBmdW5jdGlvbiBzdG9wTG9nY2F0ICgpIHtcbiAgaWYgKF8uaXNFbXB0eSh0aGlzLmxvZ2NhdCkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCB0aGlzLmxvZ2NhdC5zdG9wQ2FwdHVyZSgpO1xuICB9IGZpbmFsbHkge1xuICAgIHRoaXMubG9nY2F0ID0gbnVsbDtcbiAgfVxufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgb3V0cHV0IGZyb20gdGhlIGN1cnJlbnRseSBydW5uaW5nIGxvZ2NhdCBwcm9jZXNzLlxuICogVGhlIGxvZ2NhdCBwcm9jZXNzIHNob3VsZCBiZSBleGVjdXRlZCBieSB7MmxpbmsgI3N0YXJ0TG9nY2F0fSBtZXRob2QuXG4gKlxuICogQHJldHVybiB7c3RyaW5nfSBUaGUgY29sbGVjdGVkIGxvZ2NhdCBvdXRwdXQuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbG9nY2F0IHByb2Nlc3MgaXMgbm90IHJ1bm5pbmcuXG4gKi9cbm1ldGhvZHMuZ2V0TG9nY2F0TG9ncyA9IGZ1bmN0aW9uIGdldExvZ2NhdExvZ3MgKCkge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMubG9nY2F0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGdldCBsb2djYXQgbG9ncyBzaW5jZSBsb2djYXQgaGFzbid0IHN0YXJ0ZWRcIik7XG4gIH1cbiAgcmV0dXJuIHRoaXMubG9nY2F0LmdldExvZ3MoKTtcbn07XG5cbi8qKlxuICogU2V0IHRoZSBjYWxsYmFjayBmb3IgdGhlIGxvZ2NhdCBvdXRwdXQgZXZlbnQuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgLSBUaGUgbGlzdGVuZXIgZnVuY3Rpb24sIHdoaWNoIGFjY2VwdHMgb25lIGFyZ3VtZW50LiBUaGUgYXJndW1lbnQgaXNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYSBsb2cgcmVjb3JkIG9iamVjdCB3aXRoIGB0aW1lc3RhbXBgLCBgbGV2ZWxgIGFuZCBgbWVzc2FnZWAgcHJvcGVydGllcy5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiBsb2djYXQgcHJvY2VzcyBpcyBub3QgcnVubmluZy5cbiAqL1xubWV0aG9kcy5zZXRMb2djYXRMaXN0ZW5lciA9IGZ1bmN0aW9uIHNldExvZ2NhdExpc3RlbmVyIChsaXN0ZW5lcikge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMubG9nY2F0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkxvZ2NhdCBwcm9jZXNzIGhhc24ndCBiZWVuIHN0YXJ0ZWRcIik7XG4gIH1cbiAgdGhpcy5sb2djYXQub24oJ291dHB1dCcsIGxpc3RlbmVyKTtcbn07XG5cbi8qKlxuICogUmVtb3ZlcyB0aGUgcHJldmlvdXNseSBzZXQgY2FsbGJhY2sgZm9yIHRoZSBsb2djYXQgb3V0cHV0IGV2ZW50LlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIC0gVGhlIGxpc3RlbmVyIGZ1bmN0aW9uLCB3aGljaCBoYXMgYmVlbiBwcmV2aW91c2x5XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhc3NlZCB0byBgc2V0TG9nY2F0TGlzdGVuZXJgXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbG9nY2F0IHByb2Nlc3MgaXMgbm90IHJ1bm5pbmcuXG4gKi9cbm1ldGhvZHMucmVtb3ZlTG9nY2F0TGlzdGVuZXIgPSBmdW5jdGlvbiByZW1vdmVMb2djYXRMaXN0ZW5lciAobGlzdGVuZXIpIHtcbiAgaWYgKF8uaXNFbXB0eSh0aGlzLmxvZ2NhdCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJMb2djYXQgcHJvY2VzcyBoYXNuJ3QgYmVlbiBzdGFydGVkXCIpO1xuICB9XG4gIHRoaXMubG9nY2F0LnJlbW92ZUxpc3RlbmVyKCdvdXRwdXQnLCBsaXN0ZW5lcik7XG59O1xuXG4vKipcbiAqIFJldHVybnMgcHJvY2VzcyBuYW1lIGZvciB0aGUgZ2l2ZW4gcHJvY2VzcyBpZGVudGlmaWVyXG4gKlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBwaWQgLSBUaGUgdmFsaWQgcHJvY2VzcyBpZGVudGlmaWVyXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGdpdmVuIFBJRCBpcyBlaXRoZXIgaW52YWxpZCBvciBpcyBub3QgcHJlc2VudFxuICogaW4gdGhlIGFjdGl2ZSBwcm9jZXNzZXMgbGlzdFxuICogQHJldHVybnMge3N0cmluZ30gVGhlIHByb2Nlc3MgbmFtZVxuICovXG5tZXRob2RzLmdldE5hbWVCeVBpZCA9IGFzeW5jIGZ1bmN0aW9uIGdldE5hbWVCeVBpZCAocGlkKSB7XG4gIGlmIChpc05hTihwaWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBUaGUgUElEIHZhbHVlIG11c3QgYmUgYSB2YWxpZCBudW1iZXIuICcke3BpZH0nIGlzIGdpdmVuIGluc3RlYWRgKTtcbiAgfVxuICBwaWQgPSBwYXJzZUludChwaWQsIDEwKTtcblxuICBjb25zdCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsncHMnXSk7XG4gIGNvbnN0IHRpdGxlTWF0Y2ggPSBQU19USVRMRV9QQVRURVJOLmV4ZWMoc3Rkb3V0KTtcbiAgaWYgKCF0aXRsZU1hdGNoKSB7XG4gICAgbG9nLmRlYnVnKHN0ZG91dCk7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgZ2V0IHRoZSBwcm9jZXNzIG5hbWUgZm9yIFBJRCAnJHtwaWR9J2ApO1xuICB9XG4gIGNvbnN0IGFsbFRpdGxlcyA9IHRpdGxlTWF0Y2hbMV0udHJpbSgpLnNwbGl0KC9cXHMrLyk7XG4gIGNvbnN0IHBpZEluZGV4ID0gYWxsVGl0bGVzLmluZGV4T2YoUElEX0NPTFVNTl9USVRMRSk7XG4gIC8vIGl0IG1pZ2h0IG5vdCBiZSBzdGFibGUgdG8gdGFrZSBOQU1FIGJ5IGluZGV4LCBiZWNhdXNlIGRlcGVuZGluZyBvbiB0aGVcbiAgLy8gYWN0dWFsIFNESyB0aGUgcHMgb3V0cHV0IG1pZ2h0IG5vdCBjb250YWluIGFuIGFiYnJldmlhdGlvbiBmb3IgdGhlIFMgZmxhZzpcbiAgLy8gVVNFUiAgICAgUElEICAgUFBJRCAgVlNJWkUgIFJTUyAgICAgV0NIQU4gICAgUEMgICAgICAgIE5BTUVcbiAgLy8gVVNFUiAgICAgUElEICAgUFBJRCAgVlNJWkUgIFJTUyAgICAgV0NIQU4gICAgUEMgICBTICAgIE5BTUVcbiAgY29uc3QgbmFtZU9mZnNldCA9IGFsbFRpdGxlcy5pbmRleE9mKFBST0NFU1NfTkFNRV9DT0xVTU5fVElUTEUpIC0gYWxsVGl0bGVzLmxlbmd0aDtcbiAgY29uc3QgcGlkUmVnZXggPSBuZXcgUmVnRXhwKGBeKC4qXFxcXGIke3BpZH1cXFxcYi4qKSRgLCAnZ20nKTtcbiAgbGV0IG1hdGNoZWRMaW5lO1xuICB3aGlsZSAoKG1hdGNoZWRMaW5lID0gcGlkUmVnZXguZXhlYyhzdGRvdXQpKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gbWF0Y2hlZExpbmVbMV0udHJpbSgpLnNwbGl0KC9cXHMrLyk7XG4gICAgaWYgKHBhcnNlSW50KGl0ZW1zW3BpZEluZGV4XSwgMTApID09PSBwaWQgJiYgaXRlbXNbaXRlbXMubGVuZ3RoICsgbmFtZU9mZnNldF0pIHtcbiAgICAgIHJldHVybiBpdGVtc1tpdGVtcy5sZW5ndGggKyBuYW1lT2Zmc2V0XTtcbiAgICB9XG4gIH1cbiAgbG9nLmRlYnVnKHN0ZG91dCk7XG4gIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGdldCB0aGUgcHJvY2VzcyBuYW1lIGZvciBQSUQgJyR7cGlkfSdgKTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBsaXN0IG9mIHByb2Nlc3MgaWRzIGZvciB0aGUgcGFydGljdWxhciBwcm9jZXNzIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFRoZSBwYXJ0IG9mIHByb2Nlc3MgbmFtZS5cbiAqIEByZXR1cm4ge0FycmF5LjxudW1iZXI+fSBUaGUgbGlzdCBvZiBtYXRjaGVkIHByb2Nlc3MgSURzIG9yIGFuIGVtcHR5IGxpc3QuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIHBhc3NlZCBwcm9jZXNzIG5hbWUgaXMgbm90IGEgdmFsaWQgb25lXG4gKi9cbm1ldGhvZHMuZ2V0UElEc0J5TmFtZSA9IGFzeW5jIGZ1bmN0aW9uIGdldFBJRHNCeU5hbWUgKG5hbWUpIHtcbiAgbG9nLmRlYnVnKGBHZXR0aW5nIElEcyBvZiBhbGwgJyR7bmFtZX0nIHByb2Nlc3Nlc2ApO1xuICBpZiAoIXRoaXMuaXNWYWxpZENsYXNzKG5hbWUpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHByb2Nlc3MgbmFtZTogJyR7bmFtZX0nYCk7XG4gIH1cbiAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9hcHBpdW0vaXNzdWVzLzEzNTY3XG4gIGlmIChhd2FpdCB0aGlzLmdldEFwaUxldmVsKCkgPj0gMjMpIHtcbiAgICBpZiAoIV8uaXNCb29sZWFuKHRoaXMuX2lzUGdyZXBBdmFpbGFibGUpKSB7XG4gICAgICAvLyBwZ3JlcCBpcyBpbiBwcmlvcml0eSwgc2luY2UgcGlkb2YgaGFzIGJlZW4gcmVwb3J0ZWQgb2YgaGF2aW5nIGJ1Z3Mgb24gc29tZSBwbGF0Zm9ybXNcbiAgICAgIGNvbnN0IHBncmVwT3V0cHV0ID0gXy50cmltKGF3YWl0IHRoaXMuc2hlbGwoWydwZ3JlcCAtLWhlbHA7IGVjaG8gJD8nXSkpO1xuICAgICAgdGhpcy5faXNQZ3JlcEF2YWlsYWJsZSA9IHBhcnNlSW50KF8ubGFzdChwZ3JlcE91dHB1dC5zcGxpdCgvXFxzKy8pKSwgMTApID09PSAwO1xuICAgICAgaWYgKHRoaXMuX2lzUGdyZXBBdmFpbGFibGUpIHtcbiAgICAgICAgdGhpcy5fY2FuUGdyZXBVc2VGdWxsQ21kTGluZVNlYXJjaCA9IC9eLWZcXGIvbS50ZXN0KHBncmVwT3V0cHV0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuX2lzUGlkb2ZBdmFpbGFibGUgPSBwYXJzZUludChhd2FpdCB0aGlzLnNoZWxsKFsncGlkb2YgLS1oZWxwID4gL2Rldi9udWxsOyBlY2hvICQ/J10pLCAxMCkgPT09IDA7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICh0aGlzLl9pc1BncmVwQXZhaWxhYmxlIHx8IHRoaXMuX2lzUGlkb2ZBdmFpbGFibGUpIHtcbiAgICAgIGNvbnN0IHNoZWxsQ29tbWFuZCA9IHRoaXMuX2lzUGdyZXBBdmFpbGFibGVcbiAgICAgICAgPyAodGhpcy5fY2FuUGdyZXBVc2VGdWxsQ21kTGluZVNlYXJjaFxuICAgICAgICAgID8gWydwZ3JlcCcsICctZicsIF8uZXNjYXBlUmVnRXhwKG5hbWUpXVxuICAgICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vYXBwaXVtL2lzc3Vlcy8xMzg3MlxuICAgICAgICAgIDogW2BwZ3JlcCBeJHtfLmVzY2FwZVJlZ0V4cChuYW1lLnNsaWNlKC1NQVhfUEdSRVBfUEFUVEVSTl9MRU4pKX0kIHx8IHBncmVwIF4ke18uZXNjYXBlUmVnRXhwKG5hbWUuc2xpY2UoMCwgTUFYX1BHUkVQX1BBVFRFUk5fTEVOKSl9JGBdKVxuICAgICAgICA6IFsncGlkb2YnLCBuYW1lXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiAoYXdhaXQgdGhpcy5zaGVsbChzaGVsbENvbW1hbmQpKVxuICAgICAgICAgIC5zcGxpdCgvXFxzKy8pXG4gICAgICAgICAgLm1hcCgoeCkgPT4gcGFyc2VJbnQoeCwgMTApKVxuICAgICAgICAgIC5maWx0ZXIoKHgpID0+IF8uaXNJbnRlZ2VyKHgpKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gZXJyb3IgY29kZSAxIGlzIHJldHVybmVkIGlmIHRoZSB1dGlsaXR5IGRpZCBub3QgZmluZCBhbnkgcHJvY2Vzc2VzXG4gICAgICAgIC8vIHdpdGggdGhlIGdpdmVuIG5hbWVcbiAgICAgICAgaWYgKGUuY29kZSA9PT0gMSkge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBleHRyYWN0IHByb2Nlc3MgSUQgb2YgJyR7bmFtZX0nOiAke2UubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBsb2cuZGVidWcoJ1VzaW5nIHBzLWJhc2VkIFBJRCBkZXRlY3Rpb24nKTtcbiAgY29uc3Qgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ3BzJ10pO1xuICBjb25zdCB0aXRsZU1hdGNoID0gUFNfVElUTEVfUEFUVEVSTi5leGVjKHN0ZG91dCk7XG4gIGlmICghdGl0bGVNYXRjaCkge1xuICAgIGxvZy5kZWJ1ZyhzdGRvdXQpO1xuICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGV4dHJhY3QgUElEIG9mICcke25hbWV9JyBmcm9tIHBzIG91dHB1dGApO1xuICB9XG4gIGNvbnN0IGFsbFRpdGxlcyA9IHRpdGxlTWF0Y2hbMV0udHJpbSgpLnNwbGl0KC9cXHMrLyk7XG4gIGNvbnN0IHBpZEluZGV4ID0gYWxsVGl0bGVzLmluZGV4T2YoUElEX0NPTFVNTl9USVRMRSk7XG4gIGNvbnN0IHBpZHMgPSBbXTtcbiAgY29uc3QgcHJvY2Vzc05hbWVSZWdleCA9IG5ldyBSZWdFeHAoYF4oLipcXFxcYlxcXFxkK1xcXFxiLipcXFxcYiR7Xy5lc2NhcGVSZWdFeHAobmFtZSl9XFxcXGIuKikkYCwgJ2dtJyk7XG4gIGxldCBtYXRjaGVkTGluZTtcbiAgd2hpbGUgKChtYXRjaGVkTGluZSA9IHByb2Nlc3NOYW1lUmVnZXguZXhlYyhzdGRvdXQpKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gbWF0Y2hlZExpbmVbMV0udHJpbSgpLnNwbGl0KC9cXHMrLyk7XG4gICAgaWYgKHBpZEluZGV4ID49IGFsbFRpdGxlcy5sZW5ndGggfHwgaXNOYU4oaXRlbXNbcGlkSW5kZXhdKSkge1xuICAgICAgbG9nLmRlYnVnKHN0ZG91dCk7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBleHRyYWN0IFBJRCBvZiAnJHtuYW1lfScgZnJvbSAnJHttYXRjaGVkTGluZVsxXS50cmltKCl9J2ApO1xuICAgIH1cbiAgICBwaWRzLnB1c2gocGFyc2VJbnQoaXRlbXNbcGlkSW5kZXhdLCAxMCkpO1xuICB9XG4gIHJldHVybiBwaWRzO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGxpc3Qgb2YgcHJvY2VzcyBpZHMgZm9yIHRoZSBwYXJ0aWN1bGFyIHByb2Nlc3Mgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gVGhlIHBhcnQgb2YgcHJvY2VzcyBuYW1lLlxuICogQHJldHVybiB7QXJyYXkuPG51bWJlcj59IFRoZSBsaXN0IG9mIG1hdGNoZWQgcHJvY2VzcyBJRHMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqL1xubWV0aG9kcy5raWxsUHJvY2Vzc2VzQnlOYW1lID0gYXN5bmMgZnVuY3Rpb24ga2lsbFByb2Nlc3Nlc0J5TmFtZSAobmFtZSkge1xuICB0cnkge1xuICAgIGxvZy5kZWJ1ZyhgQXR0ZW1wdGluZyB0byBraWxsIGFsbCAke25hbWV9IHByb2Nlc3Nlc2ApO1xuICAgIGNvbnN0IHBpZHMgPSBhd2FpdCB0aGlzLmdldFBJRHNCeU5hbWUobmFtZSk7XG4gICAgaWYgKF8uaXNFbXB0eShwaWRzKSkge1xuICAgICAgbG9nLmluZm8oYE5vICcke25hbWV9JyBwcm9jZXNzIGhhcyBiZWVuIGZvdW5kYCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IEIuYWxsKHBpZHMubWFwKChwKSA9PiB0aGlzLmtpbGxQcm9jZXNzQnlQSUQocCkpKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBraWxsICR7bmFtZX0gcHJvY2Vzc2VzLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogS2lsbCB0aGUgcGFydGljdWxhciBwcm9jZXNzIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqIFRoZSBjdXJyZW50IHVzZXIgaXMgYXV0b21hdGljYWxseSBzd2l0Y2hlZCB0byByb290IGlmIG5lY2Vzc2FyeSBpbiBvcmRlclxuICogdG8gcHJvcGVybHkga2lsbCB0aGUgcHJvY2Vzcy5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHBpZCAtIFRoZSBJRCBvZiB0aGUgcHJvY2VzcyB0byBiZSBraWxsZWQuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIHByb2Nlc3MgY2Fubm90IGJlIGtpbGxlZC5cbiAqL1xubWV0aG9kcy5raWxsUHJvY2Vzc0J5UElEID0gYXN5bmMgZnVuY3Rpb24ga2lsbFByb2Nlc3NCeVBJRCAocGlkKSB7XG4gIGxvZy5kZWJ1ZyhgQXR0ZW1wdGluZyB0byBraWxsIHByb2Nlc3MgJHtwaWR9YCk7XG4gIGNvbnN0IG5vUHJvY2Vzc0ZsYWcgPSAnTm8gc3VjaCBwcm9jZXNzJztcbiAgdHJ5IHtcbiAgICAvLyBDaGVjayBpZiB0aGUgcHJvY2VzcyBleGlzdHMgYW5kIHRocm93IGFuIGV4Y2VwdGlvbiBvdGhlcndpc2VcbiAgICBhd2FpdCB0aGlzLnNoZWxsKFsna2lsbCcsIHBpZF0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKF8uaW5jbHVkZXMoZS5zdGRlcnIsIG5vUHJvY2Vzc0ZsYWcpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghXy5pbmNsdWRlcyhlLnN0ZGVyciwgJ09wZXJhdGlvbiBub3QgcGVybWl0dGVkJykpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICAgIGxvZy5pbmZvKGBDYW5ub3Qga2lsbCBQSUQgJHtwaWR9IGR1ZSB0byBpbnN1ZmZpY2llbnQgcGVybWlzc2lvbnMuIFJldHJ5aW5nIGFzIHJvb3RgKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5zaGVsbChbJ2tpbGwnLCBwaWRdLCB7XG4gICAgICAgIHByaXZpbGVnZWQ6IHRydWVcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGUxKSB7XG4gICAgICBpZiAoXy5pbmNsdWRlcyhlMS5zdGRlcnIsIG5vUHJvY2Vzc0ZsYWcpKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRocm93IGUxO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBCcm9hZGNhc3QgcHJvY2VzcyBraWxsaW5nIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gaW50ZW50IC0gVGhlIG5hbWUgb2YgdGhlIGludGVudCB0byBicm9hZGNhc3QgdG8uXG4gKiBAcGFyYW0ge3N0cmluZ30gcHJvY2Vzc05hbWUgLSBUaGUgbmFtZSBvZiB0aGUga2lsbGVkIHByb2Nlc3MuXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgdGhlIHByb2Nlc3Mgd2FzIG5vdCBraWxsZWQuXG4gKi9cbm1ldGhvZHMuYnJvYWRjYXN0UHJvY2Vzc0VuZCA9IGFzeW5jIGZ1bmN0aW9uIGJyb2FkY2FzdFByb2Nlc3NFbmQgKGludGVudCwgcHJvY2Vzc05hbWUpIHtcbiAgLy8gc3RhcnQgdGhlIGJyb2FkY2FzdCB3aXRob3V0IHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaC5cbiAgdGhpcy5icm9hZGNhc3QoaW50ZW50KTtcbiAgLy8gd2FpdCBmb3IgdGhlIHByb2Nlc3MgdG8gZW5kXG4gIGxldCBzdGFydCA9IERhdGUubm93KCk7XG4gIGxldCB0aW1lb3V0TXMgPSA0MDAwMDtcbiAgdHJ5IHtcbiAgICB3aGlsZSAoKERhdGUubm93KCkgLSBzdGFydCkgPCB0aW1lb3V0TXMpIHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLnByb2Nlc3NFeGlzdHMocHJvY2Vzc05hbWUpKSB7XG4gICAgICAgIC8vIGNvb2wgZG93blxuICAgICAgICBhd2FpdCBzbGVlcCg0MDApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBQcm9jZXNzIG5ldmVyIGRpZWQgd2l0aGluICR7dGltZW91dE1zfSBtc2ApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gYnJvYWRjYXN0IHByb2Nlc3MgZW5kLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogQnJvYWRjYXN0IGEgbWVzc2FnZSB0byB0aGUgZ2l2ZW4gaW50ZW50LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBpbnRlbnQgLSBUaGUgbmFtZSBvZiB0aGUgaW50ZW50IHRvIGJyb2FkY2FzdCB0by5cbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiBpbnRlbnQgbmFtZSBpcyBub3QgYSB2YWxpZCBjbGFzcyBuYW1lLlxuICovXG5tZXRob2RzLmJyb2FkY2FzdCA9IGFzeW5jIGZ1bmN0aW9uIGJyb2FkY2FzdCAoaW50ZW50KSB7XG4gIGlmICghdGhpcy5pc1ZhbGlkQ2xhc3MoaW50ZW50KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBpbnRlbnQgJHtpbnRlbnR9YCk7XG4gIH1cbiAgbG9nLmRlYnVnKGBCcm9hZGNhc3Rpbmc6ICR7aW50ZW50fWApO1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnYW0nLCAnYnJvYWRjYXN0JywgJy1hJywgaW50ZW50XSk7XG59O1xuXG4vKipcbiAqIEtpbGwgQW5kcm9pZCBpbnN0cnVtZW50cyBpZiB0aGV5IGFyZSBjdXJyZW50bHkgcnVubmluZy5cbiAqL1xubWV0aG9kcy5lbmRBbmRyb2lkQ292ZXJhZ2UgPSBhc3luYyBmdW5jdGlvbiBlbmRBbmRyb2lkQ292ZXJhZ2UgKCkge1xuICBpZiAodGhpcy5pbnN0cnVtZW50UHJvYyAmJiB0aGlzLmluc3RydW1lbnRQcm9jLmlzUnVubmluZykge1xuICAgIGF3YWl0IHRoaXMuaW5zdHJ1bWVudFByb2Muc3RvcCgpO1xuICB9XG59O1xuXG4vKipcbiAqIEluc3RydW1lbnQgdGhlIHBhcnRpY3VsYXIgYWN0aXZpdHkuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBuYW1lIG9mIHRoZSBwYWNrYWdlIHRvIGJlIGluc3RydW1lbnRlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpdml0eSAtIFRoZSBuYW1lIG9mIHRoZSBtYWluIGFjdGl2aXR5IGluIHRoaXMgcGFja2FnZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBpbnN0cnVtZW50V2l0aCAtIFRoZSBuYW1lIG9mIHRoZSBwYWNrYWdlIHRvIGluc3RydW1lbnRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBhY3Rpdml0eSB3aXRoLlxuICogQHRocm93cyB7ZXJyb3J9IElmIGFueSBleGNlcHRpb24gaXMgcmVwb3J0ZWQgYnkgYWRiIHNoZWxsLlxuICovXG5tZXRob2RzLmluc3RydW1lbnQgPSBhc3luYyBmdW5jdGlvbiBpbnN0cnVtZW50IChwa2csIGFjdGl2aXR5LCBpbnN0cnVtZW50V2l0aCkge1xuICBpZiAoYWN0aXZpdHlbMF0gIT09ICcuJykge1xuICAgIHBrZyA9ICcnO1xuICB9XG4gIGxldCBwa2dBY3Rpdml0eSA9IChwa2cgKyBhY3Rpdml0eSkucmVwbGFjZSgvXFwuKy9nLCAnLicpOyAvLyBGaXggcGtnLi5hY3Rpdml0eSBlcnJvclxuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbXG4gICAgJ2FtJywgJ2luc3RydW1lbnQnLFxuICAgICctZScsICdtYWluX2FjdGl2aXR5JyxcbiAgICBwa2dBY3Rpdml0eSxcbiAgICBpbnN0cnVtZW50V2l0aCxcbiAgXSk7XG4gIGlmIChzdGRvdXQuaW5kZXhPZignRXhjZXB0aW9uJykgIT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGV4Y2VwdGlvbiBkdXJpbmcgaW5zdHJ1bWVudGF0aW9uLiBPcmlnaW5hbCBlcnJvciAke3N0ZG91dC5zcGxpdCgnXFxuJylbMF19YCk7XG4gIH1cbn07XG5cbi8qKlxuICogQ29sbGVjdCBBbmRyb2lkIGNvdmVyYWdlIGJ5IGluc3RydW1lbnRpbmcgdGhlIHBhcnRpY3VsYXIgYWN0aXZpdHkuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGluc3RydW1lbnRDbGFzcyAtIFRoZSBuYW1lIG9mIHRoZSBpbnN0cnVtZW50YXRpb24gY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gd2FpdFBrZyAtIFRoZSBuYW1lIG9mIHRoZSBwYWNrYWdlIHRvIGJlIGluc3RydW1lbnRlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB3YWl0QWN0aXZpdHkgLSBUaGUgbmFtZSBvZiB0aGUgbWFpbiBhY3Rpdml0eSBpbiB0aGlzIHBhY2thZ2UuXG4gKlxuICogQHJldHVybiB7cHJvbWlzZX0gVGhlIHByb21pc2UgaXMgc3VjY2Vzc2Z1bGx5IHJlc29sdmVkIGlmIHRoZSBpbnN0cnVtZW50YXRpb24gc3RhcnRzXG4gKiAgICAgICAgICAgICAgICAgICB3aXRob3V0IGVycm9ycy5cbiAqL1xubWV0aG9kcy5hbmRyb2lkQ292ZXJhZ2UgPSBhc3luYyBmdW5jdGlvbiBhbmRyb2lkQ292ZXJhZ2UgKGluc3RydW1lbnRDbGFzcywgd2FpdFBrZywgd2FpdEFjdGl2aXR5KSB7XG4gIGlmICghdGhpcy5pc1ZhbGlkQ2xhc3MoaW5zdHJ1bWVudENsYXNzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjbGFzcyAke2luc3RydW1lbnRDbGFzc31gKTtcbiAgfVxuICByZXR1cm4gYXdhaXQgbmV3IEIoYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGxldCBhcmdzID0gdGhpcy5leGVjdXRhYmxlLmRlZmF1bHRBcmdzXG4gICAgICAuY29uY2F0KFsnc2hlbGwnLCAnYW0nLCAnaW5zdHJ1bWVudCcsICctZScsICdjb3ZlcmFnZScsICd0cnVlJywgJy13J10pXG4gICAgICAuY29uY2F0KFtpbnN0cnVtZW50Q2xhc3NdKTtcbiAgICBsb2cuZGVidWcoYENvbGxlY3RpbmcgY292ZXJhZ2UgZGF0YSB3aXRoOiAke1t0aGlzLmV4ZWN1dGFibGUucGF0aF0uY29uY2F0KGFyZ3MpLmpvaW4oJyAnKX1gKTtcbiAgICB0cnkge1xuICAgICAgLy8gYW0gaW5zdHJ1bWVudCBydW5zIGZvciB0aGUgbGlmZSBvZiB0aGUgYXBwIHByb2Nlc3MuXG4gICAgICB0aGlzLmluc3RydW1lbnRQcm9jID0gbmV3IFN1YlByb2Nlc3ModGhpcy5leGVjdXRhYmxlLnBhdGgsIGFyZ3MpO1xuICAgICAgYXdhaXQgdGhpcy5pbnN0cnVtZW50UHJvYy5zdGFydCgwKTtcbiAgICAgIHRoaXMuaW5zdHJ1bWVudFByb2Mub24oJ291dHB1dCcsIChzdGRvdXQsIHN0ZGVycikgPT4ge1xuICAgICAgICBpZiAoc3RkZXJyKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIHJ1biBpbnN0cnVtZW50YXRpb24uIE9yaWdpbmFsIGVycm9yOiAke3N0ZGVycn1gKSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yQWN0aXZpdHkod2FpdFBrZywgd2FpdEFjdGl2aXR5KTtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICByZWplY3QobmV3IEVycm9yKGBBbmRyb2lkIGNvdmVyYWdlIGZhaWxlZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIHBhcnRpY3VsYXIgcHJvcGVydHkgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwcm9wZXJ0eSAtIFRoZSBuYW1lIG9mIHRoZSBwcm9wZXJ0eS4gVGhpcyBuYW1lIHNob3VsZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYmUga25vd24gdG8gX2FkYiBzaGVsbCBnZXRwcm9wXyB0b29sLlxuICpcbiAqIEByZXR1cm4ge3N0cmluZ30gVGhlIHZhbHVlIG9mIHRoZSBnaXZlbiBwcm9wZXJ0eS5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VQcm9wZXJ0eSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVByb3BlcnR5IChwcm9wZXJ0eSkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ2dldHByb3AnLCBwcm9wZXJ0eV0pO1xuICBsZXQgdmFsID0gc3Rkb3V0LnRyaW0oKTtcbiAgbG9nLmRlYnVnKGBDdXJyZW50IGRldmljZSBwcm9wZXJ0eSAnJHtwcm9wZXJ0eX0nOiAke3ZhbH1gKTtcbiAgcmV0dXJuIHZhbDtcbn07XG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gc2V0UHJvcE9wdHNcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcHJpdmlsZWdlZCAtIERvIHdlIHJ1biBzZXRQcm9wIGFzIGEgcHJpdmlsZWdlZCBjb21tYW5kPyBEZWZhdWx0IHRydWUuXG4gKi9cblxuLyoqXG4gKiBTZXQgdGhlIHBhcnRpY3VsYXIgcHJvcGVydHkgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwcm9wZXJ0eSAtIFRoZSBuYW1lIG9mIHRoZSBwcm9wZXJ0eS4gVGhpcyBuYW1lIHNob3VsZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYmUga25vd24gdG8gX2FkYiBzaGVsbCBzZXRwcm9wXyB0b29sLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbCAtIFRoZSBuZXcgcHJvcGVydHkgdmFsdWUuXG4gKiBAcGFyYW0ge3NldFByb3BPcHRzfSBvcHRzXG4gKlxuICogQHRocm93cyB7ZXJyb3J9IElmIF9zZXRwcm9wXyB1dGlsaXR5IGZhaWxzIHRvIGNoYW5nZSBwcm9wZXJ0eSB2YWx1ZS5cbiAqL1xubWV0aG9kcy5zZXREZXZpY2VQcm9wZXJ0eSA9IGFzeW5jIGZ1bmN0aW9uIHNldERldmljZVByb3BlcnR5IChwcm9wLCB2YWwsIG9wdHMgPSB7fSkge1xuICBjb25zdCB7cHJpdmlsZWdlZCA9IHRydWV9ID0gb3B0cztcbiAgbG9nLmRlYnVnKGBTZXR0aW5nIGRldmljZSBwcm9wZXJ0eSAnJHtwcm9wfScgdG8gJyR7dmFsfSdgKTtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ3NldHByb3AnLCBwcm9wLCB2YWxdLCB7XG4gICAgcHJpdmlsZWdlZCxcbiAgfSk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gQ3VycmVudCBzeXN0ZW0gbGFuZ3VhZ2Ugb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldERldmljZVN5c0xhbmd1YWdlID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlU3lzTGFuZ3VhZ2UgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncGVyc2lzdC5zeXMubGFuZ3VhZ2UnKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBDdXJyZW50IGNvdW50cnkgbmFtZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMuZ2V0RGV2aWNlU3lzQ291bnRyeSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVN5c0NvdW50cnkgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncGVyc2lzdC5zeXMuY291bnRyeScpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEN1cnJlbnQgc3lzdGVtIGxvY2FsZSBuYW1lIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VTeXNMb2NhbGUgPSBhc3luYyBmdW5jdGlvbiBnZXREZXZpY2VTeXNMb2NhbGUgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncGVyc2lzdC5zeXMubG9jYWxlJyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gQ3VycmVudCBwcm9kdWN0IGxhbmd1YWdlIG5hbWUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldERldmljZVByb2R1Y3RMYW5ndWFnZSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVByb2R1Y3RMYW5ndWFnZSAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5wcm9kdWN0LmxvY2FsZS5sYW5ndWFnZScpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEN1cnJlbnQgcHJvZHVjdCBjb3VudHJ5IG5hbWUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldERldmljZVByb2R1Y3RDb3VudHJ5ID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlUHJvZHVjdENvdW50cnkgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8ucHJvZHVjdC5sb2NhbGUucmVnaW9uJyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gQ3VycmVudCBwcm9kdWN0IGxvY2FsZSBuYW1lIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VQcm9kdWN0TG9jYWxlID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlUHJvZHVjdExvY2FsZSAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5wcm9kdWN0LmxvY2FsZScpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBtb2RlbCBuYW1lIG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXRNb2RlbCA9IGFzeW5jIGZ1bmN0aW9uIGdldE1vZGVsICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLnByb2R1Y3QubW9kZWwnKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBUaGUgbWFudWZhY3R1cmVyIG5hbWUgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldE1hbnVmYWN0dXJlciA9IGFzeW5jIGZ1bmN0aW9uIGdldE1hbnVmYWN0dXJlciAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5wcm9kdWN0Lm1hbnVmYWN0dXJlcicpO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGN1cnJlbnQgc2NyZWVuIHNpemUuXG4gKlxuICogQHJldHVybiB7c3RyaW5nfSBEZXZpY2Ugc2NyZWVuIHNpemUgYXMgc3RyaW5nIGluIGZvcm1hdCAnV3hIJyBvclxuICogICAgICAgICAgICAgICAgICBfbnVsbF8gaWYgaXQgY2Fubm90IGJlIGRldGVybWluZWQuXG4gKi9cbm1ldGhvZHMuZ2V0U2NyZWVuU2l6ZSA9IGFzeW5jIGZ1bmN0aW9uIGdldFNjcmVlblNpemUgKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ3dtJywgJ3NpemUnXSk7XG4gIGxldCBzaXplID0gbmV3IFJlZ0V4cCgvUGh5c2ljYWwgc2l6ZTogKFteXFxyP1xcbl0rKSovZykuZXhlYyhzdGRvdXQpO1xuICBpZiAoc2l6ZSAmJiBzaXplLmxlbmd0aCA+PSAyKSB7XG4gICAgcmV0dXJuIHNpemVbMV0udHJpbSgpO1xuICB9XG4gIHJldHVybiBudWxsO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGN1cnJlbnQgc2NyZWVuIGRlbnNpdHkgaW4gZHBpXG4gKlxuICogQHJldHVybiB7P251bWJlcn0gRGV2aWNlIHNjcmVlbiBkZW5zaXR5IGFzIGEgbnVtYmVyIG9yIF9udWxsXyBpZiBpdFxuICogICAgICAgICAgICAgICAgICBjYW5ub3QgYmUgZGV0ZXJtaW5lZFxuICovXG5tZXRob2RzLmdldFNjcmVlbkRlbnNpdHkgPSBhc3luYyBmdW5jdGlvbiBnZXRTY3JlZW5EZW5zaXR5ICgpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWyd3bScsICdkZW5zaXR5J10pO1xuICBsZXQgZGVuc2l0eSA9IG5ldyBSZWdFeHAoL1BoeXNpY2FsIGRlbnNpdHk6IChbXlxccj9cXG5dKykqL2cpLmV4ZWMoc3Rkb3V0KTtcbiAgaWYgKGRlbnNpdHkgJiYgZGVuc2l0eS5sZW5ndGggPj0gMikge1xuICAgIGxldCBkZW5zaXR5TnVtYmVyID0gcGFyc2VJbnQoZGVuc2l0eVsxXS50cmltKCksIDEwKTtcbiAgICByZXR1cm4gaXNOYU4oZGVuc2l0eU51bWJlcikgPyBudWxsIDogZGVuc2l0eU51bWJlcjtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn07XG5cbi8qKlxuICogU2V0dXAgSFRUUCBwcm94eSBpbiBkZXZpY2UgZ2xvYmFsIHNldHRpbmdzLlxuICogUmVhZCBodHRwczovL2FuZHJvaWQuZ29vZ2xlc291cmNlLmNvbS9wbGF0Zm9ybS9mcmFtZXdvcmtzL2Jhc2UvKy9hbmRyb2lkLTkuMC4wX3IyMS9jb3JlL2phdmEvYW5kcm9pZC9wcm92aWRlci9TZXR0aW5ncy5qYXZhIGZvciBlYWNoIHByb3BlcnR5XG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHByb3h5SG9zdCAtIFRoZSBob3N0IG5hbWUgb2YgdGhlIHByb3h5LlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBwcm94eVBvcnQgLSBUaGUgcG9ydCBudW1iZXIgdG8gYmUgc2V0LlxuICovXG5tZXRob2RzLnNldEh0dHBQcm94eSA9IGFzeW5jIGZ1bmN0aW9uIHNldEh0dHBQcm94eSAocHJveHlIb3N0LCBwcm94eVBvcnQpIHtcbiAgbGV0IHByb3h5ID0gYCR7cHJveHlIb3N0fToke3Byb3h5UG9ydH1gO1xuICBpZiAoXy5pc1VuZGVmaW5lZChwcm94eUhvc3QpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYWxsIHRvIHNldEh0dHBQcm94eSBtZXRob2Qgd2l0aCB1bmRlZmluZWQgcHJveHlfaG9zdDogJHtwcm94eX1gKTtcbiAgfVxuICBpZiAoXy5pc1VuZGVmaW5lZChwcm94eVBvcnQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYWxsIHRvIHNldEh0dHBQcm94eSBtZXRob2Qgd2l0aCB1bmRlZmluZWQgcHJveHlfcG9ydCAke3Byb3h5fWApO1xuICB9XG5cbiAgY29uc3QgaHR0cFByb3h5U2V0dGlucyA9IFtcbiAgICBbJ2h0dHBfcHJveHknLCBwcm94eV0sXG4gICAgWydnbG9iYWxfaHR0cF9wcm94eV9ob3N0JywgcHJveHlIb3N0XSxcbiAgICBbJ2dsb2JhbF9odHRwX3Byb3h5X3BvcnQnLCBwcm94eVBvcnRdXG4gIF07XG4gIGZvciAoY29uc3QgW3NldHRpbmdLZXksIHNldHRpbmdWYWx1ZV0gb2YgaHR0cFByb3h5U2V0dGlucykge1xuICAgIGF3YWl0IHRoaXMuc2V0U2V0dGluZygnZ2xvYmFsJywgc2V0dGluZ0tleSwgc2V0dGluZ1ZhbHVlKTtcbiAgfVxufTtcblxuLyoqXG4gKiBEZWxldGUgSFRUUCBwcm94eSBpbiBkZXZpY2UgZ2xvYmFsIHNldHRpbmdzLlxuICogUmVib290aW5nIHRoZSB0ZXN0IGRldmljZSBpcyBuZWNlc3NhcnkgdG8gYXBwbHkgdGhlIGNoYW5nZS5cbiAqL1xubWV0aG9kcy5kZWxldGVIdHRwUHJveHkgPSBhc3luYyBmdW5jdGlvbiBkZWxldGVIdHRwUHJveHkgKCkge1xuICBjb25zdCBodHRwUHJveHlTZXR0aW5zID0gW1xuICAgICdodHRwX3Byb3h5JyxcbiAgICAnZ2xvYmFsX2h0dHBfcHJveHlfaG9zdCcsXG4gICAgJ2dsb2JhbF9odHRwX3Byb3h5X3BvcnQnLFxuICAgICdnbG9iYWxfaHR0cF9wcm94eV9leGNsdXNpb25fbGlzdCcgLy8gYGdsb2JhbF9odHRwX3Byb3h5X2V4Y2x1c2lvbl9saXN0PWAgd2FzIGdlbmVyYXRlZCBieSBgc2V0dGluZ3MgZ2xvYmFsIGh0dG9fcHJveHkgeHh4eGBcbiAgXTtcbiAgZm9yIChjb25zdCBzZXR0aW5nIG9mIGh0dHBQcm94eVNldHRpbnMpIHtcbiAgICBhd2FpdCB0aGlzLnNoZWxsKFsnc2V0dGluZ3MnLCAnZGVsZXRlJywgJ2dsb2JhbCcsIHNldHRpbmddKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZXQgZGV2aWNlIHByb3BlcnR5LlxuICogW2FuZHJvaWQucHJvdmlkZXIuU2V0dGluZ3Nde0BsaW5rIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9hbmRyb2lkL3Byb3ZpZGVyL1NldHRpbmdzLmh0bWx9XG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWVzcGFjZSAtIG9uZSBvZiB7c3lzdGVtLCBzZWN1cmUsIGdsb2JhbH0sIGNhc2UtaW5zZW5zaXRpdmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gc2V0dGluZyAtIHByb3BlcnR5IG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHZhbHVlIC0gcHJvcGVydHkgdmFsdWUuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IGNvbW1hbmQgb3V0cHV0LlxuICovXG5tZXRob2RzLnNldFNldHRpbmcgPSBhc3luYyBmdW5jdGlvbiBzZXRTZXR0aW5nIChuYW1lc3BhY2UsIHNldHRpbmcsIHZhbHVlKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnc2V0dGluZ3MnLCAncHV0JywgbmFtZXNwYWNlLCBzZXR0aW5nLCB2YWx1ZV0pO1xufTtcblxuLyoqXG4gKiBHZXQgZGV2aWNlIHByb3BlcnR5LlxuICogW2FuZHJvaWQucHJvdmlkZXIuU2V0dGluZ3Nde0BsaW5rIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9hbmRyb2lkL3Byb3ZpZGVyL1NldHRpbmdzLmh0bWx9XG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWVzcGFjZSAtIG9uZSBvZiB7c3lzdGVtLCBzZWN1cmUsIGdsb2JhbH0sIGNhc2UtaW5zZW5zaXRpdmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gc2V0dGluZyAtIHByb3BlcnR5IG5hbWUuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IHByb3BlcnR5IHZhbHVlLlxuICovXG5tZXRob2RzLmdldFNldHRpbmcgPSBhc3luYyBmdW5jdGlvbiBnZXRTZXR0aW5nIChuYW1lc3BhY2UsIHNldHRpbmcpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydzZXR0aW5ncycsICdnZXQnLCBuYW1lc3BhY2UsIHNldHRpbmddKTtcbn07XG5cbi8qKlxuICogUmV0cmlldmUgdGhlIGBhZGIgYnVncmVwb3J0YCBjb21tYW5kIG91dHB1dC4gVGhpc1xuICogb3BlcmF0aW9uIG1heSB0YWtlIHVwIHRvIHNldmVyYWwgbWludXRlcy5cbiAqXG4gKiBAcGFyYW0gez9udW1iZXJ9IHRpbWVvdXQgWzEyMDAwMF0gLSBDb21tYW5kIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDb21tYW5kIHN0ZG91dFxuICovXG5tZXRob2RzLmJ1Z3JlcG9ydCA9IGFzeW5jIGZ1bmN0aW9uIGJ1Z3JlcG9ydCAodGltZW91dCA9IDEyMDAwMCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5hZGJFeGVjKFsnYnVncmVwb3J0J10sIHt0aW1lb3V0fSk7XG59O1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IFNjcmVlbnJlY29yZE9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7P3N0cmluZ30gdmlkZW9TaXplIC0gVGhlIGZvcm1hdCBpcyB3aWR0aHhoZWlnaHQuXG4gKiAgICAgICAgICAgICAgICAgIFRoZSBkZWZhdWx0IHZhbHVlIGlzIHRoZSBkZXZpY2UncyBuYXRpdmUgZGlzcGxheSByZXNvbHV0aW9uIChpZiBzdXBwb3J0ZWQpLFxuICogICAgICAgICAgICAgICAgICAxMjgweDcyMCBpZiBub3QuIEZvciBiZXN0IHJlc3VsdHMsXG4gKiAgICAgICAgICAgICAgICAgIHVzZSBhIHNpemUgc3VwcG9ydGVkIGJ5IHlvdXIgZGV2aWNlJ3MgQWR2YW5jZWQgVmlkZW8gQ29kaW5nIChBVkMpIGVuY29kZXIuXG4gKiAgICAgICAgICAgICAgICAgIEZvciBleGFtcGxlLCBcIjEyODB4NzIwXCJcbiAqIEBwcm9wZXJ0eSB7P2Jvb2xlYW59IGJ1Z1JlcG9ydCAtIFNldCBpdCB0byBgdHJ1ZWAgaW4gb3JkZXIgdG8gZGlzcGxheSBhZGRpdGlvbmFsIGluZm9ybWF0aW9uIG9uIHRoZSB2aWRlbyBvdmVybGF5LFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjaCBhcyBhIHRpbWVzdGFtcCwgdGhhdCBpcyBoZWxwZnVsIGluIHZpZGVvcyBjYXB0dXJlZCB0byBpbGx1c3RyYXRlIGJ1Z3MuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIG9wdGlvbiBpcyBvbmx5IHN1cHBvcnRlZCBzaW5jZSBBUEkgbGV2ZWwgMjcgKEFuZHJvaWQgUCkuXG4gKiBAcHJvcGVydHkgez9zdHJpbmd8bnVtYmVyfSB0aW1lTGltaXQgLSBUaGUgbWF4aW11bSByZWNvcmRpbmcgdGltZSwgaW4gc2Vjb25kcy5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoZSBkZWZhdWx0IChhbmQgbWF4aW11bSkgdmFsdWUgaXMgMTgwICgzIG1pbnV0ZXMpLlxuICogQHByb3BlcnR5IHs/c3RyaW5nfG51bWJlcn0gYml0UmF0ZSAtIFRoZSB2aWRlbyBiaXQgcmF0ZSBmb3IgdGhlIHZpZGVvLCBpbiBtZWdhYml0cyBwZXIgc2Vjb25kLlxuICogICAgICAgICAgICAgICAgVGhlIGRlZmF1bHQgdmFsdWUgaXMgNC4gWW91IGNhbiBpbmNyZWFzZSB0aGUgYml0IHJhdGUgdG8gaW1wcm92ZSB2aWRlbyBxdWFsaXR5LFxuICogICAgICAgICAgICAgICAgYnV0IGRvaW5nIHNvIHJlc3VsdHMgaW4gbGFyZ2VyIG1vdmllIGZpbGVzLlxuICovXG5cbi8qKlxuICogSW5pdGlhdGUgc2NyZWVucmVjb3JkIHV0aWxpdHkgb24gdGhlIGRldmljZVxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBkZXN0aW5hdGlvbiAtIEZ1bGwgcGF0aCB0byB0aGUgd3JpdGFibGUgbWVkaWEgZmlsZSBkZXN0aW5hdGlvblxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb24gdGhlIGRldmljZSBmaWxlIHN5c3RlbS5cbiAqIEBwYXJhbSB7P1NjcmVlbnJlY29yZE9wdGlvbnN9IG9wdGlvbnMgW3t9XVxuICogQHJldHVybnMge1N1YlByb2Nlc3N9IHNjcmVlbnJlY29yZCBwcm9jZXNzLCB3aGljaCBjYW4gYmUgdGhlbiBjb250cm9sbGVkIGJ5IHRoZSBjbGllbnQgY29kZVxuICovXG5tZXRob2RzLnNjcmVlbnJlY29yZCA9IGZ1bmN0aW9uIHNjcmVlbnJlY29yZCAoZGVzdGluYXRpb24sIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBjbWQgPSBbJ3NjcmVlbnJlY29yZCddO1xuICBjb25zdCB7XG4gICAgdmlkZW9TaXplLFxuICAgIGJpdFJhdGUsXG4gICAgdGltZUxpbWl0LFxuICAgIGJ1Z1JlcG9ydCxcbiAgfSA9IG9wdGlvbnM7XG4gIGlmICh1dGlsLmhhc1ZhbHVlKHZpZGVvU2l6ZSkpIHtcbiAgICBjbWQucHVzaCgnLS1zaXplJywgdmlkZW9TaXplKTtcbiAgfVxuICBpZiAodXRpbC5oYXNWYWx1ZSh0aW1lTGltaXQpKSB7XG4gICAgY21kLnB1c2goJy0tdGltZS1saW1pdCcsIHRpbWVMaW1pdCk7XG4gIH1cbiAgaWYgKHV0aWwuaGFzVmFsdWUoYml0UmF0ZSkpIHtcbiAgICBjbWQucHVzaCgnLS1iaXQtcmF0ZScsIGJpdFJhdGUpO1xuICB9XG4gIGlmIChidWdSZXBvcnQpIHtcbiAgICBjbWQucHVzaCgnLS1idWdyZXBvcnQnKTtcbiAgfVxuICBjbWQucHVzaChkZXN0aW5hdGlvbik7XG5cbiAgY29uc3QgZnVsbENtZCA9IFtcbiAgICAuLi50aGlzLmV4ZWN1dGFibGUuZGVmYXVsdEFyZ3MsXG4gICAgJ3NoZWxsJyxcbiAgICAuLi5jbWRcbiAgXTtcbiAgbG9nLmRlYnVnKGBCdWlsZGluZyBzY3JlZW5yZWNvcmQgcHJvY2VzcyB3aXRoIHRoZSBjb21tYW5kIGxpbmU6IGFkYiAke3V0aWwucXVvdGUoZnVsbENtZCl9YCk7XG4gIHJldHVybiBuZXcgU3ViUHJvY2Vzcyh0aGlzLmV4ZWN1dGFibGUucGF0aCwgZnVsbENtZCk7XG59O1xuXG4vKipcbiAqIEV4ZWN1dGVzIHRoZSBnaXZlbiBmdW5jdGlvbiB3aXRoIHRoZSBnaXZlbiBpbnB1dCBtZXRob2QgY29udGV4dFxuICogYW5kIHRoZW4gcmVzdG9yZXMgdGhlIElNRSB0byB0aGUgb3JpZ2luYWwgdmFsdWVcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gaW1lIC0gVmFsaWQgSU1FIGlkZW50aWZpZXJcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIC0gRnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgeyp9IFRoZSByZXN1bHQgb2YgdGhlIGdpdmVuIGZ1bmN0aW9uXG4gKi9cbm1ldGhvZHMucnVuSW5JbWVDb250ZXh0ID0gYXN5bmMgZnVuY3Rpb24gcnVuSW5JbWVDb250ZXh0IChpbWUsIGZuKSB7XG4gIGNvbnN0IG9yaWdpbmFsSW1lID0gYXdhaXQgdGhpcy5kZWZhdWx0SU1FKCk7XG4gIGlmIChvcmlnaW5hbEltZSA9PT0gaW1lKSB7XG4gICAgbG9nLmRlYnVnKGBUaGUgb3JpZ2luYWwgSU1FIGlzIHRoZSBzYW1lIGFzICcke2ltZX0nLiBUaGVyZSBpcyBubyBuZWVkIHRvIHJlc2V0IGl0YCk7XG4gIH0gZWxzZSB7XG4gICAgYXdhaXQgdGhpcy5lbmFibGVJTUUoaW1lKTtcbiAgICBhd2FpdCB0aGlzLnNldElNRShpbWUpO1xuICB9XG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IGZuKCk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKG9yaWdpbmFsSW1lICE9PSBpbWUpIHtcbiAgICAgIGF3YWl0IHRoaXMuc2V0SU1FKG9yaWdpbmFsSW1lKTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogR2V0IHR6IGRhdGFiYXNlIHRpbWUgem9uZSBmb3JtYXR0ZWQgdGltZXpvbmVcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUWiBkYXRhYmFzZSBUaW1lIFpvbmVzIGZvcm1hdFxuICpcbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiBhbnkgZXhjZXB0aW9uIGlzIHJlcG9ydGVkIGJ5IGFkYiBzaGVsbC5cbiAqL1xubWV0aG9kcy5nZXRUaW1lWm9uZSA9IGFzeW5jIGZ1bmN0aW9uIGdldFRpbWVab25lICgpIHtcbiAgbG9nLmRlYnVnKCdHZXR0aW5nIGN1cnJlbnQgdGltZXpvbmUnKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncGVyc2lzdC5zeXMudGltZXpvbmUnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZ2V0dGluZyB0aW1lem9uZS4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlcyB0aGUgbGlzdCBvZiBmZWF0dXJlcyBzdXBwb3J0ZWQgYnkgdGhlIGRldmljZSB1bmRlciB0ZXN0XG4gKlxuICogQHJldHVybnMge0FycmF5PHN0cmluZz59IHRoZSBsaXN0IG9mIHN1cHBvcnRlZCBmZWF0dXJlIG5hbWVzIG9yIGFuIGVtcHR5IGxpc3QuXG4gKiBBbiBleGFtcGxlIGFkYiBjb21tYW5kIG91dHB1dDpcbiAqIGBgYFxuICogY21kXG4gKiBsc192MlxuICogZml4ZWRfcHVzaF9ta2RpclxuICogc2hlbGxfdjJcbiAqIGFiYlxuICogc3RhdF92MlxuICogYXBleFxuICogYWJiX2V4ZWNcbiAqIHJlbW91bnRfc2hlbGxcbiAqIGZpeGVkX3B1c2hfc3ltbGlua190aW1lc3RhbXBcbiAqIGBgYFxuICogQHRocm93cyB7RXJyb3J9IGlmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSByZXRyaWV2aW5nIHRoZSBsaXN0XG4gKi9cbm1ldGhvZHMubGlzdEZlYXR1cmVzID0gYXN5bmMgZnVuY3Rpb24gbGlzdEZlYXR1cmVzICgpIHtcbiAgdGhpcy5fbWVtb2l6ZWRGZWF0dXJlcyA9IHRoaXMuX21lbW9pemVkRmVhdHVyZXNcbiAgICB8fCBfLm1lbW9pemUoYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5hZGJFeGVjKFsnZmVhdHVyZXMnXSksICgpID0+IHRoaXMuY3VyRGV2aWNlSWQpO1xuICB0cnkge1xuICAgIHJldHVybiAoYXdhaXQgdGhpcy5fbWVtb2l6ZWRGZWF0dXJlcygpKVxuICAgICAgLnNwbGl0KC9cXHMrLylcbiAgICAgIC5tYXAoKHgpID0+IHgudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChfLmluY2x1ZGVzKGUuc3RkZXJyLCAndW5rbm93biBjb21tYW5kJykpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gICAgdGhyb3cgZTtcbiAgfVxufTtcblxuLyoqXG4gKiBDaGVja3MgdGhlIHN0YXRlIG9mIHN0cmVhbWVkIGluc3RhbGwgZmVhdHVyZS5cbiAqIFRoaXMgZmVhdHVyZSBhbGxvd3MgdG8gc3BlZWQgdXAgYXBrIGluc3RhbGxhdGlvblxuICogc2luY2UgaXQgZG9lcyBub3QgcmVxdWlyZSB0aGUgb3JpZ2luYWwgYXBrIHRvIGJlIHB1c2hlZCB0b1xuICogdGhlIGRldmljZSB1bmRlciB0ZXN0IGZpcnN0LCB3aGljaCBhbHNvIHNhdmVzIHNwYWNlLlxuICogQWx0aG91Z2gsIGl0IGlzIHJlcXVpcmVkIHRoYXQgYm90aCB0aGUgZGV2aWNlIHVuZGVyIHRlc3RcbiAqIGFuZCB0aGUgYWRiIHNlcnZlciBoYXZlIHRoZSBtZW50aW9uZWQgZnVuY3Rpb25hbGl0eS5cbiAqIFNlZSBodHRwczovL2dpdGh1Yi5jb20vYW9zcC1taXJyb3IvcGxhdGZvcm1fc3lzdGVtX2NvcmUvYmxvYi9tYXN0ZXIvYWRiL2NsaWVudC9hZGJfaW5zdGFsbC5jcHBcbiAqIGZvciBtb3JlIGRldGFpbHNcbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gYHRydWVgIGlmIHRoZSBmZWF0dXJlIGlzIHN1cHBvcnRlZCBieSBib3RoIGFkYiBhbmQgdGhlXG4gKiBkZXZpY2UgdW5kZXIgdGVzdFxuICovXG5tZXRob2RzLmlzU3RyZWFtZWRJbnN0YWxsU3VwcG9ydGVkID0gYXN5bmMgZnVuY3Rpb24gaXNTdHJlYW1lZEluc3RhbGxTdXBwb3J0ZWQgKCkge1xuICBjb25zdCBwcm90byA9IE9iamVjdC5nZXRQcm90b3R5cGVPZih0aGlzKTtcbiAgcHJvdG8uX2hlbHBPdXRwdXQgPSBwcm90by5faGVscE91dHB1dCB8fCBhd2FpdCB0aGlzLmFkYkV4ZWMoWydoZWxwJ10pO1xuICByZXR1cm4gcHJvdG8uX2hlbHBPdXRwdXQuaW5jbHVkZXMoJy0tc3RyZWFtaW5nJylcbiAgICAmJiAoYXdhaXQgdGhpcy5saXN0RmVhdHVyZXMoKSkuaW5jbHVkZXMoJ2NtZCcpO1xufTtcblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBpbmNyZW1lbnRhbCBpbnN0YWxsIGZlYXR1cmUgaXMgc3VwcG9ydGVkIGJ5IEFEQi5cbiAqIFJlYWQgaHR0cHM6Ly9kZXZlbG9wZXIuYW5kcm9pZC5jb20vcHJldmlldy9mZWF0dXJlcyNpbmNyZW1lbnRhbFxuICogZm9yIG1vcmUgZGV0YWlscyBvbiBpdC5cbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gYHRydWVgIGlmIHRoZSBmZWF0dXJlIGlzIHN1cHBvcnRlZCBieSBib3RoIGFkYiBhbmQgdGhlXG4gKiBkZXZpY2UgdW5kZXIgdGVzdFxuICovXG5tZXRob2RzLmlzSW5jcmVtZW50YWxJbnN0YWxsU3VwcG9ydGVkID0gYXN5bmMgZnVuY3Rpb24gaXNJbmNyZW1lbnRhbEluc3RhbGxTdXBwb3J0ZWQgKCkge1xuICBjb25zdCB7YmluYXJ5fSA9IGF3YWl0IHRoaXMuZ2V0VmVyc2lvbigpO1xuICBpZiAoIWJpbmFyeSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdXRpbC5jb21wYXJlVmVyc2lvbnMoYmluYXJ5LnZlcnNpb24sICc+PScsICczMC4wLjEnKVxuICAgICYmIChhd2FpdCB0aGlzLmxpc3RGZWF0dXJlcygpKS5pbmNsdWRlcygnYWJiX2V4ZWMnKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IG1ldGhvZHM7XG4iXSwiZmlsZSI6ImxpYi90b29scy9hZGItY29tbWFuZHMuanMiLCJzb3VyY2VSb290IjoiLi4vLi4vLi4ifQ==
