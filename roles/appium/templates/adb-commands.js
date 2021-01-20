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

methods.listProcessStatus = async function listProcessStatus() {
  if (!_lodash.default.isBoolean(this._doesPsSupportAOption)) {
    try {
      this._doesPsSupportAOption = /^-A\b/m.test(await this.shell(['ps', '--help']));
    } catch (e) {
      _logger.default.debug(e.stack);

      this._doesPsSupportAOption = false;
    }
  }

  return await this.shell(this._doesPsSupportAOption ? ['ps', '-A'] : ['ps']);
};

methods.getNameByPid = async function getNameByPid(pid) {
  if (isNaN(pid)) {
    throw new Error(`The PID value must be a valid number. '${pid}' is given instead`);
  }

  pid = parseInt(pid, 10);
  const stdout = await this.listProcessStatus();
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
      const shellCommand = this._isPgrepAvailable ? this._canPgrepUseFullCmdLineSearch ? ['pgrep', '-f', _lodash.default.escapeRegExp(`([[:blank:]]|^)${name}([[:blank:]]|$)`)] : [`pgrep ^${_lodash.default.escapeRegExp(name.slice(-MAX_PGREP_PATTERN_LEN))}$ || pgrep ^${_lodash.default.escapeRegExp(name.slice(0, MAX_PGREP_PATTERN_LEN))}$`] : ['pgrep', name];

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

  const stdout = await this.listProcessStatus();
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


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi90b29scy9hZGItY29tbWFuZHMuanMiXSwibmFtZXMiOlsiTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEgiLCJOT1RfQ0hBTkdFQUJMRV9QRVJNX0VSUk9SIiwiSUdOT1JFRF9QRVJNX0VSUk9SUyIsIk1BWF9QR1JFUF9QQVRURVJOX0xFTiIsIkhJRERFTl9BUElfUE9MSUNZX0tFWVMiLCJQSURfQ09MVU1OX1RJVExFIiwiUFJPQ0VTU19OQU1FX0NPTFVNTl9USVRMRSIsIlBTX1RJVExFX1BBVFRFUk4iLCJSZWdFeHAiLCJtZXRob2RzIiwiZ2V0QWRiV2l0aENvcnJlY3RBZGJQYXRoIiwiZXhlY3V0YWJsZSIsInBhdGgiLCJnZXRTZGtCaW5hcnlQYXRoIiwiYWRiIiwiaW5pdEFhcHQiLCJpbml0QWFwdDIiLCJpbml0WmlwQWxpZ24iLCJpbml0QnVuZGxldG9vbCIsImJpbmFyaWVzIiwiYnVuZGxldG9vbCIsImZzIiwid2hpY2giLCJlcnIiLCJFcnJvciIsImdldEFwaUxldmVsIiwiXyIsImlzSW50ZWdlciIsIl9hcGlMZXZlbCIsInN0ck91dHB1dCIsImdldERldmljZVByb3BlcnR5IiwiYXBpTGV2ZWwiLCJwYXJzZUludCIsInRyaW0iLCJjaGFyQ29kZVEiLCJjaGFyQ29kZUF0IiwiYXBpTGV2ZWxEaWZmIiwiY29kZW5hbWUiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJnZXRQbGF0Zm9ybVZlcnNpb24iLCJ0b0xvd2VyQ2FzZSIsImxvZyIsImRlYnVnIiwidG9VcHBlckNhc2UiLCJpc05hTiIsImUiLCJtZXNzYWdlIiwiaW5mbyIsImlzRGV2aWNlQ29ubmVjdGVkIiwiZGV2aWNlcyIsImdldENvbm5lY3RlZERldmljZXMiLCJsZW5ndGgiLCJta2RpciIsInJlbW90ZVBhdGgiLCJzaGVsbCIsImlzVmFsaWRDbGFzcyIsImNsYXNzU3RyaW5nIiwiZXhlYyIsImZvcmNlU3RvcCIsInBrZyIsImtpbGxQYWNrYWdlIiwiY2xlYXIiLCJncmFudEFsbFBlcm1pc3Npb25zIiwiYXBrIiwidGFyZ2V0U2RrIiwiZHVtcHN5c091dHB1dCIsInRhcmdldFNka1ZlcnNpb25Vc2luZ1BLRyIsInRhcmdldFNka1ZlcnNpb25Gcm9tTWFuaWZlc3QiLCJ3YXJuIiwicmVxdWVzdGVkUGVybWlzc2lvbnMiLCJnZXRSZXFQZXJtaXNzaW9ucyIsImdyYW50ZWRQZXJtaXNzaW9ucyIsImdldEdyYW50ZWRQZXJtaXNzaW9ucyIsInBlcm1pc3Npb25zVG9HcmFudCIsImRpZmZlcmVuY2UiLCJpc0VtcHR5IiwiZ3JhbnRQZXJtaXNzaW9ucyIsInBlcm1pc3Npb25zIiwiSlNPTiIsInN0cmluZ2lmeSIsImNvbW1hbmRzIiwiY21kQ2h1bmsiLCJwZXJtaXNzaW9uIiwibmV4dENtZCIsImpvaW4iLCJwdXNoIiwibGFzdEVycm9yIiwiY21kIiwic29tZSIsIm1zZ1JlZ2V4IiwidGVzdCIsInN0ZGVyciIsImdyYW50UGVybWlzc2lvbiIsInJldm9rZVBlcm1pc3Npb24iLCJjbWRPdXRwdXQiLCJzdGRvdXQiLCJnZXREZW5pZWRQZXJtaXNzaW9ucyIsImdldExvY2F0aW9uUHJvdmlkZXJzIiwiZ2V0U2V0dGluZyIsInNwbGl0IiwibWFwIiwicCIsImZpbHRlciIsIkJvb2xlYW4iLCJ0b2dnbGVHUFNMb2NhdGlvblByb3ZpZGVyIiwiZW5hYmxlZCIsInNldFNldHRpbmciLCJzZXRIaWRkZW5BcGlQb2xpY3kiLCJ2YWx1ZSIsImlnbm9yZUVycm9yIiwiayIsInNldERlZmF1bHRIaWRkZW5BcGlQb2xpY3kiLCJzdG9wQW5kQ2xlYXIiLCJhdmFpbGFibGVJTUVzIiwiZW5hYmxlZElNRXMiLCJlbmFibGVJTUUiLCJpbWVJZCIsImRpc2FibGVJTUUiLCJzZXRJTUUiLCJkZWZhdWx0SU1FIiwiZW5naW5lIiwia2V5ZXZlbnQiLCJrZXljb2RlIiwiY29kZSIsImlucHV0VGV4dCIsInRleHQiLCJyZXBsYWNlIiwiY2xlYXJUZXh0RmllbGQiLCJhcmdzIiwiaSIsImxvY2siLCJpc1NjcmVlbkxvY2tlZCIsInRpbWVvdXRNcyIsIndhaXRNcyIsImludGVydmFsTXMiLCJiYWNrIiwiZ29Ub0hvbWUiLCJnZXRBZGJQYXRoIiwiZ2V0U2NyZWVuT3JpZW50YXRpb24iLCJwcm9jZXNzIiwiZW52IiwiQVBQSVVNX0xPR19EVU1QU1lTIiwiZHVtcHN5c0ZpbGUiLCJyZXNvbHZlIiwiY3dkIiwid3JpdGVGaWxlIiwiaXNTb2Z0S2V5Ym9hcmRQcmVzZW50IiwiaW5wdXRTaG93bk1hdGNoIiwiaW5wdXRWaWV3U2hvd25NYXRjaCIsImlzS2V5Ym9hcmRTaG93biIsImNhbkNsb3NlS2V5Ym9hcmQiLCJzZW5kVGVsbmV0Q29tbWFuZCIsImNvbW1hbmQiLCJleGVjRW11Q29uc29sZUNvbW1hbmQiLCJwb3J0IiwiZ2V0RW11bGF0b3JQb3J0IiwiaXNBaXJwbGFuZU1vZGVPbiIsInNldEFpcnBsYW5lTW9kZSIsIm9uIiwiYnJvYWRjYXN0QWlycGxhbmVNb2RlIiwiaXNXaWZpT24iLCJpc0RhdGFPbiIsInNldFdpZmlBbmREYXRhIiwid2lmaSIsImRhdGEiLCJpc0VtdWxhdG9yIiwidXRpbCIsImhhc1ZhbHVlIiwic2V0V2lmaVN0YXRlIiwic2V0RGF0YVN0YXRlIiwiaXNBbmltYXRpb25PbiIsImFuaW1hdG9yX2R1cmF0aW9uX3NjYWxlIiwidHJhbnNpdGlvbl9hbmltYXRpb25fc2NhbGUiLCJ3aW5kb3dfYW5pbWF0aW9uX3NjYWxlIiwic2V0dGluZyIsInJpbXJhZiIsImxvY2FsUGF0aCIsIm9wdHMiLCJwb3NpeCIsImRpcm5hbWUiLCJhZGJFeGVjIiwicHVsbCIsInRpbWVvdXQiLCJwcm9jZXNzRXhpc3RzIiwicHJvY2Vzc05hbWUiLCJnZXRQSURzQnlOYW1lIiwiZ2V0Rm9yd2FyZExpc3QiLCJjb25uZWN0aW9ucyIsIkVPTCIsImxpbmUiLCJmb3J3YXJkUG9ydCIsInN5c3RlbVBvcnQiLCJkZXZpY2VQb3J0IiwicmVtb3ZlUG9ydEZvcndhcmQiLCJnZXRSZXZlcnNlTGlzdCIsInJldmVyc2VQb3J0IiwicmVtb3ZlUG9ydFJldmVyc2UiLCJmb3J3YXJkQWJzdHJhY3RQb3J0IiwicGluZyIsImluZGV4T2YiLCJyZXN0YXJ0Iiwic3RvcExvZ2NhdCIsInJlc3RhcnRBZGIiLCJ3YWl0Rm9yRGV2aWNlIiwic3RhcnRMb2djYXQiLCJfbG9nY2F0U3RhcnR1cFBhcmFtcyIsImxvZ2NhdCIsIkxvZ2NhdCIsImRlYnVnVHJhY2UiLCJjbGVhckRldmljZUxvZ3NPblN0YXJ0Iiwic3RhcnRDYXB0dXJlIiwic3RvcENhcHR1cmUiLCJnZXRMb2djYXRMb2dzIiwiZ2V0TG9ncyIsInNldExvZ2NhdExpc3RlbmVyIiwibGlzdGVuZXIiLCJyZW1vdmVMb2djYXRMaXN0ZW5lciIsInJlbW92ZUxpc3RlbmVyIiwibGlzdFByb2Nlc3NTdGF0dXMiLCJpc0Jvb2xlYW4iLCJfZG9lc1BzU3VwcG9ydEFPcHRpb24iLCJzdGFjayIsImdldE5hbWVCeVBpZCIsInBpZCIsInRpdGxlTWF0Y2giLCJhbGxUaXRsZXMiLCJwaWRJbmRleCIsIm5hbWVPZmZzZXQiLCJwaWRSZWdleCIsIm1hdGNoZWRMaW5lIiwiaXRlbXMiLCJuYW1lIiwiX2lzUGdyZXBBdmFpbGFibGUiLCJwZ3JlcE91dHB1dCIsImxhc3QiLCJfY2FuUGdyZXBVc2VGdWxsQ21kTGluZVNlYXJjaCIsIl9pc1BpZG9mQXZhaWxhYmxlIiwic2hlbGxDb21tYW5kIiwiZXNjYXBlUmVnRXhwIiwic2xpY2UiLCJ4IiwicGlkcyIsInByb2Nlc3NOYW1lUmVnZXgiLCJraWxsUHJvY2Vzc2VzQnlOYW1lIiwiQiIsImFsbCIsImtpbGxQcm9jZXNzQnlQSUQiLCJub1Byb2Nlc3NGbGFnIiwiaW5jbHVkZXMiLCJwcml2aWxlZ2VkIiwiZTEiLCJicm9hZGNhc3RQcm9jZXNzRW5kIiwiaW50ZW50IiwiYnJvYWRjYXN0Iiwic3RhcnQiLCJEYXRlIiwibm93IiwiZW5kQW5kcm9pZENvdmVyYWdlIiwiaW5zdHJ1bWVudFByb2MiLCJpc1J1bm5pbmciLCJzdG9wIiwiaW5zdHJ1bWVudCIsImFjdGl2aXR5IiwiaW5zdHJ1bWVudFdpdGgiLCJwa2dBY3Rpdml0eSIsImFuZHJvaWRDb3ZlcmFnZSIsImluc3RydW1lbnRDbGFzcyIsIndhaXRQa2ciLCJ3YWl0QWN0aXZpdHkiLCJyZWplY3QiLCJkZWZhdWx0QXJncyIsImNvbmNhdCIsIlN1YlByb2Nlc3MiLCJ3YWl0Rm9yQWN0aXZpdHkiLCJwcm9wZXJ0eSIsInZhbCIsInNldERldmljZVByb3BlcnR5IiwicHJvcCIsImdldERldmljZVN5c0xhbmd1YWdlIiwiZ2V0RGV2aWNlU3lzQ291bnRyeSIsImdldERldmljZVN5c0xvY2FsZSIsImdldERldmljZVByb2R1Y3RMYW5ndWFnZSIsImdldERldmljZVByb2R1Y3RDb3VudHJ5IiwiZ2V0RGV2aWNlUHJvZHVjdExvY2FsZSIsImdldE1vZGVsIiwiZ2V0TWFudWZhY3R1cmVyIiwiZ2V0U2NyZWVuU2l6ZSIsInNpemUiLCJnZXRTY3JlZW5EZW5zaXR5IiwiZGVuc2l0eSIsImRlbnNpdHlOdW1iZXIiLCJzZXRIdHRwUHJveHkiLCJwcm94eUhvc3QiLCJwcm94eVBvcnQiLCJwcm94eSIsImlzVW5kZWZpbmVkIiwiaHR0cFByb3h5U2V0dGlucyIsInNldHRpbmdLZXkiLCJzZXR0aW5nVmFsdWUiLCJkZWxldGVIdHRwUHJveHkiLCJuYW1lc3BhY2UiLCJidWdyZXBvcnQiLCJzY3JlZW5yZWNvcmQiLCJkZXN0aW5hdGlvbiIsIm9wdGlvbnMiLCJ2aWRlb1NpemUiLCJiaXRSYXRlIiwidGltZUxpbWl0IiwiYnVnUmVwb3J0IiwiZnVsbENtZCIsInF1b3RlIiwicnVuSW5JbWVDb250ZXh0IiwiaW1lIiwiZm4iLCJvcmlnaW5hbEltZSIsImdldFRpbWVab25lIiwibGlzdEZlYXR1cmVzIiwiX21lbW9pemVkRmVhdHVyZXMiLCJtZW1vaXplIiwiY3VyRGV2aWNlSWQiLCJpc1N0cmVhbWVkSW5zdGFsbFN1cHBvcnRlZCIsInByb3RvIiwiT2JqZWN0IiwiZ2V0UHJvdG90eXBlT2YiLCJfaGVscE91dHB1dCIsImlzSW5jcmVtZW50YWxJbnN0YWxs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QUtvRSxZQUFMLEVBQVAsRUFBNEJwRSxRQUE1QixDQUFxQyxLQUFyQyxDQURMO0FBRUQsQ0FMRDs7QUFlQWhQLE9BQU8sQ0FBQzZULDZCQUFSLEdBQXdDLGVBQWVBLDZCQUFmLEdBQWdEO0FBQ3RGLFFBQU07QUFBQ0MsSUFBQUE7QUFBRCxNQUFXLE1BQU0sS0FBS0MsVUFBTCxFQUF2Qjs7QUFDQSxNQUFJLENBQUNELE1BQUwsRUFBYTtBQUNYLFdBQU8sS0FBUDtBQUNEOztBQUNELFNBQU9oSyxvQkFBS2tLLGVBQUwsQ0FBcUJGLE1BQU0sQ0FBQ0csT0FBNUIsRUFBcUMsSUFBckMsRUFBMkMsUUFBM0MsS0FDRixDQUFDLE1BQU0sS0FBS2IsWUFBTCxFQUFQLEVBQTRCcEUsUUFBNUIsQ0FBcUMsVUFBckMsQ0FETDtBQUVELENBUEQ7O2VBU2VoUCxPIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGxvZyBmcm9tICcuLi9sb2dnZXIuanMnO1xuaW1wb3J0IHtcbiAgZ2V0SU1FTGlzdEZyb21PdXRwdXQsIGlzU2hvd2luZ0xvY2tzY3JlZW4sIGlzQ3VycmVudEZvY3VzT25LZXlndWFyZCxcbiAgZ2V0U3VyZmFjZU9yaWVudGF0aW9uLCBpc1NjcmVlbk9uRnVsbHksIGV4dHJhY3RNYXRjaGluZ1Blcm1pc3Npb25zLFxufSBmcm9tICcuLi9oZWxwZXJzLmpzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB7IGZzLCB1dGlsIH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xuaW1wb3J0IHsgRU9MIH0gZnJvbSAnb3MnO1xuaW1wb3J0IExvZ2NhdCBmcm9tICcuLi9sb2djYXQnO1xuaW1wb3J0IHsgc2xlZXAsIHdhaXRGb3JDb25kaXRpb24gfSBmcm9tICdhc3luY2JveCc7XG5pbXBvcnQgeyBTdWJQcm9jZXNzIH0gZnJvbSAndGVlbl9wcm9jZXNzJztcbmltcG9ydCBCIGZyb20gJ2JsdWViaXJkJztcblxuY29uc3QgTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEggPSAxMDAwO1xuY29uc3QgTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUiA9IC9ub3QgYSBjaGFuZ2VhYmxlIHBlcm1pc3Npb24gdHlwZS9pO1xuY29uc3QgSUdOT1JFRF9QRVJNX0VSUk9SUyA9IFtcbiAgTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUixcbiAgL1Vua25vd24gcGVybWlzc2lvbi9pLFxuXTtcbmNvbnN0IE1BWF9QR1JFUF9QQVRURVJOX0xFTiA9IDE1O1xuY29uc3QgSElEREVOX0FQSV9QT0xJQ1lfS0VZUyA9IFtcbiAgJ2hpZGRlbl9hcGlfcG9saWN5X3ByZV9wX2FwcHMnLFxuICAnaGlkZGVuX2FwaV9wb2xpY3lfcF9hcHBzJyxcbiAgJ2hpZGRlbl9hcGlfcG9saWN5J1xuXTtcbmNvbnN0IFBJRF9DT0xVTU5fVElUTEUgPSAnUElEJztcbmNvbnN0IFBST0NFU1NfTkFNRV9DT0xVTU5fVElUTEUgPSAnTkFNRSc7XG5jb25zdCBQU19USVRMRV9QQVRURVJOID0gbmV3IFJlZ0V4cChgXiguKlxcXFxiJHtQSURfQ09MVU1OX1RJVExFfVxcXFxiLipcXFxcYiR7UFJPQ0VTU19OQU1FX0NPTFVNTl9USVRMRX1cXFxcYi4qKSRgLCAnbScpO1xuXG5cbmxldCBtZXRob2RzID0ge307XG5cbi8qKlxuICogR2V0IHRoZSBwYXRoIHRvIGFkYiBleGVjdXRhYmxlIGFtZCBhc3NpZ24gaXRcbiAqIHRvIHRoaXMuZXhlY3V0YWJsZS5wYXRoIGFuZCB0aGlzLmJpbmFyaWVzLmFkYiBwcm9wZXJ0aWVzLlxuICpcbiAqIEByZXR1cm4ge0FEQn0gQURCIGluc3RhbmNlLlxuICovXG5tZXRob2RzLmdldEFkYldpdGhDb3JyZWN0QWRiUGF0aCA9IGFzeW5jIGZ1bmN0aW9uIGdldEFkYldpdGhDb3JyZWN0QWRiUGF0aCAoKSB7XG4gIHRoaXMuZXhlY3V0YWJsZS5wYXRoID0gYXdhaXQgdGhpcy5nZXRTZGtCaW5hcnlQYXRoKCdhZGInKTtcbiAgcmV0dXJuIHRoaXMuYWRiO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGZ1bGwgcGF0aCB0byBhYXB0IHRvb2wgYW5kIGFzc2lnbiBpdCB0b1xuICogdGhpcy5iaW5hcmllcy5hYXB0IHByb3BlcnR5XG4gKi9cbm1ldGhvZHMuaW5pdEFhcHQgPSBhc3luYyBmdW5jdGlvbiBpbml0QWFwdCAoKSB7XG4gIGF3YWl0IHRoaXMuZ2V0U2RrQmluYXJ5UGF0aCgnYWFwdCcpO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGZ1bGwgcGF0aCB0byBhYXB0MiB0b29sIGFuZCBhc3NpZ24gaXQgdG9cbiAqIHRoaXMuYmluYXJpZXMuYWFwdDIgcHJvcGVydHlcbiAqL1xubWV0aG9kcy5pbml0QWFwdDIgPSBhc3luYyBmdW5jdGlvbiBpbml0QWFwdDIgKCkge1xuICBhd2FpdCB0aGlzLmdldFNka0JpbmFyeVBhdGgoJ2FhcHQyJyk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgZnVsbCBwYXRoIHRvIHppcGFsaWduIHRvb2wgYW5kIGFzc2lnbiBpdCB0b1xuICogdGhpcy5iaW5hcmllcy56aXBhbGlnbiBwcm9wZXJ0eVxuICovXG5tZXRob2RzLmluaXRaaXBBbGlnbiA9IGFzeW5jIGZ1bmN0aW9uIGluaXRaaXBBbGlnbiAoKSB7XG4gIGF3YWl0IHRoaXMuZ2V0U2RrQmluYXJ5UGF0aCgnemlwYWxpZ24nKTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBmdWxsIHBhdGggdG8gYnVuZGxldG9vbCBiaW5hcnkgYW5kIGFzc2lnbiBpdCB0b1xuICogdGhpcy5iaW5hcmllcy5idW5kbGV0b29sIHByb3BlcnR5XG4gKi9cbm1ldGhvZHMuaW5pdEJ1bmRsZXRvb2wgPSBhc3luYyBmdW5jdGlvbiBpbml0QnVuZGxldG9vbCAoKSB7XG4gIHRyeSB7XG4gICAgdGhpcy5iaW5hcmllcy5idW5kbGV0b29sID0gYXdhaXQgZnMud2hpY2goJ2J1bmRsZXRvb2wuamFyJyk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcignYnVuZGxldG9vbC5qYXIgYmluYXJ5IGlzIGV4cGVjdGVkIHRvIGJlIHByZXNlbnQgaW4gUEFUSC4gJyArXG4gICAgICAnVmlzaXQgaHR0cHM6Ly9naXRodWIuY29tL2dvb2dsZS9idW5kbGV0b29sIGZvciBtb3JlIGRldGFpbHMuJyk7XG4gIH1cbn07XG5cbi8qKlxuICogUmV0cmlldmUgdGhlIEFQSSBsZXZlbCBvZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7bnVtYmVyfSBUaGUgQVBJIGxldmVsIGFzIGludGVnZXIgbnVtYmVyLCBmb3IgZXhhbXBsZSAyMSBmb3JcbiAqICAgICAgICAgICAgICAgICAgQW5kcm9pZCBMb2xsaXBvcC4gVGhlIHJlc3VsdCBvZiB0aGlzIG1ldGhvZCBpcyBjYWNoZWQsIHNvIGFsbCB0aGUgZnVydGhlclxuICogY2FsbHMgcmV0dXJuIHRoZSBzYW1lIHZhbHVlIGFzIHRoZSBmaXJzdCBvbmUuXG4gKi9cbm1ldGhvZHMuZ2V0QXBpTGV2ZWwgPSBhc3luYyBmdW5jdGlvbiBnZXRBcGlMZXZlbCAoKSB7XG4gIGlmICghXy5pc0ludGVnZXIodGhpcy5fYXBpTGV2ZWwpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0ck91dHB1dCA9IGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLmJ1aWxkLnZlcnNpb24uc2RrJyk7XG4gICAgICBsZXQgYXBpTGV2ZWwgPSBwYXJzZUludChzdHJPdXRwdXQudHJpbSgpLCAxMCk7XG5cbiAgICAgIC8vIFdvcmthcm91bmQgZm9yIHByZXZpZXcvYmV0YSBwbGF0Zm9ybSBBUEkgbGV2ZWxcbiAgICAgIGNvbnN0IGNoYXJDb2RlUSA9ICdxJy5jaGFyQ29kZUF0KDApO1xuICAgICAgLy8gMjggaXMgdGhlIGZpcnN0IEFQSSBMZXZlbCwgd2hlcmUgQW5kcm9pZCBTREsgc3RhcnRlZCByZXR1cm5pbmcgbGV0dGVycyBpbiByZXNwb25zZSB0byBnZXRQbGF0Zm9ybVZlcnNpb25cbiAgICAgIGNvbnN0IGFwaUxldmVsRGlmZiA9IGFwaUxldmVsIC0gMjg7XG4gICAgICBjb25zdCBjb2RlbmFtZSA9IFN0cmluZy5mcm9tQ2hhckNvZGUoY2hhckNvZGVRICsgYXBpTGV2ZWxEaWZmKTtcbiAgICAgIGlmIChhcGlMZXZlbERpZmYgPj0gMCAmJiAoYXdhaXQgdGhpcy5nZXRQbGF0Zm9ybVZlcnNpb24oKSkudG9Mb3dlckNhc2UoKSA9PT0gY29kZW5hbWUpIHtcbiAgICAgICAgbG9nLmRlYnVnKGBSZWxlYXNlIHZlcnNpb24gaXMgJHtjb2RlbmFtZS50b1VwcGVyQ2FzZSgpfSBidXQgZm91bmQgQVBJIExldmVsICR7YXBpTGV2ZWx9LiBTZXR0aW5nIEFQSSBMZXZlbCB0byAke2FwaUxldmVsICsgMX1gKTtcbiAgICAgICAgYXBpTGV2ZWwrKztcbiAgICAgIH1cblxuICAgICAgdGhpcy5fYXBpTGV2ZWwgPSBhcGlMZXZlbDtcbiAgICAgIGxvZy5kZWJ1ZyhgRGV2aWNlIEFQSSBsZXZlbDogJHt0aGlzLl9hcGlMZXZlbH1gKTtcbiAgICAgIGlmIChpc05hTih0aGlzLl9hcGlMZXZlbCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUaGUgYWN0dWFsIG91dHB1dCAnJHtzdHJPdXRwdXR9JyBjYW5ub3QgYmUgY29udmVydGVkIHRvIGFuIGludGVnZXJgKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZGV2aWNlIEFQSSBsZXZlbC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGhpcy5fYXBpTGV2ZWw7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBwbGF0Zm9ybSB2ZXJzaW9uIG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBwbGF0Zm9ybSB2ZXJzaW9uIGFzIGEgc3RyaW5nLCBmb3IgZXhhbXBsZSAnNS4wJyBmb3JcbiAqIEFuZHJvaWQgTG9sbGlwb3AuXG4gKi9cbm1ldGhvZHMuZ2V0UGxhdGZvcm1WZXJzaW9uID0gYXN5bmMgZnVuY3Rpb24gZ2V0UGxhdGZvcm1WZXJzaW9uICgpIHtcbiAgbG9nLmluZm8oJ0dldHRpbmcgZGV2aWNlIHBsYXRmb3JtIHZlcnNpb24nKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8uYnVpbGQudmVyc2lvbi5yZWxlYXNlJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZGV2aWNlIHBsYXRmb3JtIHZlcnNpb24uIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBWZXJpZnkgd2hldGhlciBhIGRldmljZSBpcyBjb25uZWN0ZWQuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiBhdCBsZWFzdCBvbmUgZGV2aWNlIGlzIHZpc2libGUgdG8gYWRiLlxuICovXG5tZXRob2RzLmlzRGV2aWNlQ29ubmVjdGVkID0gYXN5bmMgZnVuY3Rpb24gaXNEZXZpY2VDb25uZWN0ZWQgKCkge1xuICBsZXQgZGV2aWNlcyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGVkRGV2aWNlcygpO1xuICByZXR1cm4gZGV2aWNlcy5sZW5ndGggPiAwO1xufTtcblxuLyoqXG4gKiBSZWN1cnNpdmVseSBjcmVhdGUgYSBuZXcgZm9sZGVyIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSBuZXcgcGF0aCB0byBiZSBjcmVhdGVkLlxuICogQHJldHVybiB7c3RyaW5nfSBta2RpciBjb21tYW5kIG91dHB1dC5cbiAqL1xubWV0aG9kcy5ta2RpciA9IGFzeW5jIGZ1bmN0aW9uIG1rZGlyIChyZW1vdGVQYXRoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnbWtkaXInLCAnLXAnLCByZW1vdGVQYXRoXSk7XG59O1xuXG4vKipcbiAqIFZlcmlmeSB3aGV0aGVyIHRoZSBnaXZlbiBhcmd1bWVudCBpcyBhXG4gKiB2YWxpZCBjbGFzcyBuYW1lLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBjbGFzc1N0cmluZyAtIFRoZSBhY3R1YWwgY2xhc3MgbmFtZSB0byBiZSB2ZXJpZmllZC5cbiAqIEByZXR1cm4gez9BcnJheS48TWF0Y2g+fSBUaGUgcmVzdWx0IG9mIFJlZ2V4cC5leGVjIG9wZXJhdGlvblxuICogICAgICAgICAgICAgICAgICAgICAgICAgIG9yIF9udWxsXyBpZiBubyBtYXRjaGVzIGFyZSBmb3VuZC5cbiAqL1xubWV0aG9kcy5pc1ZhbGlkQ2xhc3MgPSBmdW5jdGlvbiBpc1ZhbGlkQ2xhc3MgKGNsYXNzU3RyaW5nKSB7XG4gIC8vIHNvbWUucGFja2FnZS9zb21lLnBhY2thZ2UuQWN0aXZpdHlcbiAgcmV0dXJuIG5ldyBSZWdFeHAoL15bYS16QS1aMC05Li9fXSskLykuZXhlYyhjbGFzc1N0cmluZyk7XG59O1xuXG4vKipcbiAqIEZvcmNlIGFwcGxpY2F0aW9uIHRvIHN0b3Agb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHN0b3BwZWQuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBvdXRwdXQgb2YgdGhlIGNvcnJlc3BvbmRpbmcgYWRiIGNvbW1hbmQuXG4gKi9cbm1ldGhvZHMuZm9yY2VTdG9wID0gYXN5bmMgZnVuY3Rpb24gZm9yY2VTdG9wIChwa2cpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydhbScsICdmb3JjZS1zdG9wJywgcGtnXSk7XG59O1xuXG4vKlxuICogS2lsbCBhcHBsaWNhdGlvblxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHN0b3BwZWQuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBvdXRwdXQgb2YgdGhlIGNvcnJlc3BvbmRpbmcgYWRiIGNvbW1hbmQuXG4gKi9cbm1ldGhvZHMua2lsbFBhY2thZ2UgPSBhc3luYyBmdW5jdGlvbiBraWxsUGFja2FnZSAocGtnKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnYW0nLCAna2lsbCcsIHBrZ10pO1xufTtcblxuLyoqXG4gKiBDbGVhciB0aGUgdXNlciBkYXRhIG9mIHRoZSBwYXJ0aWN1bGFyIGFwcGxpY2F0aW9uIG9uIHRoZSBkZXZpY2VcbiAqIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgY2xlYXJlZC5cbiAqIEByZXR1cm4ge3N0cmluZ30gVGhlIG91dHB1dCBvZiB0aGUgY29ycmVzcG9uZGluZyBhZGIgY29tbWFuZC5cbiAqL1xubWV0aG9kcy5jbGVhciA9IGFzeW5jIGZ1bmN0aW9uIGNsZWFyIChwa2cpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdjbGVhcicsIHBrZ10pO1xufTtcblxuLyoqXG4gKiBHcmFudCBhbGwgcGVybWlzc2lvbnMgcmVxdWVzdGVkIGJ5IHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKiBUaGlzIG1ldGhvZCBpcyBvbmx5IHVzZWZ1bCBvbiBBbmRyb2lkIDYuMCsgYW5kIGZvciBhcHBsaWNhdGlvbnNcbiAqIHRoYXQgc3VwcG9ydCBjb21wb25lbnRzLWJhc2VkIHBlcm1pc3Npb25zIHNldHRpbmcuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGFwayAtIFRoZSBwYXRoIHRvIHRoZSBhY3R1YWwgYXBrIGZpbGUuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGdyYW50aW5nIHBlcm1pc3Npb25zXG4gKi9cbm1ldGhvZHMuZ3JhbnRBbGxQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdyYW50QWxsUGVybWlzc2lvbnMgKHBrZywgYXBrKSB7XG4gIGNvbnN0IGFwaUxldmVsID0gYXdhaXQgdGhpcy5nZXRBcGlMZXZlbCgpO1xuICBsZXQgdGFyZ2V0U2RrID0gMDtcbiAgbGV0IGR1bXBzeXNPdXRwdXQgPSBudWxsO1xuICB0cnkge1xuICAgIGlmICghYXBrKSB7XG4gICAgICAvKipcbiAgICAgICAqIElmIGFwayBub3QgcHJvdmlkZWQsIGNvbnNpZGVyaW5nIGFwayBhbHJlYWR5IGluc3RhbGxlZCBvbiB0aGUgZGV2aWNlXG4gICAgICAgKiBhbmQgZmV0Y2hpbmcgdGFyZ2V0U2RrIHVzaW5nIHBhY2thZ2UgbmFtZS5cbiAgICAgICAqL1xuICAgICAgZHVtcHN5c091dHB1dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ3BhY2thZ2UnLCBwa2ddKTtcbiAgICAgIHRhcmdldFNkayA9IGF3YWl0IHRoaXMudGFyZ2V0U2RrVmVyc2lvblVzaW5nUEtHKHBrZywgZHVtcHN5c091dHB1dCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhcmdldFNkayA9IGF3YWl0IHRoaXMudGFyZ2V0U2RrVmVyc2lvbkZyb21NYW5pZmVzdChhcGspO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIC8vYXZvaWRpbmcgbG9nZ2luZyBlcnJvciBzdGFjaywgYXMgY2FsbGluZyBsaWJyYXJ5IGZ1bmN0aW9uIHdvdWxkIGhhdmUgbG9nZ2VkXG4gICAgbG9nLndhcm4oYFJhbiBpbnRvIHByb2JsZW0gZ2V0dGluZyB0YXJnZXQgU0RLIHZlcnNpb247IGlnbm9yaW5nLi4uYCk7XG4gIH1cbiAgaWYgKGFwaUxldmVsID49IDIzICYmIHRhcmdldFNkayA+PSAyMykge1xuICAgIC8qKlxuICAgICAqIElmIHRoZSBkZXZpY2UgaXMgcnVubmluZyBBbmRyb2lkIDYuMChBUEkgMjMpIG9yIGhpZ2hlciwgYW5kIHlvdXIgYXBwJ3MgdGFyZ2V0IFNESyBpcyAyMyBvciBoaWdoZXI6XG4gICAgICogVGhlIGFwcCBoYXMgdG8gbGlzdCB0aGUgcGVybWlzc2lvbnMgaW4gdGhlIG1hbmlmZXN0LlxuICAgICAqIHJlZmVyOiBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS90cmFpbmluZy9wZXJtaXNzaW9ucy9yZXF1ZXN0aW5nLmh0bWxcbiAgICAgKi9cbiAgICBkdW1wc3lzT3V0cHV0ID0gZHVtcHN5c091dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gICAgY29uc3QgcmVxdWVzdGVkUGVybWlzc2lvbnMgPSBhd2FpdCB0aGlzLmdldFJlcVBlcm1pc3Npb25zKHBrZywgZHVtcHN5c091dHB1dCk7XG4gICAgY29uc3QgZ3JhbnRlZFBlcm1pc3Npb25zID0gYXdhaXQgdGhpcy5nZXRHcmFudGVkUGVybWlzc2lvbnMocGtnLCBkdW1wc3lzT3V0cHV0KTtcbiAgICBjb25zdCBwZXJtaXNzaW9uc1RvR3JhbnQgPSBfLmRpZmZlcmVuY2UocmVxdWVzdGVkUGVybWlzc2lvbnMsIGdyYW50ZWRQZXJtaXNzaW9ucyk7XG4gICAgaWYgKF8uaXNFbXB0eShwZXJtaXNzaW9uc1RvR3JhbnQpKSB7XG4gICAgICBsb2cuaW5mbyhgJHtwa2d9IGNvbnRhaW5zIG5vIHBlcm1pc3Npb25zIGF2YWlsYWJsZSBmb3IgZ3JhbnRpbmdgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5ncmFudFBlcm1pc3Npb25zKHBrZywgcGVybWlzc2lvbnNUb0dyYW50KTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogR3JhbnQgbXVsdGlwbGUgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKiBUaGlzIGNhbGwgaXMgbW9yZSBwZXJmb3JtYW50IHRoYW4gYGdyYW50UGVybWlzc2lvbmAgb25lLCBzaW5jZSBpdCBjb21iaW5lc1xuICogbXVsdGlwbGUgYGFkYiBzaGVsbGAgY2FsbHMgaW50byBhIHNpbmdsZSBjb21tYW5kLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gcGVybWlzc2lvbnMgLSBUaGUgbGlzdCBvZiBwZXJtaXNzaW9ucyB0byBiZSBncmFudGVkLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBjaGFuZ2luZyBwZXJtaXNzaW9ucy5cbiAqL1xubWV0aG9kcy5ncmFudFBlcm1pc3Npb25zID0gYXN5bmMgZnVuY3Rpb24gZ3JhbnRQZXJtaXNzaW9ucyAocGtnLCBwZXJtaXNzaW9ucykge1xuICAvLyBBcyBpdCBjb25zdW1lcyBtb3JlIHRpbWUgZm9yIGdyYW50aW5nIGVhY2ggcGVybWlzc2lvbixcbiAgLy8gdHJ5aW5nIHRvIGdyYW50IGFsbCBwZXJtaXNzaW9uIGJ5IGZvcm1pbmcgZXF1aXZhbGVudCBjb21tYW5kLlxuICAvLyBBbHNvLCBpdCBpcyBuZWNlc3NhcnkgdG8gc3BsaXQgbG9uZyBjb21tYW5kcyBpbnRvIGNodW5rcywgc2luY2UgdGhlIG1heGltdW0gbGVuZ3RoIG9mXG4gIC8vIGFkYiBzaGVsbCBidWZmZXIgaXMgbGltaXRlZFxuICBsb2cuZGVidWcoYEdyYW50aW5nIHBlcm1pc3Npb25zICR7SlNPTi5zdHJpbmdpZnkocGVybWlzc2lvbnMpfSB0byAnJHtwa2d9J2ApO1xuICBjb25zdCBjb21tYW5kcyA9IFtdO1xuICBsZXQgY21kQ2h1bmsgPSBbXTtcbiAgZm9yIChjb25zdCBwZXJtaXNzaW9uIG9mIHBlcm1pc3Npb25zKSB7XG4gICAgY29uc3QgbmV4dENtZCA9IFsncG0nLCAnZ3JhbnQnLCBwa2csIHBlcm1pc3Npb24sICc7J107XG4gICAgaWYgKG5leHRDbWQuam9pbignICcpLmxlbmd0aCArIGNtZENodW5rLmpvaW4oJyAnKS5sZW5ndGggPj0gTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEgpIHtcbiAgICAgIGNvbW1hbmRzLnB1c2goY21kQ2h1bmspO1xuICAgICAgY21kQ2h1bmsgPSBbXTtcbiAgICB9XG4gICAgY21kQ2h1bmsgPSBbLi4uY21kQ2h1bmssIC4uLm5leHRDbWRdO1xuICB9XG4gIGlmICghXy5pc0VtcHR5KGNtZENodW5rKSkge1xuICAgIGNvbW1hbmRzLnB1c2goY21kQ2h1bmspO1xuICB9XG4gIGxvZy5kZWJ1ZyhgR290IHRoZSBmb2xsb3dpbmcgY29tbWFuZCBjaHVua3MgdG8gZXhlY3V0ZTogJHtKU09OLnN0cmluZ2lmeShjb21tYW5kcyl9YCk7XG4gIGxldCBsYXN0RXJyb3IgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNtZCBvZiBjb21tYW5kcykge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnNoZWxsKGNtZCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gdGhpcyBpcyB0byBnaXZlIHRoZSBtZXRob2QgYSBjaGFuY2UgdG8gYXNzaWduIGFsbCB0aGUgcmVxdWVzdGVkIHBlcm1pc3Npb25zXG4gICAgICAvLyBiZWZvcmUgdG8gcXVpdCBpbiBjYXNlIHdlJ2QgbGlrZSB0byBpZ25vcmUgdGhlIGVycm9yIG9uIHRoZSBoaWdoZXIgbGV2ZWxcbiAgICAgIGlmICghSUdOT1JFRF9QRVJNX0VSUk9SUy5zb21lKChtc2dSZWdleCkgPT4gbXNnUmVnZXgudGVzdChlLnN0ZGVyciB8fCBlLm1lc3NhZ2UpKSkge1xuICAgICAgICBsYXN0RXJyb3IgPSBlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAobGFzdEVycm9yKSB7XG4gICAgdGhyb3cgbGFzdEVycm9yO1xuICB9XG59O1xuXG4vKipcbiAqIEdyYW50IHNpbmdsZSBwZXJtaXNzaW9uIGZvciB0aGUgcGFydGljdWxhciBwYWNrYWdlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBwZXJtaXNzaW9uIC0gVGhlIGZ1bGwgbmFtZSBvZiB0aGUgcGVybWlzc2lvbiB0byBiZSBncmFudGVkLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBjaGFuZ2luZyBwZXJtaXNzaW9ucy5cbiAqL1xubWV0aG9kcy5ncmFudFBlcm1pc3Npb24gPSBhc3luYyBmdW5jdGlvbiBncmFudFBlcm1pc3Npb24gKHBrZywgcGVybWlzc2lvbikge1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdncmFudCcsIHBrZywgcGVybWlzc2lvbl0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKCFOT1RfQ0hBTkdFQUJMRV9QRVJNX0VSUk9SLnRlc3QoZS5zdGRlcnIgfHwgZS5tZXNzYWdlKSkge1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogUmV2b2tlIHNpbmdsZSBwZXJtaXNzaW9uIGZyb20gdGhlIHBhcnRpY3VsYXIgcGFja2FnZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGtnIC0gVGhlIHBhY2thZ2UgbmFtZSB0byBiZSBwcm9jZXNzZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gcGVybWlzc2lvbiAtIFRoZSBmdWxsIG5hbWUgb2YgdGhlIHBlcm1pc3Npb24gdG8gYmUgcmV2b2tlZC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgY2hhbmdpbmcgcGVybWlzc2lvbnMuXG4gKi9cbm1ldGhvZHMucmV2b2tlUGVybWlzc2lvbiA9IGFzeW5jIGZ1bmN0aW9uIHJldm9rZVBlcm1pc3Npb24gKHBrZywgcGVybWlzc2lvbikge1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdyZXZva2UnLCBwa2csIHBlcm1pc3Npb25dKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmICghTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUi50ZXN0KGUuc3RkZXJyIHx8IGUubWVzc2FnZSkpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGdyYW50ZWQgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGNtZE91dHB1dCBbbnVsbF0gLSBPcHRpb25hbCBwYXJhbWV0ZXIgY29udGFpbmluZyBjb21tYW5kIG91dHB1dCBvZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfZHVtcHN5cyBwYWNrYWdlXyBjb21tYW5kLiBJdCBtYXkgc3BlZWQgdXAgdGhlIG1ldGhvZCBleGVjdXRpb24uXG4gKiBAcmV0dXJuIHtBcnJheTxTdHJpbmc+fSBUaGUgbGlzdCBvZiBncmFudGVkIHBlcm1pc3Npb25zIG9yIGFuIGVtcHR5IGxpc3QuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGNoYW5naW5nIHBlcm1pc3Npb25zLlxuICovXG5tZXRob2RzLmdldEdyYW50ZWRQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdldEdyYW50ZWRQZXJtaXNzaW9ucyAocGtnLCBjbWRPdXRwdXQgPSBudWxsKSB7XG4gIGxvZy5kZWJ1ZygnUmV0cmlldmluZyBncmFudGVkIHBlcm1pc3Npb25zJyk7XG4gIGNvbnN0IHN0ZG91dCA9IGNtZE91dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gIHJldHVybiBleHRyYWN0TWF0Y2hpbmdQZXJtaXNzaW9ucyhzdGRvdXQsIFsnaW5zdGFsbCcsICdydW50aW1lJ10sIHRydWUpO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBkZW5pZWQgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGNtZE91dHB1dCBbbnVsbF0gLSBPcHRpb25hbCBwYXJhbWV0ZXIgY29udGFpbmluZyBjb21tYW5kIG91dHB1dCBvZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfZHVtcHN5cyBwYWNrYWdlXyBjb21tYW5kLiBJdCBtYXkgc3BlZWQgdXAgdGhlIG1ldGhvZCBleGVjdXRpb24uXG4gKiBAcmV0dXJuIHtBcnJheTxTdHJpbmc+fSBUaGUgbGlzdCBvZiBkZW5pZWQgcGVybWlzc2lvbnMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqL1xubWV0aG9kcy5nZXREZW5pZWRQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdldERlbmllZFBlcm1pc3Npb25zIChwa2csIGNtZE91dHB1dCA9IG51bGwpIHtcbiAgbG9nLmRlYnVnKCdSZXRyaWV2aW5nIGRlbmllZCBwZXJtaXNzaW9ucycpO1xuICBjb25zdCBzdGRvdXQgPSBjbWRPdXRwdXQgfHwgYXdhaXQgdGhpcy5zaGVsbChbJ2R1bXBzeXMnLCAncGFja2FnZScsIHBrZ10pO1xuICByZXR1cm4gZXh0cmFjdE1hdGNoaW5nUGVybWlzc2lvbnMoc3Rkb3V0LCBbJ2luc3RhbGwnLCAncnVudGltZSddLCBmYWxzZSk7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIHJlcXVlc3RlZCBwZXJtaXNzaW9ucyBmb3IgdGhlIHBhcnRpY3VsYXIgcGFja2FnZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGtnIC0gVGhlIHBhY2thZ2UgbmFtZSB0byBiZSBwcm9jZXNzZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gY21kT3V0cHV0IFtudWxsXSAtIE9wdGlvbmFsIHBhcmFtZXRlciBjb250YWluaW5nIGNvbW1hbmQgb3V0cHV0IG9mXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9kdW1wc3lzIHBhY2thZ2VfIGNvbW1hbmQuIEl0IG1heSBzcGVlZCB1cCB0aGUgbWV0aG9kIGV4ZWN1dGlvbi5cbiAqIEByZXR1cm4ge0FycmF5PFN0cmluZz59IFRoZSBsaXN0IG9mIHJlcXVlc3RlZCBwZXJtaXNzaW9ucyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmdldFJlcVBlcm1pc3Npb25zID0gYXN5bmMgZnVuY3Rpb24gZ2V0UmVxUGVybWlzc2lvbnMgKHBrZywgY21kT3V0cHV0ID0gbnVsbCkge1xuICBsb2cuZGVidWcoJ1JldHJpZXZpbmcgcmVxdWVzdGVkIHBlcm1pc3Npb25zJyk7XG4gIGNvbnN0IHN0ZG91dCA9IGNtZE91dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gIHJldHVybiBleHRyYWN0TWF0Y2hpbmdQZXJtaXNzaW9ucyhzdGRvdXQsIFsncmVxdWVzdGVkJ10pO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBsb2NhdGlvbiBwcm92aWRlcnMgZm9yIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGxvY2F0aW9uIHByb3ZpZGVycyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmdldExvY2F0aW9uUHJvdmlkZXJzID0gYXN5bmMgZnVuY3Rpb24gZ2V0TG9jYXRpb25Qcm92aWRlcnMgKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdzZWN1cmUnLCAnbG9jYXRpb25fcHJvdmlkZXJzX2FsbG93ZWQnKTtcbiAgcmV0dXJuIHN0ZG91dC50cmltKCkuc3BsaXQoJywnKVxuICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59O1xuXG4vKipcbiAqIFRvZ2dsZSB0aGUgc3RhdGUgb2YgR1BTIGxvY2F0aW9uIHByb3ZpZGVyLlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gZW5hYmxlZCAtIFdoZXRoZXIgdG8gZW5hYmxlICh0cnVlKSBvciBkaXNhYmxlIChmYWxzZSkgdGhlIEdQUyBwcm92aWRlci5cbiAqL1xubWV0aG9kcy50b2dnbGVHUFNMb2NhdGlvblByb3ZpZGVyID0gYXN5bmMgZnVuY3Rpb24gdG9nZ2xlR1BTTG9jYXRpb25Qcm92aWRlciAoZW5hYmxlZCkge1xuICBhd2FpdCB0aGlzLnNldFNldHRpbmcoJ3NlY3VyZScsICdsb2NhdGlvbl9wcm92aWRlcnNfYWxsb3dlZCcsIGAke2VuYWJsZWQgPyAnKycgOiAnLSd9Z3BzYCk7XG59O1xuXG4vKipcbiAqIFNldCBoaWRkZW4gYXBpIHBvbGljeSB0byBtYW5hZ2UgYWNjZXNzIHRvIG5vbi1TREsgQVBJcy5cbiAqIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvcmVzdHJpY3Rpb25zLW5vbi1zZGstaW50ZXJmYWNlc1xuICpcbiAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gdmFsdWUgLSBUaGUgQVBJIGVuZm9yY2VtZW50IHBvbGljeS5cbiAqICAgICBGb3IgQW5kcm9pZCBQXG4gKiAgICAgMDogRGlzYWJsZSBub24tU0RLIEFQSSB1c2FnZSBkZXRlY3Rpb24uIFRoaXMgd2lsbCBhbHNvIGRpc2FibGUgbG9nZ2luZywgYW5kIGFsc28gYnJlYWsgdGhlIHN0cmljdCBtb2RlIEFQSSxcbiAqICAgICAgICBkZXRlY3ROb25TZGtBcGlVc2FnZSgpLiBOb3QgcmVjb21tZW5kZWQuXG4gKiAgICAgMTogXCJKdXN0IHdhcm5cIiAtIHBlcm1pdCBhY2Nlc3MgdG8gYWxsIG5vbi1TREsgQVBJcywgYnV0IGtlZXAgd2FybmluZ3MgaW4gdGhlIGxvZy5cbiAqICAgICAgICBUaGUgc3RyaWN0IG1vZGUgQVBJIHdpbGwga2VlcCB3b3JraW5nLlxuICogICAgIDI6IERpc2FsbG93IHVzYWdlIG9mIGRhcmsgZ3JleSBhbmQgYmxhY2sgbGlzdGVkIEFQSXMuXG4gKiAgICAgMzogRGlzYWxsb3cgdXNhZ2Ugb2YgYmxhY2tsaXN0ZWQgQVBJcywgYnV0IGFsbG93IHVzYWdlIG9mIGRhcmsgZ3JleSBsaXN0ZWQgQVBJcy5cbiAqXG4gKiAgICAgRm9yIEFuZHJvaWQgUVxuICogICAgIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvbm9uLXNkay1xI2VuYWJsZS1ub24tc2RrLWFjY2Vzc1xuICogICAgIDA6IERpc2FibGUgYWxsIGRldGVjdGlvbiBvZiBub24tU0RLIGludGVyZmFjZXMuIFVzaW5nIHRoaXMgc2V0dGluZyBkaXNhYmxlcyBhbGwgbG9nIG1lc3NhZ2VzIGZvciBub24tU0RLIGludGVyZmFjZSB1c2FnZVxuICogICAgICAgIGFuZCBwcmV2ZW50cyB5b3UgZnJvbSB0ZXN0aW5nIHlvdXIgYXBwIHVzaW5nIHRoZSBTdHJpY3RNb2RlIEFQSS4gVGhpcyBzZXR0aW5nIGlzIG5vdCByZWNvbW1lbmRlZC5cbiAqICAgICAxOiBFbmFibGUgYWNjZXNzIHRvIGFsbCBub24tU0RLIGludGVyZmFjZXMsIGJ1dCBwcmludCBsb2cgbWVzc2FnZXMgd2l0aCB3YXJuaW5ncyBmb3IgYW55IG5vbi1TREsgaW50ZXJmYWNlIHVzYWdlLlxuICogICAgICAgIFVzaW5nIHRoaXMgc2V0dGluZyBhbHNvIGFsbG93cyB5b3UgdG8gdGVzdCB5b3VyIGFwcCB1c2luZyB0aGUgU3RyaWN0TW9kZSBBUEkuXG4gKiAgICAgMjogRGlzYWxsb3cgdXNhZ2Ugb2Ygbm9uLVNESyBpbnRlcmZhY2VzIHRoYXQgYmVsb25nIHRvIGVpdGhlciB0aGUgYmxhY2sgbGlzdFxuICogICAgICAgIG9yIHRvIGEgcmVzdHJpY3RlZCBncmV5bGlzdCBmb3IgeW91ciB0YXJnZXQgQVBJIGxldmVsLlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaWdub3JlRXJyb3IgW2ZhbHNlXSBXaGV0aGVyIHRvIGlnbm9yZSBhbiBleGNlcHRpb24gaW4gJ2FkYiBzaGVsbCBzZXR0aW5ncyBwdXQgZ2xvYmFsJyBjb21tYW5kXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIGFuZCBpZ25vcmVFcnJvciB3YXMgdHJ1ZSB3aGlsZSBleGVjdXRpbmcgJ2FkYiBzaGVsbCBzZXR0aW5ncyBwdXQgZ2xvYmFsJ1xuICogICAgICAgICAgICAgICAgIGNvbW1hbmQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLnNldEhpZGRlbkFwaVBvbGljeSA9IGFzeW5jIGZ1bmN0aW9uIHNldEhpZGRlbkFwaVBvbGljeSAodmFsdWUsIGlnbm9yZUVycm9yID0gZmFsc2UpIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCB0aGlzLnNoZWxsKEhJRERFTl9BUElfUE9MSUNZX0tFWVMubWFwKChrKSA9PiBgc2V0dGluZ3MgcHV0IGdsb2JhbCAke2t9ICR7dmFsdWV9YCkuam9pbignOycpKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmICghaWdub3JlRXJyb3IpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICAgIGxvZy5pbmZvKGBGYWlsZWQgdG8gc2V0IHNldHRpbmcga2V5cyAnJHtISURERU5fQVBJX1BPTElDWV9LRVlTfScgdG8gJyR7dmFsdWV9Jy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFJlc2V0IGFjY2VzcyB0byBub24tU0RLIEFQSXMgdG8gaXRzIGRlZmF1bHQgc2V0dGluZy5cbiAqIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvcmVzdHJpY3Rpb25zLW5vbi1zZGstaW50ZXJmYWNlc1xuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaWdub3JlRXJyb3IgW2ZhbHNlXSBXaGV0aGVyIHRvIGlnbm9yZSBhbiBleGNlcHRpb24gaW4gJ2FkYiBzaGVsbCBzZXR0aW5ncyBkZWxldGUgZ2xvYmFsJyBjb21tYW5kXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIGFuZCBpZ25vcmVFcnJvciB3YXMgdHJ1ZSB3aGlsZSBleGVjdXRpbmcgJ2FkYiBzaGVsbCBzZXR0aW5ncyBkZWxldGUgZ2xvYmFsJ1xuICogICAgICAgICAgICAgICAgIGNvbW1hbmQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLnNldERlZmF1bHRIaWRkZW5BcGlQb2xpY3kgPSBhc3luYyBmdW5jdGlvbiBzZXREZWZhdWx0SGlkZGVuQXBpUG9saWN5IChpZ25vcmVFcnJvciA9IGZhbHNlKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChISURERU5fQVBJX1BPTElDWV9LRVlTLm1hcCgoaykgPT4gYHNldHRpbmdzIGRlbGV0ZSBnbG9iYWwgJHtrfWApLmpvaW4oJzsnKSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoIWlnbm9yZUVycm9yKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgICBsb2cuaW5mbyhgRmFpbGVkIHRvIGRlbGV0ZSBrZXlzICcke0hJRERFTl9BUElfUE9MSUNZX0tFWVN9Jy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFN0b3AgdGhlIHBhcnRpY3VsYXIgcGFja2FnZSBpZiBpdCBpcyBydW5uaW5nIGFuZCBjbGVhcnMgaXRzIGFwcGxpY2F0aW9uIGRhdGEuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICovXG5tZXRob2RzLnN0b3BBbmRDbGVhciA9IGFzeW5jIGZ1bmN0aW9uIHN0b3BBbmRDbGVhciAocGtnKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgdGhpcy5mb3JjZVN0b3AocGtnKTtcbiAgICBhd2FpdCB0aGlzLmNsZWFyKHBrZyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBzdG9wIGFuZCBjbGVhciAke3BrZ30uIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBhdmFpbGFibGUgaW5wdXQgbWV0aG9kcyAoSU1FcykgZm9yIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIGxpc3Qgb2YgSU1FIG5hbWVzIG9yIGFuIGVtcHR5IGxpc3QuXG4gKi9cbm1ldGhvZHMuYXZhaWxhYmxlSU1FcyA9IGFzeW5jIGZ1bmN0aW9uIGF2YWlsYWJsZUlNRXMgKCkge1xuICB0cnkge1xuICAgIHJldHVybiBnZXRJTUVMaXN0RnJvbU91dHB1dChhd2FpdCB0aGlzLnNoZWxsKFsnaW1lJywgJ2xpc3QnLCAnLWEnXSkpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBnZXR0aW5nIGF2YWlsYWJsZSBJTUUncy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGVuYWJsZWQgaW5wdXQgbWV0aG9kcyAoSU1FcykgZm9yIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIGxpc3Qgb2YgZW5hYmxlZCBJTUUgbmFtZXMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqL1xubWV0aG9kcy5lbmFibGVkSU1FcyA9IGFzeW5jIGZ1bmN0aW9uIGVuYWJsZWRJTUVzICgpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZ2V0SU1FTGlzdEZyb21PdXRwdXQoYXdhaXQgdGhpcy5zaGVsbChbJ2ltZScsICdsaXN0J10pKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZ2V0dGluZyBlbmFibGVkIElNRSdzLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogRW5hYmxlIHRoZSBwYXJ0aWN1bGFyIGlucHV0IG1ldGhvZCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGltZUlkIC0gT25lIG9mIGV4aXN0aW5nIElNRSBpZHMuXG4gKi9cbm1ldGhvZHMuZW5hYmxlSU1FID0gYXN5bmMgZnVuY3Rpb24gZW5hYmxlSU1FIChpbWVJZCkge1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnaW1lJywgJ2VuYWJsZScsIGltZUlkXSk7XG59O1xuXG4vKipcbiAqIERpc2FibGUgdGhlIHBhcnRpY3VsYXIgaW5wdXQgbWV0aG9kIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gaW1lSWQgLSBPbmUgb2YgZXhpc3RpbmcgSU1FIGlkcy5cbiAqL1xubWV0aG9kcy5kaXNhYmxlSU1FID0gYXN5bmMgZnVuY3Rpb24gZGlzYWJsZUlNRSAoaW1lSWQpIHtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ2ltZScsICdkaXNhYmxlJywgaW1lSWRdKTtcbn07XG5cbi8qKlxuICogU2V0IHRoZSBwYXJ0aWN1bGFyIGlucHV0IG1ldGhvZCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGltZUlkIC0gT25lIG9mIGV4aXN0aW5nIElNRSBpZHMuXG4gKi9cbm1ldGhvZHMuc2V0SU1FID0gYXN5bmMgZnVuY3Rpb24gc2V0SU1FIChpbWVJZCkge1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnaW1lJywgJ3NldCcsIGltZUlkXSk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgZGVmYXVsdCBpbnB1dCBtZXRob2Qgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4gez9zdHJpbmd9IFRoZSBuYW1lIG9mIHRoZSBkZWZhdWx0IGlucHV0IG1ldGhvZFxuICovXG5tZXRob2RzLmRlZmF1bHRJTUUgPSBhc3luYyBmdW5jdGlvbiBkZWZhdWx0SU1FICgpIHtcbiAgdHJ5IHtcbiAgICBsZXQgZW5naW5lID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdzZWN1cmUnLCAnZGVmYXVsdF9pbnB1dF9tZXRob2QnKTtcbiAgICBpZiAoZW5naW5lID09PSAnbnVsbCcpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICByZXR1cm4gZW5naW5lLnRyaW0oKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZ2V0dGluZyBkZWZhdWx0IElNRS4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFNlbmQgdGhlIHBhcnRpY3VsYXIga2V5Y29kZSB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBrZXljb2RlIC0gVGhlIGFjdHVhbCBrZXkgY29kZSB0byBiZSBzZW50LlxuICovXG5tZXRob2RzLmtleWV2ZW50ID0gYXN5bmMgZnVuY3Rpb24ga2V5ZXZlbnQgKGtleWNvZGUpIHtcbiAgLy8ga2V5Y29kZSBtdXN0IGJlIGFuIGludC5cbiAgbGV0IGNvZGUgPSBwYXJzZUludChrZXljb2RlLCAxMCk7XG4gIGF3YWl0IHRoaXMuc2hlbGwoWydpbnB1dCcsICdrZXlldmVudCcsIGNvZGVdKTtcbn07XG5cbi8qKlxuICogU2VuZCB0aGUgcGFydGljdWxhciB0ZXh0IHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gdGV4dCAtIFRoZSBhY3R1YWwgdGV4dCB0byBiZSBzZW50LlxuICovXG5tZXRob2RzLmlucHV0VGV4dCA9IGFzeW5jIGZ1bmN0aW9uIGlucHV0VGV4dCAodGV4dCkge1xuICAvKiBlc2xpbnQtZGlzYWJsZSBuby11c2VsZXNzLWVzY2FwZSAqL1xuICAvLyBuZWVkIHRvIGVzY2FwZSB3aGl0ZXNwYWNlIGFuZCAoICkgPCA+IHwgOyAmICogXFwgfiBcIiAnXG4gIHRleHQgPSB0ZXh0XG4gICAgICAgICAgLnJlcGxhY2UoL1xcXFwvZywgJ1xcXFxcXFxcJylcbiAgICAgICAgICAucmVwbGFjZSgvXFwoL2csICdcXCgnKVxuICAgICAgICAgIC5yZXBsYWNlKC9cXCkvZywgJ1xcKScpXG4gICAgICAgICAgLnJlcGxhY2UoLzwvZywgJ1xcPCcpXG4gICAgICAgICAgLnJlcGxhY2UoLz4vZywgJ1xcPicpXG4gICAgICAgICAgLnJlcGxhY2UoL1xcfC9nLCAnXFx8JylcbiAgICAgICAgICAucmVwbGFjZSgvOy9nLCAnXFw7JylcbiAgICAgICAgICAucmVwbGFjZSgvJi9nLCAnXFwmJylcbiAgICAgICAgICAucmVwbGFjZSgvXFwqL2csICdcXConKVxuICAgICAgICAgIC5yZXBsYWNlKC9+L2csICdcXH4nKVxuICAgICAgICAgIC5yZXBsYWNlKC9cIi9nLCAnXFxcIicpXG4gICAgICAgICAgLnJlcGxhY2UoLycvZywgXCJcXCdcIilcbiAgICAgICAgICAucmVwbGFjZSgvIC9nLCAnJXMnKTtcbiAgLyogZXNsaW50LWRpc2FibGUgbm8tdXNlbGVzcy1lc2NhcGUgKi9cbiAgYXdhaXQgdGhpcy5zaGVsbChbJ2lucHV0JywgJ3RleHQnLCB0ZXh0XSk7XG59O1xuXG4vKipcbiAqIENsZWFyIHRoZSBhY3RpdmUgdGV4dCBmaWVsZCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QgYnkgc2VuZGluZ1xuICogc3BlY2lhbCBrZXlldmVudHMgdG8gaXQuXG4gKlxuICogQHBhcmFtIHtudW1iZXJ9IGxlbmd0aCBbMTAwXSAtIFRoZSBtYXhpbXVtIGxlbmd0aCBvZiB0aGUgdGV4dCBpbiB0aGUgZmllbGQgdG8gYmUgY2xlYXJlZC5cbiAqL1xubWV0aG9kcy5jbGVhclRleHRGaWVsZCA9IGFzeW5jIGZ1bmN0aW9uIGNsZWFyVGV4dEZpZWxkIChsZW5ndGggPSAxMDApIHtcbiAgLy8gYXNzdW1lcyB0aGF0IHRoZSBFZGl0VGV4dCBmaWVsZCBhbHJlYWR5IGhhcyBmb2N1c1xuICBsb2cuZGVidWcoYENsZWFyaW5nIHVwIHRvICR7bGVuZ3RofSBjaGFyYWN0ZXJzYCk7XG4gIGlmIChsZW5ndGggPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cbiAgbGV0IGFyZ3MgPSBbJ2lucHV0JywgJ2tleWV2ZW50J107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAvLyB3ZSBjYW5ub3Qga25vdyB3aGVyZSB0aGUgY3Vyc29yIGlzIGluIHRoZSB0ZXh0IGZpZWxkLCBzbyBkZWxldGUgYm90aCBiZWZvcmVcbiAgICAvLyBhbmQgYWZ0ZXIgc28gdGhhdCB3ZSBnZXQgcmlkIG9mIGV2ZXJ5dGhpbmdcbiAgICAvLyBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvYW5kcm9pZC92aWV3L0tleUV2ZW50Lmh0bWwjS0VZQ09ERV9ERUxcbiAgICAvLyBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvYW5kcm9pZC92aWV3L0tleUV2ZW50Lmh0bWwjS0VZQ09ERV9GT1JXQVJEX0RFTFxuICAgIGFyZ3MucHVzaCgnNjcnLCAnMTEyJyk7XG4gIH1cbiAgYXdhaXQgdGhpcy5zaGVsbChhcmdzKTtcbn07XG5cbi8qKlxuICogU2VuZCB0aGUgc3BlY2lhbCBrZXljb2RlIHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdCBpbiBvcmRlciB0byBsb2NrIGl0LlxuICovXG5tZXRob2RzLmxvY2sgPSBhc3luYyBmdW5jdGlvbiBsb2NrICgpIHtcbiAgaWYgKGF3YWl0IHRoaXMuaXNTY3JlZW5Mb2NrZWQoKSkge1xuICAgIGxvZy5kZWJ1ZygnU2NyZWVuIGlzIGFscmVhZHkgbG9ja2VkLiBEb2luZyBub3RoaW5nLicpO1xuICAgIHJldHVybjtcbiAgfVxuICBsb2cuZGVidWcoJ1ByZXNzaW5nIHRoZSBLRVlDT0RFX1BPV0VSIGJ1dHRvbiB0byBsb2NrIHNjcmVlbicpO1xuICBhd2FpdCB0aGlzLmtleWV2ZW50KDI2KTtcblxuICBjb25zdCB0aW1lb3V0TXMgPSA1MDAwO1xuICB0cnkge1xuICAgIGF3YWl0IHdhaXRGb3JDb25kaXRpb24oYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5pc1NjcmVlbkxvY2tlZCgpLCB7XG4gICAgICB3YWl0TXM6IHRpbWVvdXRNcyxcbiAgICAgIGludGVydmFsTXM6IDUwMCxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVGhlIGRldmljZSBzY3JlZW4gaXMgc3RpbGwgbG9ja2VkIGFmdGVyICR7dGltZW91dE1zfW1zIHRpbWVvdXRgKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZW5kIHRoZSBzcGVjaWFsIGtleWNvZGUgdG8gdGhlIGRldmljZSB1bmRlciB0ZXN0IGluIG9yZGVyIHRvIGVtdWxhdGVcbiAqIEJhY2sgYnV0dG9uIHRhcC5cbiAqL1xubWV0aG9kcy5iYWNrID0gYXN5bmMgZnVuY3Rpb24gYmFjayAoKSB7XG4gIGxvZy5kZWJ1ZygnUHJlc3NpbmcgdGhlIEJBQ0sgYnV0dG9uJyk7XG4gIGF3YWl0IHRoaXMua2V5ZXZlbnQoNCk7XG59O1xuXG4vKipcbiAqIFNlbmQgdGhlIHNwZWNpYWwga2V5Y29kZSB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QgaW4gb3JkZXIgdG8gZW11bGF0ZVxuICogSG9tZSBidXR0b24gdGFwLlxuICovXG5tZXRob2RzLmdvVG9Ib21lID0gYXN5bmMgZnVuY3Rpb24gZ29Ub0hvbWUgKCkge1xuICBsb2cuZGVidWcoJ1ByZXNzaW5nIHRoZSBIT01FIGJ1dHRvbicpO1xuICBhd2FpdCB0aGlzLmtleWV2ZW50KDMpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IHRoZSBhY3R1YWwgcGF0aCB0byBhZGIgZXhlY3V0YWJsZS5cbiAqL1xubWV0aG9kcy5nZXRBZGJQYXRoID0gZnVuY3Rpb24gZ2V0QWRiUGF0aCAoKSB7XG4gIHJldHVybiB0aGlzLmV4ZWN1dGFibGUucGF0aDtcbn07XG5cbi8qKlxuICogUmV0cmlldmUgY3VycmVudCBzY3JlZW4gb3JpZW50YXRpb24gb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge251bWJlcn0gVGhlIGN1cnJlbnQgb3JpZW50YXRpb24gZW5jb2RlZCBhcyBhbiBpbnRlZ2VyIG51bWJlci5cbiAqL1xubWV0aG9kcy5nZXRTY3JlZW5PcmllbnRhdGlvbiA9IGFzeW5jIGZ1bmN0aW9uIGdldFNjcmVlbk9yaWVudGF0aW9uICgpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ2lucHV0J10pO1xuICByZXR1cm4gZ2V0U3VyZmFjZU9yaWVudGF0aW9uKHN0ZG91dCk7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBzY3JlZW4gbG9jayBzdGF0ZSBvZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgZGV2aWNlIGlzIGxvY2tlZC5cbiAqL1xubWV0aG9kcy5pc1NjcmVlbkxvY2tlZCA9IGFzeW5jIGZ1bmN0aW9uIGlzU2NyZWVuTG9ja2VkICgpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ3dpbmRvdyddKTtcbiAgaWYgKHByb2Nlc3MuZW52LkFQUElVTV9MT0dfRFVNUFNZUykge1xuICAgIC8vIG9wdGlvbmFsIGRlYnVnZ2luZ1xuICAgIC8vIGlmIHRoZSBtZXRob2QgaXMgbm90IHdvcmtpbmcsIHR1cm4gaXQgb24gYW5kIHNlbmQgdXMgdGhlIG91dHB1dFxuICAgIGxldCBkdW1wc3lzRmlsZSA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCAnZHVtcHN5cy5sb2cnKTtcbiAgICBsb2cuZGVidWcoYFdyaXRpbmcgZHVtcHN5cyBvdXRwdXQgdG8gJHtkdW1wc3lzRmlsZX1gKTtcbiAgICBhd2FpdCBmcy53cml0ZUZpbGUoZHVtcHN5c0ZpbGUsIHN0ZG91dCk7XG4gIH1cbiAgcmV0dXJuIChpc1Nob3dpbmdMb2Nrc2NyZWVuKHN0ZG91dCkgfHwgaXNDdXJyZW50Rm9jdXNPbktleWd1YXJkKHN0ZG91dCkgfHxcbiAgICAgICAgICAhaXNTY3JlZW5PbkZ1bGx5KHN0ZG91dCkpO1xufTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBLZXlib2FyZFN0YXRlXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGlzS2V5Ym9hcmRTaG93biAtIFdoZXRoZXIgc29mdCBrZXlib2FyZCBpcyBjdXJyZW50bHkgdmlzaWJsZS5cbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gY2FuQ2xvc2VLZXlib2FyZCAtIFdoZXRoZXIgdGhlIGtleWJvYXJkIGNhbiBiZSBjbG9zZWQuXG4gKi9cblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgc3RhdGUgb2YgdGhlIHNvZnR3YXJlIGtleWJvYXJkIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtLZXlib2FyZFN0YXRlfSBUaGUga2V5Ym9hcmQgc3RhdGUuXG4gKi9cbm1ldGhvZHMuaXNTb2Z0S2V5Ym9hcmRQcmVzZW50ID0gYXN5bmMgZnVuY3Rpb24gaXNTb2Z0S2V5Ym9hcmRQcmVzZW50ICgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdpbnB1dF9tZXRob2QnXSk7XG4gICAgY29uc3QgaW5wdXRTaG93bk1hdGNoID0gL21JbnB1dFNob3duPShcXHcrKS8uZXhlYyhzdGRvdXQpO1xuICAgIGNvbnN0IGlucHV0Vmlld1Nob3duTWF0Y2ggPSAvbUlzSW5wdXRWaWV3U2hvd249KFxcdyspLy5leGVjKHN0ZG91dCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGlzS2V5Ym9hcmRTaG93bjogISEoaW5wdXRTaG93bk1hdGNoICYmIGlucHV0U2hvd25NYXRjaFsxXSA9PT0gJ3RydWUnKSxcbiAgICAgIGNhbkNsb3NlS2V5Ym9hcmQ6ICEhKGlucHV0Vmlld1Nob3duTWF0Y2ggJiYgaW5wdXRWaWV3U2hvd25NYXRjaFsxXSA9PT0gJ3RydWUnKSxcbiAgICB9O1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBmaW5kaW5nIHNvZnRrZXlib2FyZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFNlbmQgYW4gYXJiaXRyYXJ5IFRlbG5ldCBjb21tYW5kIHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gY29tbWFuZCAtIFRoZSBjb21tYW5kIHRvIGJlIHNlbnQuXG4gKlxuICogQHJldHVybiB7c3RyaW5nfSBUaGUgYWN0dWFsIG91dHB1dCBvZiB0aGUgZ2l2ZW4gY29tbWFuZC5cbiAqL1xubWV0aG9kcy5zZW5kVGVsbmV0Q29tbWFuZCA9IGFzeW5jIGZ1bmN0aW9uIHNlbmRUZWxuZXRDb21tYW5kIChjb21tYW5kKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmV4ZWNFbXVDb25zb2xlQ29tbWFuZChjb21tYW5kLCB7cG9ydDogYXdhaXQgdGhpcy5nZXRFbXVsYXRvclBvcnQoKX0pO1xufTtcblxuLyoqXG4gKiBDaGVjayB0aGUgc3RhdGUgb2YgQWlycGxhbmUgbW9kZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiBBaXJwbGFuZSBtb2RlIGlzIGVuYWJsZWQuXG4gKi9cbm1ldGhvZHMuaXNBaXJwbGFuZU1vZGVPbiA9IGFzeW5jIGZ1bmN0aW9uIGlzQWlycGxhbmVNb2RlT24gKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnYWlycGxhbmVfbW9kZV9vbicpO1xuICByZXR1cm4gcGFyc2VJbnQoc3Rkb3V0LCAxMCkgIT09IDA7XG59O1xuXG4vKipcbiAqIENoYW5nZSB0aGUgc3RhdGUgb2YgQWlycGxhbmUgbW9kZSBpbiBTZXR0aW5ncyBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtib29sZWFufSBvbiAtIFRydWUgdG8gZW5hYmxlIHRoZSBBaXJwbGFuZSBtb2RlIGluIFNldHRpbmdzIGFuZCBmYWxzZSB0byBkaXNhYmxlIGl0LlxuICovXG5tZXRob2RzLnNldEFpcnBsYW5lTW9kZSA9IGFzeW5jIGZ1bmN0aW9uIHNldEFpcnBsYW5lTW9kZSAob24pIHtcbiAgYXdhaXQgdGhpcy5zZXRTZXR0aW5nKCdnbG9iYWwnLCAnYWlycGxhbmVfbW9kZV9vbicsIG9uID8gMSA6IDApO1xufTtcblxuLyoqXG4gKiBCcm9hZGNhc3QgdGhlIHN0YXRlIG9mIEFpcnBsYW5lIG1vZGUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICogVGhpcyBtZXRob2Qgc2hvdWxkIGJlIGNhbGxlZCBhZnRlciB7QGxpbmsgI3NldEFpcnBsYW5lTW9kZX0sIG90aGVyd2lzZVxuICogdGhlIG1vZGUgY2hhbmdlIGlzIG5vdCBnb2luZyB0byBiZSBhcHBsaWVkIGZvciB0aGUgZGV2aWNlLlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb24gLSBUcnVlIHRvIGJyb2FkY2FzdCBlbmFibGUgYW5kIGZhbHNlIHRvIGJyb2FkY2FzdCBkaXNhYmxlLlxuICovXG5tZXRob2RzLmJyb2FkY2FzdEFpcnBsYW5lTW9kZSA9IGFzeW5jIGZ1bmN0aW9uIGJyb2FkY2FzdEFpcnBsYW5lTW9kZSAob24pIHtcbiAgYXdhaXQgdGhpcy5zaGVsbChbXG4gICAgJ2FtJywgJ2Jyb2FkY2FzdCcsXG4gICAgJy1hJywgJ2FuZHJvaWQuaW50ZW50LmFjdGlvbi5BSVJQTEFORV9NT0RFJyxcbiAgICAnLS1leicsICdzdGF0ZScsIG9uID8gJ3RydWUnIDogJ2ZhbHNlJ1xuICBdKTtcbn07XG5cbi8qKlxuICogQ2hlY2sgdGhlIHN0YXRlIG9mIFdpRmkgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgV2lGaSBpcyBlbmFibGVkLlxuICovXG5tZXRob2RzLmlzV2lmaU9uID0gYXN5bmMgZnVuY3Rpb24gaXNXaWZpT24gKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnd2lmaV9vbicpO1xuICByZXR1cm4gKHBhcnNlSW50KHN0ZG91dCwgMTApICE9PSAwKTtcbn07XG5cbi8qKlxuICogQ2hlY2sgdGhlIHN0YXRlIG9mIERhdGEgdHJhbnNmZXIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgRGF0YSB0cmFuc2ZlciBpcyBlbmFibGVkLlxuICovXG5tZXRob2RzLmlzRGF0YU9uID0gYXN5bmMgZnVuY3Rpb24gaXNEYXRhT24gKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnbW9iaWxlX2RhdGEnKTtcbiAgcmV0dXJuIChwYXJzZUludChzdGRvdXQsIDEwKSAhPT0gMCk7XG59O1xuXG4vKipcbiAqIENoYW5nZSB0aGUgc3RhdGUgb2YgV2lGaSBhbmQvb3IgRGF0YSB0cmFuc2ZlciBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtib29sZWFufSB3aWZpIC0gVHJ1ZSB0byBlbmFibGUgYW5kIGZhbHNlIHRvIGRpc2FibGUgV2lGaS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gZGF0YSAtIFRydWUgdG8gZW5hYmxlIGFuZCBmYWxzZSB0byBkaXNhYmxlIERhdGEgdHJhbnNmZXIuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGlzRW11bGF0b3IgW2ZhbHNlXSAtIFNldCBpdCB0byB0cnVlIGlmIHRoZSBkZXZpY2UgdW5kZXIgdGVzdFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpcyBhbiBlbXVsYXRvciByYXRoZXIgdGhhbiBhIHJlYWwgZGV2aWNlLlxuICovXG5tZXRob2RzLnNldFdpZmlBbmREYXRhID0gYXN5bmMgZnVuY3Rpb24gc2V0V2lmaUFuZERhdGEgKHt3aWZpLCBkYXRhfSwgaXNFbXVsYXRvciA9IGZhbHNlKSB7XG4gIGlmICh1dGlsLmhhc1ZhbHVlKHdpZmkpKSB7XG4gICAgYXdhaXQgdGhpcy5zZXRXaWZpU3RhdGUod2lmaSwgaXNFbXVsYXRvcik7XG4gIH1cbiAgaWYgKHV0aWwuaGFzVmFsdWUoZGF0YSkpIHtcbiAgICBhd2FpdCB0aGlzLnNldERhdGFTdGF0ZShkYXRhLCBpc0VtdWxhdG9yKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDaGVjayB0aGUgc3RhdGUgb2YgYW5pbWF0aW9uIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIGF0IGxlYXN0IG9uZSBvZiBhbmltYXRpb24gc2NhbGUgc2V0dGluZ3NcbiAqICAgICAgICAgICAgICAgICAgIGlzIG5vdCBlcXVhbCB0byAnMC4wJy5cbiAqL1xubWV0aG9kcy5pc0FuaW1hdGlvbk9uID0gYXN5bmMgZnVuY3Rpb24gaXNBbmltYXRpb25PbiAoKSB7XG4gIGxldCBhbmltYXRvcl9kdXJhdGlvbl9zY2FsZSA9IGF3YWl0IHRoaXMuZ2V0U2V0dGluZygnZ2xvYmFsJywgJ2FuaW1hdG9yX2R1cmF0aW9uX3NjYWxlJyk7XG4gIGxldCB0cmFuc2l0aW9uX2FuaW1hdGlvbl9zY2FsZSA9IGF3YWl0IHRoaXMuZ2V0U2V0dGluZygnZ2xvYmFsJywgJ3RyYW5zaXRpb25fYW5pbWF0aW9uX3NjYWxlJyk7XG4gIGxldCB3aW5kb3dfYW5pbWF0aW9uX3NjYWxlID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnd2luZG93X2FuaW1hdGlvbl9zY2FsZScpO1xuICByZXR1cm4gXy5zb21lKFthbmltYXRvcl9kdXJhdGlvbl9zY2FsZSwgdHJhbnNpdGlvbl9hbmltYXRpb25fc2NhbGUsIHdpbmRvd19hbmltYXRpb25fc2NhbGVdLFxuICAgICAgICAgICAgICAgIChzZXR0aW5nKSA9PiBzZXR0aW5nICE9PSAnMC4wJyk7XG59O1xuXG4vKipcbiAqIEZvcmNlZnVsbHkgcmVjdXJzaXZlbHkgcmVtb3ZlIGEgcGF0aCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBCZSBjYXJlZnVsIHdoaWxlIGNhbGxpbmcgdGhpcyBtZXRob2QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBUaGUgcGF0aCB0byBiZSByZW1vdmVkIHJlY3Vyc2l2ZWx5LlxuICovXG5tZXRob2RzLnJpbXJhZiA9IGFzeW5jIGZ1bmN0aW9uIHJpbXJhZiAocGF0aCkge1xuICBhd2FpdCB0aGlzLnNoZWxsKFsncm0nLCAnLXJmJywgcGF0aF0pO1xufTtcblxuLyoqXG4gKiBTZW5kIGEgZmlsZSB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsUGF0aCAtIFRoZSBwYXRoIHRvIHRoZSBmaWxlIG9uIHRoZSBsb2NhbCBmaWxlIHN5c3RlbS5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZW1vdGVQYXRoIC0gVGhlIGRlc3RpbmF0aW9uIHBhdGggb24gdGhlIHJlbW90ZSBkZXZpY2UuXG4gKiBAcGFyYW0ge29iamVjdH0gb3B0cyAtIEFkZGl0aW9uYWwgb3B0aW9ucyBtYXBwaW5nLiBTZWVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9ub2RlLXRlZW5fcHJvY2VzcyxcbiAqICAgICAgICAgICAgICAgICAgICAgICAgX2V4ZWNfIG1ldGhvZCBvcHRpb25zLCBmb3IgbW9yZSBpbmZvcm1hdGlvbiBhYm91dCBhdmFpbGFibGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucy5cbiAqL1xubWV0aG9kcy5wdXNoID0gYXN5bmMgZnVuY3Rpb24gcHVzaCAobG9jYWxQYXRoLCByZW1vdGVQYXRoLCBvcHRzKSB7XG4gIGF3YWl0IHRoaXMubWtkaXIocGF0aC5wb3NpeC5kaXJuYW1lKHJlbW90ZVBhdGgpKTtcbiAgYXdhaXQgdGhpcy5hZGJFeGVjKFsncHVzaCcsIGxvY2FsUGF0aCwgcmVtb3RlUGF0aF0sIG9wdHMpO1xufTtcblxuLyoqXG4gKiBSZWNlaXZlIGEgZmlsZSBmcm9tIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSBzb3VyY2UgcGF0aCBvbiB0aGUgcmVtb3RlIGRldmljZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhbFBhdGggLSBUaGUgZGVzdGluYXRpb24gcGF0aCB0byB0aGUgZmlsZSBvbiB0aGUgbG9jYWwgZmlsZSBzeXN0ZW0uXG4gKi9cbm1ldGhvZHMucHVsbCA9IGFzeW5jIGZ1bmN0aW9uIHB1bGwgKHJlbW90ZVBhdGgsIGxvY2FsUGF0aCkge1xuICAvLyBwdWxsIGZvbGRlciBjYW4gdGFrZSBtb3JlIHRpbWUsIGluY3JlYXNpbmcgdGltZSBvdXQgdG8gNjAgc2Vjc1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydwdWxsJywgcmVtb3RlUGF0aCwgbG9jYWxQYXRoXSwge3RpbWVvdXQ6IDYwMDAwfSk7XG59O1xuXG4vKipcbiAqIENoZWNrIHdoZXRoZXIgdGhlIHByb2Nlc3Mgd2l0aCB0aGUgcGFydGljdWxhciBuYW1lIGlzIHJ1bm5pbmcgb24gdGhlIGRldmljZVxuICogdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcHJvY2Vzc05hbWUgLSBUaGUgbmFtZSBvZiB0aGUgcHJvY2VzcyB0byBiZSBjaGVja2VkLlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgZ2l2ZW4gcHJvY2VzcyBpcyBydW5uaW5nLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBnaXZlbiBwcm9jZXNzIG5hbWUgaXMgbm90IGEgdmFsaWQgY2xhc3MgbmFtZS5cbiAqL1xubWV0aG9kcy5wcm9jZXNzRXhpc3RzID0gYXN5bmMgZnVuY3Rpb24gcHJvY2Vzc0V4aXN0cyAocHJvY2Vzc05hbWUpIHtcbiAgcmV0dXJuICFfLmlzRW1wdHkoYXdhaXQgdGhpcy5nZXRQSURzQnlOYW1lKHByb2Nlc3NOYW1lKSk7XG59O1xuXG4vKipcbiAqIEdldCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqIEByZXR1cm4ge0FycmF5LjxTdHJpbmc+fSBUaGUgb3V0cHV0IG9mIHRoZSBjb3JyZXNwb25kaW5nIGFkYiBjb21tYW5kLiBBbiBhcnJheSBjb250YWlucyBlYWNoIGZvcndhcmRpbmcgbGluZSBvZiBvdXRwdXRcbiAqL1xubWV0aG9kcy5nZXRGb3J3YXJkTGlzdCA9IGFzeW5jIGZ1bmN0aW9uIGdldEZvcndhcmRMaXN0ICgpIHtcbiAgbG9nLmRlYnVnKGBMaXN0IGZvcndhcmRpbmcgcG9ydHNgKTtcbiAgY29uc3QgY29ubmVjdGlvbnMgPSBhd2FpdCB0aGlzLmFkYkV4ZWMoWydmb3J3YXJkJywgJy0tbGlzdCddKTtcbiAgcmV0dXJuIGNvbm5lY3Rpb25zLnNwbGl0KEVPTCkuZmlsdGVyKChsaW5lKSA9PiBCb29sZWFuKGxpbmUudHJpbSgpKSk7XG59O1xuXG4vKipcbiAqIFNldHVwIFRDUCBwb3J0IGZvcndhcmRpbmcgd2l0aCBhZGIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gc3lzdGVtUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIGxvY2FsIHN5c3RlbSBwb3J0LlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBkZXZpY2VQb3J0IC0gVGhlIG51bWJlciBvZiB0aGUgcmVtb3RlIGRldmljZSBwb3J0LlxuICovXG5tZXRob2RzLmZvcndhcmRQb3J0ID0gYXN5bmMgZnVuY3Rpb24gZm9yd2FyZFBvcnQgKHN5c3RlbVBvcnQsIGRldmljZVBvcnQpIHtcbiAgbG9nLmRlYnVnKGBGb3J3YXJkaW5nIHN5c3RlbTogJHtzeXN0ZW1Qb3J0fSB0byBkZXZpY2U6ICR7ZGV2aWNlUG9ydH1gKTtcbiAgYXdhaXQgdGhpcy5hZGJFeGVjKFsnZm9yd2FyZCcsIGB0Y3A6JHtzeXN0ZW1Qb3J0fWAsIGB0Y3A6JHtkZXZpY2VQb3J0fWBdKTtcbn07XG5cbi8qKlxuICogUmVtb3ZlIFRDUCBwb3J0IGZvcndhcmRpbmcgd2l0aCBhZGIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LiBUaGUgZm9yd2FyZGluZ1xuICogZm9yIHRoZSBnaXZlbiBwb3J0IHNob3VsZCBiZSBzZXR1cCB3aXRoIHtAbGluayAjZm9yd2FyZFBvcnR9IGZpcnN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gc3lzdGVtUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIGxvY2FsIHN5c3RlbSBwb3J0XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0byByZW1vdmUgZm9yd2FyZGluZyBvbi5cbiAqL1xubWV0aG9kcy5yZW1vdmVQb3J0Rm9yd2FyZCA9IGFzeW5jIGZ1bmN0aW9uIHJlbW92ZVBvcnRGb3J3YXJkIChzeXN0ZW1Qb3J0KSB7XG4gIGxvZy5kZWJ1ZyhgUmVtb3ZpbmcgZm9yd2FyZGVkIHBvcnQgc29ja2V0IGNvbm5lY3Rpb246ICR7c3lzdGVtUG9ydH0gYCk7XG4gIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ2ZvcndhcmQnLCBgLS1yZW1vdmVgLCBgdGNwOiR7c3lzdGVtUG9ydH1gXSk7XG59O1xuXG4vKipcbiAqIEdldCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqIEByZXR1cm4ge0FycmF5LjxTdHJpbmc+fSBUaGUgb3V0cHV0IG9mIHRoZSBjb3JyZXNwb25kaW5nIGFkYiBjb21tYW5kLiBBbiBhcnJheSBjb250YWlucyBlYWNoIGZvcndhcmRpbmcgbGluZSBvZiBvdXRwdXRcbiAqL1xubWV0aG9kcy5nZXRSZXZlcnNlTGlzdCA9IGFzeW5jIGZ1bmN0aW9uIGdldFJldmVyc2VMaXN0ICgpIHtcbiAgbG9nLmRlYnVnKGBMaXN0IHJldmVyc2UgZm9yd2FyZGluZyBwb3J0c2ApO1xuICBjb25zdCBjb25uZWN0aW9ucyA9IGF3YWl0IHRoaXMuYWRiRXhlYyhbJ3JldmVyc2UnLCAnLS1saXN0J10pO1xuICByZXR1cm4gY29ubmVjdGlvbnMuc3BsaXQoRU9MKS5maWx0ZXIoKGxpbmUpID0+IEJvb2xlYW4obGluZS50cmltKCkpKTtcbn07XG5cbi8qKlxuICogU2V0dXAgVENQIHBvcnQgZm9yd2FyZGluZyB3aXRoIGFkYiBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBPbmx5IGF2YWlsYWJsZSBmb3IgQVBJIDIxKy5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IGRldmljZVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSByZW1vdGUgZGV2aWNlIHBvcnQuXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHN5c3RlbVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSBsb2NhbCBzeXN0ZW0gcG9ydC5cbiAqL1xubWV0aG9kcy5yZXZlcnNlUG9ydCA9IGFzeW5jIGZ1bmN0aW9uIHJldmVyc2VQb3J0IChkZXZpY2VQb3J0LCBzeXN0ZW1Qb3J0KSB7XG4gIGxvZy5kZWJ1ZyhgRm9yd2FyZGluZyBkZXZpY2U6ICR7ZGV2aWNlUG9ydH0gdG8gc3lzdGVtOiAke3N5c3RlbVBvcnR9YCk7XG4gIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ3JldmVyc2UnLCBgdGNwOiR7ZGV2aWNlUG9ydH1gLCBgdGNwOiR7c3lzdGVtUG9ydH1gXSk7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC4gVGhlIGZvcndhcmRpbmdcbiAqIGZvciB0aGUgZ2l2ZW4gcG9ydCBzaG91bGQgYmUgc2V0dXAgd2l0aCB7QGxpbmsgI2ZvcndhcmRQb3J0fSBmaXJzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IGRldmljZVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSByZW1vdGUgZGV2aWNlIHBvcnRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvIHJlbW92ZSBmb3J3YXJkaW5nIG9uLlxuICovXG5tZXRob2RzLnJlbW92ZVBvcnRSZXZlcnNlID0gYXN5bmMgZnVuY3Rpb24gcmVtb3ZlUG9ydFJldmVyc2UgKGRldmljZVBvcnQpIHtcbiAgbG9nLmRlYnVnKGBSZW1vdmluZyByZXZlcnNlIGZvcndhcmRlZCBwb3J0IHNvY2tldCBjb25uZWN0aW9uOiAke2RldmljZVBvcnR9IGApO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydyZXZlcnNlJywgYC0tcmVtb3ZlYCwgYHRjcDoke2RldmljZVBvcnR9YF0pO1xufTtcblxuLyoqXG4gKiBTZXR1cCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC4gVGhlIGRpZmZlcmVuY2VcbiAqIGJldHdlZW4ge0BsaW5rICNmb3J3YXJkUG9ydH0gaXMgdGhhdCB0aGlzIG1ldGhvZCBkb2VzIHNldHVwIGZvciBhbiBhYnN0cmFjdFxuICogbG9jYWwgcG9ydC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHN5c3RlbVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSBsb2NhbCBzeXN0ZW0gcG9ydC5cbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gZGV2aWNlUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIHJlbW90ZSBkZXZpY2UgcG9ydC5cbiAqL1xubWV0aG9kcy5mb3J3YXJkQWJzdHJhY3RQb3J0ID0gYXN5bmMgZnVuY3Rpb24gZm9yd2FyZEFic3RyYWN0UG9ydCAoc3lzdGVtUG9ydCwgZGV2aWNlUG9ydCkge1xuICBsb2cuZGVidWcoYEZvcndhcmRpbmcgc3lzdGVtOiAke3N5c3RlbVBvcnR9IHRvIGFic3RyYWN0IGRldmljZTogJHtkZXZpY2VQb3J0fWApO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydmb3J3YXJkJywgYHRjcDoke3N5c3RlbVBvcnR9YCwgYGxvY2FsYWJzdHJhY3Q6JHtkZXZpY2VQb3J0fWBdKTtcbn07XG5cbi8qKlxuICogRXhlY3V0ZSBwaW5nIHNoZWxsIGNvbW1hbmQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIGNvbW1hbmQgb3V0cHV0IGNvbnRhaW5zICdwaW5nJyBzdWJzdHJpbmcuXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGV4ZWN1dGluZyAncGluZycgY29tbWFuZCBvbiB0aGVcbiAqICAgICAgICAgICAgICAgICBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5waW5nID0gYXN5bmMgZnVuY3Rpb24gcGluZyAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnZWNobycsICdwaW5nJ10pO1xuICBpZiAoc3Rkb3V0LmluZGV4T2YoJ3BpbmcnKSA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgQURCIHBpbmcgZmFpbGVkLCByZXR1cm5lZCAke3N0ZG91dH1gKTtcbn07XG5cbi8qKlxuICogUmVzdGFydCB0aGUgZGV2aWNlIHVuZGVyIHRlc3QgdXNpbmcgYWRiIGNvbW1hbmRzLlxuICpcbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiBzdGFydCBmYWlscy5cbiAqL1xubWV0aG9kcy5yZXN0YXJ0ID0gYXN5bmMgZnVuY3Rpb24gcmVzdGFydCAoKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgdGhpcy5zdG9wTG9nY2F0KCk7XG4gICAgYXdhaXQgdGhpcy5yZXN0YXJ0QWRiKCk7XG4gICAgYXdhaXQgdGhpcy53YWl0Rm9yRGV2aWNlKDYwKTtcbiAgICBhd2FpdCB0aGlzLnN0YXJ0TG9nY2F0KHRoaXMuX2xvZ2NhdFN0YXJ0dXBQYXJhbXMpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBSZXN0YXJ0IGZhaWxlZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IExvZ2NhdE9wdHNcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmb3JtYXQgVGhlIGxvZyBwcmludCBmb3JtYXQsIHdoZXJlIDxmb3JtYXQ+IGlzIG9uZSBvZjpcbiAqICAgYnJpZWYgcHJvY2VzcyB0YWcgdGhyZWFkIHJhdyB0aW1lIHRocmVhZHRpbWUgbG9uZ1xuICogYHRocmVhZHRpbWVgIGlzIHRoZSBkZWZhdWx0IHZhbHVlLlxuICogQHByb3BlcnR5IHtBcnJheTxzdHJpbmc+fSBmaWx0ZXJTcGVjcyBTZXJpZXMgb2YgPHRhZz5bOnByaW9yaXR5XVxuICogd2hlcmUgPHRhZz4gaXMgYSBsb2cgY29tcG9uZW50IHRhZyAob3IgKiBmb3IgYWxsKSBhbmQgcHJpb3JpdHkgaXM6XG4gKiAgViAgICBWZXJib3NlXG4gKiAgRCAgICBEZWJ1Z1xuICogIEkgICAgSW5mb1xuICogIFcgICAgV2FyblxuICogIEUgICAgRXJyb3JcbiAqICBGICAgIEZhdGFsXG4gKiAgUyAgICBTaWxlbnQgKHN1cHJlc3MgYWxsIG91dHB1dClcbiAqXG4gKiAnKicgbWVhbnMgJyo6ZCcgYW5kIDx0YWc+IGJ5IGl0c2VsZiBtZWFucyA8dGFnPjp2XG4gKlxuICogSWYgbm90IHNwZWNpZmllZCBvbiB0aGUgY29tbWFuZGxpbmUsIGZpbHRlcnNwZWMgaXMgc2V0IGZyb20gQU5EUk9JRF9MT0dfVEFHUy5cbiAqIElmIG5vIGZpbHRlcnNwZWMgaXMgZm91bmQsIGZpbHRlciBkZWZhdWx0cyB0byAnKjpJJ1xuICovXG5cbi8qKlxuICogU3RhcnQgdGhlIGxvZ2NhdCBwcm9jZXNzIHRvIGdhdGhlciBsb2dzLlxuICpcbiAqIEBwYXJhbSB7P0xvZ2NhdE9wdHN9IG9wdHNcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiByZXN0YXJ0IGZhaWxzLlxuICovXG5tZXRob2RzLnN0YXJ0TG9nY2F0ID0gYXN5bmMgZnVuY3Rpb24gc3RhcnRMb2djYXQgKG9wdHMgPSB7fSkge1xuICBpZiAoIV8uaXNFbXB0eSh0aGlzLmxvZ2NhdCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcnlpbmcgdG8gc3RhcnQgbG9nY2F0IGNhcHR1cmUgYnV0IGl0J3MgYWxyZWFkeSBzdGFydGVkIVwiKTtcbiAgfVxuXG4gIHRoaXMubG9nY2F0ID0gbmV3IExvZ2NhdCh7XG4gICAgYWRiOiB0aGlzLmV4ZWN1dGFibGUsXG4gICAgZGVidWc6IGZhbHNlLFxuICAgIGRlYnVnVHJhY2U6IGZhbHNlLFxuICAgIGNsZWFyRGV2aWNlTG9nc09uU3RhcnQ6ICEhdGhpcy5jbGVhckRldmljZUxvZ3NPblN0YXJ0LFxuICB9KTtcbiAgYXdhaXQgdGhpcy5sb2djYXQuc3RhcnRDYXB0dXJlKG9wdHMpO1xuICB0aGlzLl9sb2djYXRTdGFydHVwUGFyYW1zID0gb3B0cztcbn07XG5cbi8qKlxuICogU3RvcCB0aGUgYWN0aXZlIGxvZ2NhdCBwcm9jZXNzIHdoaWNoIGdhdGhlcnMgbG9ncy5cbiAqIFRoZSBjYWxsIHdpbGwgYmUgaWdub3JlZCBpZiBubyBsb2djYXQgcHJvY2VzcyBpcyBydW5uaW5nLlxuICovXG5tZXRob2RzLnN0b3BMb2djYXQgPSBhc3luYyBmdW5jdGlvbiBzdG9wTG9nY2F0ICgpIHtcbiAgaWYgKF8uaXNFbXB0eSh0aGlzLmxvZ2NhdCkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCB0aGlzLmxvZ2NhdC5zdG9wQ2FwdHVyZSgpO1xuICB9IGZpbmFsbHkge1xuICAgIHRoaXMubG9nY2F0ID0gbnVsbDtcbiAgfVxufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgb3V0cHV0IGZyb20gdGhlIGN1cnJlbnRseSBydW5uaW5nIGxvZ2NhdCBwcm9jZXNzLlxuICogVGhlIGxvZ2NhdCBwcm9jZXNzIHNob3VsZCBiZSBleGVjdXRlZCBieSB7MmxpbmsgI3N0YXJ0TG9nY2F0fSBtZXRob2QuXG4gKlxuICogQHJldHVybiB7c3RyaW5nfSBUaGUgY29sbGVjdGVkIGxvZ2NhdCBvdXRwdXQuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbG9nY2F0IHByb2Nlc3MgaXMgbm90IHJ1bm5pbmcuXG4gKi9cbm1ldGhvZHMuZ2V0TG9nY2F0TG9ncyA9IGZ1bmN0aW9uIGdldExvZ2NhdExvZ3MgKCkge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMubG9nY2F0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGdldCBsb2djYXQgbG9ncyBzaW5jZSBsb2djYXQgaGFzbid0IHN0YXJ0ZWRcIik7XG4gIH1cbiAgcmV0dXJuIHRoaXMubG9nY2F0LmdldExvZ3MoKTtcbn07XG5cbi8qKlxuICogU2V0IHRoZSBjYWxsYmFjayBmb3IgdGhlIGxvZ2NhdCBvdXRwdXQgZXZlbnQuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgLSBUaGUgbGlzdGVuZXIgZnVuY3Rpb24sIHdoaWNoIGFjY2VwdHMgb25lIGFyZ3VtZW50LiBUaGUgYXJndW1lbnQgaXNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYSBsb2cgcmVjb3JkIG9iamVjdCB3aXRoIGB0aW1lc3RhbXBgLCBgbGV2ZWxgIGFuZCBgbWVzc2FnZWAgcHJvcGVydGllcy5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiBsb2djYXQgcHJvY2VzcyBpcyBub3QgcnVubmluZy5cbiAqL1xubWV0aG9kcy5zZXRMb2djYXRMaXN0ZW5lciA9IGZ1bmN0aW9uIHNldExvZ2NhdExpc3RlbmVyIChsaXN0ZW5lcikge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMubG9nY2F0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkxvZ2NhdCBwcm9jZXNzIGhhc24ndCBiZWVuIHN0YXJ0ZWRcIik7XG4gIH1cbiAgdGhpcy5sb2djYXQub24oJ291dHB1dCcsIGxpc3RlbmVyKTtcbn07XG5cbi8qKlxuICogUmVtb3ZlcyB0aGUgcHJldmlvdXNseSBzZXQgY2FsbGJhY2sgZm9yIHRoZSBsb2djYXQgb3V0cHV0IGV2ZW50LlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIC0gVGhlIGxpc3RlbmVyIGZ1bmN0aW9uLCB3aGljaCBoYXMgYmVlbiBwcmV2aW91c2x5XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhc3NlZCB0byBgc2V0TG9nY2F0TGlzdGVuZXJgXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbG9nY2F0IHByb2Nlc3MgaXMgbm90IHJ1bm5pbmcuXG4gKi9cbm1ldGhvZHMucmVtb3ZlTG9nY2F0TGlzdGVuZXIgPSBmdW5jdGlvbiByZW1vdmVMb2djYXRMaXN0ZW5lciAobGlzdGVuZXIpIHtcbiAgaWYgKF8uaXNFbXB0eSh0aGlzLmxvZ2NhdCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJMb2djYXQgcHJvY2VzcyBoYXNuJ3QgYmVlbiBzdGFydGVkXCIpO1xuICB9XG4gIHRoaXMubG9nY2F0LnJlbW92ZUxpc3RlbmVyKCdvdXRwdXQnLCBsaXN0ZW5lcik7XG59O1xuXG4vKipcbiAqIEF0IHNvbWUgcG9pbnQgb2YgdGltZSBHb29nbGUgaGFzIGNoYW5nZWQgdGhlIGRlZmF1bHQgYHBzYCBiZWhhdmlvdXIsIHNvIGl0IG9ubHlcbiAqIGxpc3RzIHByb2Nlc3NlcyB0aGF0IGJlbG9uZyB0byB0aGUgY3VycmVudCBzaGVsbCB1c2VyIHJhdGhlciB0byBhbGxcbiAqIHVzZXJzLiBJdCBpcyBuZWNlc3NhcnkgdG8gZXhlY3V0ZSBwcyB3aXRoIC1BIGNvbW1hbmQgbGluZSBhcmd1bWVudFxuICogdG8gbWltaWMgdGhlIHByZXZpb3VzIGJlaGF2aW91ci5cbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSB0aGUgb3V0cHV0IG9mIGBwc2AgY29tbWFuZCB3aGVyZSBhbGwgcHJvY2Vzc2VzIGFyZSBpbmNsdWRlZFxuICovXG5tZXRob2RzLmxpc3RQcm9jZXNzU3RhdHVzID0gYXN5bmMgZnVuY3Rpb24gbGlzdFByb2Nlc3NTdGF0dXMgKCkge1xuICBpZiAoIV8uaXNCb29sZWFuKHRoaXMuX2RvZXNQc1N1cHBvcnRBT3B0aW9uKSkge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLl9kb2VzUHNTdXBwb3J0QU9wdGlvbiA9IC9eLUFcXGIvbS50ZXN0KGF3YWl0IHRoaXMuc2hlbGwoWydwcycsICctLWhlbHAnXSkpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGxvZy5kZWJ1ZyhlLnN0YWNrKTtcbiAgICAgIHRoaXMuX2RvZXNQc1N1cHBvcnRBT3B0aW9uID0gZmFsc2U7XG4gICAgfVxuICB9XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKHRoaXMuX2RvZXNQc1N1cHBvcnRBT3B0aW9uID8gWydwcycsICctQSddIDogWydwcyddKTtcbn07XG5cbi8qKlxuICogUmV0dXJucyBwcm9jZXNzIG5hbWUgZm9yIHRoZSBnaXZlbiBwcm9jZXNzIGlkZW50aWZpZXJcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHBpZCAtIFRoZSB2YWxpZCBwcm9jZXNzIGlkZW50aWZpZXJcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgZ2l2ZW4gUElEIGlzIGVpdGhlciBpbnZhbGlkIG9yIGlzIG5vdCBwcmVzZW50XG4gKiBpbiB0aGUgYWN0aXZlIHByb2Nlc3NlcyBsaXN0XG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgcHJvY2VzcyBuYW1lXG4gKi9cbm1ldGhvZHMuZ2V0TmFtZUJ5UGlkID0gYXN5bmMgZnVuY3Rpb24gZ2V0TmFtZUJ5UGlkIChwaWQpIHtcbiAgaWYgKGlzTmFOKHBpZCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSBQSUQgdmFsdWUgbXVzdCBiZSBhIHZhbGlkIG51bWJlci4gJyR7cGlkfScgaXMgZ2l2ZW4gaW5zdGVhZGApO1xuICB9XG4gIHBpZCA9IHBhcnNlSW50KHBpZCwgMTApO1xuXG4gIGNvbnN0IHN0ZG91dCA9IGF3YWl0IHRoaXMubGlzdFByb2Nlc3NTdGF0dXMoKTtcbiAgY29uc3QgdGl0bGVNYXRjaCA9IFBTX1RJVExFX1BBVFRFUk4uZXhlYyhzdGRvdXQpO1xuICBpZiAoIXRpdGxlTWF0Y2gpIHtcbiAgICBsb2cuZGVidWcoc3Rkb3V0KTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBnZXQgdGhlIHByb2Nlc3MgbmFtZSBmb3IgUElEICcke3BpZH0nYCk7XG4gIH1cbiAgY29uc3QgYWxsVGl0bGVzID0gdGl0bGVNYXRjaFsxXS50cmltKCkuc3BsaXQoL1xccysvKTtcbiAgY29uc3QgcGlkSW5kZXggPSBhbGxUaXRsZXMuaW5kZXhPZihQSURfQ09MVU1OX1RJVExFKTtcbiAgLy8gaXQgbWlnaHQgbm90IGJlIHN0YWJsZSB0byB0YWtlIE5BTUUgYnkgaW5kZXgsIGJlY2F1c2UgZGVwZW5kaW5nIG9uIHRoZVxuICAvLyBhY3R1YWwgU0RLIHRoZSBwcyBvdXRwdXQgbWlnaHQgbm90IGNvbnRhaW4gYW4gYWJicmV2aWF0aW9uIGZvciB0aGUgUyBmbGFnOlxuICAvLyBVU0VSICAgICBQSUQgICBQUElEICBWU0laRSAgUlNTICAgICBXQ0hBTiAgICBQQyAgICAgICAgTkFNRVxuICAvLyBVU0VSICAgICBQSUQgICBQUElEICBWU0laRSAgUlNTICAgICBXQ0hBTiAgICBQQyAgIFMgICAgTkFNRVxuICBjb25zdCBuYW1lT2Zmc2V0ID0gYWxsVGl0bGVzLmluZGV4T2YoUFJPQ0VTU19OQU1FX0NPTFVNTl9USVRMRSkgLSBhbGxUaXRsZXMubGVuZ3RoO1xuICBjb25zdCBwaWRSZWdleCA9IG5ldyBSZWdFeHAoYF4oLipcXFxcYiR7cGlkfVxcXFxiLiopJGAsICdnbScpO1xuICBsZXQgbWF0Y2hlZExpbmU7XG4gIHdoaWxlICgobWF0Y2hlZExpbmUgPSBwaWRSZWdleC5leGVjKHN0ZG91dCkpKSB7XG4gICAgY29uc3QgaXRlbXMgPSBtYXRjaGVkTGluZVsxXS50cmltKCkuc3BsaXQoL1xccysvKTtcbiAgICBpZiAocGFyc2VJbnQoaXRlbXNbcGlkSW5kZXhdLCAxMCkgPT09IHBpZCAmJiBpdGVtc1tpdGVtcy5sZW5ndGggKyBuYW1lT2Zmc2V0XSkge1xuICAgICAgcmV0dXJuIGl0ZW1zW2l0ZW1zLmxlbmd0aCArIG5hbWVPZmZzZXRdO1xuICAgIH1cbiAgfVxuICBsb2cuZGVidWcoc3Rkb3V0KTtcbiAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgZ2V0IHRoZSBwcm9jZXNzIG5hbWUgZm9yIFBJRCAnJHtwaWR9J2ApO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGxpc3Qgb2YgcHJvY2VzcyBpZHMgZm9yIHRoZSBwYXJ0aWN1bGFyIHByb2Nlc3Mgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gVGhlIHBhcnQgb2YgcHJvY2VzcyBuYW1lLlxuICogQHJldHVybiB7QXJyYXkuPG51bWJlcj59IFRoZSBsaXN0IG9mIG1hdGNoZWQgcHJvY2VzcyBJRHMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgcGFzc2VkIHByb2Nlc3MgbmFtZSBpcyBub3QgYSB2YWxpZCBvbmVcbiAqL1xubWV0aG9kcy5nZXRQSURzQnlOYW1lID0gYXN5bmMgZnVuY3Rpb24gZ2V0UElEc0J5TmFtZSAobmFtZSkge1xuICBsb2cuZGVidWcoYEdldHRpbmcgSURzIG9mIGFsbCAnJHtuYW1lfScgcHJvY2Vzc2VzYCk7XG4gIGlmICghdGhpcy5pc1ZhbGlkQ2xhc3MobmFtZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcHJvY2VzcyBuYW1lOiAnJHtuYW1lfSdgKTtcbiAgfVxuICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvMTM1NjdcbiAgaWYgKGF3YWl0IHRoaXMuZ2V0QXBpTGV2ZWwoKSA+PSAyMykge1xuICAgIGlmICghXy5pc0Jvb2xlYW4odGhpcy5faXNQZ3JlcEF2YWlsYWJsZSkpIHtcbiAgICAgIC8vIHBncmVwIGlzIGluIHByaW9yaXR5LCBzaW5jZSBwaWRvZiBoYXMgYmVlbiByZXBvcnRlZCBvZiBoYXZpbmcgYnVncyBvbiBzb21lIHBsYXRmb3Jtc1xuICAgICAgY29uc3QgcGdyZXBPdXRwdXQgPSBfLnRyaW0oYXdhaXQgdGhpcy5zaGVsbChbJ3BncmVwIC0taGVscDsgZWNobyAkPyddKSk7XG4gICAgICB0aGlzLl9pc1BncmVwQXZhaWxhYmxlID0gcGFyc2VJbnQoXy5sYXN0KHBncmVwT3V0cHV0LnNwbGl0KC9cXHMrLykpLCAxMCkgPT09IDA7XG4gICAgICBpZiAodGhpcy5faXNQZ3JlcEF2YWlsYWJsZSkge1xuICAgICAgICB0aGlzLl9jYW5QZ3JlcFVzZUZ1bGxDbWRMaW5lU2VhcmNoID0gL14tZlxcYi9tLnRlc3QocGdyZXBPdXRwdXQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5faXNQaWRvZkF2YWlsYWJsZSA9IHBhcnNlSW50KGF3YWl0IHRoaXMuc2hlbGwoWydwaWRvZiAtLWhlbHAgPiAvZGV2L251bGw7IGVjaG8gJD8nXSksIDEwKSA9PT0gMDtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHRoaXMuX2lzUGdyZXBBdmFpbGFibGUgfHwgdGhpcy5faXNQaWRvZkF2YWlsYWJsZSkge1xuICAgICAgY29uc3Qgc2hlbGxDb21tYW5kID0gdGhpcy5faXNQZ3JlcEF2YWlsYWJsZVxuICAgICAgICA/ICh0aGlzLl9jYW5QZ3JlcFVzZUZ1bGxDbWRMaW5lU2VhcmNoXG4gICAgICAgICAgPyBbJ3BncmVwJywgJy1mJywgXy5lc2NhcGVSZWdFeHAoYChbWzpibGFuazpdXXxeKSR7bmFtZX0oW1s6Ymxhbms6XV18JClgKV1cbiAgICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvMTM4NzJcbiAgICAgICAgICA6IFtgcGdyZXAgXiR7Xy5lc2NhcGVSZWdFeHAobmFtZS5zbGljZSgtTUFYX1BHUkVQX1BBVFRFUk5fTEVOKSl9JCB8fCBwZ3JlcCBeJHtfLmVzY2FwZVJlZ0V4cChuYW1lLnNsaWNlKDAsIE1BWF9QR1JFUF9QQVRURVJOX0xFTikpfSRgXSlcbiAgICAgICAgOiBbJ3BpZG9mJywgbmFtZV07XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gKGF3YWl0IHRoaXMuc2hlbGwoc2hlbGxDb21tYW5kKSlcbiAgICAgICAgICAuc3BsaXQoL1xccysvKVxuICAgICAgICAgIC5tYXAoKHgpID0+IHBhcnNlSW50KHgsIDEwKSlcbiAgICAgICAgICAuZmlsdGVyKCh4KSA9PiBfLmlzSW50ZWdlcih4KSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIGVycm9yIGNvZGUgMSBpcyByZXR1cm5lZCBpZiB0aGUgdXRpbGl0eSBkaWQgbm90IGZpbmQgYW55IHByb2Nlc3Nlc1xuICAgICAgICAvLyB3aXRoIHRoZSBnaXZlbiBuYW1lXG4gICAgICAgIGlmIChlLmNvZGUgPT09IDEpIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgZXh0cmFjdCBwcm9jZXNzIElEIG9mICcke25hbWV9JzogJHtlLm1lc3NhZ2V9YCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgbG9nLmRlYnVnKCdVc2luZyBwcy1iYXNlZCBQSUQgZGV0ZWN0aW9uJyk7XG4gIGNvbnN0IHN0ZG91dCA9IGF3YWl0IHRoaXMubGlzdFByb2Nlc3NTdGF0dXMoKTtcbiAgY29uc3QgdGl0bGVNYXRjaCA9IFBTX1RJVExFX1BBVFRFUk4uZXhlYyhzdGRvdXQpO1xuICBpZiAoIXRpdGxlTWF0Y2gpIHtcbiAgICBsb2cuZGVidWcoc3Rkb3V0KTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBleHRyYWN0IFBJRCBvZiAnJHtuYW1lfScgZnJvbSBwcyBvdXRwdXRgKTtcbiAgfVxuICBjb25zdCBhbGxUaXRsZXMgPSB0aXRsZU1hdGNoWzFdLnRyaW0oKS5zcGxpdCgvXFxzKy8pO1xuICBjb25zdCBwaWRJbmRleCA9IGFsbFRpdGxlcy5pbmRleE9mKFBJRF9DT0xVTU5fVElUTEUpO1xuICBjb25zdCBwaWRzID0gW107XG4gIGNvbnN0IHByb2Nlc3NOYW1lUmVnZXggPSBuZXcgUmVnRXhwKGBeKC4qXFxcXGJcXFxcZCtcXFxcYi4qXFxcXGIke18uZXNjYXBlUmVnRXhwKG5hbWUpfVxcXFxiLiopJGAsICdnbScpO1xuICBsZXQgbWF0Y2hlZExpbmU7XG4gIHdoaWxlICgobWF0Y2hlZExpbmUgPSBwcm9jZXNzTmFtZVJlZ2V4LmV4ZWMoc3Rkb3V0KSkpIHtcbiAgICBjb25zdCBpdGVtcyA9IG1hdGNoZWRMaW5lWzFdLnRyaW0oKS5zcGxpdCgvXFxzKy8pO1xuICAgIGlmIChwaWRJbmRleCA+PSBhbGxUaXRsZXMubGVuZ3RoIHx8IGlzTmFOKGl0ZW1zW3BpZEluZGV4XSkpIHtcbiAgICAgIGxvZy5kZWJ1ZyhzdGRvdXQpO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgZXh0cmFjdCBQSUQgb2YgJyR7bmFtZX0nIGZyb20gJyR7bWF0Y2hlZExpbmVbMV0udHJpbSgpfSdgKTtcbiAgICB9XG4gICAgcGlkcy5wdXNoKHBhcnNlSW50KGl0ZW1zW3BpZEluZGV4XSwgMTApKTtcbiAgfVxuICByZXR1cm4gcGlkcztcbn07XG5cbi8qKlxuICogR2V0IHRoZSBsaXN0IG9mIHByb2Nlc3MgaWRzIGZvciB0aGUgcGFydGljdWxhciBwcm9jZXNzIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFRoZSBwYXJ0IG9mIHByb2Nlc3MgbmFtZS5cbiAqIEByZXR1cm4ge0FycmF5LjxudW1iZXI+fSBUaGUgbGlzdCBvZiBtYXRjaGVkIHByb2Nlc3MgSURzIG9yIGFuIGVtcHR5IGxpc3QuXG4gKi9cbm1ldGhvZHMua2lsbFByb2Nlc3Nlc0J5TmFtZSA9IGFzeW5jIGZ1bmN0aW9uIGtpbGxQcm9jZXNzZXNCeU5hbWUgKG5hbWUpIHtcbiAgdHJ5IHtcbiAgICBsb2cuZGVidWcoYEF0dGVtcHRpbmcgdG8ga2lsbCBhbGwgJHtuYW1lfSBwcm9jZXNzZXNgKTtcbiAgICBjb25zdCBwaWRzID0gYXdhaXQgdGhpcy5nZXRQSURzQnlOYW1lKG5hbWUpO1xuICAgIGlmIChfLmlzRW1wdHkocGlkcykpIHtcbiAgICAgIGxvZy5pbmZvKGBObyAnJHtuYW1lfScgcHJvY2VzcyBoYXMgYmVlbiBmb3VuZGApO1xuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBCLmFsbChwaWRzLm1hcCgocCkgPT4gdGhpcy5raWxsUHJvY2Vzc0J5UElEKHApKSk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8ga2lsbCAke25hbWV9IHByb2Nlc3Nlcy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIEtpbGwgdGhlIHBhcnRpY3VsYXIgcHJvY2VzcyBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBUaGUgY3VycmVudCB1c2VyIGlzIGF1dG9tYXRpY2FsbHkgc3dpdGNoZWQgdG8gcm9vdCBpZiBuZWNlc3NhcnkgaW4gb3JkZXJcbiAqIHRvIHByb3Blcmx5IGtpbGwgdGhlIHByb2Nlc3MuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBwaWQgLSBUaGUgSUQgb2YgdGhlIHByb2Nlc3MgdG8gYmUga2lsbGVkLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBwcm9jZXNzIGNhbm5vdCBiZSBraWxsZWQuXG4gKi9cbm1ldGhvZHMua2lsbFByb2Nlc3NCeVBJRCA9IGFzeW5jIGZ1bmN0aW9uIGtpbGxQcm9jZXNzQnlQSUQgKHBpZCkge1xuICBsb2cuZGVidWcoYEF0dGVtcHRpbmcgdG8ga2lsbCBwcm9jZXNzICR7cGlkfWApO1xuICBjb25zdCBub1Byb2Nlc3NGbGFnID0gJ05vIHN1Y2ggcHJvY2Vzcyc7XG4gIHRyeSB7XG4gICAgLy8gQ2hlY2sgaWYgdGhlIHByb2Nlc3MgZXhpc3RzIGFuZCB0aHJvdyBhbiBleGNlcHRpb24gb3RoZXJ3aXNlXG4gICAgYXdhaXQgdGhpcy5zaGVsbChbJ2tpbGwnLCBwaWRdKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChfLmluY2x1ZGVzKGUuc3RkZXJyLCBub1Byb2Nlc3NGbGFnKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIV8uaW5jbHVkZXMoZS5zdGRlcnIsICdPcGVyYXRpb24gbm90IHBlcm1pdHRlZCcpKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgICBsb2cuaW5mbyhgQ2Fubm90IGtpbGwgUElEICR7cGlkfSBkdWUgdG8gaW5zdWZmaWNpZW50IHBlcm1pc3Npb25zLiBSZXRyeWluZyBhcyByb290YCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuc2hlbGwoWydraWxsJywgcGlkXSwge1xuICAgICAgICBwcml2aWxlZ2VkOiB0cnVlXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlMSkge1xuICAgICAgaWYgKF8uaW5jbHVkZXMoZTEuc3RkZXJyLCBub1Byb2Nlc3NGbGFnKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0aHJvdyBlMTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogQnJvYWRjYXN0IHByb2Nlc3Mga2lsbGluZyBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGludGVudCAtIFRoZSBuYW1lIG9mIHRoZSBpbnRlbnQgdG8gYnJvYWRjYXN0IHRvLlxuICogQHBhcmFtIHtzdHJpbmd9IHByb2Nlc3NOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGtpbGxlZCBwcm9jZXNzLlxuICogQHRocm93cyB7ZXJyb3J9IElmIHRoZSBwcm9jZXNzIHdhcyBub3Qga2lsbGVkLlxuICovXG5tZXRob2RzLmJyb2FkY2FzdFByb2Nlc3NFbmQgPSBhc3luYyBmdW5jdGlvbiBicm9hZGNhc3RQcm9jZXNzRW5kIChpbnRlbnQsIHByb2Nlc3NOYW1lKSB7XG4gIC8vIHN0YXJ0IHRoZSBicm9hZGNhc3Qgd2l0aG91dCB3YWl0aW5nIGZvciBpdCB0byBmaW5pc2guXG4gIHRoaXMuYnJvYWRjYXN0KGludGVudCk7XG4gIC8vIHdhaXQgZm9yIHRoZSBwcm9jZXNzIHRvIGVuZFxuICBsZXQgc3RhcnQgPSBEYXRlLm5vdygpO1xuICBsZXQgdGltZW91dE1zID0gNDAwMDA7XG4gIHRyeSB7XG4gICAgd2hpbGUgKChEYXRlLm5vdygpIC0gc3RhcnQpIDwgdGltZW91dE1zKSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5wcm9jZXNzRXhpc3RzKHByb2Nlc3NOYW1lKSkge1xuICAgICAgICAvLyBjb29sIGRvd25cbiAgICAgICAgYXdhaXQgc2xlZXAoNDAwKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihgUHJvY2VzcyBuZXZlciBkaWVkIHdpdGhpbiAke3RpbWVvdXRNc30gbXNgKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGJyb2FkY2FzdCBwcm9jZXNzIGVuZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIEJyb2FkY2FzdCBhIG1lc3NhZ2UgdG8gdGhlIGdpdmVuIGludGVudC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gaW50ZW50IC0gVGhlIG5hbWUgb2YgdGhlIGludGVudCB0byBicm9hZGNhc3QgdG8uXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgaW50ZW50IG5hbWUgaXMgbm90IGEgdmFsaWQgY2xhc3MgbmFtZS5cbiAqL1xubWV0aG9kcy5icm9hZGNhc3QgPSBhc3luYyBmdW5jdGlvbiBicm9hZGNhc3QgKGludGVudCkge1xuICBpZiAoIXRoaXMuaXNWYWxpZENsYXNzKGludGVudCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgaW50ZW50ICR7aW50ZW50fWApO1xuICB9XG4gIGxvZy5kZWJ1ZyhgQnJvYWRjYXN0aW5nOiAke2ludGVudH1gKTtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ2FtJywgJ2Jyb2FkY2FzdCcsICctYScsIGludGVudF0pO1xufTtcblxuLyoqXG4gKiBLaWxsIEFuZHJvaWQgaW5zdHJ1bWVudHMgaWYgdGhleSBhcmUgY3VycmVudGx5IHJ1bm5pbmcuXG4gKi9cbm1ldGhvZHMuZW5kQW5kcm9pZENvdmVyYWdlID0gYXN5bmMgZnVuY3Rpb24gZW5kQW5kcm9pZENvdmVyYWdlICgpIHtcbiAgaWYgKHRoaXMuaW5zdHJ1bWVudFByb2MgJiYgdGhpcy5pbnN0cnVtZW50UHJvYy5pc1J1bm5pbmcpIHtcbiAgICBhd2FpdCB0aGlzLmluc3RydW1lbnRQcm9jLnN0b3AoKTtcbiAgfVxufTtcblxuLyoqXG4gKiBJbnN0cnVtZW50IHRoZSBwYXJ0aWN1bGFyIGFjdGl2aXR5LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgbmFtZSBvZiB0aGUgcGFja2FnZSB0byBiZSBpbnN0cnVtZW50ZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gYWN0aXZpdHkgLSBUaGUgbmFtZSBvZiB0aGUgbWFpbiBhY3Rpdml0eSBpbiB0aGlzIHBhY2thZ2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gaW5zdHJ1bWVudFdpdGggLSBUaGUgbmFtZSBvZiB0aGUgcGFja2FnZSB0byBpbnN0cnVtZW50XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgYWN0aXZpdHkgd2l0aC5cbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiBhbnkgZXhjZXB0aW9uIGlzIHJlcG9ydGVkIGJ5IGFkYiBzaGVsbC5cbiAqL1xubWV0aG9kcy5pbnN0cnVtZW50ID0gYXN5bmMgZnVuY3Rpb24gaW5zdHJ1bWVudCAocGtnLCBhY3Rpdml0eSwgaW5zdHJ1bWVudFdpdGgpIHtcbiAgaWYgKGFjdGl2aXR5WzBdICE9PSAnLicpIHtcbiAgICBwa2cgPSAnJztcbiAgfVxuICBsZXQgcGtnQWN0aXZpdHkgPSAocGtnICsgYWN0aXZpdHkpLnJlcGxhY2UoL1xcLisvZywgJy4nKTsgLy8gRml4IHBrZy4uYWN0aXZpdHkgZXJyb3JcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoW1xuICAgICdhbScsICdpbnN0cnVtZW50JyxcbiAgICAnLWUnLCAnbWFpbl9hY3Rpdml0eScsXG4gICAgcGtnQWN0aXZpdHksXG4gICAgaW5zdHJ1bWVudFdpdGgsXG4gIF0pO1xuICBpZiAoc3Rkb3V0LmluZGV4T2YoJ0V4Y2VwdGlvbicpICE9PSAtMSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBleGNlcHRpb24gZHVyaW5nIGluc3RydW1lbnRhdGlvbi4gT3JpZ2luYWwgZXJyb3IgJHtzdGRvdXQuc3BsaXQoJ1xcbicpWzBdfWApO1xuICB9XG59O1xuXG4vKipcbiAqIENvbGxlY3QgQW5kcm9pZCBjb3ZlcmFnZSBieSBpbnN0cnVtZW50aW5nIHRoZSBwYXJ0aWN1bGFyIGFjdGl2aXR5LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBpbnN0cnVtZW50Q2xhc3MgLSBUaGUgbmFtZSBvZiB0aGUgaW5zdHJ1bWVudGF0aW9uIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmd9IHdhaXRQa2cgLSBUaGUgbmFtZSBvZiB0aGUgcGFja2FnZSB0byBiZSBpbnN0cnVtZW50ZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gd2FpdEFjdGl2aXR5IC0gVGhlIG5hbWUgb2YgdGhlIG1haW4gYWN0aXZpdHkgaW4gdGhpcyBwYWNrYWdlLlxuICpcbiAqIEByZXR1cm4ge3Byb21pc2V9IFRoZSBwcm9taXNlIGlzIHN1Y2Nlc3NmdWxseSByZXNvbHZlZCBpZiB0aGUgaW5zdHJ1bWVudGF0aW9uIHN0YXJ0c1xuICogICAgICAgICAgICAgICAgICAgd2l0aG91dCBlcnJvcnMuXG4gKi9cbm1ldGhvZHMuYW5kcm9pZENvdmVyYWdlID0gYXN5bmMgZnVuY3Rpb24gYW5kcm9pZENvdmVyYWdlIChpbnN0cnVtZW50Q2xhc3MsIHdhaXRQa2csIHdhaXRBY3Rpdml0eSkge1xuICBpZiAoIXRoaXMuaXNWYWxpZENsYXNzKGluc3RydW1lbnRDbGFzcykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY2xhc3MgJHtpbnN0cnVtZW50Q2xhc3N9YCk7XG4gIH1cbiAgcmV0dXJuIGF3YWl0IG5ldyBCKGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBsZXQgYXJncyA9IHRoaXMuZXhlY3V0YWJsZS5kZWZhdWx0QXJnc1xuICAgICAgLmNvbmNhdChbJ3NoZWxsJywgJ2FtJywgJ2luc3RydW1lbnQnLCAnLWUnLCAnY292ZXJhZ2UnLCAndHJ1ZScsICctdyddKVxuICAgICAgLmNvbmNhdChbaW5zdHJ1bWVudENsYXNzXSk7XG4gICAgbG9nLmRlYnVnKGBDb2xsZWN0aW5nIGNvdmVyYWdlIGRhdGEgd2l0aDogJHtbdGhpcy5leGVjdXRhYmxlLnBhdGhdLmNvbmNhdChhcmdzKS5qb2luKCcgJyl9YCk7XG4gICAgdHJ5IHtcbiAgICAgIC8vIGFtIGluc3RydW1lbnQgcnVucyBmb3IgdGhlIGxpZmUgb2YgdGhlIGFwcCBwcm9jZXNzLlxuICAgICAgdGhpcy5pbnN0cnVtZW50UHJvYyA9IG5ldyBTdWJQcm9jZXNzKHRoaXMuZXhlY3V0YWJsZS5wYXRoLCBhcmdzKTtcbiAgICAgIGF3YWl0IHRoaXMuaW5zdHJ1bWVudFByb2Muc3RhcnQoMCk7XG4gICAgICB0aGlzLmluc3RydW1lbnRQcm9jLm9uKCdvdXRwdXQnLCAoc3Rkb3V0LCBzdGRlcnIpID0+IHtcbiAgICAgICAgaWYgKHN0ZGVycikge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoYEZhaWxlZCB0byBydW4gaW5zdHJ1bWVudGF0aW9uLiBPcmlnaW5hbCBlcnJvcjogJHtzdGRlcnJ9YCkpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHRoaXMud2FpdEZvckFjdGl2aXR5KHdhaXRQa2csIHdhaXRBY3Rpdml0eSk7XG4gICAgICByZXNvbHZlKCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmVqZWN0KG5ldyBFcnJvcihgQW5kcm9pZCBjb3ZlcmFnZSBmYWlsZWQuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKSk7XG4gICAgfVxuICB9KTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBwYXJ0aWN1bGFyIHByb3BlcnR5IG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcHJvcGVydHkgLSBUaGUgbmFtZSBvZiB0aGUgcHJvcGVydHkuIFRoaXMgbmFtZSBzaG91bGRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJlIGtub3duIHRvIF9hZGIgc2hlbGwgZ2V0cHJvcF8gdG9vbC5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSB2YWx1ZSBvZiB0aGUgZ2l2ZW4gcHJvcGVydHkuXG4gKi9cbm1ldGhvZHMuZ2V0RGV2aWNlUHJvcGVydHkgPSBhc3luYyBmdW5jdGlvbiBnZXREZXZpY2VQcm9wZXJ0eSAocHJvcGVydHkpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydnZXRwcm9wJywgcHJvcGVydHldKTtcbiAgbGV0IHZhbCA9IHN0ZG91dC50cmltKCk7XG4gIGxvZy5kZWJ1ZyhgQ3VycmVudCBkZXZpY2UgcHJvcGVydHkgJyR7cHJvcGVydHl9JzogJHt2YWx9YCk7XG4gIHJldHVybiB2YWw7XG59O1xuXG4vKipcbiAqIEB0eXBlZGVmIHtvYmplY3R9IHNldFByb3BPcHRzXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IHByaXZpbGVnZWQgLSBEbyB3ZSBydW4gc2V0UHJvcCBhcyBhIHByaXZpbGVnZWQgY29tbWFuZD8gRGVmYXVsdCB0cnVlLlxuICovXG5cbi8qKlxuICogU2V0IHRoZSBwYXJ0aWN1bGFyIHByb3BlcnR5IG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcHJvcGVydHkgLSBUaGUgbmFtZSBvZiB0aGUgcHJvcGVydHkuIFRoaXMgbmFtZSBzaG91bGRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJlIGtub3duIHRvIF9hZGIgc2hlbGwgc2V0cHJvcF8gdG9vbC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWwgLSBUaGUgbmV3IHByb3BlcnR5IHZhbHVlLlxuICogQHBhcmFtIHtzZXRQcm9wT3B0c30gb3B0c1xuICpcbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiBfc2V0cHJvcF8gdXRpbGl0eSBmYWlscyB0byBjaGFuZ2UgcHJvcGVydHkgdmFsdWUuXG4gKi9cbm1ldGhvZHMuc2V0RGV2aWNlUHJvcGVydHkgPSBhc3luYyBmdW5jdGlvbiBzZXREZXZpY2VQcm9wZXJ0eSAocHJvcCwgdmFsLCBvcHRzID0ge30pIHtcbiAgY29uc3Qge3ByaXZpbGVnZWQgPSB0cnVlfSA9IG9wdHM7XG4gIGxvZy5kZWJ1ZyhgU2V0dGluZyBkZXZpY2UgcHJvcGVydHkgJyR7cHJvcH0nIHRvICcke3ZhbH0nYCk7XG4gIGF3YWl0IHRoaXMuc2hlbGwoWydzZXRwcm9wJywgcHJvcCwgdmFsXSwge1xuICAgIHByaXZpbGVnZWQsXG4gIH0pO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEN1cnJlbnQgc3lzdGVtIGxhbmd1YWdlIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VTeXNMYW5ndWFnZSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVN5c0xhbmd1YWdlICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3BlcnNpc3Quc3lzLmxhbmd1YWdlJyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gQ3VycmVudCBjb3VudHJ5IG5hbWUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldERldmljZVN5c0NvdW50cnkgPSBhc3luYyBmdW5jdGlvbiBnZXREZXZpY2VTeXNDb3VudHJ5ICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3BlcnNpc3Quc3lzLmNvdW50cnknKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBDdXJyZW50IHN5c3RlbSBsb2NhbGUgbmFtZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMuZ2V0RGV2aWNlU3lzTG9jYWxlID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlU3lzTG9jYWxlICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3BlcnNpc3Quc3lzLmxvY2FsZScpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEN1cnJlbnQgcHJvZHVjdCBsYW5ndWFnZSBuYW1lIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VQcm9kdWN0TGFuZ3VhZ2UgPSBhc3luYyBmdW5jdGlvbiBnZXREZXZpY2VQcm9kdWN0TGFuZ3VhZ2UgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8ucHJvZHVjdC5sb2NhbGUubGFuZ3VhZ2UnKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBDdXJyZW50IHByb2R1Y3QgY291bnRyeSBuYW1lIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VQcm9kdWN0Q291bnRyeSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVByb2R1Y3RDb3VudHJ5ICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLnByb2R1Y3QubG9jYWxlLnJlZ2lvbicpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEN1cnJlbnQgcHJvZHVjdCBsb2NhbGUgbmFtZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMuZ2V0RGV2aWNlUHJvZHVjdExvY2FsZSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVByb2R1Y3RMb2NhbGUgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8ucHJvZHVjdC5sb2NhbGUnKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBUaGUgbW9kZWwgbmFtZSBvZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMuZ2V0TW9kZWwgPSBhc3luYyBmdW5jdGlvbiBnZXRNb2RlbCAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5wcm9kdWN0Lm1vZGVsJyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gVGhlIG1hbnVmYWN0dXJlciBuYW1lIG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXRNYW51ZmFjdHVyZXIgPSBhc3luYyBmdW5jdGlvbiBnZXRNYW51ZmFjdHVyZXIgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8ucHJvZHVjdC5tYW51ZmFjdHVyZXInKTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBjdXJyZW50IHNjcmVlbiBzaXplLlxuICpcbiAqIEByZXR1cm4ge3N0cmluZ30gRGV2aWNlIHNjcmVlbiBzaXplIGFzIHN0cmluZyBpbiBmb3JtYXQgJ1d4SCcgb3JcbiAqICAgICAgICAgICAgICAgICAgX251bGxfIGlmIGl0IGNhbm5vdCBiZSBkZXRlcm1pbmVkLlxuICovXG5tZXRob2RzLmdldFNjcmVlblNpemUgPSBhc3luYyBmdW5jdGlvbiBnZXRTY3JlZW5TaXplICgpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWyd3bScsICdzaXplJ10pO1xuICBsZXQgc2l6ZSA9IG5ldyBSZWdFeHAoL1BoeXNpY2FsIHNpemU6IChbXlxccj9cXG5dKykqL2cpLmV4ZWMoc3Rkb3V0KTtcbiAgaWYgKHNpemUgJiYgc2l6ZS5sZW5ndGggPj0gMikge1xuICAgIHJldHVybiBzaXplWzFdLnRyaW0oKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBjdXJyZW50IHNjcmVlbiBkZW5zaXR5IGluIGRwaVxuICpcbiAqIEByZXR1cm4gez9udW1iZXJ9IERldmljZSBzY3JlZW4gZGVuc2l0eSBhcyBhIG51bWJlciBvciBfbnVsbF8gaWYgaXRcbiAqICAgICAgICAgICAgICAgICAgY2Fubm90IGJlIGRldGVybWluZWRcbiAqL1xubWV0aG9kcy5nZXRTY3JlZW5EZW5zaXR5ID0gYXN5bmMgZnVuY3Rpb24gZ2V0U2NyZWVuRGVuc2l0eSAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnd20nLCAnZGVuc2l0eSddKTtcbiAgbGV0IGRlbnNpdHkgPSBuZXcgUmVnRXhwKC9QaHlzaWNhbCBkZW5zaXR5OiAoW15cXHI/XFxuXSspKi9nKS5leGVjKHN0ZG91dCk7XG4gIGlmIChkZW5zaXR5ICYmIGRlbnNpdHkubGVuZ3RoID49IDIpIHtcbiAgICBsZXQgZGVuc2l0eU51bWJlciA9IHBhcnNlSW50KGRlbnNpdHlbMV0udHJpbSgpLCAxMCk7XG4gICAgcmV0dXJuIGlzTmFOKGRlbnNpdHlOdW1iZXIpID8gbnVsbCA6IGRlbnNpdHlOdW1iZXI7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59O1xuXG4vKipcbiAqIFNldHVwIEhUVFAgcHJveHkgaW4gZGV2aWNlIGdsb2JhbCBzZXR0aW5ncy5cbiAqIFJlYWQgaHR0cHM6Ly9hbmRyb2lkLmdvb2dsZXNvdXJjZS5jb20vcGxhdGZvcm0vZnJhbWV3b3Jrcy9iYXNlLysvYW5kcm9pZC05LjAuMF9yMjEvY29yZS9qYXZhL2FuZHJvaWQvcHJvdmlkZXIvU2V0dGluZ3MuamF2YSBmb3IgZWFjaCBwcm9wZXJ0eVxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwcm94eUhvc3QgLSBUaGUgaG9zdCBuYW1lIG9mIHRoZSBwcm94eS5cbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gcHJveHlQb3J0IC0gVGhlIHBvcnQgbnVtYmVyIHRvIGJlIHNldC5cbiAqL1xubWV0aG9kcy5zZXRIdHRwUHJveHkgPSBhc3luYyBmdW5jdGlvbiBzZXRIdHRwUHJveHkgKHByb3h5SG9zdCwgcHJveHlQb3J0KSB7XG4gIGxldCBwcm94eSA9IGAke3Byb3h5SG9zdH06JHtwcm94eVBvcnR9YDtcbiAgaWYgKF8uaXNVbmRlZmluZWQocHJveHlIb3N0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ2FsbCB0byBzZXRIdHRwUHJveHkgbWV0aG9kIHdpdGggdW5kZWZpbmVkIHByb3h5X2hvc3Q6ICR7cHJveHl9YCk7XG4gIH1cbiAgaWYgKF8uaXNVbmRlZmluZWQocHJveHlQb3J0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ2FsbCB0byBzZXRIdHRwUHJveHkgbWV0aG9kIHdpdGggdW5kZWZpbmVkIHByb3h5X3BvcnQgJHtwcm94eX1gKTtcbiAgfVxuXG4gIGNvbnN0IGh0dHBQcm94eVNldHRpbnMgPSBbXG4gICAgWydodHRwX3Byb3h5JywgcHJveHldLFxuICAgIFsnZ2xvYmFsX2h0dHBfcHJveHlfaG9zdCcsIHByb3h5SG9zdF0sXG4gICAgWydnbG9iYWxfaHR0cF9wcm94eV9wb3J0JywgcHJveHlQb3J0XVxuICBdO1xuICBmb3IgKGNvbnN0IFtzZXR0aW5nS2V5LCBzZXR0aW5nVmFsdWVdIG9mIGh0dHBQcm94eVNldHRpbnMpIHtcbiAgICBhd2FpdCB0aGlzLnNldFNldHRpbmcoJ2dsb2JhbCcsIHNldHRpbmdLZXksIHNldHRpbmdWYWx1ZSk7XG4gIH1cbn07XG5cbi8qKlxuICogRGVsZXRlIEhUVFAgcHJveHkgaW4gZGV2aWNlIGdsb2JhbCBzZXR0aW5ncy5cbiAqIFJlYm9vdGluZyB0aGUgdGVzdCBkZXZpY2UgaXMgbmVjZXNzYXJ5IHRvIGFwcGx5IHRoZSBjaGFuZ2UuXG4gKi9cbm1ldGhvZHMuZGVsZXRlSHR0cFByb3h5ID0gYXN5bmMgZnVuY3Rpb24gZGVsZXRlSHR0cFByb3h5ICgpIHtcbiAgY29uc3QgaHR0cFByb3h5U2V0dGlucyA9IFtcbiAgICAnaHR0cF9wcm94eScsXG4gICAgJ2dsb2JhbF9odHRwX3Byb3h5X2hvc3QnLFxuICAgICdnbG9iYWxfaHR0cF9wcm94eV9wb3J0JyxcbiAgICAnZ2xvYmFsX2h0dHBfcHJveHlfZXhjbHVzaW9uX2xpc3QnIC8vIGBnbG9iYWxfaHR0cF9wcm94eV9leGNsdXNpb25fbGlzdD1gIHdhcyBnZW5lcmF0ZWQgYnkgYHNldHRpbmdzIGdsb2JhbCBodHRvX3Byb3h5IHh4eHhgXG4gIF07XG4gIGZvciAoY29uc3Qgc2V0dGluZyBvZiBodHRwUHJveHlTZXR0aW5zKSB7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChbJ3NldHRpbmdzJywgJ2RlbGV0ZScsICdnbG9iYWwnLCBzZXR0aW5nXSk7XG4gIH1cbn07XG5cbi8qKlxuICogU2V0IGRldmljZSBwcm9wZXJ0eS5cbiAqIFthbmRyb2lkLnByb3ZpZGVyLlNldHRpbmdzXXtAbGluayBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvYW5kcm9pZC9wcm92aWRlci9TZXR0aW5ncy5odG1sfVxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lc3BhY2UgLSBvbmUgb2Yge3N5c3RlbSwgc2VjdXJlLCBnbG9iYWx9LCBjYXNlLWluc2Vuc2l0aXZlLlxuICogQHBhcmFtIHtzdHJpbmd9IHNldHRpbmcgLSBwcm9wZXJ0eSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSB2YWx1ZSAtIHByb3BlcnR5IHZhbHVlLlxuICogQHJldHVybiB7c3RyaW5nfSBjb21tYW5kIG91dHB1dC5cbiAqL1xubWV0aG9kcy5zZXRTZXR0aW5nID0gYXN5bmMgZnVuY3Rpb24gc2V0U2V0dGluZyAobmFtZXNwYWNlLCBzZXR0aW5nLCB2YWx1ZSkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5zaGVsbChbJ3NldHRpbmdzJywgJ3B1dCcsIG5hbWVzcGFjZSwgc2V0dGluZywgdmFsdWVdKTtcbn07XG5cbi8qKlxuICogR2V0IGRldmljZSBwcm9wZXJ0eS5cbiAqIFthbmRyb2lkLnByb3ZpZGVyLlNldHRpbmdzXXtAbGluayBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvYW5kcm9pZC9wcm92aWRlci9TZXR0aW5ncy5odG1sfVxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lc3BhY2UgLSBvbmUgb2Yge3N5c3RlbSwgc2VjdXJlLCBnbG9iYWx9LCBjYXNlLWluc2Vuc2l0aXZlLlxuICogQHBhcmFtIHtzdHJpbmd9IHNldHRpbmcgLSBwcm9wZXJ0eSBuYW1lLlxuICogQHJldHVybiB7c3RyaW5nfSBwcm9wZXJ0eSB2YWx1ZS5cbiAqL1xubWV0aG9kcy5nZXRTZXR0aW5nID0gYXN5bmMgZnVuY3Rpb24gZ2V0U2V0dGluZyAobmFtZXNwYWNlLCBzZXR0aW5nKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnc2V0dGluZ3MnLCAnZ2V0JywgbmFtZXNwYWNlLCBzZXR0aW5nXSk7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBgYWRiIGJ1Z3JlcG9ydGAgY29tbWFuZCBvdXRwdXQuIFRoaXNcbiAqIG9wZXJhdGlvbiBtYXkgdGFrZSB1cCB0byBzZXZlcmFsIG1pbnV0ZXMuXG4gKlxuICogQHBhcmFtIHs/bnVtYmVyfSB0aW1lb3V0IFsxMjAwMDBdIC0gQ29tbWFuZCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kc1xuICogQHJldHVybnMge3N0cmluZ30gQ29tbWFuZCBzdGRvdXRcbiAqL1xubWV0aG9kcy5idWdyZXBvcnQgPSBhc3luYyBmdW5jdGlvbiBidWdyZXBvcnQgKHRpbWVvdXQgPSAxMjAwMDApIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ2J1Z3JlcG9ydCddLCB7dGltZW91dH0pO1xufTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBTY3JlZW5yZWNvcmRPcHRpb25zXG4gKiBAcHJvcGVydHkgez9zdHJpbmd9IHZpZGVvU2l6ZSAtIFRoZSBmb3JtYXQgaXMgd2lkdGh4aGVpZ2h0LlxuICogICAgICAgICAgICAgICAgICBUaGUgZGVmYXVsdCB2YWx1ZSBpcyB0aGUgZGV2aWNlJ3MgbmF0aXZlIGRpc3BsYXkgcmVzb2x1dGlvbiAoaWYgc3VwcG9ydGVkKSxcbiAqICAgICAgICAgICAgICAgICAgMTI4MHg3MjAgaWYgbm90LiBGb3IgYmVzdCByZXN1bHRzLFxuICogICAgICAgICAgICAgICAgICB1c2UgYSBzaXplIHN1cHBvcnRlZCBieSB5b3VyIGRldmljZSdzIEFkdmFuY2VkIFZpZGVvIENvZGluZyAoQVZDKSBlbmNvZGVyLlxuICogICAgICAgICAgICAgICAgICBGb3IgZXhhbXBsZSwgXCIxMjgweDcyMFwiXG4gKiBAcHJvcGVydHkgez9ib29sZWFufSBidWdSZXBvcnQgLSBTZXQgaXQgdG8gYHRydWVgIGluIG9yZGVyIHRvIGRpc3BsYXkgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiBvbiB0aGUgdmlkZW8gb3ZlcmxheSxcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2ggYXMgYSB0aW1lc3RhbXAsIHRoYXQgaXMgaGVscGZ1bCBpbiB2aWRlb3MgY2FwdHVyZWQgdG8gaWxsdXN0cmF0ZSBidWdzLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgVGhpcyBvcHRpb24gaXMgb25seSBzdXBwb3J0ZWQgc2luY2UgQVBJIGxldmVsIDI3IChBbmRyb2lkIFApLlxuICogQHByb3BlcnR5IHs/c3RyaW5nfG51bWJlcn0gdGltZUxpbWl0IC0gVGhlIG1heGltdW0gcmVjb3JkaW5nIHRpbWUsIGluIHNlY29uZHMuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGUgZGVmYXVsdCAoYW5kIG1heGltdW0pIHZhbHVlIGlzIDE4MCAoMyBtaW51dGVzKS5cbiAqIEBwcm9wZXJ0eSB7P3N0cmluZ3xudW1iZXJ9IGJpdFJhdGUgLSBUaGUgdmlkZW8gYml0IHJhdGUgZm9yIHRoZSB2aWRlbywgaW4gbWVnYWJpdHMgcGVyIHNlY29uZC5cbiAqICAgICAgICAgICAgICAgIFRoZSBkZWZhdWx0IHZhbHVlIGlzIDQuIFlvdSBjYW4gaW5jcmVhc2UgdGhlIGJpdCByYXRlIHRvIGltcHJvdmUgdmlkZW8gcXVhbGl0eSxcbiAqICAgICAgICAgICAgICAgIGJ1dCBkb2luZyBzbyByZXN1bHRzIGluIGxhcmdlciBtb3ZpZSBmaWxlcy5cbiAqL1xuXG4vKipcbiAqIEluaXRpYXRlIHNjcmVlbnJlY29yZCB1dGlsaXR5IG9uIHRoZSBkZXZpY2VcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gZGVzdGluYXRpb24gLSBGdWxsIHBhdGggdG8gdGhlIHdyaXRhYmxlIG1lZGlhIGZpbGUgZGVzdGluYXRpb25cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uIHRoZSBkZXZpY2UgZmlsZSBzeXN0ZW0uXG4gKiBAcGFyYW0gez9TY3JlZW5yZWNvcmRPcHRpb25zfSBvcHRpb25zIFt7fV1cbiAqIEByZXR1cm5zIHtTdWJQcm9jZXNzfSBzY3JlZW5yZWNvcmQgcHJvY2Vzcywgd2hpY2ggY2FuIGJlIHRoZW4gY29udHJvbGxlZCBieSB0aGUgY2xpZW50IGNvZGVcbiAqL1xubWV0aG9kcy5zY3JlZW5yZWNvcmQgPSBmdW5jdGlvbiBzY3JlZW5yZWNvcmQgKGRlc3RpbmF0aW9uLCBvcHRpb25zID0ge30pIHtcbiAgY29uc3QgY21kID0gWydzY3JlZW5yZWNvcmQnXTtcbiAgY29uc3Qge1xuICAgIHZpZGVvU2l6ZSxcbiAgICBiaXRSYXRlLFxuICAgIHRpbWVMaW1pdCxcbiAgICBidWdSZXBvcnQsXG4gIH0gPSBvcHRpb25zO1xuICBpZiAodXRpbC5oYXNWYWx1ZSh2aWRlb1NpemUpKSB7XG4gICAgY21kLnB1c2goJy0tc2l6ZScsIHZpZGVvU2l6ZSk7XG4gIH1cbiAgaWYgKHV0aWwuaGFzVmFsdWUodGltZUxpbWl0KSkge1xuICAgIGNtZC5wdXNoKCctLXRpbWUtbGltaXQnLCB0aW1lTGltaXQpO1xuICB9XG4gIGlmICh1dGlsLmhhc1ZhbHVlKGJpdFJhdGUpKSB7XG4gICAgY21kLnB1c2goJy0tYml0LXJhdGUnLCBiaXRSYXRlKTtcbiAgfVxuICBpZiAoYnVnUmVwb3J0KSB7XG4gICAgY21kLnB1c2goJy0tYnVncmVwb3J0Jyk7XG4gIH1cbiAgY21kLnB1c2goZGVzdGluYXRpb24pO1xuXG4gIGNvbnN0IGZ1bGxDbWQgPSBbXG4gICAgLi4udGhpcy5leGVjdXRhYmxlLmRlZmF1bHRBcmdzLFxuICAgICdzaGVsbCcsXG4gICAgLi4uY21kXG4gIF07XG4gIGxvZy5kZWJ1ZyhgQnVpbGRpbmcgc2NyZWVucmVjb3JkIHByb2Nlc3Mgd2l0aCB0aGUgY29tbWFuZCBsaW5lOiBhZGIgJHt1dGlsLnF1b3RlKGZ1bGxDbWQpfWApO1xuICByZXR1cm4gbmV3IFN1YlByb2Nlc3ModGhpcy5leGVjdXRhYmxlLnBhdGgsIGZ1bGxDbWQpO1xufTtcblxuLyoqXG4gKiBFeGVjdXRlcyB0aGUgZ2l2ZW4gZnVuY3Rpb24gd2l0aCB0aGUgZ2l2ZW4gaW5wdXQgbWV0aG9kIGNvbnRleHRcbiAqIGFuZCB0aGVuIHJlc3RvcmVzIHRoZSBJTUUgdG8gdGhlIG9yaWdpbmFsIHZhbHVlXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGltZSAtIFZhbGlkIElNRSBpZGVudGlmaWVyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiAtIEZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIHsqfSBUaGUgcmVzdWx0IG9mIHRoZSBnaXZlbiBmdW5jdGlvblxuICovXG5tZXRob2RzLnJ1bkluSW1lQ29udGV4dCA9IGFzeW5jIGZ1bmN0aW9uIHJ1bkluSW1lQ29udGV4dCAoaW1lLCBmbikge1xuICBjb25zdCBvcmlnaW5hbEltZSA9IGF3YWl0IHRoaXMuZGVmYXVsdElNRSgpO1xuICBpZiAob3JpZ2luYWxJbWUgPT09IGltZSkge1xuICAgIGxvZy5kZWJ1ZyhgVGhlIG9yaWdpbmFsIElNRSBpcyB0aGUgc2FtZSBhcyAnJHtpbWV9Jy4gVGhlcmUgaXMgbm8gbmVlZCB0byByZXNldCBpdGApO1xuICB9IGVsc2Uge1xuICAgIGF3YWl0IHRoaXMuZW5hYmxlSU1FKGltZSk7XG4gICAgYXdhaXQgdGhpcy5zZXRJTUUoaW1lKTtcbiAgfVxuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCBmbigpO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChvcmlnaW5hbEltZSAhPT0gaW1lKSB7XG4gICAgICBhd2FpdCB0aGlzLnNldElNRShvcmlnaW5hbEltZSk7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIEdldCB0eiBkYXRhYmFzZSB0aW1lIHpvbmUgZm9ybWF0dGVkIHRpbWV6b25lXG4gKlxuICogQHJldHVybnMge3N0cmluZ30gVFogZGF0YWJhc2UgVGltZSBab25lcyBmb3JtYXRcbiAqXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgYW55IGV4Y2VwdGlvbiBpcyByZXBvcnRlZCBieSBhZGIgc2hlbGwuXG4gKi9cbm1ldGhvZHMuZ2V0VGltZVpvbmUgPSBhc3luYyBmdW5jdGlvbiBnZXRUaW1lWm9uZSAoKSB7XG4gIGxvZy5kZWJ1ZygnR2V0dGluZyBjdXJyZW50IHRpbWV6b25lJyk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3BlcnNpc3Quc3lzLnRpbWV6b25lJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgdGltZXpvbmUuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBSZXRyaWV2ZXMgdGhlIGxpc3Qgb2YgZmVhdHVyZXMgc3VwcG9ydGVkIGJ5IHRoZSBkZXZpY2UgdW5kZXIgdGVzdFxuICpcbiAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSB0aGUgbGlzdCBvZiBzdXBwb3J0ZWQgZmVhdHVyZSBuYW1lcyBvciBhbiBlbXB0eSBsaXN0LlxuICogQW4gZXhhbXBsZSBhZGIgY29tbWFuZCBvdXRwdXQ6XG4gKiBgYGBcbiAqIGNtZFxuICogbHNfdjJcbiAqIGZpeGVkX3B1c2hfbWtkaXJcbiAqIHNoZWxsX3YyXG4gKiBhYmJcbiAqIHN0YXRfdjJcbiAqIGFwZXhcbiAqIGFiYl9leGVjXG4gKiByZW1vdW50X3NoZWxsXG4gKiBmaXhlZF9wdXNoX3N5bWxpbmtfdGltZXN0YW1wXG4gKiBgYGBcbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgcmV0cmlldmluZyB0aGUgbGlzdFxuICovXG5tZXRob2RzLmxpc3RGZWF0dXJlcyA9IGFzeW5jIGZ1bmN0aW9uIGxpc3RGZWF0dXJlcyAoKSB7XG4gIHRoaXMuX21lbW9pemVkRmVhdHVyZXMgPSB0aGlzLl9tZW1vaXplZEZlYXR1cmVzXG4gICAgfHwgXy5tZW1vaXplKGFzeW5jICgpID0+IGF3YWl0IHRoaXMuYWRiRXhlYyhbJ2ZlYXR1cmVzJ10pLCAoKSA9PiB0aGlzLmN1ckRldmljZUlkKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gKGF3YWl0IHRoaXMuX21lbW9pemVkRmVhdHVyZXMoKSlcbiAgICAgIC5zcGxpdCgvXFxzKy8pXG4gICAgICAubWFwKCh4KSA9PiB4LnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoXy5pbmNsdWRlcyhlLnN0ZGVyciwgJ3Vua25vd24gY29tbWFuZCcpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuICAgIHRocm93IGU7XG4gIH1cbn07XG5cbi8qKlxuICogQ2hlY2tzIHRoZSBzdGF0ZSBvZiBzdHJlYW1lZCBpbnN0YWxsIGZlYXR1cmUuXG4gKiBUaGlzIGZlYXR1cmUgYWxsb3dzIHRvIHNwZWVkIHVwIGFwayBpbnN0YWxsYXRpb25cbiAqIHNpbmNlIGl0IGRvZXMgbm90IHJlcXVpcmUgdGhlIG9yaWdpbmFsIGFwayB0byBiZSBwdXNoZWQgdG9cbiAqIHRoZSBkZXZpY2UgdW5kZXIgdGVzdCBmaXJzdCwgd2hpY2ggYWxzbyBzYXZlcyBzcGFjZS5cbiAqIEFsdGhvdWdoLCBpdCBpcyByZXF1aXJlZCB0aGF0IGJvdGggdGhlIGRldmljZSB1bmRlciB0ZXN0XG4gKiBhbmQgdGhlIGFkYiBzZXJ2ZXIgaGF2ZSB0aGUgbWVudGlvbmVkIGZ1bmN0aW9uYWxpdHkuXG4gKiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2Fvc3AtbWlycm9yL3BsYXRmb3JtX3N5c3RlbV9jb3JlL2Jsb2IvbWFzdGVyL2FkYi9jbGllbnQvYWRiX2luc3RhbGwuY3BwXG4gKiBmb3IgbW9yZSBkZXRhaWxzXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IGB0cnVlYCBpZiB0aGUgZmVhdHVyZSBpcyBzdXBwb3J0ZWQgYnkgYm90aCBhZGIgYW5kIHRoZVxuICogZGV2aWNlIHVuZGVyIHRlc3RcbiAqL1xubWV0aG9kcy5pc1N0cmVhbWVkSW5zdGFsbFN1cHBvcnRlZCA9IGFzeW5jIGZ1bmN0aW9uIGlzU3RyZWFtZWRJbnN0YWxsU3VwcG9ydGVkICgpIHtcbiAgY29uc3QgcHJvdG8gPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YodGhpcyk7XG4gIHByb3RvLl9oZWxwT3V0cHV0ID0gcHJvdG8uX2hlbHBPdXRwdXQgfHwgYXdhaXQgdGhpcy5hZGJFeGVjKFsnaGVscCddKTtcbiAgcmV0dXJuIHByb3RvLl9oZWxwT3V0cHV0LmluY2x1ZGVzKCctLXN0cmVhbWluZycpXG4gICAgJiYgKGF3YWl0IHRoaXMubGlzdEZlYXR1cmVzKCkpLmluY2x1ZGVzKCdjbWQnKTtcbn07XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgaW5jcmVtZW50YWwgaW5zdGFsbCBmZWF0dXJlIGlzIHN1cHBvcnRlZCBieSBBREIuXG4gKiBSZWFkIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvZmVhdHVyZXMjaW5jcmVtZW50YWxcbiAqIGZvciBtb3JlIGRldGFpbHMgb24gaXQuXG4gKlxuICogQHJldHVybnMge2Jvb2xlYW59IGB0cnVlYCBpZiB0aGUgZmVhdHVyZSBpcyBzdXBwb3J0ZWQgYnkgYm90aCBhZGIgYW5kIHRoZVxuICogZGV2aWNlIHVuZGVyIHRlc3RcbiAqL1xubWV0aG9kcy5pc0luY3JlbWVudGFsSW5zdGFsbFN1cHBvcnRlZCA9IGFzeW5jIGZ1bmN0aW9uIGlzSW5jcmVtZW50YWxJbnN0YWxsU3VwcG9ydGVkICgpIHtcbiAgY29uc3Qge2JpbmFyeX0gPSBhd2FpdCB0aGlzLmdldFZlcnNpb24oKTtcbiAgaWYgKCFiaW5hcnkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHV0aWwuY29tcGFyZVZlcnNpb25zKGJpbmFyeS52ZXJzaW9uLCAnPj0nLCAnMzAuMC4xJylcbiAgICAmJiAoYXdhaXQgdGhpcy5saXN0RmVhdHVyZXMoKSkuaW5jbHVkZXMoJ2FiYl9leGVjJyk7XG59O1xuXG5leHBvcnQgZGVmYXVsdCBtZXRob2RzO1xuIl0sImZpbGUiOiJsaWIvdG9vbHMvYWRiLWNvbW1hbmRzLmpzIiwic291cmNlUm9vdCI6Ii4uLy4uLy4uIn0=
