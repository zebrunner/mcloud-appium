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

var _net = _interopRequireDefault(require("net"));

var _os = require("os");

var _logcat = _interopRequireDefault(require("../logcat"));

var _asyncbox = require("asyncbox");

var _teen_process = require("teen_process");

var _bluebird = _interopRequireDefault(require("bluebird"));

var _shellQuote = require("shell-quote");

const SETTINGS_HELPER_ID = 'io.appium.settings';
const WIFI_CONNECTION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.WiFiConnectionSettingReceiver`;
const WIFI_CONNECTION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.wifi`;
const DATA_CONNECTION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.DataConnectionSettingReceiver`;
const DATA_CONNECTION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.data_connection`;
const ANIMATION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.AnimationSettingReceiver`;
const ANIMATION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.animation`;
const LOCALE_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.LocaleSettingReceiver`;
const LOCALE_SETTING_ACTION = `${SETTINGS_HELPER_ID}.locale`;
const LOCATION_SERVICE = `${SETTINGS_HELPER_ID}/.LocationService`;
const LOCATION_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.LocationInfoReceiver`;
const LOCATION_RETRIEVAL_ACTION = `${SETTINGS_HELPER_ID}.location`;
const CLIPBOARD_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.ClipboardReceiver`;
const CLIPBOARD_RETRIEVAL_ACTION = `${SETTINGS_HELPER_ID}.clipboard.get`;
const APPIUM_IME = `${SETTINGS_HELPER_ID}/.AppiumIME`;
const MAX_SHELL_BUFFER_LENGTH = 1000;
const NOT_CHANGEABLE_PERM_ERROR = /not a changeable permission type/i;
const IGNORED_PERM_ERRORS = [NOT_CHANGEABLE_PERM_ERROR, /Unknown permission/i];
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

      if (apiLevel === 28 && (await this.getDeviceProperty('ro.build.version.release')).toLowerCase() === 'q') {
        _logger.default.debug('Release version is Q but found API Level 28. Setting API Level to 29');

        apiLevel = 29;
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

methods.setHiddenApiPolicy = async function setHiddenApiPolicy(value) {
  await this.setSetting('global', 'hidden_api_policy_pre_p_apps', value);
  await this.setSetting('global', 'hidden_api_policy_p_apps', value);
  await this.setSetting('global', 'hidden_api_policy', value);
};

methods.setDefaultHiddenApiPolicy = async function setDefaultHiddenApiPolicy() {
  await this.shell(['settings', 'delete', 'global', 'hidden_api_policy_pre_p_apps']);
  await this.shell(['settings', 'delete', 'global', 'hidden_api_policy_p_apps']);
  await this.shell(['settings', 'delete', 'global', 'hidden_api_policy']);
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
    return (0, _helpers.getIMEListFromOutput)((await this.shell(['ime', 'list', '-a'])));
  } catch (e) {
    throw new Error(`Error getting available IME's. Original error: ${e.message}`);
  }
};

methods.enabledIMEs = async function enabledIMEs() {
  try {
    return (0, _helpers.getIMEListFromOutput)((await this.shell(['ime', 'list'])));
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
  _logger.default.debug(`Sending telnet command to device: ${command}`);

  let port = await this.getEmulatorPort();
  return await new _bluebird.default((resolve, reject) => {
    let conn = _net.default.createConnection(port, 'localhost'),
        connected = false,
        readyRegex = /^OK$/m,
        dataStream = '',
        res = null;

    conn.on('connect', () => {
      _logger.default.debug('Socket connection to device created');
    });
    conn.on('data', data => {
      data = data.toString('utf8');

      if (!connected) {
        if (readyRegex.test(data)) {
          connected = true;

          _logger.default.debug('Socket connection to device ready');

          conn.write(`${command}\n`);
        }
      } else {
        dataStream += data;

        if (readyRegex.test(data)) {
          res = dataStream.replace(readyRegex, '').trim();
          res = _lodash.default.last(res.trim().split('\n'));

          _logger.default.debug(`Telnet command got response: ${res}`);

          conn.write('quit\n');
        }
      }
    });
    conn.on('error', err => {
      _logger.default.debug(`Telnet command error: ${err.message}`);

      reject(err);
    });
    conn.on('close', () => {
      if (res === null) {
        reject(new Error('Never got a response from command'));
      } else {
        resolve(res);
      }
    });
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

methods.setWifiState = async function setWifiState(on, isEmulator = false) {
  if (isEmulator) {
    await this.shell(['svc', 'wifi', on ? 'enable' : 'disable'], {
      privileged: true
    });
  } else {
    await this.shell(['am', 'broadcast', '-a', WIFI_CONNECTION_SETTING_ACTION, '-n', WIFI_CONNECTION_SETTING_RECEIVER, '--es', 'setstatus', on ? 'enable' : 'disable']);
  }
};

methods.isDataOn = async function isDataOn() {
  let stdout = await this.getSetting('global', 'mobile_data');
  return parseInt(stdout, 10) !== 0;
};

methods.setDataState = async function setDataState(on, isEmulator = false) {
  if (isEmulator) {
    await this.shell(['svc', 'data', on ? 'enable' : 'disable'], {
      privileged: true
    });
  } else {
    await this.shell(['am', 'broadcast', '-a', DATA_CONNECTION_SETTING_ACTION, '-n', DATA_CONNECTION_SETTING_RECEIVER, '--es', 'setstatus', on ? 'enable' : 'disable']);
  }
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

methods.setAnimationState = async function setAnimationState(on) {
  await this.shell(['am', 'broadcast', '-a', ANIMATION_SETTING_ACTION, '-n', ANIMATION_SETTING_RECEIVER, '--es', 'setstatus', on ? 'enable' : 'disable']);
};

methods.isAnimationOn = async function isAnimationOn() {
  let animator_duration_scale = await this.getSetting('global', 'animator_duration_scale');
  let transition_animation_scale = await this.getSetting('global', 'transition_animation_scale');
  let window_animation_scale = await this.getSetting('global', 'window_animation_scale');
  return _lodash.default.some([animator_duration_scale, transition_animation_scale, window_animation_scale], setting => setting !== '0.0');
};

methods.setDeviceSysLocaleViaSettingApp = async function setDeviceSysLocaleViaSettingApp(language, country, script = null) {
  const params = ['am', 'broadcast', '-a', LOCALE_SETTING_ACTION, '-n', LOCALE_SETTING_RECEIVER, '--es', 'lang', language.toLowerCase(), '--es', 'country', country.toUpperCase()];

  if (script) {
    params.push('--es', 'script', script);
  }

  await this.shell(params);
};

methods.setGeoLocation = async function setGeoLocation(location, isEmulator = false) {
  const formatLocationValue = (valueName, isRequired = true) => {
    if (!_appiumSupport.util.hasValue(location[valueName])) {
      if (isRequired) {
        throw new Error(`${valueName} must be provided`);
      }

      return null;
    }

    const floatValue = parseFloat(location[valueName]);

    if (!isNaN(floatValue)) {
      return `${_lodash.default.ceil(floatValue, 5)}`;
    }

    if (isRequired) {
      throw new Error(`${valueName} is expected to be a valid float number. ` + `'${location[valueName]}' is given instead`);
    }

    return null;
  };

  const longitude = formatLocationValue('longitude');
  const latitude = formatLocationValue('latitude');
  const altitude = formatLocationValue('altitude', false);

  if (isEmulator) {
    await this.resetTelnetAuthToken();
    await this.adbExec(['emu', 'geo', 'fix', longitude, latitude]);
    await this.adbExec(['emu', 'geo', 'fix', longitude.replace('.', ','), latitude.replace('.', ',')]);
  } else {
    const args = ['am', 'startservice', '-e', 'longitude', longitude, '-e', 'latitude', latitude];

    if (_appiumSupport.util.hasValue(altitude)) {
      args.push('-e', 'altitude', altitude);
    }

    args.push(LOCATION_SERVICE);
    await this.shell(args);
  }
};

methods.getGeoLocation = async function getGeoLocation() {
  let output;

  try {
    output = await this.shell(['am', 'broadcast', '-n', LOCATION_RECEIVER, '-a', LOCATION_RETRIEVAL_ACTION]);
  } catch (err) {
    throw new Error(`Cannot retrieve the current geo coordinates from the device. ` + `Make sure the Appium Settings application is up to date and has location permissions. Also the location ` + `services must be enabled on the device. Original error: ${err.message}`);
  }

  const match = /data="(-?[\d\.]+)\s+(-?[\d\.]+)\s+(-?[\d\.]+)"/.exec(output);

  if (!match) {
    throw new Error(`Cannot parse the actual location values from the command output: ${output}`);
  }

  const location = {
    latitude: match[1],
    longitude: match[2],
    altitude: match[3]
  };

  _logger.default.debug(`Got geo coordinates: ${JSON.stringify(location)}`);

  return location;
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
  if (!this.isValidClass(processName)) {
    throw new Error(`Invalid process name: ${processName}`);
  }

  return !_lodash.default.isEmpty((await this.getPIDsByName(processName)));
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
    await this.startLogcat();
  } catch (e) {
    throw new Error(`Restart failed. Original error: ${e.message}`);
  }
};

methods.startLogcat = async function startLogcat() {
  if (!_lodash.default.isEmpty(this.logcat)) {
    throw new Error("Trying to start logcat capture but it's already started!");
  }

  this.logcat = new _logcat.default({
    adb: this.executable,
    debug: false,
    debugTrace: false,
    clearDeviceLogsOnStart: !!this.clearDeviceLogsOnStart
  });
  await this.logcat.startCapture();
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

methods.getPIDsByName = async function getPIDsByName(name) {
  _logger.default.debug(`Getting IDs of all '${name}' processes`);

  if ((await this.getApiLevel()) >= 23) {
    if (!_lodash.default.isBoolean(this._isPgrepAvailable)) {
      const pgrepOutput = _lodash.default.trim((await this.shell(['pgrep --help; echo $?'])));

      this._isPgrepAvailable = parseInt(_lodash.default.last(pgrepOutput.split(/\s+/)), 10) === 0;

      if (this._isPgrepAvailable) {
        this._canPgrepUseFullCmdLineSearch = /^-f\b/m.test(pgrepOutput);
      } else {
        this._isPidofAvailable = parseInt((await this.shell(['pidof --help > /dev/null; echo $?'])), 10) === 0;
      }
    }

    if (this._isPgrepAvailable || this._isPidofAvailable) {
      const shellCommand = this._isPgrepAvailable ? this._canPgrepUseFullCmdLineSearch ? ['pgrep', '-f', _lodash.default.escapeRegExp(name)] : ['pgrep', `^${_lodash.default.escapeRegExp(name.slice(-15))}$`] : ['pgrep', name];

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

  const pidColumnTitle = 'PID';
  const processNameColumnTitle = 'NAME';
  const stdout = await this.shell(['ps']);
  const titleMatch = new RegExp(`^(.*\\b${pidColumnTitle}\\b.*\\b${processNameColumnTitle}\\b.*)$`, 'm').exec(stdout);

  if (!titleMatch) {
    throw new Error(`Could not extract PID of '${name}' from ps output: ${stdout}`);
  }

  const allTitles = titleMatch[1].trim().split(/\s+/);
  const pidIndex = allTitles.indexOf(pidColumnTitle);
  const pids = [];
  const processNameRegex = new RegExp(`^(.*\\b\\d+\\b.*\\b${_lodash.default.escapeRegExp(name)}\\b.*)$`, 'gm');
  let matchedLine;

  while (matchedLine = processNameRegex.exec(stdout)) {
    const items = matchedLine[1].trim().split(/\s+/);

    if (pidIndex >= allTitles.length || isNaN(items[pidIndex])) {
      throw new Error(`Could not extract PID of '${name}' from '${matchedLine[1].trim()}'. ps output: ${stdout}`);
    }

    pids.push(parseInt(items[pidIndex], 10));
  }

  return pids;
};

methods.killProcessesByName = async function killProcessesByName(name) {
  try {
    _logger.default.debug(`Attempting to kill all ${name} processes`);

    let pids = await this.getPIDsByName(name);

    if (_lodash.default.isEmpty(pids)) {
      _logger.default.info(`No '${name}' process has been found`);

      return;
    }

    for (let pid of pids) {
      await this.killProcessByPID(pid);
    }
  } catch (e) {
    throw new Error(`Unable to kill ${name} processes. Original error: ${e.message}`);
  }
};

methods.killProcessByPID = async function killProcessByPID(pid) {
  _logger.default.debug(`Attempting to kill process ${pid}`);

  let wasRoot = false;
  let becameRoot = false;

  try {
    try {
      await this.shell(['kill', '-0', pid]);
    } catch (e) {
      if (!e.message.includes('Operation not permitted')) {
        throw e;
      }

      try {
        wasRoot = await this.isRoot();
      } catch (ign) {}

      if (wasRoot) {
        throw e;
      }

      _logger.default.info(`Cannot kill PID ${pid} due to insufficient permissions. Retrying as root`);

      let {
        isSuccessful
      } = await this.root();
      becameRoot = isSuccessful;
      await this.shell(['kill', '-0', pid]);
    }

    const timeoutMs = 1000;
    let stdout;

    try {
      await (0, _asyncbox.waitForCondition)(async () => {
        try {
          stdout = await this.shell(['kill', pid]);
          return false;
        } catch (e) {
          return true;
        }
      }, {
        waitMs: timeoutMs,
        intervalMs: 300
      });
    } catch (err) {
      _logger.default.warn(`Cannot kill process ${pid} in ${timeoutMs} ms. Trying to force kill...`);

      stdout = await this.shell(['kill', '-9', pid]);
    }

    return stdout;
  } finally {
    if (becameRoot) {
      await this.unroot();
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

  _logger.default.debug(`Building screenrecord process with the command line: adb ${(0, _shellQuote.quote)(fullCmd)}`);

  return new _teen_process.SubProcess(this.executable.path, fullCmd);
};

methods.runInImeContext = async function runInImeContext(ime, fn) {
  const originalIme = await this.defaultIME();

  if (originalIme === ime) {
    _logger.default.debug(`The original IME is the same as '${ime}'. There is no need to reset it`);
  } else {
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

methods.performEditorAction = async function performEditorAction(action) {
  _logger.default.debug(`Performing editor action: ${action}`);

  await this.runInImeContext(APPIUM_IME, async () => await this.shell(['input', 'text', `/${action}/`]));
};

methods.getTimeZone = async function getTimeZone() {
  _logger.default.debug('Getting current timezone');

  try {
    return await this.getDeviceProperty('persist.sys.timezone');
  } catch (e) {
    throw new Error(`Error getting timezone. Original error: ${e.message}`);
  }
};

methods.getClipboard = async function getClipboard() {
  _logger.default.debug('Getting the clipboard content');

  const retrieveClipboard = async () => await this.shell(['am', 'broadcast', '-n', CLIPBOARD_RECEIVER, '-a', CLIPBOARD_RETRIEVAL_ACTION]);

  let output;

  try {
    output = (await this.getApiLevel()) >= 29 ? await this.runInImeContext(APPIUM_IME, retrieveClipboard) : await retrieveClipboard();
  } catch (err) {
    throw new Error(`Cannot retrieve the current clipboard content from the device. ` + `Make sure the Appium Settings application is up to date. ` + `Original error: ${err.message}`);
  }

  const match = /data="([^"]*)"/.exec(output);

  if (!match) {
    throw new Error(`Cannot parse the actual cliboard content from the command output: ${output}`);
  }

  return _lodash.default.trim(match[1]);
};

var _default = methods;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi90b29scy9hZGItY29tbWFuZHMuanMiXSwibmFtZXMiOlsiU0VUVElOR1NfSEVMUEVSX0lEIiwiV0lGSV9DT05ORUNUSU9OX1NFVFRJTkdfUkVDRUlWRVIiLCJXSUZJX0NPTk5FQ1RJT05fU0VUVElOR19BQ1RJT04iLCJEQVRBX0NPTk5FQ1RJT05fU0VUVElOR19SRUNFSVZFUiIsIkRBVEFfQ09OTkVDVElPTl9TRVRUSU5HX0FDVElPTiIsIkFOSU1BVElPTl9TRVRUSU5HX1JFQ0VJVkVSIiwiQU5JTUFUSU9OX1NFVFRJTkdfQUNUSU9OIiwiTE9DQUxFX1NFVFRJTkdfUkVDRUlWRVIiLCJMT0NBTEVfU0VUVElOR19BQ1RJT04iLCJMT0NBVElPTl9TRVJWSUNFIiwiTE9DQVRJT05fUkVDRUlWRVIiLCJMT0NBVElPTl9SRVRSSUVWQUxfQUNUSU9OIiwiQ0xJUEJPQVJEX1JFQ0VJVkVSIiwiQ0xJUEJPQVJEX1JFVFJJRVZBTF9BQ1RJT04iLCJBUFBJVU1fSU1FIiwiTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEgiLCJOT1RfQ0hBTkdFQUJMRV9QRVJNX0VSUk9SIiwiSUdOT1JFRF9QRVJNX0VSUk9SUyIsIm1ldGhvZHMiLCJnZXRBZGJXaXRoQ29ycmVjdEFkYlBhdGgiLCJleGVjdXRhYmxlIiwicGF0aCIsImdldFNka0JpbmFyeVBhdGgiLCJhZGIiLCJpbml0QWFwdCIsImluaXRBYXB0MiIsImluaXRaaXBBbGlnbiIsImluaXRCdW5kbGV0b29sIiwiYmluYXJpZXMiLCJidW5kbGV0b29sIiwiZnMiLCJ3aGljaCIsImVyciIsIkVycm9yIiwiZ2V0QXBpTGV2ZWwiLCJfIiwiaXNJbnRlZ2VyIiwiX2FwaUxldmVsIiwic3RyT3V0cHV0IiwiZ2V0RGV2aWNlUHJvcGVydHkiLCJhcGlMZXZlbCIsInBhcnNlSW50IiwidHJpbSIsInRvTG93ZXJDYXNlIiwibG9nIiwiZGVidWciLCJpc05hTiIsImUiLCJtZXNzYWdlIiwiZ2V0UGxhdGZvcm1WZXJzaW9uIiwiaW5mbyIsImlzRGV2aWNlQ29ubmVjdGVkIiwiZGV2aWNlcyIsImdldENvbm5lY3RlZERldmljZXMiLCJsZW5ndGgiLCJta2RpciIsInJlbW90ZVBhdGgiLCJzaGVsbCIsImlzVmFsaWRDbGFzcyIsImNsYXNzU3RyaW5nIiwiUmVnRXhwIiwiZXhlYyIsImZvcmNlU3RvcCIsInBrZyIsImtpbGxQYWNrYWdlIiwiY2xlYXIiLCJncmFudEFsbFBlcm1pc3Npb25zIiwiYXBrIiwidGFyZ2V0U2RrIiwiZHVtcHN5c091dHB1dCIsInRhcmdldFNka1ZlcnNpb25Vc2luZ1BLRyIsInRhcmdldFNka1ZlcnNpb25Gcm9tTWFuaWZlc3QiLCJ3YXJuIiwicmVxdWVzdGVkUGVybWlzc2lvbnMiLCJnZXRSZXFQZXJtaXNzaW9ucyIsImdyYW50ZWRQZXJtaXNzaW9ucyIsImdldEdyYW50ZWRQZXJtaXNzaW9ucyIsInBlcm1pc3Npb25zVG9HcmFudCIsImRpZmZlcmVuY2UiLCJpc0VtcHR5IiwiZ3JhbnRQZXJtaXNzaW9ucyIsInBlcm1pc3Npb25zIiwiSlNPTiIsInN0cmluZ2lmeSIsImNvbW1hbmRzIiwiY21kQ2h1bmsiLCJwZXJtaXNzaW9uIiwibmV4dENtZCIsImpvaW4iLCJwdXNoIiwibGFzdEVycm9yIiwiY21kIiwic29tZSIsIm1zZ1JlZ2V4IiwidGVzdCIsInN0ZGVyciIsImdyYW50UGVybWlzc2lvbiIsInJldm9rZVBlcm1pc3Npb24iLCJjbWRPdXRwdXQiLCJzdGRvdXQiLCJnZXREZW5pZWRQZXJtaXNzaW9ucyIsImdldExvY2F0aW9uUHJvdmlkZXJzIiwiZ2V0U2V0dGluZyIsInNwbGl0IiwibWFwIiwicCIsImZpbHRlciIsIkJvb2xlYW4iLCJ0b2dnbGVHUFNMb2NhdGlvblByb3ZpZGVyIiwiZW5hYmxlZCIsInNldFNldHRpbmciLCJzZXRIaWRkZW5BcGlQb2xpY3kiLCJ2YWx1ZSIsInNldERlZmF1bHRIaWRkZW5BcGlQb2xpY3kiLCJzdG9wQW5kQ2xlYXIiLCJhdmFpbGFibGVJTUVzIiwiZW5hYmxlZElNRXMiLCJlbmFibGVJTUUiLCJpbWVJZCIsImRpc2FibGVJTUUiLCJzZXRJTUUiLCJkZWZhdWx0SU1FIiwiZW5naW5lIiwia2V5ZXZlbnQiLCJrZXljb2RlIiwiY29kZSIsImlucHV0VGV4dCIsInRleHQiLCJyZXBsYWNlIiwiY2xlYXJUZXh0RmllbGQiLCJhcmdzIiwiaSIsImxvY2siLCJpc1NjcmVlbkxvY2tlZCIsInRpbWVvdXRNcyIsIndhaXRNcyIsImludGVydmFsTXMiLCJiYWNrIiwiZ29Ub0hvbWUiLCJnZXRBZGJQYXRoIiwiZ2V0U2NyZWVuT3JpZW50YXRpb24iLCJwcm9jZXNzIiwiZW52IiwiQVBQSVVNX0xPR19EVU1QU1lTIiwiZHVtcHN5c0ZpbGUiLCJyZXNvbHZlIiwiY3dkIiwid3JpdGVGaWxlIiwiaXNTb2Z0S2V5Ym9hcmRQcmVzZW50IiwiaW5wdXRTaG93bk1hdGNoIiwiaW5wdXRWaWV3U2hvd25NYXRjaCIsImlzS2V5Ym9hcmRTaG93biIsImNhbkNsb3NlS2V5Ym9hcmQiLCJzZW5kVGVsbmV0Q29tbWFuZCIsImNvbW1hbmQiLCJwb3J0IiwiZ2V0RW11bGF0b3JQb3J0IiwiQiIsInJlamVjdCIsImNvbm4iLCJuZXQiLCJjcmVhdGVDb25uZWN0aW9uIiwiY29ubmVjdGVkIiwicmVhZHlSZWdleCIsImRhdGFTdHJlYW0iLCJyZXMiLCJvbiIsImRhdGEiLCJ0b1N0cmluZyIsIndyaXRlIiwibGFzdCIsImlzQWlycGxhbmVNb2RlT24iLCJzZXRBaXJwbGFuZU1vZGUiLCJicm9hZGNhc3RBaXJwbGFuZU1vZGUiLCJpc1dpZmlPbiIsInNldFdpZmlTdGF0ZSIsImlzRW11bGF0b3IiLCJwcml2aWxlZ2VkIiwiaXNEYXRhT24iLCJzZXREYXRhU3RhdGUiLCJzZXRXaWZpQW5kRGF0YSIsIndpZmkiLCJ1dGlsIiwiaGFzVmFsdWUiLCJzZXRBbmltYXRpb25TdGF0ZSIsImlzQW5pbWF0aW9uT24iLCJhbmltYXRvcl9kdXJhdGlvbl9zY2FsZSIsInRyYW5zaXRpb25fYW5pbWF0aW9uX3NjYWxlIiwid2luZG93X2FuaW1hdGlvbl9zY2FsZSIsInNldHRpbmciLCJzZXREZXZpY2VTeXNMb2NhbGVWaWFTZXR0aW5nQXBwIiwibGFuZ3VhZ2UiLCJjb3VudHJ5Iiwic2NyaXB0IiwicGFyYW1zIiwidG9VcHBlckNhc2UiLCJzZXRHZW9Mb2NhdGlvbiIsImxvY2F0aW9uIiwiZm9ybWF0TG9jYXRpb25WYWx1ZSIsInZhbHVlTmFtZSIsImlzUmVxdWlyZWQiLCJmbG9hdFZhbHVlIiwicGFyc2VGbG9hdCIsImNlaWwiLCJsb25naXR1ZGUiLCJsYXRpdHVkZSIsImFsdGl0dWRlIiwicmVzZXRUZWxuZXRBdXRoVG9rZW4iLCJhZGJFeGVjIiwiZ2V0R2VvTG9jYXRpb24iLCJvdXRwdXQiLCJtYXRjaCIsInJpbXJhZiIsImxvY2FsUGF0aCIsIm9wdHMiLCJwb3NpeCIsImRpcm5hbWUiLCJwdWxsIiwidGltZW91dCIsInByb2Nlc3NFeGlzdHMiLCJwcm9jZXNzTmFtZSIsImdldFBJRHNCeU5hbWUiLCJnZXRGb3J3YXJkTGlzdCIsImNvbm5lY3Rpb25zIiwiRU9MIiwibGluZSIsImZvcndhcmRQb3J0Iiwic3lzdGVtUG9ydCIsImRldmljZVBvcnQiLCJyZW1vdmVQb3J0Rm9yd2FyZCIsImdldFJldmVyc2VMaXN0IiwicmV2ZXJzZVBvcnQiLCJyZW1vdmVQb3J0UmV2ZXJzZSIsImZvcndhcmRBYnN0cmFjdFBvcnQiLCJwaW5nIiwiaW5kZXhPZiIsInJlc3RhcnQiLCJzdG9wTG9nY2F0IiwicmVzdGFydEFkYiIsIndhaXRGb3JEZXZpY2UiLCJzdGFydExvZ2NhdCIsImxvZ2NhdCIsIkxvZ2NhdCIsImRlYnVnVHJhY2UiLCJjbGVhckRldmljZUxvZ3NPblN0YXJ0Iiwic3RhcnRDYXB0dXJlIiwic3RvcENhcHR1cmUiLCJnZXRMb2djYXRMb2dzIiwiZ2V0TG9ncyIsInNldExvZ2NhdExpc3RlbmVyIiwibGlzdGVuZXIiLCJyZW1vdmVMb2djYXRMaXN0ZW5lciIsInJlbW92ZUxpc3RlbmVyIiwibmFtZSIsImlzQm9vbGVhbiIsIl9pc1BncmVwQXZhaWxhYmxlIiwicGdyZXBPdXRwdXQiLCJfY2FuUGdyZXBVc2VGdWxsQ21kTGluZVNlYXJjaCIsIl9pc1BpZG9mQXZhaWxhYmxlIiwic2hlbGxDb21tYW5kIiwiZXNjYXBlUmVnRXhwIiwic2xpY2UiLCJ4IiwicGlkQ29sdW1uVGl0bGUiLCJwcm9jZXNzTmFtZUNvbHVtblRpdGxlIiwidGl0bGVNYXRjaCIsImFsbFRpdGxlcyIsInBpZEluZGV4IiwicGlkcyIsInByb2Nlc3NOYW1lUmVnZXgiLCJtYXRjaGVkTGluZSIsIml0ZW1zIiwia2lsbFByb2Nlc3Nlc0J5TmFtZSIsInBpZCIsImtpbGxQcm9jZXNzQnlQSUQiLCJ3YXNSb290IiwiYmVjYW1lUm9vdCIsImluY2x1ZGVzIiwiaXNSb290IiwiaWduIiwiaXNTdWNjZXNzZnVsIiwicm9vdCIsInVucm9vdCIsImJyb2FkY2FzdFByb2Nlc3NFbmQiLCJpbnRlbnQiLCJicm9hZGNhc3QiLCJzdGFydCIsIkRhdGUiLCJub3ciLCJlbmRBbmRyb2lkQ292ZXJhZ2UiLCJpbnN0cnVtZW50UHJvYyIsImlzUnVubmluZyIsInN0b3AiLCJpbnN0cnVtZW50IiwiYWN0aXZpdHkiLCJpbnN0cnVtZW50V2l0aCIsInBrZ0FjdGl2aXR5IiwiYW5kcm9pZENvdmVyYWdlIiwiaW5zdHJ1bWVudENsYXNzIiwid2FpdFBrZyIsIndhaXRBY3Rpdml0eSIsImRlZmF1bHRBcmdzIiwiY29uY2F0IiwiU3ViUHJvY2VzcyIsIndhaXRGb3JBY3Rpdml0eSIsInByb3BlcnR5IiwidmFsIiwic2V0RGV2aWNlUHJvcGVydHkiLCJwcm9wIiwiZ2V0RGV2aWNlU3lzTGFuZ3VhZ2UiLCJnZXREZXZpY2VTeXNDb3VudHJ5IiwiZ2V0RGV2aWNlU3lzTG9jYWxlIiwiZ2V0RGV2aWNlUHJvZHVjdExhbmd1YWdlIiwiZ2V0RGV2aWNlUHJvZHVjdENvdW50cnkiLCJnZXREZXZpY2VQcm9kdWN0TG9jYWxlIiwiZ2V0TW9kZWwiLCJnZXRNYW51ZmFjdHVyZXIiLCJnZXRTY3JlZW5TaXplIiwic2l6ZSIsImdldFNjcmVlbkRlbnNpdHkiLCJkZW5zaXR5IiwiZGVuc2l0eU51bWJlciIsInNldEh0dHBQcm94eSIsInByb3h5SG9zdCIsInByb3h5UG9ydCIsInByb3h5IiwiaXNVbmRlZmluZWQiLCJodHRwUHJveHlTZXR0aW5zIiwic2V0dGluZ0tleSIsInNldHRpbmdWYWx1ZSIsImRlbGV0ZUh0dHBQcm94eSIsIm5hbWVzcGFjZSIsImJ1Z3JlcG9ydCIsInNjcmVlbnJlY29yZCIsImRlc3RpbmF0aW9uIiwib3B0aW9ucyIsInZpZGVvU2l6ZSIsImJpdFJhdGUiLCJ0aW1lTGltaXQiLCJidWdSZXBvcnQiLCJmdWxsQ21kIiwicnVuSW5JbWVDb250ZXh0IiwiaW1lIiwiZm4iLCJvcmlnaW5hbEltZSIsInBlcmZvcm1FZGl0b3JBY3Rpb24iLCJhY3Rpb24iLCJnZXRUaW1lWm9uZSIsImdldENsaXBib2FyZCIsInJldHJpZXZlQ2xpcGJvYXJkIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUlBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUdBLE1BQU1BLGtCQUFrQixHQUFHLG9CQUEzQjtBQUNBLE1BQU1DLGdDQUFnQyxHQUFJLEdBQUVELGtCQUFtQiwyQ0FBL0Q7QUFDQSxNQUFNRSw4QkFBOEIsR0FBSSxHQUFFRixrQkFBbUIsT0FBN0Q7QUFDQSxNQUFNRyxnQ0FBZ0MsR0FBSSxHQUFFSCxrQkFBbUIsMkNBQS9EO0FBQ0EsTUFBTUksOEJBQThCLEdBQUksR0FBRUosa0JBQW1CLGtCQUE3RDtBQUNBLE1BQU1LLDBCQUEwQixHQUFJLEdBQUVMLGtCQUFtQixzQ0FBekQ7QUFDQSxNQUFNTSx3QkFBd0IsR0FBSSxHQUFFTixrQkFBbUIsWUFBdkQ7QUFDQSxNQUFNTyx1QkFBdUIsR0FBSSxHQUFFUCxrQkFBbUIsbUNBQXREO0FBQ0EsTUFBTVEscUJBQXFCLEdBQUksR0FBRVIsa0JBQW1CLFNBQXBEO0FBQ0EsTUFBTVMsZ0JB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RDtBQUNGLENBUEQ7O0FBc0JBOUIsT0FBTyxDQUFDMFUsWUFBUixHQUF1QixlQUFlQSxZQUFmLEdBQStCO0FBQ3BEaFQsa0JBQUlDLEtBQUosQ0FBVSwrQkFBVjs7QUFDQSxRQUFNZ1QsaUJBQWlCLEdBQUcsWUFBWSxNQUFNLEtBQUtwUyxLQUFMLENBQVcsQ0FDckQsSUFEcUQsRUFDL0MsV0FEK0MsRUFFckQsSUFGcUQsRUFFL0M3QyxrQkFGK0MsRUFHckQsSUFIcUQsRUFHL0NDLDBCQUgrQyxDQUFYLENBQTVDOztBQUtBLE1BQUlxTSxNQUFKOztBQUNBLE1BQUk7QUFDRkEsSUFBQUEsTUFBTSxHQUFJLE9BQU0sS0FBS2hMLFdBQUwsRUFBTixLQUE0QixFQUE3QixHQUNKLE1BQU0sS0FBS21ULGVBQUwsQ0FBcUJ2VSxVQUFyQixFQUFpQytVLGlCQUFqQyxDQURGLEdBRUosTUFBTUEsaUJBQWlCLEVBRjVCO0FBR0QsR0FKRCxDQUlFLE9BQU83VCxHQUFQLEVBQVk7QUFDWixVQUFNLElBQUlDLEtBQUosQ0FBVyxpRUFBRCxHQUNiLDJEQURhLEdBRWIsbUJBQWtCRCxHQUFHLENBQUNnQixPQUFRLEVBRjNCLENBQU47QUFHRDs7QUFFRCxRQUFNbUssS0FBSyxHQUFHLGlCQUFpQnRKLElBQWpCLENBQXNCcUosTUFBdEIsQ0FBZDs7QUFDQSxNQUFJLENBQUNDLEtBQUwsRUFBWTtBQUNWLFVBQU0sSUFBSWxMLEtBQUosQ0FBVyxxRUFBb0VpTCxNQUFPLEVBQXRGLENBQU47QUFDRDs7QUFDRCxTQUFPL0ssZ0JBQUVPLElBQUYsQ0FBT3lLLEtBQUssQ0FBQyxDQUFELENBQVosQ0FBUDtBQUNELENBdkJEOztlQXlCZWpNLE8iLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbG9nIGZyb20gJy4uL2xvZ2dlci5qcyc7XG5pbXBvcnQge1xuICBnZXRJTUVMaXN0RnJvbU91dHB1dCwgaXNTaG93aW5nTG9ja3NjcmVlbiwgaXNDdXJyZW50Rm9jdXNPbktleWd1YXJkLFxuICBnZXRTdXJmYWNlT3JpZW50YXRpb24sIGlzU2NyZWVuT25GdWxseSwgZXh0cmFjdE1hdGNoaW5nUGVybWlzc2lvbnNcbn0gZnJvbSAnLi4vaGVscGVycy5qcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgeyBmcywgdXRpbCB9IGZyb20gJ2FwcGl1bS1zdXBwb3J0JztcbmltcG9ydCBuZXQgZnJvbSAnbmV0JztcbmltcG9ydCB7IEVPTCB9IGZyb20gJ29zJztcbmltcG9ydCBMb2djYXQgZnJvbSAnLi4vbG9nY2F0JztcbmltcG9ydCB7IHNsZWVwLCB3YWl0Rm9yQ29uZGl0aW9uIH0gZnJvbSAnYXN5bmNib3gnO1xuaW1wb3J0IHsgU3ViUHJvY2VzcyB9IGZyb20gJ3RlZW5fcHJvY2Vzcyc7XG5pbXBvcnQgQiBmcm9tICdibHVlYmlyZCc7XG5pbXBvcnQgeyBxdW90ZSB9IGZyb20gJ3NoZWxsLXF1b3RlJztcblxuXG5jb25zdCBTRVRUSU5HU19IRUxQRVJfSUQgPSAnaW8uYXBwaXVtLnNldHRpbmdzJztcbmNvbnN0IFdJRklfQ09OTkVDVElPTl9TRVRUSU5HX1JFQ0VJVkVSID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS8ucmVjZWl2ZXJzLldpRmlDb25uZWN0aW9uU2V0dGluZ1JlY2VpdmVyYDtcbmNvbnN0IFdJRklfQ09OTkVDVElPTl9TRVRUSU5HX0FDVElPTiA9IGAke1NFVFRJTkdTX0hFTFBFUl9JRH0ud2lmaWA7XG5jb25zdCBEQVRBX0NPTk5FQ1RJT05fU0VUVElOR19SRUNFSVZFUiA9IGAke1NFVFRJTkdTX0hFTFBFUl9JRH0vLnJlY2VpdmVycy5EYXRhQ29ubmVjdGlvblNldHRpbmdSZWNlaXZlcmA7XG5jb25zdCBEQVRBX0NPTk5FQ1RJT05fU0VUVElOR19BQ1RJT04gPSBgJHtTRVRUSU5HU19IRUxQRVJfSUR9LmRhdGFfY29ubmVjdGlvbmA7XG5jb25zdCBBTklNQVRJT05fU0VUVElOR19SRUNFSVZFUiA9IGAke1NFVFRJTkdTX0hFTFBFUl9JRH0vLnJlY2VpdmVycy5BbmltYXRpb25TZXR0aW5nUmVjZWl2ZXJgO1xuY29uc3QgQU5JTUFUSU9OX1NFVFRJTkdfQUNUSU9OID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS5hbmltYXRpb25gO1xuY29uc3QgTE9DQUxFX1NFVFRJTkdfUkVDRUlWRVIgPSBgJHtTRVRUSU5HU19IRUxQRVJfSUR9Ly5yZWNlaXZlcnMuTG9jYWxlU2V0dGluZ1JlY2VpdmVyYDtcbmNvbnN0IExPQ0FMRV9TRVRUSU5HX0FDVElPTiA9IGAke1NFVFRJTkdTX0hFTFBFUl9JRH0ubG9jYWxlYDtcbmNvbnN0IExPQ0FUSU9OX1NFUlZJQ0UgPSBgJHtTRVRUSU5HU19IRUxQRVJfSUR9Ly5Mb2NhdGlvblNlcnZpY2VgO1xuY29uc3QgTE9DQVRJT05fUkVDRUlWRVIgPSBgJHtTRVRUSU5HU19IRUxQRVJfSUR9Ly5yZWNlaXZlcnMuTG9jYXRpb25JbmZvUmVjZWl2ZXJgO1xuY29uc3QgTE9DQVRJT05fUkVUUklFVkFMX0FDVElPTiA9IGAke1NFVFRJTkdTX0hFTFBFUl9JRH0ubG9jYXRpb25gO1xuY29uc3QgQ0xJUEJPQVJEX1JFQ0VJVkVSID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS8ucmVjZWl2ZXJzLkNsaXBib2FyZFJlY2VpdmVyYDtcbmNvbnN0IENMSVBCT0FSRF9SRVRSSUVWQUxfQUNUSU9OID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS5jbGlwYm9hcmQuZ2V0YDtcbmNvbnN0IEFQUElVTV9JTUUgPSBgJHtTRVRUSU5HU19IRUxQRVJfSUR9Ly5BcHBpdW1JTUVgO1xuY29uc3QgTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEggPSAxMDAwO1xuY29uc3QgTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUiA9IC9ub3QgYSBjaGFuZ2VhYmxlIHBlcm1pc3Npb24gdHlwZS9pO1xuY29uc3QgSUdOT1JFRF9QRVJNX0VSUk9SUyA9IFtcbiAgTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUixcbiAgL1Vua25vd24gcGVybWlzc2lvbi9pLFxuXTtcblxuXG5sZXQgbWV0aG9kcyA9IHt9O1xuXG4vKipcbiAqIEdldCB0aGUgcGF0aCB0byBhZGIgZXhlY3V0YWJsZSBhbWQgYXNzaWduIGl0XG4gKiB0byB0aGlzLmV4ZWN1dGFibGUucGF0aCBhbmQgdGhpcy5iaW5hcmllcy5hZGIgcHJvcGVydGllcy5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEZ1bGwgcGF0aCB0byBhZGIgZXhlY3V0YWJsZS5cbiAqL1xubWV0aG9kcy5nZXRBZGJXaXRoQ29ycmVjdEFkYlBhdGggPSBhc3luYyBmdW5jdGlvbiBnZXRBZGJXaXRoQ29ycmVjdEFkYlBhdGggKCkge1xuICB0aGlzLmV4ZWN1dGFibGUucGF0aCA9IGF3YWl0IHRoaXMuZ2V0U2RrQmluYXJ5UGF0aCgnYWRiJyk7XG4gIHJldHVybiB0aGlzLmFkYjtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBmdWxsIHBhdGggdG8gYWFwdCB0b29sIGFuZCBhc3NpZ24gaXQgdG9cbiAqIHRoaXMuYmluYXJpZXMuYWFwdCBwcm9wZXJ0eVxuICovXG5tZXRob2RzLmluaXRBYXB0ID0gYXN5bmMgZnVuY3Rpb24gaW5pdEFhcHQgKCkge1xuICBhd2FpdCB0aGlzLmdldFNka0JpbmFyeVBhdGgoJ2FhcHQnKTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBmdWxsIHBhdGggdG8gYWFwdDIgdG9vbCBhbmQgYXNzaWduIGl0IHRvXG4gKiB0aGlzLmJpbmFyaWVzLmFhcHQyIHByb3BlcnR5XG4gKi9cbm1ldGhvZHMuaW5pdEFhcHQyID0gYXN5bmMgZnVuY3Rpb24gaW5pdEFhcHQyICgpIHtcbiAgYXdhaXQgdGhpcy5nZXRTZGtCaW5hcnlQYXRoKCdhYXB0MicpO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGZ1bGwgcGF0aCB0byB6aXBhbGlnbiB0b29sIGFuZCBhc3NpZ24gaXQgdG9cbiAqIHRoaXMuYmluYXJpZXMuemlwYWxpZ24gcHJvcGVydHlcbiAqL1xubWV0aG9kcy5pbml0WmlwQWxpZ24gPSBhc3luYyBmdW5jdGlvbiBpbml0WmlwQWxpZ24gKCkge1xuICBhd2FpdCB0aGlzLmdldFNka0JpbmFyeVBhdGgoJ3ppcGFsaWduJyk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgZnVsbCBwYXRoIHRvIGJ1bmRsZXRvb2wgYmluYXJ5IGFuZCBhc3NpZ24gaXQgdG9cbiAqIHRoaXMuYmluYXJpZXMuYnVuZGxldG9vbCBwcm9wZXJ0eVxuICovXG5tZXRob2RzLmluaXRCdW5kbGV0b29sID0gYXN5bmMgZnVuY3Rpb24gaW5pdEJ1bmRsZXRvb2wgKCkge1xuICB0cnkge1xuICAgIHRoaXMuYmluYXJpZXMuYnVuZGxldG9vbCA9IGF3YWl0IGZzLndoaWNoKCdidW5kbGV0b29sLmphcicpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2J1bmRsZXRvb2wuamFyIGJpbmFyeSBpcyBleHBlY3RlZCB0byBiZSBwcmVzZW50IGluIFBBVEguICcgK1xuICAgICAgJ1Zpc2l0IGh0dHBzOi8vZ2l0aHViLmNvbS9nb29nbGUvYnVuZGxldG9vbCBmb3IgbW9yZSBkZXRhaWxzLicpO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBBUEkgbGV2ZWwgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge251bWJlcn0gVGhlIEFQSSBsZXZlbCBhcyBpbnRlZ2VyIG51bWJlciwgZm9yIGV4YW1wbGUgMjEgZm9yXG4gKiAgICAgICAgICAgICAgICAgIEFuZHJvaWQgTG9sbGlwb3AuIFRoZSByZXN1bHQgb2YgdGhpcyBtZXRob2QgaXMgY2FjaGVkLCBzbyBhbGwgdGhlIGZ1cnRoZXJcbiAqIGNhbGxzIHJldHVybiB0aGUgc2FtZSB2YWx1ZSBhcyB0aGUgZmlyc3Qgb25lLlxuICovXG5tZXRob2RzLmdldEFwaUxldmVsID0gYXN5bmMgZnVuY3Rpb24gZ2V0QXBpTGV2ZWwgKCkge1xuICBpZiAoIV8uaXNJbnRlZ2VyKHRoaXMuX2FwaUxldmVsKSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdHJPdXRwdXQgPSBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5idWlsZC52ZXJzaW9uLnNkaycpO1xuICAgICAgbGV0IGFwaUxldmVsID0gcGFyc2VJbnQoc3RyT3V0cHV0LnRyaW0oKSwgMTApO1xuXG4gICAgICAvLyBUZW1wIHdvcmthcm91bmQuIEFuZHJvaWQgUSBiZXRhIGVtdWxhdG9ycyByZXBvcnQgU0RLIDI4IHdoZW4gdGhleSBzaG91bGQgYmUgMjlcbiAgICAgIGlmIChhcGlMZXZlbCA9PT0gMjggJiYgKGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLmJ1aWxkLnZlcnNpb24ucmVsZWFzZScpKS50b0xvd2VyQ2FzZSgpID09PSAncScpIHtcbiAgICAgICAgbG9nLmRlYnVnKCdSZWxlYXNlIHZlcnNpb24gaXMgUSBidXQgZm91bmQgQVBJIExldmVsIDI4LiBTZXR0aW5nIEFQSSBMZXZlbCB0byAyOScpO1xuICAgICAgICBhcGlMZXZlbCA9IDI5O1xuICAgICAgfVxuICAgICAgdGhpcy5fYXBpTGV2ZWwgPSBhcGlMZXZlbDtcbiAgICAgIGxvZy5kZWJ1ZyhgRGV2aWNlIEFQSSBsZXZlbDogJHt0aGlzLl9hcGlMZXZlbH1gKTtcbiAgICAgIGlmIChpc05hTih0aGlzLl9hcGlMZXZlbCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUaGUgYWN0dWFsIG91dHB1dCAnJHtzdHJPdXRwdXR9JyBjYW5ub3QgYmUgY29udmVydGVkIHRvIGFuIGludGVnZXJgKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZGV2aWNlIEFQSSBsZXZlbC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGhpcy5fYXBpTGV2ZWw7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBwbGF0Zm9ybSB2ZXJzaW9uIG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBwbGF0Zm9ybSB2ZXJzaW9uIGFzIGEgc3RyaW5nLCBmb3IgZXhhbXBsZSAnNS4wJyBmb3JcbiAqIEFuZHJvaWQgTG9sbGlwb3AuXG4gKi9cbm1ldGhvZHMuZ2V0UGxhdGZvcm1WZXJzaW9uID0gYXN5bmMgZnVuY3Rpb24gZ2V0UGxhdGZvcm1WZXJzaW9uICgpIHtcbiAgbG9nLmluZm8oJ0dldHRpbmcgZGV2aWNlIHBsYXRmb3JtIHZlcnNpb24nKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8uYnVpbGQudmVyc2lvbi5yZWxlYXNlJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZGV2aWNlIHBsYXRmb3JtIHZlcnNpb24uIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBWZXJpZnkgd2hldGhlciBhIGRldmljZSBpcyBjb25uZWN0ZWQuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiBhdCBsZWFzdCBvbmUgZGV2aWNlIGlzIHZpc2libGUgdG8gYWRiLlxuICovXG5tZXRob2RzLmlzRGV2aWNlQ29ubmVjdGVkID0gYXN5bmMgZnVuY3Rpb24gaXNEZXZpY2VDb25uZWN0ZWQgKCkge1xuICBsZXQgZGV2aWNlcyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGVkRGV2aWNlcygpO1xuICByZXR1cm4gZGV2aWNlcy5sZW5ndGggPiAwO1xufTtcblxuLyoqXG4gKiBSZWN1cnNpdmVseSBjcmVhdGUgYSBuZXcgZm9sZGVyIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSBuZXcgcGF0aCB0byBiZSBjcmVhdGVkLlxuICogQHJldHVybiB7c3RyaW5nfSBta2RpciBjb21tYW5kIG91dHB1dC5cbiAqL1xubWV0aG9kcy5ta2RpciA9IGFzeW5jIGZ1bmN0aW9uIG1rZGlyIChyZW1vdGVQYXRoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnbWtkaXInLCAnLXAnLCByZW1vdGVQYXRoXSk7XG59O1xuXG4vKipcbiAqIFZlcmlmeSB3aGV0aGVyIHRoZSBnaXZlbiBhcmd1bWVudCBpcyBhXG4gKiB2YWxpZCBjbGFzcyBuYW1lLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBjbGFzc1N0cmluZyAtIFRoZSBhY3R1YWwgY2xhc3MgbmFtZSB0byBiZSB2ZXJpZmllZC5cbiAqIEByZXR1cm4gez9BcnJheS48TWF0Y2g+fSBUaGUgcmVzdWx0IG9mIFJlZ2V4cC5leGVjIG9wZXJhdGlvblxuICogICAgICAgICAgICAgICAgICAgICAgICAgIG9yIF9udWxsXyBpZiBubyBtYXRjaGVzIGFyZSBmb3VuZC5cbiAqL1xubWV0aG9kcy5pc1ZhbGlkQ2xhc3MgPSBmdW5jdGlvbiBpc1ZhbGlkQ2xhc3MgKGNsYXNzU3RyaW5nKSB7XG4gIC8vIHNvbWUucGFja2FnZS9zb21lLnBhY2thZ2UuQWN0aXZpdHlcbiAgcmV0dXJuIG5ldyBSZWdFeHAoL15bYS16QS1aMC05Li9fXSskLykuZXhlYyhjbGFzc1N0cmluZyk7XG59O1xuXG4vKipcbiAqIEZvcmNlIGFwcGxpY2F0aW9uIHRvIHN0b3Agb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHN0b3BwZWQuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBvdXRwdXQgb2YgdGhlIGNvcnJlc3BvbmRpbmcgYWRiIGNvbW1hbmQuXG4gKi9cbm1ldGhvZHMuZm9yY2VTdG9wID0gYXN5bmMgZnVuY3Rpb24gZm9yY2VTdG9wIChwa2cpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydhbScsICdmb3JjZS1zdG9wJywgcGtnXSk7XG59O1xuXG4vKlxuICogS2lsbCBhcHBsaWNhdGlvblxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHN0b3BwZWQuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBvdXRwdXQgb2YgdGhlIGNvcnJlc3BvbmRpbmcgYWRiIGNvbW1hbmQuXG4gKi9cbm1ldGhvZHMua2lsbFBhY2thZ2UgPSBhc3luYyBmdW5jdGlvbiBraWxsUGFja2FnZSAocGtnKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnYW0nLCAna2lsbCcsIHBrZ10pO1xufTtcblxuLyoqXG4gKiBDbGVhciB0aGUgdXNlciBkYXRhIG9mIHRoZSBwYXJ0aWN1bGFyIGFwcGxpY2F0aW9uIG9uIHRoZSBkZXZpY2VcbiAqIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgY2xlYXJlZC5cbiAqIEByZXR1cm4ge3N0cmluZ30gVGhlIG91dHB1dCBvZiB0aGUgY29ycmVzcG9uZGluZyBhZGIgY29tbWFuZC5cbiAqL1xubWV0aG9kcy5jbGVhciA9IGFzeW5jIGZ1bmN0aW9uIGNsZWFyIChwa2cpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdjbGVhcicsIHBrZ10pO1xufTtcblxuLyoqXG4gKiBHcmFudCBhbGwgcGVybWlzc2lvbnMgcmVxdWVzdGVkIGJ5IHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKiBUaGlzIG1ldGhvZCBpcyBvbmx5IHVzZWZ1bCBvbiBBbmRyb2lkIDYuMCsgYW5kIGZvciBhcHBsaWNhdGlvbnNcbiAqIHRoYXQgc3VwcG9ydCBjb21wb25lbnRzLWJhc2VkIHBlcm1pc3Npb25zIHNldHRpbmcuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGFwayAtIFRoZSBwYXRoIHRvIHRoZSBhY3R1YWwgYXBrIGZpbGUuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGdyYW50aW5nIHBlcm1pc3Npb25zXG4gKi9cbm1ldGhvZHMuZ3JhbnRBbGxQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdyYW50QWxsUGVybWlzc2lvbnMgKHBrZywgYXBrKSB7XG4gIGNvbnN0IGFwaUxldmVsID0gYXdhaXQgdGhpcy5nZXRBcGlMZXZlbCgpO1xuICBsZXQgdGFyZ2V0U2RrID0gMDtcbiAgbGV0IGR1bXBzeXNPdXRwdXQgPSBudWxsO1xuICB0cnkge1xuICAgIGlmICghYXBrKSB7XG4gICAgICAvKipcbiAgICAgICAqIElmIGFwayBub3QgcHJvdmlkZWQsIGNvbnNpZGVyaW5nIGFwayBhbHJlYWR5IGluc3RhbGxlZCBvbiB0aGUgZGV2aWNlXG4gICAgICAgKiBhbmQgZmV0Y2hpbmcgdGFyZ2V0U2RrIHVzaW5nIHBhY2thZ2UgbmFtZS5cbiAgICAgICAqL1xuICAgICAgZHVtcHN5c091dHB1dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ3BhY2thZ2UnLCBwa2ddKTtcbiAgICAgIHRhcmdldFNkayA9IGF3YWl0IHRoaXMudGFyZ2V0U2RrVmVyc2lvblVzaW5nUEtHKHBrZywgZHVtcHN5c091dHB1dCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhcmdldFNkayA9IGF3YWl0IHRoaXMudGFyZ2V0U2RrVmVyc2lvbkZyb21NYW5pZmVzdChhcGspO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIC8vYXZvaWRpbmcgbG9nZ2luZyBlcnJvciBzdGFjaywgYXMgY2FsbGluZyBsaWJyYXJ5IGZ1bmN0aW9uIHdvdWxkIGhhdmUgbG9nZ2VkXG4gICAgbG9nLndhcm4oYFJhbiBpbnRvIHByb2JsZW0gZ2V0dGluZyB0YXJnZXQgU0RLIHZlcnNpb247IGlnbm9yaW5nLi4uYCk7XG4gIH1cbiAgaWYgKGFwaUxldmVsID49IDIzICYmIHRhcmdldFNkayA+PSAyMykge1xuICAgIC8qKlxuICAgICAqIElmIHRoZSBkZXZpY2UgaXMgcnVubmluZyBBbmRyb2lkIDYuMChBUEkgMjMpIG9yIGhpZ2hlciwgYW5kIHlvdXIgYXBwJ3MgdGFyZ2V0IFNESyBpcyAyMyBvciBoaWdoZXI6XG4gICAgICogVGhlIGFwcCBoYXMgdG8gbGlzdCB0aGUgcGVybWlzc2lvbnMgaW4gdGhlIG1hbmlmZXN0LlxuICAgICAqIHJlZmVyOiBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS90cmFpbmluZy9wZXJtaXNzaW9ucy9yZXF1ZXN0aW5nLmh0bWxcbiAgICAgKi9cbiAgICBkdW1wc3lzT3V0cHV0ID0gZHVtcHN5c091dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gICAgY29uc3QgcmVxdWVzdGVkUGVybWlzc2lvbnMgPSBhd2FpdCB0aGlzLmdldFJlcVBlcm1pc3Npb25zKHBrZywgZHVtcHN5c091dHB1dCk7XG4gICAgY29uc3QgZ3JhbnRlZFBlcm1pc3Npb25zID0gYXdhaXQgdGhpcy5nZXRHcmFudGVkUGVybWlzc2lvbnMocGtnLCBkdW1wc3lzT3V0cHV0KTtcbiAgICBjb25zdCBwZXJtaXNzaW9uc1RvR3JhbnQgPSBfLmRpZmZlcmVuY2UocmVxdWVzdGVkUGVybWlzc2lvbnMsIGdyYW50ZWRQZXJtaXNzaW9ucyk7XG4gICAgaWYgKF8uaXNFbXB0eShwZXJtaXNzaW9uc1RvR3JhbnQpKSB7XG4gICAgICBsb2cuaW5mbyhgJHtwa2d9IGNvbnRhaW5zIG5vIHBlcm1pc3Npb25zIGF2YWlsYWJsZSBmb3IgZ3JhbnRpbmdgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5ncmFudFBlcm1pc3Npb25zKHBrZywgcGVybWlzc2lvbnNUb0dyYW50KTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogR3JhbnQgbXVsdGlwbGUgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKiBUaGlzIGNhbGwgaXMgbW9yZSBwZXJmb3JtYW50IHRoYW4gYGdyYW50UGVybWlzc2lvbmAgb25lLCBzaW5jZSBpdCBjb21iaW5lc1xuICogbXVsdGlwbGUgYGFkYiBzaGVsbGAgY2FsbHMgaW50byBhIHNpbmdsZSBjb21tYW5kLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gcGVybWlzc2lvbnMgLSBUaGUgbGlzdCBvZiBwZXJtaXNzaW9ucyB0byBiZSBncmFudGVkLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBjaGFuZ2luZyBwZXJtaXNzaW9ucy5cbiAqL1xubWV0aG9kcy5ncmFudFBlcm1pc3Npb25zID0gYXN5bmMgZnVuY3Rpb24gZ3JhbnRQZXJtaXNzaW9ucyAocGtnLCBwZXJtaXNzaW9ucykge1xuICAvLyBBcyBpdCBjb25zdW1lcyBtb3JlIHRpbWUgZm9yIGdyYW50aW5nIGVhY2ggcGVybWlzc2lvbixcbiAgLy8gdHJ5aW5nIHRvIGdyYW50IGFsbCBwZXJtaXNzaW9uIGJ5IGZvcm1pbmcgZXF1aXZhbGVudCBjb21tYW5kLlxuICAvLyBBbHNvLCBpdCBpcyBuZWNlc3NhcnkgdG8gc3BsaXQgbG9uZyBjb21tYW5kcyBpbnRvIGNodW5rcywgc2luY2UgdGhlIG1heGltdW0gbGVuZ3RoIG9mXG4gIC8vIGFkYiBzaGVsbCBidWZmZXIgaXMgbGltaXRlZFxuICBsb2cuZGVidWcoYEdyYW50aW5nIHBlcm1pc3Npb25zICR7SlNPTi5zdHJpbmdpZnkocGVybWlzc2lvbnMpfSB0byAnJHtwa2d9J2ApO1xuICBjb25zdCBjb21tYW5kcyA9IFtdO1xuICBsZXQgY21kQ2h1bmsgPSBbXTtcbiAgZm9yIChjb25zdCBwZXJtaXNzaW9uIG9mIHBlcm1pc3Npb25zKSB7XG4gICAgY29uc3QgbmV4dENtZCA9IFsncG0nLCAnZ3JhbnQnLCBwa2csIHBlcm1pc3Npb24sICc7J107XG4gICAgaWYgKG5leHRDbWQuam9pbignICcpLmxlbmd0aCArIGNtZENodW5rLmpvaW4oJyAnKS5sZW5ndGggPj0gTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEgpIHtcbiAgICAgIGNvbW1hbmRzLnB1c2goY21kQ2h1bmspO1xuICAgICAgY21kQ2h1bmsgPSBbXTtcbiAgICB9XG4gICAgY21kQ2h1bmsgPSBbLi4uY21kQ2h1bmssIC4uLm5leHRDbWRdO1xuICB9XG4gIGlmICghXy5pc0VtcHR5KGNtZENodW5rKSkge1xuICAgIGNvbW1hbmRzLnB1c2goY21kQ2h1bmspO1xuICB9XG4gIGxvZy5kZWJ1ZyhgR290IHRoZSBmb2xsb3dpbmcgY29tbWFuZCBjaHVua3MgdG8gZXhlY3V0ZTogJHtKU09OLnN0cmluZ2lmeShjb21tYW5kcyl9YCk7XG4gIGxldCBsYXN0RXJyb3IgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNtZCBvZiBjb21tYW5kcykge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnNoZWxsKGNtZCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gdGhpcyBpcyB0byBnaXZlIHRoZSBtZXRob2QgYSBjaGFuY2UgdG8gYXNzaWduIGFsbCB0aGUgcmVxdWVzdGVkIHBlcm1pc3Npb25zXG4gICAgICAvLyBiZWZvcmUgdG8gcXVpdCBpbiBjYXNlIHdlJ2QgbGlrZSB0byBpZ25vcmUgdGhlIGVycm9yIG9uIHRoZSBoaWdoZXIgbGV2ZWxcbiAgICAgIGlmICghSUdOT1JFRF9QRVJNX0VSUk9SUy5zb21lKChtc2dSZWdleCkgPT4gbXNnUmVnZXgudGVzdChlLnN0ZGVyciB8fCBlLm1lc3NhZ2UpKSkge1xuICAgICAgICBsYXN0RXJyb3IgPSBlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAobGFzdEVycm9yKSB7XG4gICAgdGhyb3cgbGFzdEVycm9yO1xuICB9XG59O1xuXG4vKipcbiAqIEdyYW50IHNpbmdsZSBwZXJtaXNzaW9uIGZvciB0aGUgcGFydGljdWxhciBwYWNrYWdlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBwZXJtaXNzaW9uIC0gVGhlIGZ1bGwgbmFtZSBvZiB0aGUgcGVybWlzc2lvbiB0byBiZSBncmFudGVkLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBjaGFuZ2luZyBwZXJtaXNzaW9ucy5cbiAqL1xubWV0aG9kcy5ncmFudFBlcm1pc3Npb24gPSBhc3luYyBmdW5jdGlvbiBncmFudFBlcm1pc3Npb24gKHBrZywgcGVybWlzc2lvbikge1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdncmFudCcsIHBrZywgcGVybWlzc2lvbl0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKCFOT1RfQ0hBTkdFQUJMRV9QRVJNX0VSUk9SLnRlc3QoZS5zdGRlcnIgfHwgZS5tZXNzYWdlKSkge1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogUmV2b2tlIHNpbmdsZSBwZXJtaXNzaW9uIGZyb20gdGhlIHBhcnRpY3VsYXIgcGFja2FnZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGtnIC0gVGhlIHBhY2thZ2UgbmFtZSB0byBiZSBwcm9jZXNzZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gcGVybWlzc2lvbiAtIFRoZSBmdWxsIG5hbWUgb2YgdGhlIHBlcm1pc3Npb24gdG8gYmUgcmV2b2tlZC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgY2hhbmdpbmcgcGVybWlzc2lvbnMuXG4gKi9cbm1ldGhvZHMucmV2b2tlUGVybWlzc2lvbiA9IGFzeW5jIGZ1bmN0aW9uIHJldm9rZVBlcm1pc3Npb24gKHBrZywgcGVybWlzc2lvbikge1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdyZXZva2UnLCBwa2csIHBlcm1pc3Npb25dKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmICghTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUi50ZXN0KGUuc3RkZXJyIHx8IGUubWVzc2FnZSkpIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGdyYW50ZWQgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGNtZE91dHB1dCBbbnVsbF0gLSBPcHRpb25hbCBwYXJhbWV0ZXIgY29udGFpbmluZyBjb21tYW5kIG91dHB1dCBvZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfZHVtcHN5cyBwYWNrYWdlXyBjb21tYW5kLiBJdCBtYXkgc3BlZWQgdXAgdGhlIG1ldGhvZCBleGVjdXRpb24uXG4gKiBAcmV0dXJuIHtBcnJheTxTdHJpbmc+fSBUaGUgbGlzdCBvZiBncmFudGVkIHBlcm1pc3Npb25zIG9yIGFuIGVtcHR5IGxpc3QuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGNoYW5naW5nIHBlcm1pc3Npb25zLlxuICovXG5tZXRob2RzLmdldEdyYW50ZWRQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdldEdyYW50ZWRQZXJtaXNzaW9ucyAocGtnLCBjbWRPdXRwdXQgPSBudWxsKSB7XG4gIGxvZy5kZWJ1ZygnUmV0cmlldmluZyBncmFudGVkIHBlcm1pc3Npb25zJyk7XG4gIGNvbnN0IHN0ZG91dCA9IGNtZE91dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gIHJldHVybiBleHRyYWN0TWF0Y2hpbmdQZXJtaXNzaW9ucyhzdGRvdXQsIFsnaW5zdGFsbCcsICdydW50aW1lJ10sIHRydWUpO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBkZW5pZWQgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGNtZE91dHB1dCBbbnVsbF0gLSBPcHRpb25hbCBwYXJhbWV0ZXIgY29udGFpbmluZyBjb21tYW5kIG91dHB1dCBvZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfZHVtcHN5cyBwYWNrYWdlXyBjb21tYW5kLiBJdCBtYXkgc3BlZWQgdXAgdGhlIG1ldGhvZCBleGVjdXRpb24uXG4gKiBAcmV0dXJuIHtBcnJheTxTdHJpbmc+fSBUaGUgbGlzdCBvZiBkZW5pZWQgcGVybWlzc2lvbnMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqL1xubWV0aG9kcy5nZXREZW5pZWRQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdldERlbmllZFBlcm1pc3Npb25zIChwa2csIGNtZE91dHB1dCA9IG51bGwpIHtcbiAgbG9nLmRlYnVnKCdSZXRyaWV2aW5nIGRlbmllZCBwZXJtaXNzaW9ucycpO1xuICBjb25zdCBzdGRvdXQgPSBjbWRPdXRwdXQgfHwgYXdhaXQgdGhpcy5zaGVsbChbJ2R1bXBzeXMnLCAncGFja2FnZScsIHBrZ10pO1xuICByZXR1cm4gZXh0cmFjdE1hdGNoaW5nUGVybWlzc2lvbnMoc3Rkb3V0LCBbJ2luc3RhbGwnLCAncnVudGltZSddLCBmYWxzZSk7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIHJlcXVlc3RlZCBwZXJtaXNzaW9ucyBmb3IgdGhlIHBhcnRpY3VsYXIgcGFja2FnZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGtnIC0gVGhlIHBhY2thZ2UgbmFtZSB0byBiZSBwcm9jZXNzZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gY21kT3V0cHV0IFtudWxsXSAtIE9wdGlvbmFsIHBhcmFtZXRlciBjb250YWluaW5nIGNvbW1hbmQgb3V0cHV0IG9mXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9kdW1wc3lzIHBhY2thZ2VfIGNvbW1hbmQuIEl0IG1heSBzcGVlZCB1cCB0aGUgbWV0aG9kIGV4ZWN1dGlvbi5cbiAqIEByZXR1cm4ge0FycmF5PFN0cmluZz59IFRoZSBsaXN0IG9mIHJlcXVlc3RlZCBwZXJtaXNzaW9ucyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmdldFJlcVBlcm1pc3Npb25zID0gYXN5bmMgZnVuY3Rpb24gZ2V0UmVxUGVybWlzc2lvbnMgKHBrZywgY21kT3V0cHV0ID0gbnVsbCkge1xuICBsb2cuZGVidWcoJ1JldHJpZXZpbmcgcmVxdWVzdGVkIHBlcm1pc3Npb25zJyk7XG4gIGNvbnN0IHN0ZG91dCA9IGNtZE91dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gIHJldHVybiBleHRyYWN0TWF0Y2hpbmdQZXJtaXNzaW9ucyhzdGRvdXQsIFsncmVxdWVzdGVkJ10pO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBsb2NhdGlvbiBwcm92aWRlcnMgZm9yIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGxvY2F0aW9uIHByb3ZpZGVycyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmdldExvY2F0aW9uUHJvdmlkZXJzID0gYXN5bmMgZnVuY3Rpb24gZ2V0TG9jYXRpb25Qcm92aWRlcnMgKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdzZWN1cmUnLCAnbG9jYXRpb25fcHJvdmlkZXJzX2FsbG93ZWQnKTtcbiAgcmV0dXJuIHN0ZG91dC50cmltKCkuc3BsaXQoJywnKVxuICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG59O1xuXG4vKipcbiAqIFRvZ2dsZSB0aGUgc3RhdGUgb2YgR1BTIGxvY2F0aW9uIHByb3ZpZGVyLlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gZW5hYmxlZCAtIFdoZXRoZXIgdG8gZW5hYmxlICh0cnVlKSBvciBkaXNhYmxlIChmYWxzZSkgdGhlIEdQUyBwcm92aWRlci5cbiAqL1xubWV0aG9kcy50b2dnbGVHUFNMb2NhdGlvblByb3ZpZGVyID0gYXN5bmMgZnVuY3Rpb24gdG9nZ2xlR1BTTG9jYXRpb25Qcm92aWRlciAoZW5hYmxlZCkge1xuICBhd2FpdCB0aGlzLnNldFNldHRpbmcoJ3NlY3VyZScsICdsb2NhdGlvbl9wcm92aWRlcnNfYWxsb3dlZCcsIGAke2VuYWJsZWQgPyAnKycgOiAnLSd9Z3BzYCk7XG59O1xuXG4vKipcbiAqIFNldCBoaWRkZW4gYXBpIHBvbGljeSB0byBtYW5hZ2UgYWNjZXNzIHRvIG5vbi1TREsgQVBJcy5cbiAqIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvcmVzdHJpY3Rpb25zLW5vbi1zZGstaW50ZXJmYWNlc1xuICpcbiAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gdmFsdWUgLSBUaGUgQVBJIGVuZm9yY2VtZW50IHBvbGljeS5cbiAqICAgICBGb3IgQW5kcm9pZCBQXG4gKiAgICAgMDogRGlzYWJsZSBub24tU0RLIEFQSSB1c2FnZSBkZXRlY3Rpb24uIFRoaXMgd2lsbCBhbHNvIGRpc2FibGUgbG9nZ2luZywgYW5kIGFsc28gYnJlYWsgdGhlIHN0cmljdCBtb2RlIEFQSSxcbiAqICAgICAgICBkZXRlY3ROb25TZGtBcGlVc2FnZSgpLiBOb3QgcmVjb21tZW5kZWQuXG4gKiAgICAgMTogXCJKdXN0IHdhcm5cIiAtIHBlcm1pdCBhY2Nlc3MgdG8gYWxsIG5vbi1TREsgQVBJcywgYnV0IGtlZXAgd2FybmluZ3MgaW4gdGhlIGxvZy5cbiAqICAgICAgICBUaGUgc3RyaWN0IG1vZGUgQVBJIHdpbGwga2VlcCB3b3JraW5nLlxuICogICAgIDI6IERpc2FsbG93IHVzYWdlIG9mIGRhcmsgZ3JleSBhbmQgYmxhY2sgbGlzdGVkIEFQSXMuXG4gKiAgICAgMzogRGlzYWxsb3cgdXNhZ2Ugb2YgYmxhY2tsaXN0ZWQgQVBJcywgYnV0IGFsbG93IHVzYWdlIG9mIGRhcmsgZ3JleSBsaXN0ZWQgQVBJcy5cbiAqXG4gKiAgICAgRm9yIEFuZHJvaWQgUVxuICogICAgIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvbm9uLXNkay1xI2VuYWJsZS1ub24tc2RrLWFjY2Vzc1xuICogICAgIDA6IERpc2FibGUgYWxsIGRldGVjdGlvbiBvZiBub24tU0RLIGludGVyZmFjZXMuIFVzaW5nIHRoaXMgc2V0dGluZyBkaXNhYmxlcyBhbGwgbG9nIG1lc3NhZ2VzIGZvciBub24tU0RLIGludGVyZmFjZSB1c2FnZVxuICogICAgICAgIGFuZCBwcmV2ZW50cyB5b3UgZnJvbSB0ZXN0aW5nIHlvdXIgYXBwIHVzaW5nIHRoZSBTdHJpY3RNb2RlIEFQSS4gVGhpcyBzZXR0aW5nIGlzIG5vdCByZWNvbW1lbmRlZC5cbiAqICAgICAxOiBFbmFibGUgYWNjZXNzIHRvIGFsbCBub24tU0RLIGludGVyZmFjZXMsIGJ1dCBwcmludCBsb2cgbWVzc2FnZXMgd2l0aCB3YXJuaW5ncyBmb3IgYW55IG5vbi1TREsgaW50ZXJmYWNlIHVzYWdlLlxuICogICAgICAgIFVzaW5nIHRoaXMgc2V0dGluZyBhbHNvIGFsbG93cyB5b3UgdG8gdGVzdCB5b3VyIGFwcCB1c2luZyB0aGUgU3RyaWN0TW9kZSBBUEkuXG4gKiAgICAgMjogRGlzYWxsb3cgdXNhZ2Ugb2Ygbm9uLVNESyBpbnRlcmZhY2VzIHRoYXQgYmVsb25nIHRvIGVpdGhlciB0aGUgYmxhY2sgbGlzdFxuICogICAgICAgIG9yIHRvIGEgcmVzdHJpY3RlZCBncmV5bGlzdCBmb3IgeW91ciB0YXJnZXQgQVBJIGxldmVsLlxuICovXG5tZXRob2RzLnNldEhpZGRlbkFwaVBvbGljeSA9IGFzeW5jIGZ1bmN0aW9uIHNldEhpZGRlbkFwaVBvbGljeSAodmFsdWUpIHtcbiAgYXdhaXQgdGhpcy5zZXRTZXR0aW5nKCdnbG9iYWwnLCAnaGlkZGVuX2FwaV9wb2xpY3lfcHJlX3BfYXBwcycsIHZhbHVlKTtcbiAgYXdhaXQgdGhpcy5zZXRTZXR0aW5nKCdnbG9iYWwnLCAnaGlkZGVuX2FwaV9wb2xpY3lfcF9hcHBzJywgdmFsdWUpO1xuICBhd2FpdCB0aGlzLnNldFNldHRpbmcoJ2dsb2JhbCcsICdoaWRkZW5fYXBpX3BvbGljeScsIHZhbHVlKTtcbn07XG5cbi8qKlxuICogUmVzZXQgYWNjZXNzIHRvIG5vbi1TREsgQVBJcyB0byBpdHMgZGVmYXVsdCBzZXR0aW5nLlxuICogaHR0cHM6Ly9kZXZlbG9wZXIuYW5kcm9pZC5jb20vcHJldmlldy9yZXN0cmljdGlvbnMtbm9uLXNkay1pbnRlcmZhY2VzXG4gKi9cbm1ldGhvZHMuc2V0RGVmYXVsdEhpZGRlbkFwaVBvbGljeSA9IGFzeW5jIGZ1bmN0aW9uIHNldERlZmF1bHRIaWRkZW5BcGlQb2xpY3kgKCkge1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnc2V0dGluZ3MnLCAnZGVsZXRlJywgJ2dsb2JhbCcsICdoaWRkZW5fYXBpX3BvbGljeV9wcmVfcF9hcHBzJ10pO1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnc2V0dGluZ3MnLCAnZGVsZXRlJywgJ2dsb2JhbCcsICdoaWRkZW5fYXBpX3BvbGljeV9wX2FwcHMnXSk7XG4gIGF3YWl0IHRoaXMuc2hlbGwoWydzZXR0aW5ncycsICdkZWxldGUnLCAnZ2xvYmFsJywgJ2hpZGRlbl9hcGlfcG9saWN5J10pO1xufTtcblxuLyoqXG4gKiBTdG9wIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UgaWYgaXQgaXMgcnVubmluZyBhbmQgY2xlYXJzIGl0cyBhcHBsaWNhdGlvbiBkYXRhLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqL1xubWV0aG9kcy5zdG9wQW5kQ2xlYXIgPSBhc3luYyBmdW5jdGlvbiBzdG9wQW5kQ2xlYXIgKHBrZykge1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMuZm9yY2VTdG9wKHBrZyk7XG4gICAgYXdhaXQgdGhpcy5jbGVhcihwa2cpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3Qgc3RvcCBhbmQgY2xlYXIgJHtwa2d9LiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogUmV0cmlldmUgdGhlIGxpc3Qgb2YgYXZhaWxhYmxlIGlucHV0IG1ldGhvZHMgKElNRXMpIGZvciB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7QXJyYXkuPFN0cmluZz59IFRoZSBsaXN0IG9mIElNRSBuYW1lcyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmF2YWlsYWJsZUlNRXMgPSBhc3luYyBmdW5jdGlvbiBhdmFpbGFibGVJTUVzICgpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZ2V0SU1FTGlzdEZyb21PdXRwdXQoYXdhaXQgdGhpcy5zaGVsbChbJ2ltZScsICdsaXN0JywgJy1hJ10pKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZ2V0dGluZyBhdmFpbGFibGUgSU1FJ3MuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBlbmFibGVkIGlucHV0IG1ldGhvZHMgKElNRXMpIGZvciB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7QXJyYXkuPFN0cmluZz59IFRoZSBsaXN0IG9mIGVuYWJsZWQgSU1FIG5hbWVzIG9yIGFuIGVtcHR5IGxpc3QuXG4gKi9cbm1ldGhvZHMuZW5hYmxlZElNRXMgPSBhc3luYyBmdW5jdGlvbiBlbmFibGVkSU1FcyAoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGdldElNRUxpc3RGcm9tT3V0cHV0KGF3YWl0IHRoaXMuc2hlbGwoWydpbWUnLCAnbGlzdCddKSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZW5hYmxlZCBJTUUncy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIEVuYWJsZSB0aGUgcGFydGljdWxhciBpbnB1dCBtZXRob2Qgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBpbWVJZCAtIE9uZSBvZiBleGlzdGluZyBJTUUgaWRzLlxuICovXG5tZXRob2RzLmVuYWJsZUlNRSA9IGFzeW5jIGZ1bmN0aW9uIGVuYWJsZUlNRSAoaW1lSWQpIHtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ2ltZScsICdlbmFibGUnLCBpbWVJZF0pO1xufTtcblxuLyoqXG4gKiBEaXNhYmxlIHRoZSBwYXJ0aWN1bGFyIGlucHV0IG1ldGhvZCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGltZUlkIC0gT25lIG9mIGV4aXN0aW5nIElNRSBpZHMuXG4gKi9cbm1ldGhvZHMuZGlzYWJsZUlNRSA9IGFzeW5jIGZ1bmN0aW9uIGRpc2FibGVJTUUgKGltZUlkKSB7XG4gIGF3YWl0IHRoaXMuc2hlbGwoWydpbWUnLCAnZGlzYWJsZScsIGltZUlkXSk7XG59O1xuXG4vKipcbiAqIFNldCB0aGUgcGFydGljdWxhciBpbnB1dCBtZXRob2Qgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBpbWVJZCAtIE9uZSBvZiBleGlzdGluZyBJTUUgaWRzLlxuICovXG5tZXRob2RzLnNldElNRSA9IGFzeW5jIGZ1bmN0aW9uIHNldElNRSAoaW1lSWQpIHtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ2ltZScsICdzZXQnLCBpbWVJZF0pO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGRlZmF1bHQgaW5wdXQgbWV0aG9kIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHs/c3RyaW5nfSBUaGUgbmFtZSBvZiB0aGUgZGVmYXVsdCBpbnB1dCBtZXRob2RcbiAqL1xubWV0aG9kcy5kZWZhdWx0SU1FID0gYXN5bmMgZnVuY3Rpb24gZGVmYXVsdElNRSAoKSB7XG4gIHRyeSB7XG4gICAgbGV0IGVuZ2luZSA9IGF3YWl0IHRoaXMuZ2V0U2V0dGluZygnc2VjdXJlJywgJ2RlZmF1bHRfaW5wdXRfbWV0aG9kJyk7XG4gICAgaWYgKGVuZ2luZSA9PT0gJ251bGwnKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgcmV0dXJuIGVuZ2luZS50cmltKCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZGVmYXVsdCBJTUUuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZW5kIHRoZSBwYXJ0aWN1bGFyIGtleWNvZGUgdG8gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0ga2V5Y29kZSAtIFRoZSBhY3R1YWwga2V5IGNvZGUgdG8gYmUgc2VudC5cbiAqL1xubWV0aG9kcy5rZXlldmVudCA9IGFzeW5jIGZ1bmN0aW9uIGtleWV2ZW50IChrZXljb2RlKSB7XG4gIC8vIGtleWNvZGUgbXVzdCBiZSBhbiBpbnQuXG4gIGxldCBjb2RlID0gcGFyc2VJbnQoa2V5Y29kZSwgMTApO1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnaW5wdXQnLCAna2V5ZXZlbnQnLCBjb2RlXSk7XG59O1xuXG4vKipcbiAqIFNlbmQgdGhlIHBhcnRpY3VsYXIgdGV4dCB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHRleHQgLSBUaGUgYWN0dWFsIHRleHQgdG8gYmUgc2VudC5cbiAqL1xubWV0aG9kcy5pbnB1dFRleHQgPSBhc3luYyBmdW5jdGlvbiBpbnB1dFRleHQgKHRleHQpIHtcbiAgLyogZXNsaW50LWRpc2FibGUgbm8tdXNlbGVzcy1lc2NhcGUgKi9cbiAgLy8gbmVlZCB0byBlc2NhcGUgd2hpdGVzcGFjZSBhbmQgKCApIDwgPiB8IDsgJiAqIFxcIH4gXCIgJ1xuICB0ZXh0ID0gdGV4dFxuICAgICAgICAgIC5yZXBsYWNlKC9cXFxcL2csICdcXFxcXFxcXCcpXG4gICAgICAgICAgLnJlcGxhY2UoL1xcKC9nLCAnXFwoJylcbiAgICAgICAgICAucmVwbGFjZSgvXFwpL2csICdcXCknKVxuICAgICAgICAgIC5yZXBsYWNlKC88L2csICdcXDwnKVxuICAgICAgICAgIC5yZXBsYWNlKC8+L2csICdcXD4nKVxuICAgICAgICAgIC5yZXBsYWNlKC9cXHwvZywgJ1xcfCcpXG4gICAgICAgICAgLnJlcGxhY2UoLzsvZywgJ1xcOycpXG4gICAgICAgICAgLnJlcGxhY2UoLyYvZywgJ1xcJicpXG4gICAgICAgICAgLnJlcGxhY2UoL1xcKi9nLCAnXFwqJylcbiAgICAgICAgICAucmVwbGFjZSgvfi9nLCAnXFx+JylcbiAgICAgICAgICAucmVwbGFjZSgvXCIvZywgJ1xcXCInKVxuICAgICAgICAgIC5yZXBsYWNlKC8nL2csIFwiXFwnXCIpXG4gICAgICAgICAgLnJlcGxhY2UoLyAvZywgJyVzJyk7XG4gIC8qIGVzbGludC1kaXNhYmxlIG5vLXVzZWxlc3MtZXNjYXBlICovXG4gIGF3YWl0IHRoaXMuc2hlbGwoWydpbnB1dCcsICd0ZXh0JywgdGV4dF0pO1xufTtcblxuLyoqXG4gKiBDbGVhciB0aGUgYWN0aXZlIHRleHQgZmllbGQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0IGJ5IHNlbmRpbmdcbiAqIHNwZWNpYWwga2V5ZXZlbnRzIHRvIGl0LlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSBsZW5ndGggWzEwMF0gLSBUaGUgbWF4aW11bSBsZW5ndGggb2YgdGhlIHRleHQgaW4gdGhlIGZpZWxkIHRvIGJlIGNsZWFyZWQuXG4gKi9cbm1ldGhvZHMuY2xlYXJUZXh0RmllbGQgPSBhc3luYyBmdW5jdGlvbiBjbGVhclRleHRGaWVsZCAobGVuZ3RoID0gMTAwKSB7XG4gIC8vIGFzc3VtZXMgdGhhdCB0aGUgRWRpdFRleHQgZmllbGQgYWxyZWFkeSBoYXMgZm9jdXNcbiAgbG9nLmRlYnVnKGBDbGVhcmluZyB1cCB0byAke2xlbmd0aH0gY2hhcmFjdGVyc2ApO1xuICBpZiAobGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxldCBhcmdzID0gWydpbnB1dCcsICdrZXlldmVudCddO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgLy8gd2UgY2Fubm90IGtub3cgd2hlcmUgdGhlIGN1cnNvciBpcyBpbiB0aGUgdGV4dCBmaWVsZCwgc28gZGVsZXRlIGJvdGggYmVmb3JlXG4gICAgLy8gYW5kIGFmdGVyIHNvIHRoYXQgd2UgZ2V0IHJpZCBvZiBldmVyeXRoaW5nXG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIuYW5kcm9pZC5jb20vcmVmZXJlbmNlL2FuZHJvaWQvdmlldy9LZXlFdmVudC5odG1sI0tFWUNPREVfREVMXG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIuYW5kcm9pZC5jb20vcmVmZXJlbmNlL2FuZHJvaWQvdmlldy9LZXlFdmVudC5odG1sI0tFWUNPREVfRk9SV0FSRF9ERUxcbiAgICBhcmdzLnB1c2goJzY3JywgJzExMicpO1xuICB9XG4gIGF3YWl0IHRoaXMuc2hlbGwoYXJncyk7XG59O1xuXG4vKipcbiAqIFNlbmQgdGhlIHNwZWNpYWwga2V5Y29kZSB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QgaW4gb3JkZXIgdG8gbG9jayBpdC5cbiAqL1xubWV0aG9kcy5sb2NrID0gYXN5bmMgZnVuY3Rpb24gbG9jayAoKSB7XG4gIGlmIChhd2FpdCB0aGlzLmlzU2NyZWVuTG9ja2VkKCkpIHtcbiAgICBsb2cuZGVidWcoJ1NjcmVlbiBpcyBhbHJlYWR5IGxvY2tlZC4gRG9pbmcgbm90aGluZy4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgbG9nLmRlYnVnKCdQcmVzc2luZyB0aGUgS0VZQ09ERV9QT1dFUiBidXR0b24gdG8gbG9jayBzY3JlZW4nKTtcbiAgYXdhaXQgdGhpcy5rZXlldmVudCgyNik7XG5cbiAgY29uc3QgdGltZW91dE1zID0gNTAwMDtcbiAgdHJ5IHtcbiAgICBhd2FpdCB3YWl0Rm9yQ29uZGl0aW9uKGFzeW5jICgpID0+IGF3YWl0IHRoaXMuaXNTY3JlZW5Mb2NrZWQoKSwge1xuICAgICAgd2FpdE1zOiB0aW1lb3V0TXMsXG4gICAgICBpbnRlcnZhbE1zOiA1MDAsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSBkZXZpY2Ugc2NyZWVuIGlzIHN0aWxsIGxvY2tlZCBhZnRlciAke3RpbWVvdXRNc31tcyB0aW1lb3V0YCk7XG4gIH1cbn07XG5cbi8qKlxuICogU2VuZCB0aGUgc3BlY2lhbCBrZXljb2RlIHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdCBpbiBvcmRlciB0byBlbXVsYXRlXG4gKiBCYWNrIGJ1dHRvbiB0YXAuXG4gKi9cbm1ldGhvZHMuYmFjayA9IGFzeW5jIGZ1bmN0aW9uIGJhY2sgKCkge1xuICBsb2cuZGVidWcoJ1ByZXNzaW5nIHRoZSBCQUNLIGJ1dHRvbicpO1xuICBhd2FpdCB0aGlzLmtleWV2ZW50KDQpO1xufTtcblxuLyoqXG4gKiBTZW5kIHRoZSBzcGVjaWFsIGtleWNvZGUgdG8gdGhlIGRldmljZSB1bmRlciB0ZXN0IGluIG9yZGVyIHRvIGVtdWxhdGVcbiAqIEhvbWUgYnV0dG9uIHRhcC5cbiAqL1xubWV0aG9kcy5nb1RvSG9tZSA9IGFzeW5jIGZ1bmN0aW9uIGdvVG9Ib21lICgpIHtcbiAgbG9nLmRlYnVnKCdQcmVzc2luZyB0aGUgSE9NRSBidXR0b24nKTtcbiAgYXdhaXQgdGhpcy5rZXlldmVudCgzKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSB0aGUgYWN0dWFsIHBhdGggdG8gYWRiIGV4ZWN1dGFibGUuXG4gKi9cbm1ldGhvZHMuZ2V0QWRiUGF0aCA9IGZ1bmN0aW9uIGdldEFkYlBhdGggKCkge1xuICByZXR1cm4gdGhpcy5leGVjdXRhYmxlLnBhdGg7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIGN1cnJlbnQgc2NyZWVuIG9yaWVudGF0aW9uIG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtudW1iZXJ9IFRoZSBjdXJyZW50IG9yaWVudGF0aW9uIGVuY29kZWQgYXMgYW4gaW50ZWdlciBudW1iZXIuXG4gKi9cbm1ldGhvZHMuZ2V0U2NyZWVuT3JpZW50YXRpb24gPSBhc3luYyBmdW5jdGlvbiBnZXRTY3JlZW5PcmllbnRhdGlvbiAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdpbnB1dCddKTtcbiAgcmV0dXJuIGdldFN1cmZhY2VPcmllbnRhdGlvbihzdGRvdXQpO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgc2NyZWVuIGxvY2sgc3RhdGUgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIGRldmljZSBpcyBsb2NrZWQuXG4gKi9cbm1ldGhvZHMuaXNTY3JlZW5Mb2NrZWQgPSBhc3luYyBmdW5jdGlvbiBpc1NjcmVlbkxvY2tlZCAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICd3aW5kb3cnXSk7XG4gIGlmIChwcm9jZXNzLmVudi5BUFBJVU1fTE9HX0RVTVBTWVMpIHtcbiAgICAvLyBvcHRpb25hbCBkZWJ1Z2dpbmdcbiAgICAvLyBpZiB0aGUgbWV0aG9kIGlzIG5vdCB3b3JraW5nLCB0dXJuIGl0IG9uIGFuZCBzZW5kIHVzIHRoZSBvdXRwdXRcbiAgICBsZXQgZHVtcHN5c0ZpbGUgPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgJ2R1bXBzeXMubG9nJyk7XG4gICAgbG9nLmRlYnVnKGBXcml0aW5nIGR1bXBzeXMgb3V0cHV0IHRvICR7ZHVtcHN5c0ZpbGV9YCk7XG4gICAgYXdhaXQgZnMud3JpdGVGaWxlKGR1bXBzeXNGaWxlLCBzdGRvdXQpO1xuICB9XG4gIHJldHVybiAoaXNTaG93aW5nTG9ja3NjcmVlbihzdGRvdXQpIHx8IGlzQ3VycmVudEZvY3VzT25LZXlndWFyZChzdGRvdXQpIHx8XG4gICAgICAgICAgIWlzU2NyZWVuT25GdWxseShzdGRvdXQpKTtcbn07XG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gS2V5Ym9hcmRTdGF0ZVxuICogQHByb3BlcnR5IHtib29sZWFufSBpc0tleWJvYXJkU2hvd24gLSBXaGV0aGVyIHNvZnQga2V5Ym9hcmQgaXMgY3VycmVudGx5IHZpc2libGUuXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGNhbkNsb3NlS2V5Ym9hcmQgLSBXaGV0aGVyIHRoZSBrZXlib2FyZCBjYW4gYmUgY2xvc2VkLlxuICovXG5cbi8qKlxuICogUmV0cmlldmUgdGhlIHN0YXRlIG9mIHRoZSBzb2Z0d2FyZSBrZXlib2FyZCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7S2V5Ym9hcmRTdGF0ZX0gVGhlIGtleWJvYXJkIHN0YXRlLlxuICovXG5tZXRob2RzLmlzU29mdEtleWJvYXJkUHJlc2VudCA9IGFzeW5jIGZ1bmN0aW9uIGlzU29mdEtleWJvYXJkUHJlc2VudCAoKSB7XG4gIHRyeSB7XG4gICAgY29uc3Qgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ2R1bXBzeXMnLCAnaW5wdXRfbWV0aG9kJ10pO1xuICAgIGNvbnN0IGlucHV0U2hvd25NYXRjaCA9IC9tSW5wdXRTaG93bj0oXFx3KykvLmV4ZWMoc3Rkb3V0KTtcbiAgICBjb25zdCBpbnB1dFZpZXdTaG93bk1hdGNoID0gL21Jc0lucHV0Vmlld1Nob3duPShcXHcrKS8uZXhlYyhzdGRvdXQpO1xuICAgIHJldHVybiB7XG4gICAgICBpc0tleWJvYXJkU2hvd246ICEhKGlucHV0U2hvd25NYXRjaCAmJiBpbnB1dFNob3duTWF0Y2hbMV0gPT09ICd0cnVlJyksXG4gICAgICBjYW5DbG9zZUtleWJvYXJkOiAhIShpbnB1dFZpZXdTaG93bk1hdGNoICYmIGlucHV0Vmlld1Nob3duTWF0Y2hbMV0gPT09ICd0cnVlJyksXG4gICAgfTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZmluZGluZyBzb2Z0a2V5Ym9hcmQuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZW5kIGFuIGFyYml0cmFyeSBUZWxuZXQgY29tbWFuZCB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGNvbW1hbmQgLSBUaGUgY29tbWFuZCB0byBiZSBzZW50LlxuICpcbiAqIEByZXR1cm4ge3N0cmluZ30gVGhlIGFjdHVhbCBvdXRwdXQgb2YgdGhlIGdpdmVuIGNvbW1hbmQuXG4gKi9cbm1ldGhvZHMuc2VuZFRlbG5ldENvbW1hbmQgPSBhc3luYyBmdW5jdGlvbiBzZW5kVGVsbmV0Q29tbWFuZCAoY29tbWFuZCkge1xuICBsb2cuZGVidWcoYFNlbmRpbmcgdGVsbmV0IGNvbW1hbmQgdG8gZGV2aWNlOiAke2NvbW1hbmR9YCk7XG4gIGxldCBwb3J0ID0gYXdhaXQgdGhpcy5nZXRFbXVsYXRvclBvcnQoKTtcbiAgcmV0dXJuIGF3YWl0IG5ldyBCKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBsZXQgY29ubiA9IG5ldC5jcmVhdGVDb25uZWN0aW9uKHBvcnQsICdsb2NhbGhvc3QnKSxcbiAgICAgICAgY29ubmVjdGVkID0gZmFsc2UsXG4gICAgICAgIHJlYWR5UmVnZXggPSAvXk9LJC9tLFxuICAgICAgICBkYXRhU3RyZWFtID0gJycsXG4gICAgICAgIHJlcyA9IG51bGw7XG4gICAgY29ubi5vbignY29ubmVjdCcsICgpID0+IHtcbiAgICAgIGxvZy5kZWJ1ZygnU29ja2V0IGNvbm5lY3Rpb24gdG8gZGV2aWNlIGNyZWF0ZWQnKTtcbiAgICB9KTtcbiAgICBjb25uLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgIGRhdGEgPSBkYXRhLnRvU3RyaW5nKCd1dGY4Jyk7XG4gICAgICBpZiAoIWNvbm5lY3RlZCkge1xuICAgICAgICBpZiAocmVhZHlSZWdleC50ZXN0KGRhdGEpKSB7XG4gICAgICAgICAgY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgICBsb2cuZGVidWcoJ1NvY2tldCBjb25uZWN0aW9uIHRvIGRldmljZSByZWFkeScpO1xuICAgICAgICAgIGNvbm4ud3JpdGUoYCR7Y29tbWFuZH1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGF0YVN0cmVhbSArPSBkYXRhO1xuICAgICAgICBpZiAocmVhZHlSZWdleC50ZXN0KGRhdGEpKSB7XG4gICAgICAgICAgcmVzID0gZGF0YVN0cmVhbS5yZXBsYWNlKHJlYWR5UmVnZXgsICcnKS50cmltKCk7XG4gICAgICAgICAgcmVzID0gXy5sYXN0KHJlcy50cmltKCkuc3BsaXQoJ1xcbicpKTtcbiAgICAgICAgICBsb2cuZGVidWcoYFRlbG5ldCBjb21tYW5kIGdvdCByZXNwb25zZTogJHtyZXN9YCk7XG4gICAgICAgICAgY29ubi53cml0ZSgncXVpdFxcbicpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gICAgY29ubi5vbignZXJyb3InLCAoZXJyKSA9PiB7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgcHJvbWlzZS9wcmVmZXItYXdhaXQtdG8tY2FsbGJhY2tzXG4gICAgICBsb2cuZGVidWcoYFRlbG5ldCBjb21tYW5kIGVycm9yOiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgcmVqZWN0KGVycik7XG4gICAgfSk7XG4gICAgY29ubi5vbignY2xvc2UnLCAoKSA9PiB7XG4gICAgICBpZiAocmVzID09PSBudWxsKSB7XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoJ05ldmVyIGdvdCBhIHJlc3BvbnNlIGZyb20gY29tbWFuZCcpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc29sdmUocmVzKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG59O1xuXG4vKipcbiAqIENoZWNrIHRoZSBzdGF0ZSBvZiBBaXJwbGFuZSBtb2RlIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIEFpcnBsYW5lIG1vZGUgaXMgZW5hYmxlZC5cbiAqL1xubWV0aG9kcy5pc0FpcnBsYW5lTW9kZU9uID0gYXN5bmMgZnVuY3Rpb24gaXNBaXJwbGFuZU1vZGVPbiAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLmdldFNldHRpbmcoJ2dsb2JhbCcsICdhaXJwbGFuZV9tb2RlX29uJyk7XG4gIHJldHVybiBwYXJzZUludChzdGRvdXQsIDEwKSAhPT0gMDtcbn07XG5cbi8qKlxuICogQ2hhbmdlIHRoZSBzdGF0ZSBvZiBBaXJwbGFuZSBtb2RlIGluIFNldHRpbmdzIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge2Jvb2xlYW59IG9uIC0gVHJ1ZSB0byBlbmFibGUgdGhlIEFpcnBsYW5lIG1vZGUgaW4gU2V0dGluZ3MgYW5kIGZhbHNlIHRvIGRpc2FibGUgaXQuXG4gKi9cbm1ldGhvZHMuc2V0QWlycGxhbmVNb2RlID0gYXN5bmMgZnVuY3Rpb24gc2V0QWlycGxhbmVNb2RlIChvbikge1xuICBhd2FpdCB0aGlzLnNldFNldHRpbmcoJ2dsb2JhbCcsICdhaXJwbGFuZV9tb2RlX29uJywgb24gPyAxIDogMCk7XG59O1xuXG4vKipcbiAqIEJyb2FkY2FzdCB0aGUgc3RhdGUgb2YgQWlycGxhbmUgbW9kZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBUaGlzIG1ldGhvZCBzaG91bGQgYmUgY2FsbGVkIGFmdGVyIHtAbGluayAjc2V0QWlycGxhbmVNb2RlfSwgb3RoZXJ3aXNlXG4gKiB0aGUgbW9kZSBjaGFuZ2UgaXMgbm90IGdvaW5nIHRvIGJlIGFwcGxpZWQgZm9yIHRoZSBkZXZpY2UuXG4gKlxuICogQHBhcmFtIHtib29sZWFufSBvbiAtIFRydWUgdG8gYnJvYWRjYXN0IGVuYWJsZSBhbmQgZmFsc2UgdG8gYnJvYWRjYXN0IGRpc2FibGUuXG4gKi9cbm1ldGhvZHMuYnJvYWRjYXN0QWlycGxhbmVNb2RlID0gYXN5bmMgZnVuY3Rpb24gYnJvYWRjYXN0QWlycGxhbmVNb2RlIChvbikge1xuICBhd2FpdCB0aGlzLnNoZWxsKFtcbiAgICAnYW0nLCAnYnJvYWRjYXN0JyxcbiAgICAnLWEnLCAnYW5kcm9pZC5pbnRlbnQuYWN0aW9uLkFJUlBMQU5FX01PREUnLFxuICAgICctLWV6JywgJ3N0YXRlJywgb24gPyAndHJ1ZScgOiAnZmFsc2UnXG4gIF0pO1xufTtcblxuLyoqXG4gKiBDaGVjayB0aGUgc3RhdGUgb2YgV2lGaSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiBXaUZpIGlzIGVuYWJsZWQuXG4gKi9cbm1ldGhvZHMuaXNXaWZpT24gPSBhc3luYyBmdW5jdGlvbiBpc1dpZmlPbiAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLmdldFNldHRpbmcoJ2dsb2JhbCcsICd3aWZpX29uJyk7XG4gIHJldHVybiAocGFyc2VJbnQoc3Rkb3V0LCAxMCkgIT09IDApO1xufTtcblxuLyoqXG4gKiBDaGFuZ2UgdGhlIHN0YXRlIG9mIFdpRmkgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb24gLSBUcnVlIHRvIGVuYWJsZSBhbmQgZmFsc2UgdG8gZGlzYWJsZSBpdC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNFbXVsYXRvciBbZmFsc2VdIC0gU2V0IGl0IHRvIHRydWUgaWYgdGhlIGRldmljZSB1bmRlciB0ZXN0XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzIGFuIGVtdWxhdG9yIHJhdGhlciB0aGFuIGEgcmVhbCBkZXZpY2UuXG4gKi9cbm1ldGhvZHMuc2V0V2lmaVN0YXRlID0gYXN5bmMgZnVuY3Rpb24gc2V0V2lmaVN0YXRlIChvbiwgaXNFbXVsYXRvciA9IGZhbHNlKSB7XG4gIGlmIChpc0VtdWxhdG9yKSB7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChbJ3N2YycsICd3aWZpJywgb24gPyAnZW5hYmxlJyA6ICdkaXNhYmxlJ10sIHtcbiAgICAgIHByaXZpbGVnZWQ6IHRydWUsXG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChbXG4gICAgICAnYW0nLCAnYnJvYWRjYXN0JyxcbiAgICAgICctYScsIFdJRklfQ09OTkVDVElPTl9TRVRUSU5HX0FDVElPTixcbiAgICAgICctbicsIFdJRklfQ09OTkVDVElPTl9TRVRUSU5HX1JFQ0VJVkVSLFxuICAgICAgJy0tZXMnLCAnc2V0c3RhdHVzJywgb24gPyAnZW5hYmxlJyA6ICdkaXNhYmxlJ1xuICAgIF0pO1xuICB9XG59O1xuXG4vKipcbiAqIENoZWNrIHRoZSBzdGF0ZSBvZiBEYXRhIHRyYW5zZmVyIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIERhdGEgdHJhbnNmZXIgaXMgZW5hYmxlZC5cbiAqL1xubWV0aG9kcy5pc0RhdGFPbiA9IGFzeW5jIGZ1bmN0aW9uIGlzRGF0YU9uICgpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuZ2V0U2V0dGluZygnZ2xvYmFsJywgJ21vYmlsZV9kYXRhJyk7XG4gIHJldHVybiAocGFyc2VJbnQoc3Rkb3V0LCAxMCkgIT09IDApO1xufTtcblxuLyoqXG4gKiBDaGFuZ2UgdGhlIHN0YXRlIG9mIERhdGEgdHJhbnNmZXIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb24gLSBUcnVlIHRvIGVuYWJsZSBhbmQgZmFsc2UgdG8gZGlzYWJsZSBpdC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNFbXVsYXRvciBbZmFsc2VdIC0gU2V0IGl0IHRvIHRydWUgaWYgdGhlIGRldmljZSB1bmRlciB0ZXN0XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzIGFuIGVtdWxhdG9yIHJhdGhlciB0aGFuIGEgcmVhbCBkZXZpY2UuXG4gKi9cbm1ldGhvZHMuc2V0RGF0YVN0YXRlID0gYXN5bmMgZnVuY3Rpb24gc2V0RGF0YVN0YXRlIChvbiwgaXNFbXVsYXRvciA9IGZhbHNlKSB7XG4gIGlmIChpc0VtdWxhdG9yKSB7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChbJ3N2YycsICdkYXRhJywgb24gPyAnZW5hYmxlJyA6ICdkaXNhYmxlJ10sIHtcbiAgICAgIHByaXZpbGVnZWQ6IHRydWUsXG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChbXG4gICAgICAnYW0nLCAnYnJvYWRjYXN0JyxcbiAgICAgICctYScsIERBVEFfQ09OTkVDVElPTl9TRVRUSU5HX0FDVElPTixcbiAgICAgICctbicsIERBVEFfQ09OTkVDVElPTl9TRVRUSU5HX1JFQ0VJVkVSLFxuICAgICAgJy0tZXMnLCAnc2V0c3RhdHVzJywgb24gPyAnZW5hYmxlJyA6ICdkaXNhYmxlJ1xuICAgIF0pO1xuICB9XG59O1xuXG4vKipcbiAqIENoYW5nZSB0aGUgc3RhdGUgb2YgV2lGaSBhbmQvb3IgRGF0YSB0cmFuc2ZlciBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtib29sZWFufSB3aWZpIC0gVHJ1ZSB0byBlbmFibGUgYW5kIGZhbHNlIHRvIGRpc2FibGUgV2lGaS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gZGF0YSAtIFRydWUgdG8gZW5hYmxlIGFuZCBmYWxzZSB0byBkaXNhYmxlIERhdGEgdHJhbnNmZXIuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGlzRW11bGF0b3IgW2ZhbHNlXSAtIFNldCBpdCB0byB0cnVlIGlmIHRoZSBkZXZpY2UgdW5kZXIgdGVzdFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpcyBhbiBlbXVsYXRvciByYXRoZXIgdGhhbiBhIHJlYWwgZGV2aWNlLlxuICovXG5tZXRob2RzLnNldFdpZmlBbmREYXRhID0gYXN5bmMgZnVuY3Rpb24gc2V0V2lmaUFuZERhdGEgKHt3aWZpLCBkYXRhfSwgaXNFbXVsYXRvciA9IGZhbHNlKSB7XG4gIGlmICh1dGlsLmhhc1ZhbHVlKHdpZmkpKSB7XG4gICAgYXdhaXQgdGhpcy5zZXRXaWZpU3RhdGUod2lmaSwgaXNFbXVsYXRvcik7XG4gIH1cbiAgaWYgKHV0aWwuaGFzVmFsdWUoZGF0YSkpIHtcbiAgICBhd2FpdCB0aGlzLnNldERhdGFTdGF0ZShkYXRhLCBpc0VtdWxhdG9yKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDaGFuZ2UgdGhlIHN0YXRlIG9mIGFuaW1hdGlvbiBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBBbmltYXRpb24gb24gdGhlIGRldmljZSBpcyBjb250cm9sbGVkIGJ5IHRoZSBmb2xsb3dpbmcgZ2xvYmFsIHByb3BlcnRpZXM6XG4gKiBbQU5JTUFUT1JfRFVSQVRJT05fU0NBTEVde0BsaW5rIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9hbmRyb2lkL3Byb3ZpZGVyL1NldHRpbmdzLkdsb2JhbC5odG1sI0FOSU1BVE9SX0RVUkFUSU9OX1NDQUxFfSxcbiAqIFtUUkFOU0lUSU9OX0FOSU1BVElPTl9TQ0FMRV17QGxpbmsgaHR0cHM6Ly9kZXZlbG9wZXIuYW5kcm9pZC5jb20vcmVmZXJlbmNlL2FuZHJvaWQvcHJvdmlkZXIvU2V0dGluZ3MuR2xvYmFsLmh0bWwjVFJBTlNJVElPTl9BTklNQVRJT05fU0NBTEV9LFxuICogW1dJTkRPV19BTklNQVRJT05fU0NBTEVde0BsaW5rIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9hbmRyb2lkL3Byb3ZpZGVyL1NldHRpbmdzLkdsb2JhbC5odG1sI1dJTkRPV19BTklNQVRJT05fU0NBTEV9LlxuICogVGhpcyBtZXRob2Qgc2V0cyBhbGwgdGhpcyBwcm9wZXJ0aWVzIHRvIDAuMCB0byBkaXNhYmxlICgxLjAgdG8gZW5hYmxlKSBhbmltYXRpb24uXG4gKlxuICogVHVybmluZyBvZmYgYW5pbWF0aW9uIG1pZ2h0IGJlIHVzZWZ1bCB0byBpbXByb3ZlIHN0YWJpbGl0eVxuICogYW5kIHJlZHVjZSB0ZXN0cyBleGVjdXRpb24gdGltZS5cbiAqXG4gKiBAcGFyYW0ge2Jvb2xlYW59IG9uIC0gVHJ1ZSB0byBlbmFibGUgYW5kIGZhbHNlIHRvIGRpc2FibGUgaXQuXG4gKi9cbm1ldGhvZHMuc2V0QW5pbWF0aW9uU3RhdGUgPSBhc3luYyBmdW5jdGlvbiBzZXRBbmltYXRpb25TdGF0ZSAob24pIHtcbiAgYXdhaXQgdGhpcy5zaGVsbChbXG4gICAgJ2FtJywgJ2Jyb2FkY2FzdCcsXG4gICAgJy1hJywgQU5JTUFUSU9OX1NFVFRJTkdfQUNUSU9OLFxuICAgICctbicsIEFOSU1BVElPTl9TRVRUSU5HX1JFQ0VJVkVSLFxuICAgICctLWVzJywgJ3NldHN0YXR1cycsIG9uID8gJ2VuYWJsZScgOiAnZGlzYWJsZSdcbiAgXSk7XG59O1xuXG4vKipcbiAqIENoZWNrIHRoZSBzdGF0ZSBvZiBhbmltYXRpb24gb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgYXQgbGVhc3Qgb25lIG9mIGFuaW1hdGlvbiBzY2FsZSBzZXR0aW5nc1xuICogICAgICAgICAgICAgICAgICAgaXMgbm90IGVxdWFsIHRvICcwLjAnLlxuICovXG5tZXRob2RzLmlzQW5pbWF0aW9uT24gPSBhc3luYyBmdW5jdGlvbiBpc0FuaW1hdGlvbk9uICgpIHtcbiAgbGV0IGFuaW1hdG9yX2R1cmF0aW9uX3NjYWxlID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnYW5pbWF0b3JfZHVyYXRpb25fc2NhbGUnKTtcbiAgbGV0IHRyYW5zaXRpb25fYW5pbWF0aW9uX3NjYWxlID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAndHJhbnNpdGlvbl9hbmltYXRpb25fc2NhbGUnKTtcbiAgbGV0IHdpbmRvd19hbmltYXRpb25fc2NhbGUgPSBhd2FpdCB0aGlzLmdldFNldHRpbmcoJ2dsb2JhbCcsICd3aW5kb3dfYW5pbWF0aW9uX3NjYWxlJyk7XG4gIHJldHVybiBfLnNvbWUoW2FuaW1hdG9yX2R1cmF0aW9uX3NjYWxlLCB0cmFuc2l0aW9uX2FuaW1hdGlvbl9zY2FsZSwgd2luZG93X2FuaW1hdGlvbl9zY2FsZV0sXG4gICAgICAgICAgICAgICAgKHNldHRpbmcpID0+IHNldHRpbmcgIT09ICcwLjAnKTtcbn07XG5cbi8qKlxuICogQ2hhbmdlIHRoZSBsb2NhbGUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LiBEb24ndCBuZWVkIHRvIHJlYm9vdCB0aGUgZGV2aWNlIGFmdGVyIGNoYW5naW5nIHRoZSBsb2NhbGUuXG4gKiBUaGlzIG1ldGhvZCBzZXRzIGFuIGFyYml0cmFyeSBsb2NhbGUgZm9sbG93aW5nOlxuICogICBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvamF2YS91dGlsL0xvY2FsZS5odG1sXG4gKiAgIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9qYXZhL3V0aWwvTG9jYWxlLmh0bWwjTG9jYWxlKGphdmEubGFuZy5TdHJpbmcsJTIwamF2YS5sYW5nLlN0cmluZylcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbGFuZ3VhZ2UgLSBMYW5ndWFnZS4gZS5nLiBlbiwgamFcbiAqIEBwYXJhbSB7c3RyaW5nfSBjb3VudHJ5IC0gQ291bnRyeS4gZS5nLiBVUywgSlBcbiAqIEBwYXJhbSB7P3N0cmluZ30gc2NyaXB0IC0gU2NyaXB0LiBlLmcuIEhhbnMgaW4gYHpoLUhhbnMtQ05gXG4gKi9cbm1ldGhvZHMuc2V0RGV2aWNlU3lzTG9jYWxlVmlhU2V0dGluZ0FwcCA9IGFzeW5jIGZ1bmN0aW9uIHNldERldmljZVN5c0xvY2FsZVZpYVNldHRpbmdBcHAgKGxhbmd1YWdlLCBjb3VudHJ5LCBzY3JpcHQgPSBudWxsKSB7XG4gIGNvbnN0IHBhcmFtcyA9IFtcbiAgICAnYW0nLCAnYnJvYWRjYXN0JyxcbiAgICAnLWEnLCBMT0NBTEVfU0VUVElOR19BQ1RJT04sXG4gICAgJy1uJywgTE9DQUxFX1NFVFRJTkdfUkVDRUlWRVIsXG4gICAgJy0tZXMnLCAnbGFuZycsIGxhbmd1YWdlLnRvTG93ZXJDYXNlKCksXG4gICAgJy0tZXMnLCAnY291bnRyeScsIGNvdW50cnkudG9VcHBlckNhc2UoKVxuICBdO1xuXG4gIGlmIChzY3JpcHQpIHtcbiAgICBwYXJhbXMucHVzaCgnLS1lcycsICdzY3JpcHQnLCBzY3JpcHQpO1xuICB9XG5cbiAgYXdhaXQgdGhpcy5zaGVsbChwYXJhbXMpO1xufTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBMb2NhdGlvblxuICogQHByb3BlcnR5IHtudW1iZXJ8c3RyaW5nfSBsb25naXR1ZGUgLSBWYWxpZCBsb25naXR1ZGUgdmFsdWUuXG4gKiBAcHJvcGVydHkge251bWJlcnxzdHJpbmd9IGxhdGl0dWRlIC0gVmFsaWQgbGF0aXR1ZGUgdmFsdWUuXG4gKiBAcHJvcGVydHkgez9udW1iZXJ8c3RyaW5nfSBhbHRpdHVkZSAtIFZhbGlkIGFsdGl0dWRlIHZhbHVlLlxuICovXG5cbi8qKlxuICogRW11bGF0ZSBnZW9sb2NhdGlvbiBjb29yZGluYXRlcyBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtMb2NhdGlvbn0gbG9jYXRpb24gLSBMb2NhdGlvbiBvYmplY3QuIFRoZSBgYWx0aXR1ZGVgIHZhbHVlIGlzIGlnbm9yZWRcbiAqIHdoaWxlIG1vY2tpbmcgdGhlIHBvc2l0aW9uLlxuICogQHBhcmFtIHtib29sZWFufSBpc0VtdWxhdG9yIFtmYWxzZV0gLSBTZXQgaXQgdG8gdHJ1ZSBpZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3RcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXMgYW4gZW11bGF0b3IgcmF0aGVyIHRoYW4gYSByZWFsIGRldmljZS5cbiAqL1xubWV0aG9kcy5zZXRHZW9Mb2NhdGlvbiA9IGFzeW5jIGZ1bmN0aW9uIHNldEdlb0xvY2F0aW9uIChsb2NhdGlvbiwgaXNFbXVsYXRvciA9IGZhbHNlKSB7XG4gIGNvbnN0IGZvcm1hdExvY2F0aW9uVmFsdWUgPSAodmFsdWVOYW1lLCBpc1JlcXVpcmVkID0gdHJ1ZSkgPT4ge1xuICAgIGlmICghdXRpbC5oYXNWYWx1ZShsb2NhdGlvblt2YWx1ZU5hbWVdKSkge1xuICAgICAgaWYgKGlzUmVxdWlyZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3ZhbHVlTmFtZX0gbXVzdCBiZSBwcm92aWRlZGApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGNvbnN0IGZsb2F0VmFsdWUgPSBwYXJzZUZsb2F0KGxvY2F0aW9uW3ZhbHVlTmFtZV0pO1xuICAgIGlmICghaXNOYU4oZmxvYXRWYWx1ZSkpIHtcbiAgICAgIHJldHVybiBgJHtfLmNlaWwoZmxvYXRWYWx1ZSwgNSl9YDtcbiAgICB9XG4gICAgaWYgKGlzUmVxdWlyZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHt2YWx1ZU5hbWV9IGlzIGV4cGVjdGVkIHRvIGJlIGEgdmFsaWQgZmxvYXQgbnVtYmVyLiBgICtcbiAgICAgICAgYCcke2xvY2F0aW9uW3ZhbHVlTmFtZV19JyBpcyBnaXZlbiBpbnN0ZWFkYCk7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9O1xuICBjb25zdCBsb25naXR1ZGUgPSBmb3JtYXRMb2NhdGlvblZhbHVlKCdsb25naXR1ZGUnKTtcbiAgY29uc3QgbGF0aXR1ZGUgPSBmb3JtYXRMb2NhdGlvblZhbHVlKCdsYXRpdHVkZScpO1xuICBjb25zdCBhbHRpdHVkZSA9IGZvcm1hdExvY2F0aW9uVmFsdWUoJ2FsdGl0dWRlJywgZmFsc2UpO1xuICBpZiAoaXNFbXVsYXRvcikge1xuICAgIGF3YWl0IHRoaXMucmVzZXRUZWxuZXRBdXRoVG9rZW4oKTtcbiAgICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydlbXUnLCAnZ2VvJywgJ2ZpeCcsIGxvbmdpdHVkZSwgbGF0aXR1ZGVdKTtcbiAgICAvLyBBIHdvcmthcm91bmQgZm9yIGh0dHBzOi8vY29kZS5nb29nbGUuY29tL3AvYW5kcm9pZC9pc3N1ZXMvZGV0YWlsP2lkPTIwNjE4MFxuICAgIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ2VtdScsICdnZW8nLCAnZml4JywgbG9uZ2l0dWRlLnJlcGxhY2UoJy4nLCAnLCcpLCBsYXRpdHVkZS5yZXBsYWNlKCcuJywgJywnKV0pO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGFyZ3MgPSBbXG4gICAgICAnYW0nLCAnc3RhcnRzZXJ2aWNlJyxcbiAgICAgICctZScsICdsb25naXR1ZGUnLCBsb25naXR1ZGUsXG4gICAgICAnLWUnLCAnbGF0aXR1ZGUnLCBsYXRpdHVkZSxcbiAgICBdO1xuICAgIGlmICh1dGlsLmhhc1ZhbHVlKGFsdGl0dWRlKSkge1xuICAgICAgYXJncy5wdXNoKCctZScsICdhbHRpdHVkZScsIGFsdGl0dWRlKTtcbiAgICB9XG4gICAgYXJncy5wdXNoKExPQ0FUSU9OX1NFUlZJQ0UpO1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoYXJncyk7XG4gIH1cbn07XG5cbi8qKlxuICogR2V0IHRoZSBjdXJyZW50IGdlbyBsb2NhdGlvbiBmcm9tIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJucyB7TG9jYXRpb259IFRoZSBjdXJyZW50IGxvY2F0aW9uXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGN1cnJlbnQgbG9jYXRpb24gY2Fubm90IGJlIHJldHJpZXZlZFxuICovXG5tZXRob2RzLmdldEdlb0xvY2F0aW9uID0gYXN5bmMgZnVuY3Rpb24gZ2V0R2VvTG9jYXRpb24gKCkge1xuICBsZXQgb3V0cHV0O1xuICB0cnkge1xuICAgIG91dHB1dCA9IGF3YWl0IHRoaXMuc2hlbGwoW1xuICAgICAgJ2FtJywgJ2Jyb2FkY2FzdCcsXG4gICAgICAnLW4nLCBMT0NBVElPTl9SRUNFSVZFUixcbiAgICAgICctYScsIExPQ0FUSU9OX1JFVFJJRVZBTF9BQ1RJT04sXG4gICAgXSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHJldHJpZXZlIHRoZSBjdXJyZW50IGdlbyBjb29yZGluYXRlcyBmcm9tIHRoZSBkZXZpY2UuIGAgK1xuICAgICAgYE1ha2Ugc3VyZSB0aGUgQXBwaXVtIFNldHRpbmdzIGFwcGxpY2F0aW9uIGlzIHVwIHRvIGRhdGUgYW5kIGhhcyBsb2NhdGlvbiBwZXJtaXNzaW9ucy4gQWxzbyB0aGUgbG9jYXRpb24gYCArXG4gICAgICBgc2VydmljZXMgbXVzdCBiZSBlbmFibGVkIG9uIHRoZSBkZXZpY2UuIE9yaWdpbmFsIGVycm9yOiAke2Vyci5tZXNzYWdlfWApO1xuICB9XG5cbiAgY29uc3QgbWF0Y2ggPSAvZGF0YT1cIigtP1tcXGRcXC5dKylcXHMrKC0/W1xcZFxcLl0rKVxccysoLT9bXFxkXFwuXSspXCIvLmV4ZWMob3V0cHV0KTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHBhcnNlIHRoZSBhY3R1YWwgbG9jYXRpb24gdmFsdWVzIGZyb20gdGhlIGNvbW1hbmQgb3V0cHV0OiAke291dHB1dH1gKTtcbiAgfVxuICBjb25zdCBsb2NhdGlvbiA9IHtcbiAgICBsYXRpdHVkZTogbWF0Y2hbMV0sXG4gICAgbG9uZ2l0dWRlOiBtYXRjaFsyXSxcbiAgICBhbHRpdHVkZTogbWF0Y2hbM10sXG4gIH07XG4gIGxvZy5kZWJ1ZyhgR290IGdlbyBjb29yZGluYXRlczogJHtKU09OLnN0cmluZ2lmeShsb2NhdGlvbil9YCk7XG4gIHJldHVybiBsb2NhdGlvbjtcbn07XG5cbi8qKlxuICogRm9yY2VmdWxseSByZWN1cnNpdmVseSByZW1vdmUgYSBwYXRoIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqIEJlIGNhcmVmdWwgd2hpbGUgY2FsbGluZyB0aGlzIG1ldGhvZC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIFRoZSBwYXRoIHRvIGJlIHJlbW92ZWQgcmVjdXJzaXZlbHkuXG4gKi9cbm1ldGhvZHMucmltcmFmID0gYXN5bmMgZnVuY3Rpb24gcmltcmFmIChwYXRoKSB7XG4gIGF3YWl0IHRoaXMuc2hlbGwoWydybScsICctcmYnLCBwYXRoXSk7XG59O1xuXG4vKipcbiAqIFNlbmQgYSBmaWxlIHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbG9jYWxQYXRoIC0gVGhlIHBhdGggdG8gdGhlIGZpbGUgb24gdGhlIGxvY2FsIGZpbGUgc3lzdGVtLlxuICogQHBhcmFtIHtzdHJpbmd9IHJlbW90ZVBhdGggLSBUaGUgZGVzdGluYXRpb24gcGF0aCBvbiB0aGUgcmVtb3RlIGRldmljZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBvcHRzIC0gQWRkaXRpb25hbCBvcHRpb25zIG1hcHBpbmcuIFNlZVxuICogICAgICAgICAgICAgICAgICAgICAgICBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL25vZGUtdGVlbl9wcm9jZXNzLFxuICogICAgICAgICAgICAgICAgICAgICAgICBfZXhlY18gbWV0aG9kIG9wdGlvbnMsIGZvciBtb3JlIGluZm9ybWF0aW9uIGFib3V0IGF2YWlsYWJsZVxuICogICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zLlxuICovXG5tZXRob2RzLnB1c2ggPSBhc3luYyBmdW5jdGlvbiBwdXNoIChsb2NhbFBhdGgsIHJlbW90ZVBhdGgsIG9wdHMpIHtcbiAgYXdhaXQgdGhpcy5ta2RpcihwYXRoLnBvc2l4LmRpcm5hbWUocmVtb3RlUGF0aCkpO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydwdXNoJywgbG9jYWxQYXRoLCByZW1vdGVQYXRoXSwgb3B0cyk7XG59O1xuXG4vKipcbiAqIFJlY2VpdmUgYSBmaWxlIGZyb20gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSByZW1vdGVQYXRoIC0gVGhlIHNvdXJjZSBwYXRoIG9uIHRoZSByZW1vdGUgZGV2aWNlLlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsUGF0aCAtIFRoZSBkZXN0aW5hdGlvbiBwYXRoIHRvIHRoZSBmaWxlIG9uIHRoZSBsb2NhbCBmaWxlIHN5c3RlbS5cbiAqL1xubWV0aG9kcy5wdWxsID0gYXN5bmMgZnVuY3Rpb24gcHVsbCAocmVtb3RlUGF0aCwgbG9jYWxQYXRoKSB7XG4gIC8vIHB1bGwgZm9sZGVyIGNhbiB0YWtlIG1vcmUgdGltZSwgaW5jcmVhc2luZyB0aW1lIG91dCB0byA2MCBzZWNzXG4gIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ3B1bGwnLCByZW1vdGVQYXRoLCBsb2NhbFBhdGhdLCB7dGltZW91dDogNjAwMDB9KTtcbn07XG5cbi8qKlxuICogQ2hlY2sgd2hldGhlciB0aGUgcHJvY2VzcyB3aXRoIHRoZSBwYXJ0aWN1bGFyIG5hbWUgaXMgcnVubmluZyBvbiB0aGUgZGV2aWNlXG4gKiB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwcm9jZXNzTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBwcm9jZXNzIHRvIGJlIGNoZWNrZWQuXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSBnaXZlbiBwcm9jZXNzIGlzIHJ1bm5pbmcuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGdpdmVuIHByb2Nlc3MgbmFtZSBpcyBub3QgYSB2YWxpZCBjbGFzcyBuYW1lLlxuICovXG5tZXRob2RzLnByb2Nlc3NFeGlzdHMgPSBhc3luYyBmdW5jdGlvbiBwcm9jZXNzRXhpc3RzIChwcm9jZXNzTmFtZSkge1xuICBpZiAoIXRoaXMuaXNWYWxpZENsYXNzKHByb2Nlc3NOYW1lKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBwcm9jZXNzIG5hbWU6ICR7cHJvY2Vzc05hbWV9YCk7XG4gIH1cbiAgcmV0dXJuICFfLmlzRW1wdHkoYXdhaXQgdGhpcy5nZXRQSURzQnlOYW1lKHByb2Nlc3NOYW1lKSk7XG59O1xuXG4vKipcbiAqIEdldCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqIEByZXR1cm4ge0FycmF5LjxTdHJpbmc+fSBUaGUgb3V0cHV0IG9mIHRoZSBjb3JyZXNwb25kaW5nIGFkYiBjb21tYW5kLiBBbiBhcnJheSBjb250YWlucyBlYWNoIGZvcndhcmRpbmcgbGluZSBvZiBvdXRwdXRcbiAqL1xubWV0aG9kcy5nZXRGb3J3YXJkTGlzdCA9IGFzeW5jIGZ1bmN0aW9uIGdldEZvcndhcmRMaXN0ICgpIHtcbiAgbG9nLmRlYnVnKGBMaXN0IGZvcndhcmRpbmcgcG9ydHNgKTtcbiAgY29uc3QgY29ubmVjdGlvbnMgPSBhd2FpdCB0aGlzLmFkYkV4ZWMoWydmb3J3YXJkJywgJy0tbGlzdCddKTtcbiAgcmV0dXJuIGNvbm5lY3Rpb25zLnNwbGl0KEVPTCkuZmlsdGVyKChsaW5lKSA9PiBCb29sZWFuKGxpbmUudHJpbSgpKSk7XG59O1xuXG4vKipcbiAqIFNldHVwIFRDUCBwb3J0IGZvcndhcmRpbmcgd2l0aCBhZGIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gc3lzdGVtUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIGxvY2FsIHN5c3RlbSBwb3J0LlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBkZXZpY2VQb3J0IC0gVGhlIG51bWJlciBvZiB0aGUgcmVtb3RlIGRldmljZSBwb3J0LlxuICovXG5tZXRob2RzLmZvcndhcmRQb3J0ID0gYXN5bmMgZnVuY3Rpb24gZm9yd2FyZFBvcnQgKHN5c3RlbVBvcnQsIGRldmljZVBvcnQpIHtcbiAgbG9nLmRlYnVnKGBGb3J3YXJkaW5nIHN5c3RlbTogJHtzeXN0ZW1Qb3J0fSB0byBkZXZpY2U6ICR7ZGV2aWNlUG9ydH1gKTtcbiAgYXdhaXQgdGhpcy5hZGJFeGVjKFsnZm9yd2FyZCcsIGB0Y3A6JHtzeXN0ZW1Qb3J0fWAsIGB0Y3A6JHtkZXZpY2VQb3J0fWBdKTtcbn07XG5cbi8qKlxuICogUmVtb3ZlIFRDUCBwb3J0IGZvcndhcmRpbmcgd2l0aCBhZGIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LiBUaGUgZm9yd2FyZGluZ1xuICogZm9yIHRoZSBnaXZlbiBwb3J0IHNob3VsZCBiZSBzZXR1cCB3aXRoIHtAbGluayAjZm9yd2FyZFBvcnR9IGZpcnN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gc3lzdGVtUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIGxvY2FsIHN5c3RlbSBwb3J0XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0byByZW1vdmUgZm9yd2FyZGluZyBvbi5cbiAqL1xubWV0aG9kcy5yZW1vdmVQb3J0Rm9yd2FyZCA9IGFzeW5jIGZ1bmN0aW9uIHJlbW92ZVBvcnRGb3J3YXJkIChzeXN0ZW1Qb3J0KSB7XG4gIGxvZy5kZWJ1ZyhgUmVtb3ZpbmcgZm9yd2FyZGVkIHBvcnQgc29ja2V0IGNvbm5lY3Rpb246ICR7c3lzdGVtUG9ydH0gYCk7XG4gIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ2ZvcndhcmQnLCBgLS1yZW1vdmVgLCBgdGNwOiR7c3lzdGVtUG9ydH1gXSk7XG59O1xuXG4vKipcbiAqIEdldCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqIEByZXR1cm4ge0FycmF5LjxTdHJpbmc+fSBUaGUgb3V0cHV0IG9mIHRoZSBjb3JyZXNwb25kaW5nIGFkYiBjb21tYW5kLiBBbiBhcnJheSBjb250YWlucyBlYWNoIGZvcndhcmRpbmcgbGluZSBvZiBvdXRwdXRcbiAqL1xubWV0aG9kcy5nZXRSZXZlcnNlTGlzdCA9IGFzeW5jIGZ1bmN0aW9uIGdldFJldmVyc2VMaXN0ICgpIHtcbiAgbG9nLmRlYnVnKGBMaXN0IHJldmVyc2UgZm9yd2FyZGluZyBwb3J0c2ApO1xuICBjb25zdCBjb25uZWN0aW9ucyA9IGF3YWl0IHRoaXMuYWRiRXhlYyhbJ3JldmVyc2UnLCAnLS1saXN0J10pO1xuICByZXR1cm4gY29ubmVjdGlvbnMuc3BsaXQoRU9MKS5maWx0ZXIoKGxpbmUpID0+IEJvb2xlYW4obGluZS50cmltKCkpKTtcbn07XG5cbi8qKlxuICogU2V0dXAgVENQIHBvcnQgZm9yd2FyZGluZyB3aXRoIGFkYiBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBPbmx5IGF2YWlsYWJsZSBmb3IgQVBJIDIxKy5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IGRldmljZVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSByZW1vdGUgZGV2aWNlIHBvcnQuXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHN5c3RlbVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSBsb2NhbCBzeXN0ZW0gcG9ydC5cbiAqL1xubWV0aG9kcy5yZXZlcnNlUG9ydCA9IGFzeW5jIGZ1bmN0aW9uIHJldmVyc2VQb3J0IChkZXZpY2VQb3J0LCBzeXN0ZW1Qb3J0KSB7XG4gIGxvZy5kZWJ1ZyhgRm9yd2FyZGluZyBkZXZpY2U6ICR7ZGV2aWNlUG9ydH0gdG8gc3lzdGVtOiAke3N5c3RlbVBvcnR9YCk7XG4gIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ3JldmVyc2UnLCBgdGNwOiR7ZGV2aWNlUG9ydH1gLCBgdGNwOiR7c3lzdGVtUG9ydH1gXSk7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC4gVGhlIGZvcndhcmRpbmdcbiAqIGZvciB0aGUgZ2l2ZW4gcG9ydCBzaG91bGQgYmUgc2V0dXAgd2l0aCB7QGxpbmsgI2ZvcndhcmRQb3J0fSBmaXJzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IGRldmljZVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSByZW1vdGUgZGV2aWNlIHBvcnRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvIHJlbW92ZSBmb3J3YXJkaW5nIG9uLlxuICovXG5tZXRob2RzLnJlbW92ZVBvcnRSZXZlcnNlID0gYXN5bmMgZnVuY3Rpb24gcmVtb3ZlUG9ydFJldmVyc2UgKGRldmljZVBvcnQpIHtcbiAgbG9nLmRlYnVnKGBSZW1vdmluZyByZXZlcnNlIGZvcndhcmRlZCBwb3J0IHNvY2tldCBjb25uZWN0aW9uOiAke2RldmljZVBvcnR9IGApO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydyZXZlcnNlJywgYC0tcmVtb3ZlYCwgYHRjcDoke2RldmljZVBvcnR9YF0pO1xufTtcblxuLyoqXG4gKiBTZXR1cCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC4gVGhlIGRpZmZlcmVuY2VcbiAqIGJldHdlZW4ge0BsaW5rICNmb3J3YXJkUG9ydH0gaXMgdGhhdCB0aGlzIG1ldGhvZCBkb2VzIHNldHVwIGZvciBhbiBhYnN0cmFjdFxuICogbG9jYWwgcG9ydC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHN5c3RlbVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSBsb2NhbCBzeXN0ZW0gcG9ydC5cbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gZGV2aWNlUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIHJlbW90ZSBkZXZpY2UgcG9ydC5cbiAqL1xubWV0aG9kcy5mb3J3YXJkQWJzdHJhY3RQb3J0ID0gYXN5bmMgZnVuY3Rpb24gZm9yd2FyZEFic3RyYWN0UG9ydCAoc3lzdGVtUG9ydCwgZGV2aWNlUG9ydCkge1xuICBsb2cuZGVidWcoYEZvcndhcmRpbmcgc3lzdGVtOiAke3N5c3RlbVBvcnR9IHRvIGFic3RyYWN0IGRldmljZTogJHtkZXZpY2VQb3J0fWApO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydmb3J3YXJkJywgYHRjcDoke3N5c3RlbVBvcnR9YCwgYGxvY2FsYWJzdHJhY3Q6JHtkZXZpY2VQb3J0fWBdKTtcbn07XG5cbi8qKlxuICogRXhlY3V0ZSBwaW5nIHNoZWxsIGNvbW1hbmQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIGNvbW1hbmQgb3V0cHV0IGNvbnRhaW5zICdwaW5nJyBzdWJzdHJpbmcuXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGV4ZWN1dGluZyAncGluZycgY29tbWFuZCBvbiB0aGVcbiAqICAgICAgICAgICAgICAgICBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5waW5nID0gYXN5bmMgZnVuY3Rpb24gcGluZyAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnZWNobycsICdwaW5nJ10pO1xuICBpZiAoc3Rkb3V0LmluZGV4T2YoJ3BpbmcnKSA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgQURCIHBpbmcgZmFpbGVkLCByZXR1cm5lZCAke3N0ZG91dH1gKTtcbn07XG5cbi8qKlxuICogUmVzdGFydCB0aGUgZGV2aWNlIHVuZGVyIHRlc3QgdXNpbmcgYWRiIGNvbW1hbmRzLlxuICpcbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiBzdGFydCBmYWlscy5cbiAqL1xubWV0aG9kcy5yZXN0YXJ0ID0gYXN5bmMgZnVuY3Rpb24gcmVzdGFydCAoKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgdGhpcy5zdG9wTG9nY2F0KCk7XG4gICAgYXdhaXQgdGhpcy5yZXN0YXJ0QWRiKCk7XG4gICAgYXdhaXQgdGhpcy53YWl0Rm9yRGV2aWNlKDYwKTtcbiAgICBhd2FpdCB0aGlzLnN0YXJ0TG9nY2F0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFJlc3RhcnQgZmFpbGVkLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogU3RhcnQgdGhlIGxvZ2NhdCBwcm9jZXNzIHRvIGdhdGhlciBsb2dzLlxuICpcbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiByZXN0YXJ0IGZhaWxzLlxuICovXG5tZXRob2RzLnN0YXJ0TG9nY2F0ID0gYXN5bmMgZnVuY3Rpb24gc3RhcnRMb2djYXQgKCkge1xuICBpZiAoIV8uaXNFbXB0eSh0aGlzLmxvZ2NhdCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJUcnlpbmcgdG8gc3RhcnQgbG9nY2F0IGNhcHR1cmUgYnV0IGl0J3MgYWxyZWFkeSBzdGFydGVkIVwiKTtcbiAgfVxuICB0aGlzLmxvZ2NhdCA9IG5ldyBMb2djYXQoe1xuICAgIGFkYjogdGhpcy5leGVjdXRhYmxlLFxuICAgIGRlYnVnOiBmYWxzZSxcbiAgICBkZWJ1Z1RyYWNlOiBmYWxzZSxcbiAgICBjbGVhckRldmljZUxvZ3NPblN0YXJ0OiAhIXRoaXMuY2xlYXJEZXZpY2VMb2dzT25TdGFydCxcbiAgfSk7XG4gIGF3YWl0IHRoaXMubG9nY2F0LnN0YXJ0Q2FwdHVyZSgpO1xufTtcblxuLyoqXG4gKiBTdG9wIHRoZSBhY3RpdmUgbG9nY2F0IHByb2Nlc3Mgd2hpY2ggZ2F0aGVycyBsb2dzLlxuICogVGhlIGNhbGwgd2lsbCBiZSBpZ25vcmVkIGlmIG5vIGxvZ2NhdCBwcm9jZXNzIGlzIHJ1bm5pbmcuXG4gKi9cbm1ldGhvZHMuc3RvcExvZ2NhdCA9IGFzeW5jIGZ1bmN0aW9uIHN0b3BMb2djYXQgKCkge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMubG9nY2F0KSkge1xuICAgIHJldHVybjtcbiAgfVxuICB0cnkge1xuICAgIGF3YWl0IHRoaXMubG9nY2F0LnN0b3BDYXB0dXJlKCk7XG4gIH0gZmluYWxseSB7XG4gICAgdGhpcy5sb2djYXQgPSBudWxsO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBvdXRwdXQgZnJvbSB0aGUgY3VycmVudGx5IHJ1bm5pbmcgbG9nY2F0IHByb2Nlc3MuXG4gKiBUaGUgbG9nY2F0IHByb2Nlc3Mgc2hvdWxkIGJlIGV4ZWN1dGVkIGJ5IHsybGluayAjc3RhcnRMb2djYXR9IG1ldGhvZC5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBjb2xsZWN0ZWQgbG9nY2F0IG91dHB1dC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiBsb2djYXQgcHJvY2VzcyBpcyBub3QgcnVubmluZy5cbiAqL1xubWV0aG9kcy5nZXRMb2djYXRMb2dzID0gZnVuY3Rpb24gZ2V0TG9nY2F0TG9ncyAoKSB7XG4gIGlmIChfLmlzRW1wdHkodGhpcy5sb2djYXQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgZ2V0IGxvZ2NhdCBsb2dzIHNpbmNlIGxvZ2NhdCBoYXNuJ3Qgc3RhcnRlZFwiKTtcbiAgfVxuICByZXR1cm4gdGhpcy5sb2djYXQuZ2V0TG9ncygpO1xufTtcblxuLyoqXG4gKiBTZXQgdGhlIGNhbGxiYWNrIGZvciB0aGUgbG9nY2F0IG91dHB1dCBldmVudC5cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciAtIFRoZSBsaXN0ZW5lciBmdW5jdGlvbiwgd2hpY2ggYWNjZXB0cyBvbmUgYXJndW1lbnQuIFRoZSBhcmd1bWVudCBpc1xuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhIGxvZyByZWNvcmQgb2JqZWN0IHdpdGggYHRpbWVzdGFtcGAsIGBsZXZlbGAgYW5kIGBtZXNzYWdlYCBwcm9wZXJ0aWVzLlxuICogQHRocm93cyB7RXJyb3J9IElmIGxvZ2NhdCBwcm9jZXNzIGlzIG5vdCBydW5uaW5nLlxuICovXG5tZXRob2RzLnNldExvZ2NhdExpc3RlbmVyID0gZnVuY3Rpb24gc2V0TG9nY2F0TGlzdGVuZXIgKGxpc3RlbmVyKSB7XG4gIGlmIChfLmlzRW1wdHkodGhpcy5sb2djYXQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTG9nY2F0IHByb2Nlc3MgaGFzbid0IGJlZW4gc3RhcnRlZFwiKTtcbiAgfVxuICB0aGlzLmxvZ2NhdC5vbignb3V0cHV0JywgbGlzdGVuZXIpO1xufTtcblxuLyoqXG4gKiBSZW1vdmVzIHRoZSBwcmV2aW91c2x5IHNldCBjYWxsYmFjayBmb3IgdGhlIGxvZ2NhdCBvdXRwdXQgZXZlbnQuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgLSBUaGUgbGlzdGVuZXIgZnVuY3Rpb24sIHdoaWNoIGhhcyBiZWVuIHByZXZpb3VzbHlcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFzc2VkIHRvIGBzZXRMb2djYXRMaXN0ZW5lcmBcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiBsb2djYXQgcHJvY2VzcyBpcyBub3QgcnVubmluZy5cbiAqL1xubWV0aG9kcy5yZW1vdmVMb2djYXRMaXN0ZW5lciA9IGZ1bmN0aW9uIHJlbW92ZUxvZ2NhdExpc3RlbmVyIChsaXN0ZW5lcikge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMubG9nY2F0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkxvZ2NhdCBwcm9jZXNzIGhhc24ndCBiZWVuIHN0YXJ0ZWRcIik7XG4gIH1cbiAgdGhpcy5sb2djYXQucmVtb3ZlTGlzdGVuZXIoJ291dHB1dCcsIGxpc3RlbmVyKTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBsaXN0IG9mIHByb2Nlc3MgaWRzIGZvciB0aGUgcGFydGljdWxhciBwcm9jZXNzIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFRoZSBwYXJ0IG9mIHByb2Nlc3MgbmFtZS5cbiAqIEByZXR1cm4ge0FycmF5LjxudW1iZXI+fSBUaGUgbGlzdCBvZiBtYXRjaGVkIHByb2Nlc3MgSURzIG9yIGFuIGVtcHR5IGxpc3QuXG4gKi9cbm1ldGhvZHMuZ2V0UElEc0J5TmFtZSA9IGFzeW5jIGZ1bmN0aW9uIGdldFBJRHNCeU5hbWUgKG5hbWUpIHtcbiAgbG9nLmRlYnVnKGBHZXR0aW5nIElEcyBvZiBhbGwgJyR7bmFtZX0nIHByb2Nlc3Nlc2ApO1xuICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvMTM1NjdcbiAgaWYgKGF3YWl0IHRoaXMuZ2V0QXBpTGV2ZWwoKSA+PSAyMykge1xuICAgIGlmICghXy5pc0Jvb2xlYW4odGhpcy5faXNQZ3JlcEF2YWlsYWJsZSkpIHtcbiAgICAgIC8vIHBncmVwIGlzIGluIHByaW9yaXR5LCBzaW5jZSBwaWRvZiBoYXMgYmVlbiByZXBvcnRlZCBvZiBoYXZpbmcgYnVncyBvbiBzb21lIHBsYXRmb3Jtc1xuICAgICAgY29uc3QgcGdyZXBPdXRwdXQgPSBfLnRyaW0oYXdhaXQgdGhpcy5zaGVsbChbJ3BncmVwIC0taGVscDsgZWNobyAkPyddKSk7XG4gICAgICB0aGlzLl9pc1BncmVwQXZhaWxhYmxlID0gcGFyc2VJbnQoXy5sYXN0KHBncmVwT3V0cHV0LnNwbGl0KC9cXHMrLykpLCAxMCkgPT09IDA7XG4gICAgICBpZiAodGhpcy5faXNQZ3JlcEF2YWlsYWJsZSkge1xuICAgICAgICB0aGlzLl9jYW5QZ3JlcFVzZUZ1bGxDbWRMaW5lU2VhcmNoID0gL14tZlxcYi9tLnRlc3QocGdyZXBPdXRwdXQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5faXNQaWRvZkF2YWlsYWJsZSA9IHBhcnNlSW50KGF3YWl0IHRoaXMuc2hlbGwoWydwaWRvZiAtLWhlbHAgPiAvZGV2L251bGw7IGVjaG8gJD8nXSksIDEwKSA9PT0gMDtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHRoaXMuX2lzUGdyZXBBdmFpbGFibGUgfHwgdGhpcy5faXNQaWRvZkF2YWlsYWJsZSkge1xuICAgICAgY29uc3Qgc2hlbGxDb21tYW5kID0gdGhpcy5faXNQZ3JlcEF2YWlsYWJsZVxuICAgICAgICA/ICh0aGlzLl9jYW5QZ3JlcFVzZUZ1bGxDbWRMaW5lU2VhcmNoXG4gICAgICAgICAgPyBbJ3BncmVwJywgJy1mJywgXy5lc2NhcGVSZWdFeHAobmFtZSldXG4gICAgICAgICAgOiBbJ3BncmVwJywgYF4ke18uZXNjYXBlUmVnRXhwKG5hbWUuc2xpY2UoLTE1KSl9JGBdKVxuICAgICAgICA6IFsncGlkb2YnLCBuYW1lXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiAoYXdhaXQgdGhpcy5zaGVsbChzaGVsbENvbW1hbmQpKVxuICAgICAgICAgIC5zcGxpdCgvXFxzKy8pXG4gICAgICAgICAgLm1hcCgoeCkgPT4gcGFyc2VJbnQoeCwgMTApKVxuICAgICAgICAgIC5maWx0ZXIoKHgpID0+IF8uaXNJbnRlZ2VyKHgpKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gZXJyb3IgY29kZSAxIGlzIHJldHVybmVkIGlmIHRoZSB1dGlsaXR5IGRpZCBub3QgZmluZCBhbnkgcHJvY2Vzc2VzXG4gICAgICAgIC8vIHdpdGggdGhlIGdpdmVuIG5hbWVcbiAgICAgICAgaWYgKGUuY29kZSA9PT0gMSkge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBleHRyYWN0IHByb2Nlc3MgSUQgb2YgJyR7bmFtZX0nOiAke2UubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBsb2cuZGVidWcoJ1VzaW5nIHBzLWJhc2VkIFBJRCBkZXRlY3Rpb24nKTtcbiAgY29uc3QgcGlkQ29sdW1uVGl0bGUgPSAnUElEJztcbiAgY29uc3QgcHJvY2Vzc05hbWVDb2x1bW5UaXRsZSA9ICdOQU1FJztcbiAgY29uc3Qgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ3BzJ10pO1xuICBjb25zdCB0aXRsZU1hdGNoID0gbmV3IFJlZ0V4cChgXiguKlxcXFxiJHtwaWRDb2x1bW5UaXRsZX1cXFxcYi4qXFxcXGIke3Byb2Nlc3NOYW1lQ29sdW1uVGl0bGV9XFxcXGIuKikkYCwgJ20nKS5leGVjKHN0ZG91dCk7XG4gIGlmICghdGl0bGVNYXRjaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGV4dHJhY3QgUElEIG9mICcke25hbWV9JyBmcm9tIHBzIG91dHB1dDogJHtzdGRvdXR9YCk7XG4gIH1cbiAgY29uc3QgYWxsVGl0bGVzID0gdGl0bGVNYXRjaFsxXS50cmltKCkuc3BsaXQoL1xccysvKTtcbiAgY29uc3QgcGlkSW5kZXggPSBhbGxUaXRsZXMuaW5kZXhPZihwaWRDb2x1bW5UaXRsZSk7XG4gIGNvbnN0IHBpZHMgPSBbXTtcbiAgY29uc3QgcHJvY2Vzc05hbWVSZWdleCA9IG5ldyBSZWdFeHAoYF4oLipcXFxcYlxcXFxkK1xcXFxiLipcXFxcYiR7Xy5lc2NhcGVSZWdFeHAobmFtZSl9XFxcXGIuKikkYCwgJ2dtJyk7XG4gIGxldCBtYXRjaGVkTGluZTtcbiAgd2hpbGUgKChtYXRjaGVkTGluZSA9IHByb2Nlc3NOYW1lUmVnZXguZXhlYyhzdGRvdXQpKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gbWF0Y2hlZExpbmVbMV0udHJpbSgpLnNwbGl0KC9cXHMrLyk7XG4gICAgaWYgKHBpZEluZGV4ID49IGFsbFRpdGxlcy5sZW5ndGggfHwgaXNOYU4oaXRlbXNbcGlkSW5kZXhdKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgZXh0cmFjdCBQSUQgb2YgJyR7bmFtZX0nIGZyb20gJyR7bWF0Y2hlZExpbmVbMV0udHJpbSgpfScuIHBzIG91dHB1dDogJHtzdGRvdXR9YCk7XG4gICAgfVxuICAgIHBpZHMucHVzaChwYXJzZUludChpdGVtc1twaWRJbmRleF0sIDEwKSk7XG4gIH1cbiAgcmV0dXJuIHBpZHM7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgbGlzdCBvZiBwcm9jZXNzIGlkcyBmb3IgdGhlIHBhcnRpY3VsYXIgcHJvY2VzcyBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBUaGUgcGFydCBvZiBwcm9jZXNzIG5hbWUuXG4gKiBAcmV0dXJuIHtBcnJheS48bnVtYmVyPn0gVGhlIGxpc3Qgb2YgbWF0Y2hlZCBwcm9jZXNzIElEcyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmtpbGxQcm9jZXNzZXNCeU5hbWUgPSBhc3luYyBmdW5jdGlvbiBraWxsUHJvY2Vzc2VzQnlOYW1lIChuYW1lKSB7XG4gIHRyeSB7XG4gICAgbG9nLmRlYnVnKGBBdHRlbXB0aW5nIHRvIGtpbGwgYWxsICR7bmFtZX0gcHJvY2Vzc2VzYCk7XG4gICAgbGV0IHBpZHMgPSBhd2FpdCB0aGlzLmdldFBJRHNCeU5hbWUobmFtZSk7XG4gICAgaWYgKF8uaXNFbXB0eShwaWRzKSkge1xuICAgICAgbG9nLmluZm8oYE5vICcke25hbWV9JyBwcm9jZXNzIGhhcyBiZWVuIGZvdW5kYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAobGV0IHBpZCBvZiBwaWRzKSB7XG4gICAgICBhd2FpdCB0aGlzLmtpbGxQcm9jZXNzQnlQSUQocGlkKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBraWxsICR7bmFtZX0gcHJvY2Vzc2VzLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogS2lsbCB0aGUgcGFydGljdWxhciBwcm9jZXNzIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqIFRoZSBjdXJyZW50IHVzZXIgaXMgYXV0b21hdGljYWxseSBzd2l0Y2hlZCB0byByb290IGlmIG5lY2Vzc2FyeSBpbiBvcmRlclxuICogdG8gcHJvcGVybHkga2lsbCB0aGUgcHJvY2Vzcy5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHBpZCAtIFRoZSBJRCBvZiB0aGUgcHJvY2VzcyB0byBiZSBraWxsZWQuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEtpbGwgY29tbWFuZCBzdGRvdXQuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIHByb2Nlc3Mgd2l0aCBnaXZlbiBJRCBpcyBub3QgcHJlc2VudCBvciBjYW5ub3QgYmUga2lsbGVkLlxuICovXG5tZXRob2RzLmtpbGxQcm9jZXNzQnlQSUQgPSBhc3luYyBmdW5jdGlvbiBraWxsUHJvY2Vzc0J5UElEIChwaWQpIHtcbiAgbG9nLmRlYnVnKGBBdHRlbXB0aW5nIHRvIGtpbGwgcHJvY2VzcyAke3BpZH1gKTtcbiAgbGV0IHdhc1Jvb3QgPSBmYWxzZTtcbiAgbGV0IGJlY2FtZVJvb3QgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICB0cnkge1xuICAgICAgLy8gQ2hlY2sgaWYgdGhlIHByb2Nlc3MgZXhpc3RzIGFuZCB0aHJvdyBhbiBleGNlcHRpb24gb3RoZXJ3aXNlXG4gICAgICBhd2FpdCB0aGlzLnNoZWxsKFsna2lsbCcsICctMCcsIHBpZF0pO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmICghZS5tZXNzYWdlLmluY2x1ZGVzKCdPcGVyYXRpb24gbm90IHBlcm1pdHRlZCcpKSB7XG4gICAgICAgIHRocm93IGU7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICB3YXNSb290ID0gYXdhaXQgdGhpcy5pc1Jvb3QoKTtcbiAgICAgIH0gY2F0Y2ggKGlnbikge31cbiAgICAgIGlmICh3YXNSb290KSB7XG4gICAgICAgIHRocm93IGU7XG4gICAgICB9XG4gICAgICBsb2cuaW5mbyhgQ2Fubm90IGtpbGwgUElEICR7cGlkfSBkdWUgdG8gaW5zdWZmaWNpZW50IHBlcm1pc3Npb25zLiBSZXRyeWluZyBhcyByb290YCk7XG4gICAgICBsZXQge2lzU3VjY2Vzc2Z1bH0gPSBhd2FpdCB0aGlzLnJvb3QoKTtcbiAgICAgIGJlY2FtZVJvb3QgPSBpc1N1Y2Nlc3NmdWw7XG4gICAgICBhd2FpdCB0aGlzLnNoZWxsKFsna2lsbCcsICctMCcsIHBpZF0pO1xuICAgIH1cbiAgICBjb25zdCB0aW1lb3V0TXMgPSAxMDAwO1xuICAgIGxldCBzdGRvdXQ7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHdhaXRGb3JDb25kaXRpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydraWxsJywgcGlkXSk7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgLy8ga2lsbCByZXR1cm5zIG5vbi16ZXJvIGNvZGUgaWYgdGhlIHByb2Nlc3MgaXMgYWxyZWFkeSBraWxsZWRcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfSwge3dhaXRNczogdGltZW91dE1zLCBpbnRlcnZhbE1zOiAzMDB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGxvZy53YXJuKGBDYW5ub3Qga2lsbCBwcm9jZXNzICR7cGlkfSBpbiAke3RpbWVvdXRNc30gbXMuIFRyeWluZyB0byBmb3JjZSBraWxsLi4uYCk7XG4gICAgICBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsna2lsbCcsICctOScsIHBpZF0pO1xuICAgIH1cbiAgICByZXR1cm4gc3Rkb3V0O1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChiZWNhbWVSb290KSB7XG4gICAgICBhd2FpdCB0aGlzLnVucm9vdCgpO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBCcm9hZGNhc3QgcHJvY2VzcyBraWxsaW5nIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gaW50ZW50IC0gVGhlIG5hbWUgb2YgdGhlIGludGVudCB0byBicm9hZGNhc3QgdG8uXG4gKiBAcGFyYW0ge3N0cmluZ30gcHJvY2Vzc05hbWUgLSBUaGUgbmFtZSBvZiB0aGUga2lsbGVkIHByb2Nlc3MuXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgdGhlIHByb2Nlc3Mgd2FzIG5vdCBraWxsZWQuXG4gKi9cbm1ldGhvZHMuYnJvYWRjYXN0UHJvY2Vzc0VuZCA9IGFzeW5jIGZ1bmN0aW9uIGJyb2FkY2FzdFByb2Nlc3NFbmQgKGludGVudCwgcHJvY2Vzc05hbWUpIHtcbiAgLy8gc3RhcnQgdGhlIGJyb2FkY2FzdCB3aXRob3V0IHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaC5cbiAgdGhpcy5icm9hZGNhc3QoaW50ZW50KTtcbiAgLy8gd2FpdCBmb3IgdGhlIHByb2Nlc3MgdG8gZW5kXG4gIGxldCBzdGFydCA9IERhdGUubm93KCk7XG4gIGxldCB0aW1lb3V0TXMgPSA0MDAwMDtcbiAgdHJ5IHtcbiAgICB3aGlsZSAoKERhdGUubm93KCkgLSBzdGFydCkgPCB0aW1lb3V0TXMpIHtcbiAgICAgIGlmIChhd2FpdCB0aGlzLnByb2Nlc3NFeGlzdHMocHJvY2Vzc05hbWUpKSB7XG4gICAgICAgIC8vIGNvb2wgZG93blxuICAgICAgICBhd2FpdCBzbGVlcCg0MDApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBQcm9jZXNzIG5ldmVyIGRpZWQgd2l0aGluICR7dGltZW91dE1zfSBtc2ApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gYnJvYWRjYXN0IHByb2Nlc3MgZW5kLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogQnJvYWRjYXN0IGEgbWVzc2FnZSB0byB0aGUgZ2l2ZW4gaW50ZW50LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBpbnRlbnQgLSBUaGUgbmFtZSBvZiB0aGUgaW50ZW50IHRvIGJyb2FkY2FzdCB0by5cbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiBpbnRlbnQgbmFtZSBpcyBub3QgYSB2YWxpZCBjbGFzcyBuYW1lLlxuICovXG5tZXRob2RzLmJyb2FkY2FzdCA9IGFzeW5jIGZ1bmN0aW9uIGJyb2FkY2FzdCAoaW50ZW50KSB7XG4gIGlmICghdGhpcy5pc1ZhbGlkQ2xhc3MoaW50ZW50KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBpbnRlbnQgJHtpbnRlbnR9YCk7XG4gIH1cbiAgbG9nLmRlYnVnKGBCcm9hZGNhc3Rpbmc6ICR7aW50ZW50fWApO1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnYW0nLCAnYnJvYWRjYXN0JywgJy1hJywgaW50ZW50XSk7XG59O1xuXG4vKipcbiAqIEtpbGwgQW5kcm9pZCBpbnN0cnVtZW50cyBpZiB0aGV5IGFyZSBjdXJyZW50bHkgcnVubmluZy5cbiAqL1xubWV0aG9kcy5lbmRBbmRyb2lkQ292ZXJhZ2UgPSBhc3luYyBmdW5jdGlvbiBlbmRBbmRyb2lkQ292ZXJhZ2UgKCkge1xuICBpZiAodGhpcy5pbnN0cnVtZW50UHJvYyAmJiB0aGlzLmluc3RydW1lbnRQcm9jLmlzUnVubmluZykge1xuICAgIGF3YWl0IHRoaXMuaW5zdHJ1bWVudFByb2Muc3RvcCgpO1xuICB9XG59O1xuXG4vKipcbiAqIEluc3RydW1lbnQgdGhlIHBhcnRpY3VsYXIgYWN0aXZpdHkuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBuYW1lIG9mIHRoZSBwYWNrYWdlIHRvIGJlIGluc3RydW1lbnRlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpdml0eSAtIFRoZSBuYW1lIG9mIHRoZSBtYWluIGFjdGl2aXR5IGluIHRoaXMgcGFja2FnZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBpbnN0cnVtZW50V2l0aCAtIFRoZSBuYW1lIG9mIHRoZSBwYWNrYWdlIHRvIGluc3RydW1lbnRcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBhY3Rpdml0eSB3aXRoLlxuICogQHRocm93cyB7ZXJyb3J9IElmIGFueSBleGNlcHRpb24gaXMgcmVwb3J0ZWQgYnkgYWRiIHNoZWxsLlxuICovXG5tZXRob2RzLmluc3RydW1lbnQgPSBhc3luYyBmdW5jdGlvbiBpbnN0cnVtZW50IChwa2csIGFjdGl2aXR5LCBpbnN0cnVtZW50V2l0aCkge1xuICBpZiAoYWN0aXZpdHlbMF0gIT09ICcuJykge1xuICAgIHBrZyA9ICcnO1xuICB9XG4gIGxldCBwa2dBY3Rpdml0eSA9IChwa2cgKyBhY3Rpdml0eSkucmVwbGFjZSgvXFwuKy9nLCAnLicpOyAvLyBGaXggcGtnLi5hY3Rpdml0eSBlcnJvclxuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbXG4gICAgJ2FtJywgJ2luc3RydW1lbnQnLFxuICAgICctZScsICdtYWluX2FjdGl2aXR5JyxcbiAgICBwa2dBY3Rpdml0eSxcbiAgICBpbnN0cnVtZW50V2l0aCxcbiAgXSk7XG4gIGlmIChzdGRvdXQuaW5kZXhPZignRXhjZXB0aW9uJykgIT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGV4Y2VwdGlvbiBkdXJpbmcgaW5zdHJ1bWVudGF0aW9uLiBPcmlnaW5hbCBlcnJvciAke3N0ZG91dC5zcGxpdCgnXFxuJylbMF19YCk7XG4gIH1cbn07XG5cbi8qKlxuICogQ29sbGVjdCBBbmRyb2lkIGNvdmVyYWdlIGJ5IGluc3RydW1lbnRpbmcgdGhlIHBhcnRpY3VsYXIgYWN0aXZpdHkuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGluc3RydW1lbnRDbGFzcyAtIFRoZSBuYW1lIG9mIHRoZSBpbnN0cnVtZW50YXRpb24gY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gd2FpdFBrZyAtIFRoZSBuYW1lIG9mIHRoZSBwYWNrYWdlIHRvIGJlIGluc3RydW1lbnRlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB3YWl0QWN0aXZpdHkgLSBUaGUgbmFtZSBvZiB0aGUgbWFpbiBhY3Rpdml0eSBpbiB0aGlzIHBhY2thZ2UuXG4gKlxuICogQHJldHVybiB7cHJvbWlzZX0gVGhlIHByb21pc2UgaXMgc3VjY2Vzc2Z1bGx5IHJlc29sdmVkIGlmIHRoZSBpbnN0cnVtZW50YXRpb24gc3RhcnRzXG4gKiAgICAgICAgICAgICAgICAgICB3aXRob3V0IGVycm9ycy5cbiAqL1xubWV0aG9kcy5hbmRyb2lkQ292ZXJhZ2UgPSBhc3luYyBmdW5jdGlvbiBhbmRyb2lkQ292ZXJhZ2UgKGluc3RydW1lbnRDbGFzcywgd2FpdFBrZywgd2FpdEFjdGl2aXR5KSB7XG4gIGlmICghdGhpcy5pc1ZhbGlkQ2xhc3MoaW5zdHJ1bWVudENsYXNzKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBjbGFzcyAke2luc3RydW1lbnRDbGFzc31gKTtcbiAgfVxuICByZXR1cm4gYXdhaXQgbmV3IEIoYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGxldCBhcmdzID0gdGhpcy5leGVjdXRhYmxlLmRlZmF1bHRBcmdzXG4gICAgICAuY29uY2F0KFsnc2hlbGwnLCAnYW0nLCAnaW5zdHJ1bWVudCcsICctZScsICdjb3ZlcmFnZScsICd0cnVlJywgJy13J10pXG4gICAgICAuY29uY2F0KFtpbnN0cnVtZW50Q2xhc3NdKTtcbiAgICBsb2cuZGVidWcoYENvbGxlY3RpbmcgY292ZXJhZ2UgZGF0YSB3aXRoOiAke1t0aGlzLmV4ZWN1dGFibGUucGF0aF0uY29uY2F0KGFyZ3MpLmpvaW4oJyAnKX1gKTtcbiAgICB0cnkge1xuICAgICAgLy8gYW0gaW5zdHJ1bWVudCBydW5zIGZvciB0aGUgbGlmZSBvZiB0aGUgYXBwIHByb2Nlc3MuXG4gICAgICB0aGlzLmluc3RydW1lbnRQcm9jID0gbmV3IFN1YlByb2Nlc3ModGhpcy5leGVjdXRhYmxlLnBhdGgsIGFyZ3MpO1xuICAgICAgYXdhaXQgdGhpcy5pbnN0cnVtZW50UHJvYy5zdGFydCgwKTtcbiAgICAgIHRoaXMuaW5zdHJ1bWVudFByb2Mub24oJ291dHB1dCcsIChzdGRvdXQsIHN0ZGVycikgPT4ge1xuICAgICAgICBpZiAoc3RkZXJyKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIHJ1biBpbnN0cnVtZW50YXRpb24uIE9yaWdpbmFsIGVycm9yOiAke3N0ZGVycn1gKSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgYXdhaXQgdGhpcy53YWl0Rm9yQWN0aXZpdHkod2FpdFBrZywgd2FpdEFjdGl2aXR5KTtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICByZWplY3QobmV3IEVycm9yKGBBbmRyb2lkIGNvdmVyYWdlIGZhaWxlZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIHBhcnRpY3VsYXIgcHJvcGVydHkgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwcm9wZXJ0eSAtIFRoZSBuYW1lIG9mIHRoZSBwcm9wZXJ0eS4gVGhpcyBuYW1lIHNob3VsZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYmUga25vd24gdG8gX2FkYiBzaGVsbCBnZXRwcm9wXyB0b29sLlxuICpcbiAqIEByZXR1cm4ge3N0cmluZ30gVGhlIHZhbHVlIG9mIHRoZSBnaXZlbiBwcm9wZXJ0eS5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VQcm9wZXJ0eSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVByb3BlcnR5IChwcm9wZXJ0eSkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ2dldHByb3AnLCBwcm9wZXJ0eV0pO1xuICBsZXQgdmFsID0gc3Rkb3V0LnRyaW0oKTtcbiAgbG9nLmRlYnVnKGBDdXJyZW50IGRldmljZSBwcm9wZXJ0eSAnJHtwcm9wZXJ0eX0nOiAke3ZhbH1gKTtcbiAgcmV0dXJuIHZhbDtcbn07XG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gc2V0UHJvcE9wdHNcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gcHJpdmlsZWdlZCAtIERvIHdlIHJ1biBzZXRQcm9wIGFzIGEgcHJpdmlsZWdlZCBjb21tYW5kPyBEZWZhdWx0IHRydWUuXG4gKi9cblxuLyoqXG4gKiBTZXQgdGhlIHBhcnRpY3VsYXIgcHJvcGVydHkgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwcm9wZXJ0eSAtIFRoZSBuYW1lIG9mIHRoZSBwcm9wZXJ0eS4gVGhpcyBuYW1lIHNob3VsZFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgYmUga25vd24gdG8gX2FkYiBzaGVsbCBzZXRwcm9wXyB0b29sLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbCAtIFRoZSBuZXcgcHJvcGVydHkgdmFsdWUuXG4gKiBAcGFyYW0ge3NldFByb3BPcHRzfSBvcHRzXG4gKlxuICogQHRocm93cyB7ZXJyb3J9IElmIF9zZXRwcm9wXyB1dGlsaXR5IGZhaWxzIHRvIGNoYW5nZSBwcm9wZXJ0eSB2YWx1ZS5cbiAqL1xubWV0aG9kcy5zZXREZXZpY2VQcm9wZXJ0eSA9IGFzeW5jIGZ1bmN0aW9uIHNldERldmljZVByb3BlcnR5IChwcm9wLCB2YWwsIG9wdHMgPSB7fSkge1xuICBjb25zdCB7cHJpdmlsZWdlZCA9IHRydWV9ID0gb3B0cztcbiAgbG9nLmRlYnVnKGBTZXR0aW5nIGRldmljZSBwcm9wZXJ0eSAnJHtwcm9wfScgdG8gJyR7dmFsfSdgKTtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ3NldHByb3AnLCBwcm9wLCB2YWxdLCB7XG4gICAgcHJpdmlsZWdlZCxcbiAgfSk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gQ3VycmVudCBzeXN0ZW0gbGFuZ3VhZ2Ugb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldERldmljZVN5c0xhbmd1YWdlID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlU3lzTGFuZ3VhZ2UgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncGVyc2lzdC5zeXMubGFuZ3VhZ2UnKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBDdXJyZW50IGNvdW50cnkgbmFtZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMuZ2V0RGV2aWNlU3lzQ291bnRyeSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVN5c0NvdW50cnkgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncGVyc2lzdC5zeXMuY291bnRyeScpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEN1cnJlbnQgc3lzdGVtIGxvY2FsZSBuYW1lIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VTeXNMb2NhbGUgPSBhc3luYyBmdW5jdGlvbiBnZXREZXZpY2VTeXNMb2NhbGUgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncGVyc2lzdC5zeXMubG9jYWxlJyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gQ3VycmVudCBwcm9kdWN0IGxhbmd1YWdlIG5hbWUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldERldmljZVByb2R1Y3RMYW5ndWFnZSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVByb2R1Y3RMYW5ndWFnZSAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5wcm9kdWN0LmxvY2FsZS5sYW5ndWFnZScpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEN1cnJlbnQgcHJvZHVjdCBjb3VudHJ5IG5hbWUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldERldmljZVByb2R1Y3RDb3VudHJ5ID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlUHJvZHVjdENvdW50cnkgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8ucHJvZHVjdC5sb2NhbGUucmVnaW9uJyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gQ3VycmVudCBwcm9kdWN0IGxvY2FsZSBuYW1lIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VQcm9kdWN0TG9jYWxlID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlUHJvZHVjdExvY2FsZSAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5wcm9kdWN0LmxvY2FsZScpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBtb2RlbCBuYW1lIG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXRNb2RlbCA9IGFzeW5jIGZ1bmN0aW9uIGdldE1vZGVsICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLnByb2R1Y3QubW9kZWwnKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBUaGUgbWFudWZhY3R1cmVyIG5hbWUgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldE1hbnVmYWN0dXJlciA9IGFzeW5jIGZ1bmN0aW9uIGdldE1hbnVmYWN0dXJlciAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5wcm9kdWN0Lm1hbnVmYWN0dXJlcicpO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGN1cnJlbnQgc2NyZWVuIHNpemUuXG4gKlxuICogQHJldHVybiB7c3RyaW5nfSBEZXZpY2Ugc2NyZWVuIHNpemUgYXMgc3RyaW5nIGluIGZvcm1hdCAnV3hIJyBvclxuICogICAgICAgICAgICAgICAgICBfbnVsbF8gaWYgaXQgY2Fubm90IGJlIGRldGVybWluZWQuXG4gKi9cbm1ldGhvZHMuZ2V0U2NyZWVuU2l6ZSA9IGFzeW5jIGZ1bmN0aW9uIGdldFNjcmVlblNpemUgKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ3dtJywgJ3NpemUnXSk7XG4gIGxldCBzaXplID0gbmV3IFJlZ0V4cCgvUGh5c2ljYWwgc2l6ZTogKFteXFxyP1xcbl0rKSovZykuZXhlYyhzdGRvdXQpO1xuICBpZiAoc2l6ZSAmJiBzaXplLmxlbmd0aCA+PSAyKSB7XG4gICAgcmV0dXJuIHNpemVbMV0udHJpbSgpO1xuICB9XG4gIHJldHVybiBudWxsO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGN1cnJlbnQgc2NyZWVuIGRlbnNpdHkgaW4gZHBpXG4gKlxuICogQHJldHVybiB7P251bWJlcn0gRGV2aWNlIHNjcmVlbiBkZW5zaXR5IGFzIGEgbnVtYmVyIG9yIF9udWxsXyBpZiBpdFxuICogICAgICAgICAgICAgICAgICBjYW5ub3QgYmUgZGV0ZXJtaW5lZFxuICovXG5tZXRob2RzLmdldFNjcmVlbkRlbnNpdHkgPSBhc3luYyBmdW5jdGlvbiBnZXRTY3JlZW5EZW5zaXR5ICgpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWyd3bScsICdkZW5zaXR5J10pO1xuICBsZXQgZGVuc2l0eSA9IG5ldyBSZWdFeHAoL1BoeXNpY2FsIGRlbnNpdHk6IChbXlxccj9cXG5dKykqL2cpLmV4ZWMoc3Rkb3V0KTtcbiAgaWYgKGRlbnNpdHkgJiYgZGVuc2l0eS5sZW5ndGggPj0gMikge1xuICAgIGxldCBkZW5zaXR5TnVtYmVyID0gcGFyc2VJbnQoZGVuc2l0eVsxXS50cmltKCksIDEwKTtcbiAgICByZXR1cm4gaXNOYU4oZGVuc2l0eU51bWJlcikgPyBudWxsIDogZGVuc2l0eU51bWJlcjtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn07XG5cbi8qKlxuICogU2V0dXAgSFRUUCBwcm94eSBpbiBkZXZpY2UgZ2xvYmFsIHNldHRpbmdzLlxuICogUmVhZCBodHRwczovL2FuZHJvaWQuZ29vZ2xlc291cmNlLmNvbS9wbGF0Zm9ybS9mcmFtZXdvcmtzL2Jhc2UvKy9hbmRyb2lkLTkuMC4wX3IyMS9jb3JlL2phdmEvYW5kcm9pZC9wcm92aWRlci9TZXR0aW5ncy5qYXZhIGZvciBlYWNoIHByb3BlcnR5XG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHByb3h5SG9zdCAtIFRoZSBob3N0IG5hbWUgb2YgdGhlIHByb3h5LlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBwcm94eVBvcnQgLSBUaGUgcG9ydCBudW1iZXIgdG8gYmUgc2V0LlxuICovXG5tZXRob2RzLnNldEh0dHBQcm94eSA9IGFzeW5jIGZ1bmN0aW9uIHNldEh0dHBQcm94eSAocHJveHlIb3N0LCBwcm94eVBvcnQpIHtcbiAgbGV0IHByb3h5ID0gYCR7cHJveHlIb3N0fToke3Byb3h5UG9ydH1gO1xuICBpZiAoXy5pc1VuZGVmaW5lZChwcm94eUhvc3QpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYWxsIHRvIHNldEh0dHBQcm94eSBtZXRob2Qgd2l0aCB1bmRlZmluZWQgcHJveHlfaG9zdDogJHtwcm94eX1gKTtcbiAgfVxuICBpZiAoXy5pc1VuZGVmaW5lZChwcm94eVBvcnQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYWxsIHRvIHNldEh0dHBQcm94eSBtZXRob2Qgd2l0aCB1bmRlZmluZWQgcHJveHlfcG9ydCAke3Byb3h5fWApO1xuICB9XG5cbiAgY29uc3QgaHR0cFByb3h5U2V0dGlucyA9IFtcbiAgICBbJ2h0dHBfcHJveHknLCBwcm94eV0sXG4gICAgWydnbG9iYWxfaHR0cF9wcm94eV9ob3N0JywgcHJveHlIb3N0XSxcbiAgICBbJ2dsb2JhbF9odHRwX3Byb3h5X3BvcnQnLCBwcm94eVBvcnRdXG4gIF07XG4gIGZvciAoY29uc3QgW3NldHRpbmdLZXksIHNldHRpbmdWYWx1ZV0gb2YgaHR0cFByb3h5U2V0dGlucykge1xuICAgIGF3YWl0IHRoaXMuc2V0U2V0dGluZygnZ2xvYmFsJywgc2V0dGluZ0tleSwgc2V0dGluZ1ZhbHVlKTtcbiAgfVxufTtcblxuLyoqXG4gKiBEZWxldGUgSFRUUCBwcm94eSBpbiBkZXZpY2UgZ2xvYmFsIHNldHRpbmdzLlxuICogUmVib290aW5nIHRoZSB0ZXN0IGRldmljZSBpcyBuZWNlc3NhcnkgdG8gYXBwbHkgdGhlIGNoYW5nZS5cbiAqL1xubWV0aG9kcy5kZWxldGVIdHRwUHJveHkgPSBhc3luYyBmdW5jdGlvbiBkZWxldGVIdHRwUHJveHkgKCkge1xuICBjb25zdCBodHRwUHJveHlTZXR0aW5zID0gW1xuICAgICdodHRwX3Byb3h5JyxcbiAgICAnZ2xvYmFsX2h0dHBfcHJveHlfaG9zdCcsXG4gICAgJ2dsb2JhbF9odHRwX3Byb3h5X3BvcnQnLFxuICAgICdnbG9iYWxfaHR0cF9wcm94eV9leGNsdXNpb25fbGlzdCcgLy8gYGdsb2JhbF9odHRwX3Byb3h5X2V4Y2x1c2lvbl9saXN0PWAgd2FzIGdlbmVyYXRlZCBieSBgc2V0dGluZ3MgZ2xvYmFsIGh0dG9fcHJveHkgeHh4eGBcbiAgXTtcbiAgZm9yIChjb25zdCBzZXR0aW5nIG9mIGh0dHBQcm94eVNldHRpbnMpIHtcbiAgICBhd2FpdCB0aGlzLnNoZWxsKFsnc2V0dGluZ3MnLCAnZGVsZXRlJywgJ2dsb2JhbCcsIHNldHRpbmddKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZXQgZGV2aWNlIHByb3BlcnR5LlxuICogW2FuZHJvaWQucHJvdmlkZXIuU2V0dGluZ3Nde0BsaW5rIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9hbmRyb2lkL3Byb3ZpZGVyL1NldHRpbmdzLmh0bWx9XG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWVzcGFjZSAtIG9uZSBvZiB7c3lzdGVtLCBzZWN1cmUsIGdsb2JhbH0sIGNhc2UtaW5zZW5zaXRpdmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gc2V0dGluZyAtIHByb3BlcnR5IG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHZhbHVlIC0gcHJvcGVydHkgdmFsdWUuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IGNvbW1hbmQgb3V0cHV0LlxuICovXG5tZXRob2RzLnNldFNldHRpbmcgPSBhc3luYyBmdW5jdGlvbiBzZXRTZXR0aW5nIChuYW1lc3BhY2UsIHNldHRpbmcsIHZhbHVlKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnc2V0dGluZ3MnLCAncHV0JywgbmFtZXNwYWNlLCBzZXR0aW5nLCB2YWx1ZV0pO1xufTtcblxuLyoqXG4gKiBHZXQgZGV2aWNlIHByb3BlcnR5LlxuICogW2FuZHJvaWQucHJvdmlkZXIuU2V0dGluZ3Nde0BsaW5rIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9hbmRyb2lkL3Byb3ZpZGVyL1NldHRpbmdzLmh0bWx9XG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWVzcGFjZSAtIG9uZSBvZiB7c3lzdGVtLCBzZWN1cmUsIGdsb2JhbH0sIGNhc2UtaW5zZW5zaXRpdmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gc2V0dGluZyAtIHByb3BlcnR5IG5hbWUuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IHByb3BlcnR5IHZhbHVlLlxuICovXG5tZXRob2RzLmdldFNldHRpbmcgPSBhc3luYyBmdW5jdGlvbiBnZXRTZXR0aW5nIChuYW1lc3BhY2UsIHNldHRpbmcpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydzZXR0aW5ncycsICdnZXQnLCBuYW1lc3BhY2UsIHNldHRpbmddKTtcbn07XG5cbi8qKlxuICogUmV0cmlldmUgdGhlIGBhZGIgYnVncmVwb3J0YCBjb21tYW5kIG91dHB1dC4gVGhpc1xuICogb3BlcmF0aW9uIG1heSB0YWtlIHVwIHRvIHNldmVyYWwgbWludXRlcy5cbiAqXG4gKiBAcGFyYW0gez9udW1iZXJ9IHRpbWVvdXQgWzEyMDAwMF0gLSBDb21tYW5kIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBDb21tYW5kIHN0ZG91dFxuICovXG5tZXRob2RzLmJ1Z3JlcG9ydCA9IGFzeW5jIGZ1bmN0aW9uIGJ1Z3JlcG9ydCAodGltZW91dCA9IDEyMDAwMCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5hZGJFeGVjKFsnYnVncmVwb3J0J10sIHt0aW1lb3V0fSk7XG59O1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IFNjcmVlbnJlY29yZE9wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7P3N0cmluZ30gdmlkZW9TaXplIC0gVGhlIGZvcm1hdCBpcyB3aWR0aHhoZWlnaHQuXG4gKiAgICAgICAgICAgICAgICAgIFRoZSBkZWZhdWx0IHZhbHVlIGlzIHRoZSBkZXZpY2UncyBuYXRpdmUgZGlzcGxheSByZXNvbHV0aW9uIChpZiBzdXBwb3J0ZWQpLFxuICogICAgICAgICAgICAgICAgICAxMjgweDcyMCBpZiBub3QuIEZvciBiZXN0IHJlc3VsdHMsXG4gKiAgICAgICAgICAgICAgICAgIHVzZSBhIHNpemUgc3VwcG9ydGVkIGJ5IHlvdXIgZGV2aWNlJ3MgQWR2YW5jZWQgVmlkZW8gQ29kaW5nIChBVkMpIGVuY29kZXIuXG4gKiAgICAgICAgICAgICAgICAgIEZvciBleGFtcGxlLCBcIjEyODB4NzIwXCJcbiAqIEBwcm9wZXJ0eSB7P2Jvb2xlYW59IGJ1Z1JlcG9ydCAtIFNldCBpdCB0byBgdHJ1ZWAgaW4gb3JkZXIgdG8gZGlzcGxheSBhZGRpdGlvbmFsIGluZm9ybWF0aW9uIG9uIHRoZSB2aWRlbyBvdmVybGF5LFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjaCBhcyBhIHRpbWVzdGFtcCwgdGhhdCBpcyBoZWxwZnVsIGluIHZpZGVvcyBjYXB0dXJlZCB0byBpbGx1c3RyYXRlIGJ1Z3MuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGlzIG9wdGlvbiBpcyBvbmx5IHN1cHBvcnRlZCBzaW5jZSBBUEkgbGV2ZWwgMjcgKEFuZHJvaWQgUCkuXG4gKiBAcHJvcGVydHkgez9zdHJpbmd8bnVtYmVyfSB0aW1lTGltaXQgLSBUaGUgbWF4aW11bSByZWNvcmRpbmcgdGltZSwgaW4gc2Vjb25kcy5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoZSBkZWZhdWx0IChhbmQgbWF4aW11bSkgdmFsdWUgaXMgMTgwICgzIG1pbnV0ZXMpLlxuICogQHByb3BlcnR5IHs/c3RyaW5nfG51bWJlcn0gYml0UmF0ZSAtIFRoZSB2aWRlbyBiaXQgcmF0ZSBmb3IgdGhlIHZpZGVvLCBpbiBtZWdhYml0cyBwZXIgc2Vjb25kLlxuICogICAgICAgICAgICAgICAgVGhlIGRlZmF1bHQgdmFsdWUgaXMgNC4gWW91IGNhbiBpbmNyZWFzZSB0aGUgYml0IHJhdGUgdG8gaW1wcm92ZSB2aWRlbyBxdWFsaXR5LFxuICogICAgICAgICAgICAgICAgYnV0IGRvaW5nIHNvIHJlc3VsdHMgaW4gbGFyZ2VyIG1vdmllIGZpbGVzLlxuICovXG5cbi8qKlxuICogSW5pdGlhdGUgc2NyZWVucmVjb3JkIHV0aWxpdHkgb24gdGhlIGRldmljZVxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBkZXN0aW5hdGlvbiAtIEZ1bGwgcGF0aCB0byB0aGUgd3JpdGFibGUgbWVkaWEgZmlsZSBkZXN0aW5hdGlvblxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb24gdGhlIGRldmljZSBmaWxlIHN5c3RlbS5cbiAqIEBwYXJhbSB7P1NjcmVlbnJlY29yZE9wdGlvbnN9IG9wdGlvbnMgW3t9XVxuICogQHJldHVybnMge1N1YlByb2Nlc3N9IHNjcmVlbnJlY29yZCBwcm9jZXNzLCB3aGljaCBjYW4gYmUgdGhlbiBjb250cm9sbGVkIGJ5IHRoZSBjbGllbnQgY29kZVxuICovXG5tZXRob2RzLnNjcmVlbnJlY29yZCA9IGZ1bmN0aW9uIHNjcmVlbnJlY29yZCAoZGVzdGluYXRpb24sIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBjbWQgPSBbJ3NjcmVlbnJlY29yZCddO1xuICBjb25zdCB7XG4gICAgdmlkZW9TaXplLFxuICAgIGJpdFJhdGUsXG4gICAgdGltZUxpbWl0LFxuICAgIGJ1Z1JlcG9ydCxcbiAgfSA9IG9wdGlvbnM7XG4gIGlmICh1dGlsLmhhc1ZhbHVlKHZpZGVvU2l6ZSkpIHtcbiAgICBjbWQucHVzaCgnLS1zaXplJywgdmlkZW9TaXplKTtcbiAgfVxuICBpZiAodXRpbC5oYXNWYWx1ZSh0aW1lTGltaXQpKSB7XG4gICAgY21kLnB1c2goJy0tdGltZS1saW1pdCcsIHRpbWVMaW1pdCk7XG4gIH1cbiAgaWYgKHV0aWwuaGFzVmFsdWUoYml0UmF0ZSkpIHtcbiAgICBjbWQucHVzaCgnLS1iaXQtcmF0ZScsIGJpdFJhdGUpO1xuICB9XG4gIGlmIChidWdSZXBvcnQpIHtcbiAgICBjbWQucHVzaCgnLS1idWdyZXBvcnQnKTtcbiAgfVxuICBjbWQucHVzaChkZXN0aW5hdGlvbik7XG5cbiAgY29uc3QgZnVsbENtZCA9IFtcbiAgICAuLi50aGlzLmV4ZWN1dGFibGUuZGVmYXVsdEFyZ3MsXG4gICAgJ3NoZWxsJyxcbiAgICAuLi5jbWRcbiAgXTtcbiAgbG9nLmRlYnVnKGBCdWlsZGluZyBzY3JlZW5yZWNvcmQgcHJvY2VzcyB3aXRoIHRoZSBjb21tYW5kIGxpbmU6IGFkYiAke3F1b3RlKGZ1bGxDbWQpfWApO1xuICByZXR1cm4gbmV3IFN1YlByb2Nlc3ModGhpcy5leGVjdXRhYmxlLnBhdGgsIGZ1bGxDbWQpO1xufTtcblxuLyoqXG4gKiBFeGVjdXRlcyB0aGUgZ2l2ZW4gZnVuY3Rpb24gd2l0aCB0aGUgZ2l2ZW4gaW5wdXQgbWV0aG9kIGNvbnRleHRcbiAqIGFuZCB0aGVuIHJlc3RvcmVzIHRoZSBJTUUgdG8gdGhlIG9yaWdpbmFsIHZhbHVlXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGltZSAtIFZhbGlkIElNRSBpZGVudGlmaWVyXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiAtIEZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIHsqfSBUaGUgcmVzdWx0IG9mIHRoZSBnaXZlbiBmdW5jdGlvblxuICovXG5tZXRob2RzLnJ1bkluSW1lQ29udGV4dCA9IGFzeW5jIGZ1bmN0aW9uIHJ1bkluSW1lQ29udGV4dCAoaW1lLCBmbikge1xuICBjb25zdCBvcmlnaW5hbEltZSA9IGF3YWl0IHRoaXMuZGVmYXVsdElNRSgpO1xuICBpZiAob3JpZ2luYWxJbWUgPT09IGltZSkge1xuICAgIGxvZy5kZWJ1ZyhgVGhlIG9yaWdpbmFsIElNRSBpcyB0aGUgc2FtZSBhcyAnJHtpbWV9Jy4gVGhlcmUgaXMgbm8gbmVlZCB0byByZXNldCBpdGApO1xuICB9IGVsc2Uge1xuICAgIGF3YWl0IHRoaXMuc2V0SU1FKGltZSk7XG4gIH1cbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgZm4oKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBpZiAob3JpZ2luYWxJbWUgIT09IGltZSkge1xuICAgICAgYXdhaXQgdGhpcy5zZXRJTUUob3JpZ2luYWxJbWUpO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBQZXJmb3JtcyB0aGUgZ2l2ZW4gZWRpdG9yIGFjdGlvbiBvbiB0aGUgZm9jdXNlZCBpbnB1dCBmaWVsZC5cbiAqIFRoaXMgbWV0aG9kIHJlcXVpcmVzIEFwcGl1bSBTZXR0aW5ncyBoZWxwZXIgdG8gYmUgaW5zdGFsbGVkIG9uIHRoZSBkZXZpY2UuXG4gKiBObyBleGNlcHRpb24gaXMgdGhyb3duIGlmIHRoZXJlIHdhcyBhIGZhaWx1cmUgd2hpbGUgcGVyZm9ybWluZyB0aGUgYWN0aW9uLlxuICogWW91IG11c3QgaW52ZXN0aWdhdGUgdGhlIGxvZ2NhdCBvdXRwdXQgaWYgc29tZXRoaW5nIGRpZCBub3Qgd29yayBhcyBleHBlY3RlZC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IGFjdGlvbiAtIEVpdGhlciBhY3Rpb24gY29kZSBvciBuYW1lLiBUaGUgZm9sbG93aW5nIGFjdGlvblxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lcyBhcmUgc3VwcG9ydGVkOiBgbm9ybWFsLCB1bnNwZWNpZmllZCwgbm9uZSxcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZ28sIHNlYXJjaCwgc2VuZCwgbmV4dCwgZG9uZSwgcHJldmlvdXNgXG4gKi9cbm1ldGhvZHMucGVyZm9ybUVkaXRvckFjdGlvbiA9IGFzeW5jIGZ1bmN0aW9uIHBlcmZvcm1FZGl0b3JBY3Rpb24gKGFjdGlvbikge1xuICBsb2cuZGVidWcoYFBlcmZvcm1pbmcgZWRpdG9yIGFjdGlvbjogJHthY3Rpb259YCk7XG4gIGF3YWl0IHRoaXMucnVuSW5JbWVDb250ZXh0KEFQUElVTV9JTUUsXG4gICAgYXN5bmMgKCkgPT4gYXdhaXQgdGhpcy5zaGVsbChbJ2lucHV0JywgJ3RleHQnLCBgLyR7YWN0aW9ufS9gXSkpO1xufTtcblxuLyoqXG4gKiBHZXQgdHogZGF0YWJhc2UgdGltZSB6b25lIGZvcm1hdHRlZCB0aW1lem9uZVxuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9IFRaIGRhdGFiYXNlIFRpbWUgWm9uZXMgZm9ybWF0XG4gKlxuICogQHRocm93cyB7ZXJyb3J9IElmIGFueSBleGNlcHRpb24gaXMgcmVwb3J0ZWQgYnkgYWRiIHNoZWxsLlxuICovXG5tZXRob2RzLmdldFRpbWVab25lID0gYXN5bmMgZnVuY3Rpb24gZ2V0VGltZVpvbmUgKCkge1xuICBsb2cuZGVidWcoJ0dldHRpbmcgY3VycmVudCB0aW1lem9uZScpO1xuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdwZXJzaXN0LnN5cy50aW1lem9uZScpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBnZXR0aW5nIHRpbWV6b25lLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogUmV0cmlldmVzIHRoZSB0ZXh0IGNvbnRlbnQgb2YgdGhlIGRldmljZSdzIGNsaXBib2FyZC5cbiAqIFRoZSBtZXRob2Qgd29ya3MgZm9yIEFuZHJvaWQgYmVsb3cgYW5kIGFib3ZlIDI5LlxuICogSXQgdGVtb3JhcmlseSBlbmZvcmNlcyB0aGUgSU1FIHNldHRpbmcgaW4gb3JkZXIgdG8gd29ya2Fyb3VuZFxuICogc2VjdXJpdHkgbGltaXRhdGlvbnMgaWYgbmVlZGVkLlxuICogVGhpcyBtZXRob2Qgb25seSB3b3JrcyBpZiBBcHBpdW0gU2V0dGluZ3Mgdi4gMi4xNSsgaXMgaW5zdGFsbGVkXG4gKiBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3RcbiAqXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgYWN0dWFsIGNvbnRlbnQgb2YgdGhlIG1haW4gY2xpcGJvYXJkIGFzXG4gKiBiYXNlNjQtZW5jb2RlZCBzdHJpbmcgb3IgYW4gZW1wdHkgc3RyaW5nIGlmIHRoZSBjbGlwYm9hcmQgaXMgZW1wdHlcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGVyZSB3YXMgYSBwcm9ibGVtIHdoaWxlIGdldHRpbmcgdGhlXG4gKiBjbGlwYm9hcmQgY29udGFudFxuICovXG5tZXRob2RzLmdldENsaXBib2FyZCA9IGFzeW5jIGZ1bmN0aW9uIGdldENsaXBib2FyZCAoKSB7XG4gIGxvZy5kZWJ1ZygnR2V0dGluZyB0aGUgY2xpcGJvYXJkIGNvbnRlbnQnKTtcbiAgY29uc3QgcmV0cmlldmVDbGlwYm9hcmQgPSBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLnNoZWxsKFtcbiAgICAnYW0nLCAnYnJvYWRjYXN0JyxcbiAgICAnLW4nLCBDTElQQk9BUkRfUkVDRUlWRVIsXG4gICAgJy1hJywgQ0xJUEJPQVJEX1JFVFJJRVZBTF9BQ1RJT04sXG4gIF0pO1xuICBsZXQgb3V0cHV0O1xuICB0cnkge1xuICAgIG91dHB1dCA9IChhd2FpdCB0aGlzLmdldEFwaUxldmVsKCkgPj0gMjkpXG4gICAgICA/IChhd2FpdCB0aGlzLnJ1bkluSW1lQ29udGV4dChBUFBJVU1fSU1FLCByZXRyaWV2ZUNsaXBib2FyZCkpXG4gICAgICA6IChhd2FpdCByZXRyaWV2ZUNsaXBib2FyZCgpKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0cmlldmUgdGhlIGN1cnJlbnQgY2xpcGJvYXJkIGNvbnRlbnQgZnJvbSB0aGUgZGV2aWNlLiBgICtcbiAgICAgIGBNYWtlIHN1cmUgdGhlIEFwcGl1bSBTZXR0aW5ncyBhcHBsaWNhdGlvbiBpcyB1cCB0byBkYXRlLiBgICtcbiAgICAgIGBPcmlnaW5hbCBlcnJvcjogJHtlcnIubWVzc2FnZX1gKTtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoID0gL2RhdGE9XCIoW15cIl0qKVwiLy5leGVjKG91dHB1dCk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBwYXJzZSB0aGUgYWN0dWFsIGNsaWJvYXJkIGNvbnRlbnQgZnJvbSB0aGUgY29tbWFuZCBvdXRwdXQ6ICR7b3V0cHV0fWApO1xuICB9XG4gIHJldHVybiBfLnRyaW0obWF0Y2hbMV0pO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgbWV0aG9kcztcbiJdLCJmaWxlIjoibGliL3Rvb2xzL2FkYi1jb21tYW5kcy5qcyIsInNvdXJjZVJvb3QiOiIuLi8uLi8uLiJ9
