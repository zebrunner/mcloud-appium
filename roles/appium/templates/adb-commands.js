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
const APPIUM_IME = `${SETTINGS_HELPER_ID}/.AppiumIME`;
const MAX_SHELL_BUFFER_LENGTH = 1000;
const NOT_CHANGEABLE_PERM_ERROR = 'not a changeable permission type';
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
      if (!e.message.includes(NOT_CHANGEABLE_PERM_ERROR)) {
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
  } catch (error) {
    if (!error.message.includes(NOT_CHANGEABLE_PERM_ERROR)) {
      throw error;
    }
  }
};

methods.revokePermission = async function revokePermission(pkg, permission) {
  try {
    await this.shell(['pm', 'revoke', pkg, permission]);
  } catch (error) {
    if (!error.message.includes(NOT_CHANGEABLE_PERM_ERROR)) {
      throw error;
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

methods.performEditorAction = async function performEditorAction(action) {
  _logger.default.debug(`Performing editor action: ${action}`);

  const defaultIME = await this.defaultIME();
  await this.enableIME(APPIUM_IME);

  try {
    await this.setIME(APPIUM_IME);
    await this.shell(['input', 'text', `/${action}/`]);
  } finally {
    await this.setIME(defaultIME);
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

var _default = methods;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi90b29scy9hZGItY29tbWFuZHMuanMiXSwibmFtZXMiOlsiU0VUVElOR1NfSEVMUEVSX0lEIiwiV0lGSV9DT05ORUNUSU9OX1NFVFRJTkdfUkVDRUlWRVIiLCJXSUZJX0NPTk5FQ1RJT05fU0VUVElOR19BQ1RJT04iLCJEQVRBX0NPTk5FQ1RJT05fU0VUVElOR19SRUNFSVZFUiIsIkRBVEFfQ09OTkVDVElPTl9TRVRUSU5HX0FDVElPTiIsIkFOSU1BVElPTl9TRVRUSU5HX1JFQ0VJVkVSIiwiQU5JTUFUSU9OX1NFVFRJTkdfQUNUSU9OIiwiTE9DQUxFX1NFVFRJTkdfUkVDRUlWRVIiLCJMT0NBTEVfU0VUVElOR19BQ1RJT04iLCJMT0NBVElPTl9TRVJWSUNFIiwiTE9DQVRJT05fUkVDRUlWRVIiLCJMT0NBVElPTl9SRVRSSUVWQUxfQUNUSU9OIiwiQVBQSVVNX0lNRSIsIk1BWF9TSEVMTF9CVUZGRVJfTEVOR1RIIiwiTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUiIsIm1ldGhvZHMiLCJnZXRBZGJXaXRoQ29ycmVjdEFkYlBhdGgiLCJleGVjdXRhYmxlIiwicGF0aCIsImdldFNka0JpbmFyeVBhdGgiLCJhZGIiLCJpbml0QWFwdCIsImluaXRBYXB0MiIsImluaXRaaXBBbGlnbiIsImluaXRCdW5kbGV0b29sIiwiYmluYXJpZXMiLCJidW5kbGV0b29sIiwiZnMiLCJ3aGljaCIsImVyciIsIkVycm9yIiwiZ2V0QXBpTGV2ZWwiLCJfIiwiaXNJbnRlZ2VyIiwiX2FwaUxldmVsIiwic3RyT3V0cHV0IiwiZ2V0RGV2aWNlUHJvcGVydHkiLCJhcGlMZXZlbCIsInBhcnNlSW50IiwidHJpbSIsInRvTG93ZXJDYXNlIiwibG9nIiwiZGVidWciLCJpc05hTiIsImUiLCJtZXNzYWdlIiwiZ2V0UGxhdGZvcm1WZXJzaW9uIiwiaW5mbyIsImlzRGV2aWNlQ29ubmVjdGVkIiwiZGV2aWNlcyIsImdldENvbm5lY3RlZERldmljZXMiLCJsZW5ndGgiLCJta2RpciIsInJlbW90ZVBhdGgiLCJzaGVsbCIsImlzVmFsaWRDbGFzcyIsImNsYXNzU3RyaW5nIiwiUmVnRXhwIiwiZXhlYyIsImZvcmNlU3RvcCIsInBrZyIsImtpbGxQYWNrYWdlIiwiY2xlYXIiLCJncmFudEFsbFBlcm1pc3Npb25zIiwiYXBrIiwidGFyZ2V0U2RrIiwiZHVtcHN5c091dHB1dCIsInRhcmdldFNka1ZlcnNpb25Vc2luZ1BLRyIsInRhcmdldFNka1ZlcnNpb25Gcm9tTWFuaWZlc3QiLCJ3YXJuIiwicmVxdWVzdGVkUGVybWlzc2lvbnMiLCJnZXRSZXFQZXJtaXNzaW9ucyIsImdyYW50ZWRQZXJtaXNzaW9ucyIsImdldEdyYW50ZWRQZXJtaXNzaW9ucyIsInBlcm1pc3Npb25zVG9HcmFudCIsImRpZmZlcmVuY2UiLCJpc0VtcHR5IiwiZ3JhbnRQZXJtaXNzaW9ucyIsInBlcm1pc3Npb25zIiwiSlNPTiIsInN0cmluZ2lmeSIsImNvbW1hbmRzIiwiY21kQ2h1bmsiLCJwZXJtaXNzaW9uIiwibmV4dENtZCIsImpvaW4iLCJwdXNoIiwibGFzdEVycm9yIiwiY21kIiwiaW5jbHVkZXMiLCJncmFudFBlcm1pc3Npb24iLCJlcnJvciIsInJldm9rZVBlcm1pc3Npb24iLCJjbWRPdXRwdXQiLCJzdGRvdXQiLCJnZXREZW5pZWRQZXJtaXNzaW9ucyIsImdldExvY2F0aW9uUHJvdmlkZXJzIiwiZ2V0U2V0dGluZyIsInNwbGl0IiwibWFwIiwicCIsImZpbHRlciIsIkJvb2xlYW4iLCJ0b2dnbGVHUFNMb2NhdGlvblByb3ZpZGVyIiwiZW5hYmxlZCIsInNldFNldHRpbmciLCJzZXRIaWRkZW5BcGlQb2xpY3kiLCJ2YWx1ZSIsInNldERlZmF1bHRIaWRkZW5BcGlQb2xpY3kiLCJzdG9wQW5kQ2xlYXIiLCJhdmFpbGFibGVJTUVzIiwiZW5hYmxlZElNRXMiLCJlbmFibGVJTUUiLCJpbWVJZCIsImRpc2FibGVJTUUiLCJzZXRJTUUiLCJkZWZhdWx0SU1FIiwiZW5naW5lIiwia2V5ZXZlbnQiLCJrZXljb2RlIiwiY29kZSIsImlucHV0VGV4dCIsInRleHQiLCJyZXBsYWNlIiwiY2xlYXJUZXh0RmllbGQiLCJhcmdzIiwiaSIsImxvY2siLCJpc1NjcmVlbkxvY2tlZCIsInRpbWVvdXRNcyIsIndhaXRNcyIsImludGVydmFsTXMiLCJiYWNrIiwiZ29Ub0hvbWUiLCJnZXRBZGJQYXRoIiwiZ2V0U2NyZWVuT3JpZW50YXRpb24iLCJwcm9jZXNzIiwiZW52IiwiQVBQSVVNX0xPR19EVU1QU1lTIiwiZHVtcHN5c0ZpbGUiLCJyZXNvbHZlIiwiY3dkIiwid3JpdGVGaWxlIiwiaXNTb2Z0S2V5Ym9hcmRQcmVzZW50IiwiaW5wdXRTaG93bk1hdGNoIiwiaW5wdXRWaWV3U2hvd25NYXRjaCIsImlzS2V5Ym9hcmRTaG93biIsImNhbkNsb3NlS2V5Ym9hcmQiLCJzZW5kVGVsbmV0Q29tbWFuZCIsImNvbW1hbmQiLCJwb3J0IiwiZ2V0RW11bGF0b3JQb3J0IiwiQiIsInJlamVjdCIsImNvbm4iLCJuZXQiLCJjcmVhdGVDb25uZWN0aW9uIiwiY29ubmVjdGVkIiwicmVhZHlSZWdleCIsImRhdGFTdHJlYW0iLCJyZXMiLCJvbiIsImRhdGEiLCJ0b1N0cmluZyIsInRlc3QiLCJ3cml0ZSIsImxhc3QiLCJpc0FpcnBsYW5lTW9kZU9uIiwic2V0QWlycGxhbmVNb2RlIiwiYnJvYWRjYXN0QWlycGxhbmVNb2RlIiwiaXNXaWZpT24iLCJzZXRXaWZpU3RhdGUiLCJpc0VtdWxhdG9yIiwicHJpdmlsZWdlZCIsImlzRGF0YU9uIiwic2V0RGF0YVN0YXRlIiwic2V0V2lmaUFuZERhdGEiLCJ3aWZpIiwidXRpbCIsImhhc1ZhbHVlIiwic2V0QW5pbWF0aW9uU3RhdGUiLCJpc0FuaW1hdGlvbk9uIiwiYW5pbWF0b3JfZHVyYXRpb25fc2NhbGUiLCJ0cmFuc2l0aW9uX2FuaW1hdGlvbl9zY2FsZSIsIndpbmRvd19hbmltYXRpb25fc2NhbGUiLCJzb21lIiwic2V0dGluZyIsInNldERldmljZVN5c0xvY2FsZVZpYVNldHRpbmdBcHAiLCJsYW5ndWFnZSIsImNvdW50cnkiLCJzY3JpcHQiLCJwYXJhbXMiLCJ0b1VwcGVyQ2FzZSIsInNldEdlb0xvY2F0aW9uIiwibG9jYXRpb24iLCJmb3JtYXRMb2NhdGlvblZhbHVlIiwidmFsdWVOYW1lIiwiaXNSZXF1aXJlZCIsImZsb2F0VmFsdWUiLCJwYXJzZUZsb2F0IiwiY2VpbCIsImxvbmdpdHVkZSIsImxhdGl0dWRlIiwiYWx0aXR1ZGUiLCJyZXNldFRlbG5ldEF1dGhUb2tlbiIsImFkYkV4ZWMiLCJnZXRHZW9Mb2NhdGlvbiIsIm91dHB1dCIsIm1hdGNoIiwicmltcmFmIiwibG9jYWxQYXRoIiwib3B0cyIsInBvc2l4IiwiZGlybmFtZSIsInB1bGwiLCJ0aW1lb3V0IiwicHJvY2Vzc0V4aXN0cyIsInByb2Nlc3NOYW1lIiwiZ2V0UElEc0J5TmFtZSIsImdldEZvcndhcmRMaXN0IiwiY29ubmVjdGlvbnMiLCJFT0wiLCJsaW5lIiwiZm9yd2FyZFBvcnQiLCJzeXN0ZW1Qb3J0IiwiZGV2aWNlUG9ydCIsInJlbW92ZVBvcnRGb3J3YXJkIiwiZ2V0UmV2ZXJzZUxpc3QiLCJyZXZlcnNlUG9ydCIsInJlbW92ZVBvcnRSZXZlcnNlIiwiZm9yd2FyZEFic3RyYWN0UG9ydCIsInBpbmciLCJpbmRleE9mIiwicmVzdGFydCIsInN0b3BMb2djYXQiLCJyZXN0YXJ0QWRiIiwid2FpdEZvckRldmljZSIsInN0YXJ0TG9nY2F0IiwibG9nY2F0IiwiTG9nY2F0IiwiZGVidWdUcmFjZSIsImNsZWFyRGV2aWNlTG9nc09uU3RhcnQiLCJzdGFydENhcHR1cmUiLCJzdG9wQ2FwdHVyZSIsImdldExvZ2NhdExvZ3MiLCJnZXRMb2dzIiwic2V0TG9nY2F0TGlzdGVuZXIiLCJsaXN0ZW5lciIsInJlbW92ZUxvZ2NhdExpc3RlbmVyIiwicmVtb3ZlTGlzdGVuZXIiLCJuYW1lIiwiaXNCb29sZWFuIiwiX2lzUGdyZXBBdmFpbGFibGUiLCJwZ3JlcE91dHB1dCIsIl9jYW5QZ3JlcFVzZUZ1bGxDbWRMaW5lU2VhcmNoIiwiX2lzUGlkb2ZBdmFpbGFibGUiLCJzaGVsbENvbW1hbmQiLCJlc2NhcGVSZWdFeHAiLCJzbGljZSIsIngiLCJwaWRDb2x1bW5UaXRsZSIsInByb2Nlc3NOYW1lQ29sdW1uVGl0bGUiLCJ0aXRsZU1hdGNoIiwiYWxsVGl0bGVzIiwicGlkSW5kZXgiLCJwaWRzIiwicHJvY2Vzc05hbWVSZWdleCIsIm1hdGNoZWRMaW5lIiwiaXRlbXMiLCJraWxsUHJvY2Vzc2VzQnlOYW1lIiwicGlkIiwia2lsbFByb2Nlc3NCeVBJRCIsIndhc1Jvb3QiLCJiZWNhbWVSb290IiwiaXNSb290IiwiaWduIiwiaXNTdWNjZXNzZnVsIiwicm9vdCIsInVucm9vdCIsImJyb2FkY2FzdFByb2Nlc3NFbmQiLCJpbnRlbnQiLCJicm9hZGNhc3QiLCJzdGFydCIsIkRhdGUiLCJub3ciLCJlbmRBbmRyb2lkQ292ZXJhZ2UiLCJpbnN0cnVtZW50UHJvYyIsImlzUnVubmluZyIsInN0b3AiLCJpbnN0cnVtZW50IiwiYWN0aXZpdHkiLCJpbnN0cnVtZW50V2l0aCIsInBrZ0FjdGl2aXR5IiwiYW5kcm9pZENvdmVyYWdlIiwiaW5zdHJ1bWVudENsYXNzIiwid2FpdFBrZyIsIndhaXRBY3Rpdml0eSIsImRlZmF1bHRBcmdzIiwiY29uY2F0IiwiU3ViUHJvY2VzcyIsInN0ZGVyciIsIndhaXRGb3JBY3Rpdml0eSIsInByb3BlcnR5IiwidmFsIiwic2V0RGV2aWNlUHJvcGVydHkiLCJwcm9wIiwiZ2V0RGV2aWNlU3lzTGFuZ3VhZ2UiLCJnZXREZXZpY2VTeXNDb3VudHJ5IiwiZ2V0RGV2aWNlU3lzTG9jYWxlIiwiZ2V0RGV2aWNlUHJvZHVjdExhbmd1YWdlIiwiZ2V0RGV2aWNlUHJvZHVjdENvdW50cnkiLCJnZXREZXZpY2VQcm9kdWN0TG9jYWxlIiwiZ2V0TW9kZWwiLCJnZXRNYW51ZmFjdHVyZXIiLCJnZXRTY3JlZW5TaXplIiwic2l6ZSIsImdldFNjcmVlbkRlbnNpdHkiLCJkZW5zaXR5IiwiZGVuc2l0eU51bWJlciIsInNldEh0dHBQcm94eSIsInByb3h5SG9zdCIsInByb3h5UG9ydCIsInByb3h5IiwiaXNVbmRlZmluZWQiLCJodHRwUHJveHlTZXR0aW5zIiwic2V0dGluZ0tleSIsInNldHRpbmdWYWx1ZSIsImRlbGV0ZUh0dHBQcm94eSIsIm5hbWVzcGFjZSIsImJ1Z3JlcG9ydCIsInNjcmVlbnJlY29yZCIsImRlc3RpbmF0aW9uIiwib3B0aW9ucyIsInZpZGVvU2l6ZSIsImJpdFJhdGUiLCJ0aW1lTGltaXQiLCJidWdSZXBvcnQiLCJmdWxsQ21kIiwicGVyZm9ybUVkaXRvckFjdGlvbiIsImFjdGlvbiIsImdldFRpbWVab25lIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUVBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUdBLE1BQU1BLGtCQUFrQixHQUFHLG9CQUEzQjtBQUNBLE1BQU1DLGdDQUFnQyxHQUFJLEdBQUVELGtCQUFtQiwyQ0FBL0Q7QUFDQSxNQUFNRSw4QkFBOEIsR0FBSSxHQUFFRixrQkFBbUIsT0FBN0Q7QUFDQSxNQUFNRyxnQ0FBZ0MsR0FBSSxHQUFFSCxrQkFBbUIsMkNBQS9EO0FBQ0EsTUFBTUksOEJBQThCLEdBQUksR0FBRUosa0JBQW1CLGtCQUE3RDtBQUNBLE1BQU1LLDBCQUEwQixHQUFJLEdBQUVMLGtCQUFtQixzQ0FBekQ7QUFDQSxNQUFNTSx3QkFBd0IsR0FBSSxHQUFFTixrQkFBbUIsWUFBdkQ7QUFDQSxNQUFNTyx1QkFBdUIsR0FBSSxHQUFFUCxrQkFBbUIsbUNBQXREO0FBQ0EsTUFBTVEscUJBQXFCLEdBQUksR0FBRVIsa0JBQW1CLFNBQXBEO0FBQ0EsTUFBTVMsZ0JBQWdCLEdBQUksR0FBRVQsa0JBQW1CLG1CQUEvQztBQUNBLE1BQU1VLGlCQUFpQixHQUFJLEdBQUVWLGtCQUFtQixrQ0FBaEQ7QUFDQSxNQUFNVyx5QkFBeUIsR0FBSSxHQUFFWCxrQkFBbUIsV0FBeEQ7QUFDQSxNQUFNWSxVQUFVLEdBQUksR0FBRVosa0JBQW1CLGFBQXpDO0FBQ0EsTUFBTWEsdUJBQXVCLEdBQUcsSUFBaEM7QUFDQSxNQUFNQyx5QkFBeUIsR0FBRyxrQ0FBbEM7QUFFQSxJQUFJQyxPQUFPLEdBQUcsRUFBZDs7QUFRQUEsT0FBTyxDQUFDQyx3QkFBUixHQUFtQyxlQUFlQSx3QkFBZixHQUEyQztBQUM1RSxPQUFLQyxVQUFMLENBQWdCQyxJQUFoQixHQUF1QixNQUFNLEtBQUtDLGdCQUFMLENBQXNCLEtBQXRCLENBQTdCO0FBQ0EsU0FBTyxLQUFLQyxHQUFaO0FBQ0QsQ0FIRDs7QUFTQUwsT0FBTyxDQUFDTSxRQUFSLEdBQW1CLGVBQWVBLFFBQWYsR0FBMkI7QUFDNUMsUUFBTSxLQUFLRixnQkFBTCxDQUFzQixNQUF0QixDQUFOO0FBQ0QsQ0FGRDs7QUFRQUosT0FBTyxDQUFDTyxTQUFSLEdBQW9CLGVBQWVBLFNBQWYsR0FBNEI7QUFDOUMsUUFBTSxLQUFLSCxnQkFBTCxDQUFzQixPQUF0QixDQUFOO0FBQ0QsQ0FGRDs7QUFRQUosT0FBTyxDQUFDUSxZQUFSLEdBQXVCLGVBQWVBLFlBQWYsR0FBK0I7QUFDcEQsUUFBTSxLQUFLSixnQkFBTCxDQUFzQixVQUF0QixDQUFOO0FBQ0QsQ0FGRDs7QUFRQUosT0FBTyxDQUFDUyxjQUFSLEdBQXlCLGVBQWVBLGNBQWYsR0FBaUM7QUFDeEQsTUFBSTtBQUNGLFNBQUtDLFFBQUwsQ0FBY0MsVUFBZCxHQUEyQixNQUFNQyxrQkFBR0MsS0FBSCxDQUFTLGdCQUFULENBQWpDO0FBQ0QsR0FGRCxDQUVFLE9BQU9DLEdBQVAsRUFBWTtBQUNaLFVBQU0sSUFBSUMsS0FBSixDQUFVLDhEQUNkLDhEQURJLENBQU47QUFFRDtBQUNGLENBUEQ7O0FBZ0JBZixPQUFPLENBQUNnQixXQUFSLEdBQXNCLGVBQWVBLFdBQWYsR0FBOEI7QUFDbEQsTUFBSSxDQUFDQyxnQkFBRUMsU0FBRixDQUFZLEtBQUtDLFNBQWpCLENBQUwsRUFBa0M7QUFDaEMsUUFBSTtBQUNGLFlBQU1DLFNBQVMsR0FBRyxNQUFNLEtBQUtDLGlCQUFMLENBQXVCLHNCQUF2QixDQUF4QjtBQUNBLFVBQUlDLFFBQVEsR0FBR0MsUUFBUSxDQUFDSCxTQUFTLENBQUNJLElBQVYsRUFBRCxFQUFtQixFQUFuQixDQUF2Qjs7QUFHQSxVQUFJRixRQUFRLEtBQUssRUFBYixJQUFtQixDQUFDLE1BQU0sS0FBS0QsaUJBQUwsQ0FBdUIsMEJBQXZCLENBQVAsRUFBMkRJLFdBQTNELE9BQTZFLEdBQXBHLEVBQXlHO0FBQ3ZHQyx3QkFBSUMsS0FBSixDQUFVLHNFQUFWOztBQUNBTCxRQUFBQSxRQUFRLEdBQUcsRUFBWDtBQUNEOztBQUNELFdBQUtILFNBQUwsR0FBaUJHLFFBQWpCOztBQUNBSSxzQkFBSUMsS0FBSixDQUFXLHFCQUFvQixLQUFLUixTQUFVLEVBQTlDOztBQUNBLFVBQUlTLEtBQUssQ0FBQyxLQUFLVCxTQUFOLENBQVQsRUFBMkI7QUFDekIsY0FBTSxJQUFJSixLQUFKLENBQVcsc0JBQXFCSyxTQUFVLHFDQUExQyxDQUFOO0FBQ0Q7QUFDRixLQWRELENBY0UsT0FBT1MsQ0FBUCxFQUFVO0FBQ1YsWUFBTSxJQUFJZCxLQUFKLENBQVcsbURBQWtEYyxDQUFDLENBQUNDLE9BQVEsRUFBdkUsQ0FBTjtBQUNEO0FBQ0Y7O0FBQ0QsU0FBTyxLQUFLWCxTQUFaO0FBQ0QsQ0FyQkQ7O0FBNkJBbkIsT0FBTyxDQUFDK0Isa0JBQVIsR0FBNkIsZUFBZUEsa0JBQWYsR0FBcUM7QUFDaEVMLGtCQUFJTSxJQUFKLENBQVMsaUNBQVQ7O0FBQ0EsTUFBSTtBQUNGLFdBQU8sTUFBTSxLQUFLWCxpQkFBTCxDQUF1QiwwQkFBdkIsQ0FBYjtBQUNELEdBRkQsQ0FFRSxPQUFPUSxDQUFQLEVBQVU7QUFDVixVQUFNLElBQUlkLEtBQUosQ0FBVywwREFBeURjLENBQUMsQ0FBQ0MsT0FBUSxFQUE5RSxDQUFOO0FBQ0Q7QUFDRixDQVBEOztBQWNBOUIsT0FBTyxDQUFDaUMsaUJBQVIsR0FBNEIsZUFBZUEsaUJBQWYsR0FBb0M7QUFDOUQsTUFBSUMsT0FBTyxHQUFHLE1BQU0sS0FBS0MsbUJBQUwsRUFBcEI7QUFDQSxTQUFPRCxPQUFPLENBQUNFLE1BQVIsR0FBaUIsQ0FBeEI7QUFDRCxDQUhEOztBQVdBcEMsT0FBTyxDQUFDcUMsS0FBUixHQUFnQixlQUFlQSxLQUFmLENBQXNCQyxVQUF0QixFQUFrQztBQUNoRCxTQUFPLE1BQU0sS0FBS0MsS0FBTCxDQUFXLENBQUMsT0FBRCxFQUFVLElBQVYsRUFBZ0JELFVBQWhCLENBQVgsQ0FBYjtBQUNELENBRkQ7O0FBWUF0QyxPQUFPLENBQUN3QyxZQUFSLEdBQXVCLFNBQVNBLFlBQVQsQ0FBdUJDLFdBQXZCLEVBQW9DO0FBRXpELFNBQU8sSUFBSUMsTUFBSixDQUFXLG1CQUFYLEVBQWdDQyxJQUFoQyxDQUFxQ0YsV0FBckMsQ0FBUDtBQUNELENBSEQ7O0FBV0F6QyxPQUFPLENBQUM0QyxTQUFSLEdBQW9CLGVBQWVBLFNBQWYsQ0FBMEJDLEdBQTFCLEVBQStCO0FBQ2pELFNBQU8sTUFBTSxLQUFLTixLQUFMLENBQVcsQ0FBQyxJQUFELEVBQU8sWUFBUCxFQUFxQk0sR0FBckIsQ0FBWCxDQUFiO0FBQ0QsQ0FGRDs7QUFVQTdDLE9BQU8sQ0FBQzhDLFdBQVIsR0FBc0IsZUFBZUEsV0FBZixDQUE0QkQsR0FBNUIsRUFBaUM7QUFDckQsU0FBTyxNQUFNLEtBQUtOLEtBQUwsQ0FBVyxDQUFDLElBQUQsRUFBTyxNQUFQLEVBQWVNLEdBQWYsQ0FBWCxDQUFiO0FBQ0QsQ0FGRDs7QUFXQTdDLE9BQU8sQ0FBQytDLEtBQVIsR0FBZ0IsZUFBZUEsS0FBZixDQUFzQkYsR0FBdEIsRUFBMkI7QUFDekMsU0FBTyxNQUFNLEtBQUtOLEtBQUwsQ0FBVyxDQUFDLElBQUQsRUFBTyxPQUFQLEVBQWdCTSxHQUFoQixDQUFYLENBQWI7QUFDRCxDQUZEOztBQWFBN0MsT0FBTyxDQUFDZ0QsbUJBQVIsR0FBOEIsZUFBZUEsbUJBQWYsQ0FBb0NILEdBQXBDLEVBQXlDSSxHQUF6QyxFQUE4QztBQUMxRSxRQUFNM0IsUUFBUSxHQUFHLE1BQU0sS0FBS04sV0FBTCxFQUF2QjtBQUNBLE1BQUlrQyxTQUFTLEdBQUcsQ0FBaEI7QUFDQSxNQUFJQyxhQUFhLEdBQUcsSUFBcEI7O0FBQ0EsTUFBSTtBQUNGLFFBQUksQ0FBQ0YsR0FBTCxFQUFVO0FBS1JFLE1BQUFBLGFBQWEsR0FBRyxNQUFNLEtBQUtaLEtBQUwsQ0FBVyxDQUFDLFNBQUQsRUFBWSxTQUFaLEVBQXVCTSxHQUF2QixDQUFYLENBQXRCO0FBQ0FLLE1BQUFBLFNBQVMsR0FBRyxNQUFNLEtBQUtFLHdCQUFMLENBQThCUCxHQUE5QixFQUFtQ00sYUFBbkMsQ0FBbEI7QUFDRCxLQVBELE1BT087QUFDTEQsTUFBQUEsU0FBUyxHQUFHLE1BQU0sS0FBS0csNEJBQUwsQ0FBa0NKLEdBQWxDLENBQWxCO0FBQ0Q7QUFDRixHQVhELENBV0UsT0FBT3BCLENBQVAsRUFBVTtBQUVWSCxvQkFBSTRCLElBQUosQ0FBVSwwREFBVjtBQUNEOztBQUNELE1BQUloQyxRQUFRLElBQUksRUFBWixJQUFrQjRCLFNBQVMsSUFBSSxFQUFuQyxFQUF1QztBQU1yQ0MsSUFBQUEsYUFBYSxHQUFHQSxhQUFhLEtBQUksTUFBTSxLQUFLWixLQUFMLENBQVcsQ0FBQyxTQUFELEVBQVksU0FBWixFQUF1Qk0sR0FBdkIsQ0FBWCxDQUFWLENBQTdCO0FBQ0EsVUFBTVUsb0JBQW9CLEdBQUcsTUFBTSxLQUFLQyxpQkFBTCxDQUF1QlgsR0FBdkIsRUFBNEJNLGFBQTVCLENBQW5DO0FBQ0EsVUFBTU0sa0JBQWtCLEdBQUcsTUFBTSxLQUFLQyxxQkFBTCxDQUEyQmIsR0FBM0IsRUFBZ0NNLGFBQWhDLENBQWpDOztBQUNBLFVBQU1RLGtCQUFrQixHQUFHMUMsZ0JBQUUyQyxVQUFGLENBQWFMLG9CQUFiLEVBQW1DRSxrQkFBbkMsQ0FBM0I7O0FBQ0EsUUFBSXhDLGdCQUFFNEMsT0FBRixDQUFVRixrQkFBVixDQUFKLEVBQW1DO0FBQ2pDakMsc0JBQUlNLElBQUosQ0FBVSxHQUFFYSxHQUFJLGlEQUFoQjtBQUNELEtBRkQsTUFFTztBQUNMLFlBQU0sS0FBS2lCLGdCQUFMLENBQXNCakIsR0FBdEIsRUFBMkJjLGtCQUEzQixDQUFOO0FBQ0Q7QUFDRjtBQUNGLENBbkNEOztBQThDQTNELE9BQU8sQ0FBQzhELGdCQUFSLEdBQTJCLGVBQWVBLGdCQUFmLENBQWlDakIsR0FBakMsRUFBc0NrQixXQUF0QyxFQUFtRDtBQUs1RXJDLGtCQUFJQyxLQUFKLENBQVcsd0JBQXVCcUMsSUFBSSxDQUFDQyxTQUFMLENBQWVGLFdBQWYsQ0FBNEIsUUFBT2xCLEdBQUksR0FBekU7O0FBQ0EsUUFBTXFCLFFBQVEsR0FBRyxFQUFqQjtBQUNBLE1BQUlDLFFBQVEsR0FBRyxFQUFmOztBQUNBLE9BQUssTUFBTUMsVUFBWCxJQUF5QkwsV0FBekIsRUFBc0M7QUFDcEMsVUFBTU0sT0FBTyxHQUFHLENBQUMsSUFBRCxFQUFPLE9BQVAsRUFBZ0J4QixHQUFoQixFQUFxQnVCLFVBQXJCLEVBQWlDLEdBQWpDLENBQWhCOztBQUNBLFFBQUlDLE9BQU8sQ0FBQ0MsSUFBUixDQUFhLEdBQWIsRUFBa0JsQyxNQUFsQixHQUEyQitCLFFBQVEsQ0FBQ0csSUFBVCxDQUFjLEdBQWQsRUFBbUJsQyxNQUE5QyxJQUF3RHRDLHVCQUE1RCxFQUFxRjtBQUNuRm9FLE1BQUFBLFFBQVEsQ0FBQ0ssSUFBVCxDQUFjSixRQUFkO0FBQ0FBLE1BQUFBLFFBQVEsR0FBRyxFQUFYO0FBQ0Q7O0FBQ0RBLElBQUFBLFFBQVEsR0FBRyxDQUFDLEdBQUdBLFFBQUosRUFBYyxHQUFHRSxPQUFqQixDQUFYO0FBQ0Q7O0FBQ0QsTUFBSSxDQUFDcEQsZ0JBQUU0QyxPQUFGLENBQVVNLFFBQVYsQ0FBTCxFQUEwQjtBQUN4QkQsSUFBQUEsUUFBUSxDQUFDSyxJQUFULENBQWNKLFFBQWQ7QUFDRDs7QUFDRHpDLGtCQUFJQyxLQUFKLENBQVcsZ0RBQStDcUMsSUFBSSxDQUFDQyxTQUFMLENBQWVDLFFBQWYsQ0FBeUIsRUFBbkY7O0FBQ0EsTUFBSU0sU0FBUyxHQUFHLElBQWhCOztBQUNBLE9BQUssTUFBTUMsR0FBWCxJQUFrQlAsUUFBbEIsRUFBNEI7QUFDMUIsUUFBSTtBQUNGLFlBQU0sS0FBSzNCLEtBQUwsQ0FBV2tDLEdBQVgsQ0FBTjtBQUNELEtBRkQsQ0FFRSxPQUFPNUMsQ0FBUCxFQUFVO0FBR1YsVUFBSSxDQUFDQSxDQUFDLENBQUNDLE9BQUYsQ0FBVTRDLFFBQVYsQ0FBbUIzRSx5QkFBbkIsQ0FBTCxFQUFvRDtBQUNsRHlFLFFBQUFBLFNBQVMsR0FBRzNDLENBQVo7QUFDRDtBQUNGO0FBQ0Y7O0FBQ0QsTUFBSTJDLFNBQUosRUFBZTtBQUNiLFVBQU1BLFNBQU47QUFDRDtBQUNGLENBbkNEOztBQTRDQXhFLE9BQU8sQ0FBQzJFLGVBQVIsR0FBMEIsZUFBZUEsZUFBZixDQUFnQzlCLEdBQWhDLEVBQXFDdUIsVUFBckMsRUFBaUQ7QUFDekUsTUFBSTtBQUNGLFVBQU0sS0FBSzdCLEtBQUwsQ0FBVyxDQUFDLElBQUQsRUFBTyxPQUFQLEVBQWdCTSxHQUFoQixFQUFxQnVCLFVBQXJCLENBQVgsQ0FBTjtBQUNELEdBRkQsQ0FFRSxPQUFPUSxLQUFQLEVBQWM7QUFDZCxRQUFJLENBQUNBLEtBQUssQ0FBQzlDLE9BQU4sQ0FBYzRDLFFBQWQsQ0FBdUIzRSx5QkFBdkIsQ0FBTCxFQUF3RDtBQUN0RCxZQUFNNkUsS0FBTjtBQUNEO0FBQ0Y7QUFDRixDQVJEOztBQWlCQTVFLE9BQU8sQ0FBQzZFLGdCQUFSLEdBQTJCLGVBQWVBLGdCQUFmLENBQWlDaEMsR0FBakMsRUFBc0N1QixVQUF0QyxFQUFrRDtBQUMzRSxNQUFJO0FBQ0YsVUFBTSxLQUFLN0IsS0FBTCxDQUFXLENBQUMsSUFBRCxFQUFPLFFBQVAsRUFBaUJNLEdBQWpCLEVBQXNCdUIsVUFBdEIsQ0FBWCxDQUFOO0FBQ0QsR0FGRCxDQUVFLE9BQU9RLEtBQVAsRUFBYztBQUNkLFFBQUksQ0FBQ0EsS0FBSyxDQUFDOUMsT0FBTixDQUFjNEMsUUFBZCxDQUF1QjNFLHlCQUF2QixDQUFMLEVBQXdEO0FBQ3RELFlBQU02RSxLQUFOO0FBQ0Q7QUFDRjtBQUNGLENBUkQ7O0FBbUJBNUUsT0FBTyxDQUFDMEQscUJBQVIsR0FBZ0MsZUFBZUEscUJBQWYsQ0FBc0NiLEdBQXRDLEVBQTJDaUMsU0FBUyxHQUFHLElBQXZELEVBQTZEO0FBQzNGcEQsa0JBQUlDLEtBQUosQ0FBVSxnQ0FBVjs7QUFDQSxRQUFNb0QsTUFBTSxHQUFHRCxTQUFTLEtBQUksTUFBTSxLQUFLdkMsS0FBTCxDQUFXLENBQUMsU0FBRCxFQUFZLFNBQVosRUFBdUJNLEdBQXZCLENBQVgsQ0FBVixDQUF4QjtBQUNBLFNBQU8seUNBQTJCa0MsTUFBM0IsRUFBbUMsQ0FBQyxTQUFELEVBQVksU0FBWixDQUFuQyxFQUEyRCxJQUEzRCxDQUFQO0FBQ0QsQ0FKRDs7QUFjQS9FLE9BQU8sQ0FBQ2dGLG9CQUFSLEdBQStCLGVBQWVBLG9CQUFmLENBQXFDbkMsR0FBckMsRUFBMENpQyxTQUFTLEdBQUcsSUFBdEQsRUFBNEQ7QUFDekZwRCxrQkFBSUMsS0FBSixDQUFVLCtCQUFWOztBQUNBLFFBQU1vRCxNQUFNLEdBQUdELFNBQVMsS0FBSSxNQUFNLEtBQUt2QyxLQUFMLENBQVcsQ0FBQyxTQUFELEVBQVksU0FBWixFQUF1Qk0sR0FBdkIsQ0FBWCxDQUFWLENBQXhCO0FBQ0EsU0FBTyx5Q0FBMkJrQyxNQUEzQixFQUFtQyxDQUFDLFNBQUQsRUFBWSxTQUFaLENBQW5DLEVBQTJELEtBQTNELENBQVA7QUFDRCxDQUpEOztBQWNBL0UsT0FBTyxDQUFDd0QsaUJBQVIsR0FBNEIsZUFBZUEsaUJBQWYsQ0FBa0NYLEdBQWxDLEVBQXVDaUMsU0FBUyxHQUFHLElBQW5ELEVBQXlEO0FBQ25GcEQsa0JBQUlDLEtBQUosQ0FBVSxrQ0FBVjs7QUFDQSxRQUFNb0QsTUFBTSxHQUFHRCxTQUFTLEtBQUksTUFBTSxLQUFLdkMsS0FBTCxDQUFXLENBQUMsU0FBRCxFQUFZLFNBQVosRUFBdUJNLEdBQXZCLENBQVgsQ0FBVixDQUF4QjtBQUNBLFNBQU8seUNBQTJCa0MsTUFBM0IsRUFBbUMsQ0FBQyxXQUFELENBQW5DLENBQVA7QUFDRCxDQUpEOztBQVdBL0UsT0FBTyxDQUFDaUYsb0JBQVIsR0FBK0IsZUFBZUEsb0JBQWYsR0FBdUM7QUFDcEUsTUFBSUYsTUFBTSxHQUFHLE1BQU0sS0FBS0csVUFBTCxDQUFnQixRQUFoQixFQUEwQiw0QkFBMUIsQ0FBbkI7QUFDQSxTQUFPSCxNQUFNLENBQUN2RCxJQUFQLEdBQWMyRCxLQUFkLENBQW9CLEdBQXBCLEVBQ0pDLEdBREksQ0FDQ0MsQ0FBRCxJQUFPQSxDQUFDLENBQUM3RCxJQUFGLEVBRFAsRUFFSjhELE1BRkksQ0FFR0MsT0FGSCxDQUFQO0FBR0QsQ0FMRDs7QUFZQXZGLE9BQU8sQ0FBQ3dGLHlCQUFSLEdBQW9DLGVBQWVBLHlCQUFmLENBQTBDQyxPQUExQyxFQUFtRDtBQUNyRixRQUFNLEtBQUtDLFVBQUwsQ0FBZ0IsUUFBaEIsRUFBMEIsNEJBQTFCLEVBQXlELEdBQUVELE9BQU8sR0FBRyxHQUFILEdBQVMsR0FBSSxLQUEvRSxDQUFOO0FBQ0QsQ0FGRDs7QUEwQkF6RixPQUFPLENBQUMyRixrQkFBUixHQUE2QixlQUFlQSxrQkFBZixDQUFtQ0MsS0FBbkMsRUFBMEM7QUFDckUsUUFBTSxLQUFLRixVQUFMLENBQWdCLFFBQWhCLEVBQTBCLDhCQUExQixFQUEwREUsS0FBMUQsQ0FBTjtBQUNBLFFBQU0sS0FBS0YsVUFBTCxDQUFnQixRQUFoQixFQUEwQiwwQkFBMUIsRUFBc0RFLEtBQXRELENBQU47QUFDQSxRQUFNLEtBQUtGLFVBQUwsQ0FBZ0IsUUFBaEIsRUFBMEIsbUJBQTFCLEVBQStDRSxLQUEvQyxDQUFOO0FBQ0QsQ0FKRDs7QUFVQTVGLE9BQU8sQ0FBQzZGLHlCQUFSLEdBQW9DLGVBQWVBLHlCQUFmLEdBQTRDO0FBQzlFLFFBQU0sS0FBS3RELEtBQUwsQ0FBVyxDQUFDLFVBQUQsRUFBYSxRQUFiLEVBQXVCLFFBQXZCLEVBQWlDLDhCQUFqQyxDQUFYLENBQU47QUFDQSxRQUFNLEtBQUtBLEtBQUwsQ0FBVyxDQUFDLFVBQUQsRUFBYSxRQUFiLEVBQXVCLFFBQXZCLEVBQWlDLDBCQUFqQyxDQUFYLENBQU47QUFDQSxRQUFNLEtBQUtBLEtBQUwsQ0FBVyxDQUFDLFVBQUQsRUFBYSxRQUFiLEVBQXVCLFFBQXZCLEVBQWlDLG1CQUFqQyxDQUFYLENBQU47QUFDRCxDQUpEOztBQVdBdkMsT0FBTyxDQUFDOEYsWUFBUixHQUF1QixlQUFlQSxZQUFmLENBQTZCakQsR0FBN0IsRUFBa0M7QUFDdkQsTUFBSTtBQUNGLFVBQU0sS0FBS0QsU0FBTCxDQUFlQyxHQUFmLENBQU47QUFDQSxVQUFNLEtBQUtFLEtBQUwsQ0FBV0YsR0FBWCxDQUFOO0FBQ0QsR0FIRCxDQUdFLE9BQU9oQixDQUFQLEVBQVU7QUFDVixVQUFNLElBQUlkLEtBQUosQ0FBVyx5QkFBd0I4QixHQUFJLHFCQUFvQmhCLENBQUMsQ0FBQ0MsT0FBUSxFQUFyRSxDQUFOO0FBQ0Q7QUFDRixDQVBEOztBQWNBOUIsT0FBTyxDQUFDK0YsYUFBUixHQUF3QixlQUFlQSxhQUFmLEdBQWdDO0FBQ3RELE1BQUk7QUFDRixXQUFPLG9DQUFxQixNQUFNLEtBQUt4RCxLQUFMLENBQVcsQ0FBQyxLQUFELEVBQVEsTUFBUixFQUFnQixJQUFoQixDQUFYLENBQTNCLEVBQVA7QUFDRCxHQUZELENBRUUsT0FBT1YsQ0FBUCxFQUFVO0FBQ1YsVUFBTSxJQUFJZCxLQUFKLENBQVcsa0RBQWlEYyxDQUFDLENBQUNDLE9BQVEsRUFBdEUsQ0FBTjtBQUNEO0FBQ0YsQ0FORDs7QUFhQTlCLE9BQU8sQ0FBQ2dHLFdBQVIsR0FBc0IsZUFBZUEsV0FBZixHQUE4QjtBQUNsRCxNQUFJO0FBQ0YsV0FBTyxvQ0FBcUIsTUFBTSxLQUFLekQsS0FBTCxDQUFXLENBQUMsS0FBRCxFQUFRLE1BQVIsQ0FBWCxDQUEzQixFQUFQO0FBQ0QsR0FGRCxDQUVFLE9BQU9WLENBQVAsRUFBVTtBQUNWLFVBQU0sSUFBSWQsS0FBSixDQUFXLGdEQUErQ2MsQ0FBQyxDQUFDQyxPQUFRLEVBQXBFLENBQU47QUFDRDtBQUNGLENBTkQ7O0FBYUE5QixPQUFPLENBQUNpRyxTQUFSLEdBQW9CLGVBQWVBLFNBQWYsQ0FBMEJDLEtBQTFCLEVBQWlDO0FBQ25ELFFBQU0sS0FBSzNELEtBQUwsQ0FBVyxDQUFDLEtBQUQsRUFBUSxRQUFSLEVBQWtCMkQsS0FBbEIsQ0FBWCxDQUFOO0FBQ0QsQ0FGRDs7QUFTQWxHLE9BQU8sQ0FBQ21HLFVBQVIsR0FBcUIsZUFBZUEsVUFBZixDQUEyQkQsS0FBM0IsRUFBa0M7QUFDckQsUUFBTSxLQUFLM0QsS0FBTCxDQUFXLENBQUMsS0FBRCxFQUFRLFNBQVIsRUFBbUIyRCxLQUFuQixDQUFYLENBQU47QUFDRCxDQUZEOztBQVNBbEcsT0FBTyxDQUFDb0csTUFBUixHQUFpQixlQUFlQSxNQUFmLENBQXVCRixLQUF2QixFQUE4QjtBQUM3QyxRQUFNLEtBQUszRCxLQUFMLENBQVcsQ0FBQyxLQUFELEVBQVEsS0FBUixFQUFlMkQsS0FBZixDQUFYLENBQU47QUFDRCxDQUZEOztBQVNBbEcsT0FBTyxDQUFDcUcsVUFBUixHQUFxQixlQUFlQSxVQUFmLEdBQTZCO0FBQ2hELE1BQUk7QUFDRixRQUFJQyxNQUFNLEdBQUcsTUFBTSxLQUFLcEIsVUFBTCxDQUFnQixRQUFoQixFQUEwQixzQkFBMUIsQ0FBbkI7O0FBQ0EsUUFBSW9CLE1BQU0sS0FBSyxNQUFmLEVBQXVCO0FBQ3JCLGFBQU8sSUFBUDtBQUNEOztBQUNELFdBQU9BLE1BQU0sQ0FBQzlFLElBQVAsRUFBUDtBQUNELEdBTkQsQ0FNRSxPQUFPSyxDQUFQLEVBQVU7QUFDVixVQUFNLElBQUlkLEtBQUosQ0FBVyw4Q0FBNkNjLENBQUMsQ0FBQ0MsT0FBUSxFQUFsRSxDQUFOO0FBQ0Q7QUFDRixDQVZEOztBQWlCQTlCLE9BQU8sQ0FBQ3VHLFFBQVIsR0FBbUIsZUFBZUEsUUFBZixDQUF5QkMsT0FBekIsRUFBa0M7QUFFbkQsTUFBSUMsSUFBSSxHQUFHbEYsUUFBUSxDQUFDaUYsT0FBRCxFQUFVLEVBQVYsQ0FBbkI7QUFDQSxRQUFNLEtBQUtqRSxLQUFMLENBQVcsQ0FBQyxPQUFELEVBQVUsVUFBVixFQUFzQmtFLElBQXRCLENBQVgsQ0FBTjtBQUNELENBSkQ7O0FBV0F6RyxPQUFPLENBQUMwRyxTQUFSLEdBQW9CLGVBQWVBLFNBQWYsQ0FBMEJDLElBQTFCLEVBQWdDO0FBR2xEQSxFQUFBQSxJQUFJLEdBQUdBLElBQUksQ0FDRkMsT0FERixDQUNVLEtBRFYsRUFDaUIsTUFEakIsRUFFRUEsT0FGRixDQUVVLEtBRlYsRUFFaUIsSUFGakIsRUFHRUEsT0FIRixDQUdVLEtBSFYsRUFHaUIsSUFIakIsRUFJRUEsT0FKRixDQUlVLElBSlYsRUFJZ0IsSUFKaEIsRUFLRUEsT0FMRixDQUtVLElBTFYsRUFLZ0IsSUFMaEIsRUFNRUEsT0FORixDQU1VLEtBTlYsRUFNaUIsSUFOakIsRUFPRUEsT0FQRixDQU9VLElBUFYsRUFPZ0IsSUFQaEIsRUFRRUEsT0FSRixDQVFVLElBUlYsRUFRZ0IsSUFSaEIsRUFTRUEsT0FURixDQVNVLEtBVFYsRUFTaUIsSUFUakIsRUFVRUEsT0FWRixDQVVVLElBVlYsRUFVZ0IsSUFWaEIsRUFXRUEsT0FYRixDQVdVLElBWFYsRUFXZ0IsSUFYaEIsRUFZRUEsT0FaRixDQVlVLElBWlYsRUFZZ0IsSUFaaEIsRUFhRUEsT0FiRixDQWFVLElBYlYsRUFhZ0IsSUFiaEIsQ0FBUDtBQWVBLFFBQU0sS0FBS3JFLEtBQUwsQ0FBVyxDQUFDLE9BQUQsRUFBVSxNQUFWLEVBQWtCb0UsSUFBbEIsQ0FBWCxDQUFOO0FBQ0QsQ0FuQkQ7O0FBMkJBM0csT0FBTyxDQUFDNkcsY0FBUixHQUF5QixlQUFlQSxjQUFmLENBQStCekUsTUFBTSxHQUFHLEdBQXhDLEVBQTZDO0FBRXBFVixrQkFBSUMsS0FBSixDQUFXLGtCQUFpQlMsTUFBTyxhQUFuQzs7QUFDQSxNQUFJQSxNQUFNLEtBQUssQ0FBZixFQUFrQjtBQUNoQjtBQUNEOztBQUNELE1BQUkwRSxJQUFJLEdBQUcsQ0FBQyxPQUFELEVBQVUsVUFBVixDQUFYOztBQUNBLE9BQUssSUFBSUMsQ0FBQyxHQUFHLENBQWIsRUFBZ0JBLENBQUMsR0FBRzNFLE1BQXBCLEVBQTRCMkUsQ0FBQyxFQUE3QixFQUFpQztBQUsvQkQsSUFBQUEsSUFBSSxDQUFDdkMsSUFBTCxDQUFVLElBQVYsRUFBZ0IsS0FBaEI7QUFDRDs7QUFDRCxRQUFNLEtBQUtoQyxLQUFMLENBQVd1RSxJQUFYLENBQU47QUFDRCxDQWZEOztBQW9CQTlHLE9BQU8sQ0FBQ2dILElBQVIsR0FBZSxlQUFlQSxJQUFmLEdBQXVCO0FBQ3BDLE1BQUksTUFBTSxLQUFLQyxjQUFMLEVBQVYsRUFBaUM7QUFDL0J2RixvQkFBSUMsS0FBSixDQUFVLDBDQUFWOztBQUNBO0FBQ0Q7O0FBQ0RELGtCQUFJQyxLQUFKLENBQVUsa0RBQVY7O0FBQ0EsUUFBTSxLQUFLNEUsUUFBTCxDQUFjLEVBQWQsQ0FBTjtBQUVBLFFBQU1XLFNBQVMsR0FBRyxJQUFsQjs7QUFDQSxNQUFJO0FBQ0YsVUFBTSxnQ0FBaUIsWUFBWSxNQUFNLEtBQUtELGNBQUwsRUFBbkMsRUFBMEQ7QUFDOURFLE1BQUFBLE1BQU0sRUFBRUQsU0FEc0Q7QUFFOURFLE1BQUFBLFVBQVUsRUFBRTtBQUZrRCxLQUExRCxDQUFOO0FBSUQsR0FMRCxDQUtFLE9BQU92RixDQUFQLEVBQVU7QUFDVixVQUFNLElBQUlkLEtBQUosQ0FBVywyQ0FBMENtRyxTQUFVLFlBQS9ELENBQU47QUFDRDtBQUNGLENBakJEOztBQXVCQWxILE9BQU8sQ0FBQ3FILElBQVIsR0FBZSxlQUFlQSxJQUFmLEdBQXVCO0FBQ3BDM0Ysa0JBQUlDLEtBQUosQ0FBVSwwQkFBVjs7QUFDQSxRQUFNLEtBQUs0RSxRQUFMLENBQWMsQ0FBZCxDQUFOO0FBQ0QsQ0FIRDs7QUFTQXZHLE9BQU8sQ0FBQ3NILFFBQVIsR0FBbUIsZUFBZUEsUUFBZixHQUEyQjtBQUM1QzVGLGtCQUFJQyxLQUFKLENBQVUsMEJBQVY7O0FBQ0EsUUFBTSxLQUFLNEUsUUFBTCxDQUFjLENBQWQsQ0FBTjtBQUNELENBSEQ7O0FBUUF2RyxPQUFPLENBQUN1SCxVQUFSLEdBQXFCLFNBQVNBLFVBQVQsR0FBdUI7QUFDMUMsU0FBTyxLQUFLckgsVUFBTCxDQUFnQkMsSUFBdkI7QUFDRCxDQUZEOztBQVNBSCxPQUFPLENBQUN3SCxvQkFBUixHQUErQixlQUFlQSxvQkFBZixHQUF1QztBQUNwRSxNQUFJekMsTUFBTSxHQUFHLE1BQU0sS0FBS3hDLEtBQUwsQ0FBVyxDQUFDLFNBQUQsRUFBWSxPQUFaLENBQVgsQ0FBbkI7QUFDQSxTQUFPLG9DQUFzQndDLE1BQXRCLENBQVA7QUFDRCxDQUhEOztBQVVBL0UsT0FBTyxDQUFDaUgsY0FBUixHQUF5QixlQUFlQSxjQUFmLEdBQWlDO0FBQ3hELE1BQUlsQyxNQUFNLEdBQUcsTUFBTSxLQUFLeEMsS0FBTCxDQUFXLENBQUMsU0FBRCxFQUFZLFFBQVosQ0FBWCxDQUFuQjs7QUFDQSxNQUFJa0YsT0FBTyxDQUFDQyxHQUFSLENBQVlDLGtCQUFoQixFQUFvQztBQUdsQyxRQUFJQyxXQUFXLEdBQUd6SCxjQUFLMEgsT0FBTCxDQUFhSixPQUFPLENBQUNLLEdBQVIsRUFBYixFQUE0QixhQUE1QixDQUFsQjs7QUFDQXBHLG9CQUFJQyxLQUFKLENBQVcsNkJBQTRCaUcsV0FBWSxFQUFuRDs7QUFDQSxVQUFNaEgsa0JBQUdtSCxTQUFILENBQWFILFdBQWIsRUFBMEI3QyxNQUExQixDQUFOO0FBQ0Q7O0FBQ0QsU0FBUSxrQ0FBb0JBLE1BQXBCLEtBQStCLHVDQUF5QkEsTUFBekIsQ0FBL0IsSUFDQSxDQUFDLDhCQUFnQkEsTUFBaEIsQ0FEVDtBQUVELENBWEQ7O0FBd0JBL0UsT0FBTyxDQUFDZ0kscUJBQVIsR0FBZ0MsZUFBZUEscUJBQWYsR0FBd0M7QUFDdEUsTUFBSTtBQUNGLFVBQU1qRCxNQUFNLEdBQUcsTUFBTSxLQUFLeEMsS0FBTCxDQUFXLENBQUMsU0FBRCxFQUFZLGNBQVosQ0FBWCxDQUFyQjtBQUNBLFVBQU0wRixlQUFlLEdBQUcsb0JBQW9CdEYsSUFBcEIsQ0FBeUJvQyxNQUF6QixDQUF4QjtBQUNBLFVBQU1tRCxtQkFBbUIsR0FBRywwQkFBMEJ2RixJQUExQixDQUErQm9DLE1BQS9CLENBQTVCO0FBQ0EsV0FBTztBQUNMb0QsTUFBQUEsZUFBZSxFQUFFLENBQUMsRUFBRUYsZUFBZSxJQUFJQSxlQUFlLENBQUMsQ0FBRCxDQUFmLEtBQXVCLE1BQTVDLENBRGI7QUFFTEcsTUFBQUEsZ0JBQWdCLEVBQUUsQ0FBQyxFQUFFRixtQkFBbUIsSUFBSUEsbUJBQW1CLENBQUMsQ0FBRCxDQUFuQixLQUEyQixNQUFwRDtBQUZkLEtBQVA7QUFJRCxHQVJELENBUUUsT0FBT3JHLENBQVAsRUFBVTtBQUNWLFVBQU0sSUFBSWQsS0FBSixDQUFXLCtDQUE4Q2MsQ0FBQyxDQUFDQyxPQUFRLEVBQW5FLENBQU47QUFDRDtBQUNGLENBWkQ7O0FBcUJBOUIsT0FBTyxDQUFDcUksaUJBQVIsR0FBNEIsZUFBZUEsaUJBQWYsQ0FBa0NDLE9BQWxDLEVBQTJDO0FBQ3JFNUcsa0JBQUlDLEtBQUosQ0FBVyxxQ0FBb0MyRyxPQUFRLEVBQXZEOztBQUNBLE1BQUlDLElBQUksR0FBRyxNQUFNLEtBQUtDLGVBQUwsRUFBakI7QUFDQSxTQUFPLE1BQU0sSUFBSUMsaUJBQUosQ0FBTSxDQUFDWixPQUFELEVBQVVhLE1BQVYsS0FBcUI7QUFDdEMsUUFBSUMsSUFBSSxHQUFHQyxhQUFJQyxnQkFBSixDQUFxQk4sSUFBckIsRUFBMkIsV0FBM0IsQ0FBWDtBQUFBLFFBQ0lPLFNBQVMsR0FBRyxLQURoQjtBQUFBLFFBRUlDLFVBQVUsR0FBRyxPQUZqQjtBQUFBLFFBR0lDLFVBQVUsR0FBRyxFQUhqQjtBQUFBLFFBSUlDLEdBQUcsR0FBRyxJQUpWOztBQUtBTixJQUFBQSxJQUFJLENBQUNPLEVBQUwsQ0FBUSxTQUFSLEVBQW1CLE1BQU07QUFDdkJ4SCxzQkFBSUMsS0FBSixDQUFVLHFDQUFWO0FBQ0QsS0FGRDtBQUdBZ0gsSUFBQUEsSUFBSSxDQUFDTyxFQUFMLENBQVEsTUFBUixFQUFpQkMsSUFBRCxJQUFVO0FBQ3hCQSxNQUFBQSxJQUFJLEdBQUdBLElBQUksQ0FBQ0MsUUFBTCxDQUFjLE1BQWQsQ0FBUDs7QUFDQSxVQUFJLENBQUNOLFNBQUwsRUFBZ0I7QUFDZCxZQUFJQyxVQUFVLENBQUNNLElBQVgsQ0FBZ0JGLElBQWhCLENBQUosRUFBMkI7QUFDekJMLFVBQUFBLFNBQVMsR0FBRyxJQUFaOztBQUNBcEgsMEJBQUlDLEtBQUosQ0FBVSxtQ0FBVjs7QUFDQWdILFVBQUFBLElBQUksQ0FBQ1csS0FBTCxDQUFZLEdBQUVoQixPQUFRLElBQXRCO0FBQ0Q7QUFDRixPQU5ELE1BTU87QUFDTFUsUUFBQUEsVUFBVSxJQUFJRyxJQUFkOztBQUNBLFlBQUlKLFVBQVUsQ0FBQ00sSUFBWCxDQUFnQkYsSUFBaEIsQ0FBSixFQUEyQjtBQUN6QkYsVUFBQUEsR0FBRyxHQUFHRCxVQUFVLENBQUNwQyxPQUFYLENBQW1CbUMsVUFBbkIsRUFBK0IsRUFBL0IsRUFBbUN2SCxJQUFuQyxFQUFOO0FBQ0F5SCxVQUFBQSxHQUFHLEdBQUdoSSxnQkFBRXNJLElBQUYsQ0FBT04sR0FBRyxDQUFDekgsSUFBSixHQUFXMkQsS0FBWCxDQUFpQixJQUFqQixDQUFQLENBQU47O0FBQ0F6RCwwQkFBSUMsS0FBSixDQUFXLGdDQUErQnNILEdBQUksRUFBOUM7O0FBQ0FOLFVBQUFBLElBQUksQ0FBQ1csS0FBTCxDQUFXLFFBQVg7QUFDRDtBQUNGO0FBQ0YsS0FqQkQ7QUFrQkFYLElBQUFBLElBQUksQ0FBQ08sRUFBTCxDQUFRLE9BQVIsRUFBa0JwSSxHQUFELElBQVM7QUFDeEJZLHNCQUFJQyxLQUFKLENBQVcseUJBQXdCYixHQUFHLENBQUNnQixPQUFRLEVBQS9DOztBQUNBNEcsTUFBQUEsTUFBTSxDQUFDNUgsR0FBRCxDQUFOO0FBQ0QsS0FIRDtBQUlBNkgsSUFBQUEsSUFBSSxDQUFDTyxFQUFMLENBQVEsT0FBUixFQUFpQixNQUFNO0FBQ3JCLFVBQUlELEdBQUcsS0FBSyxJQUFaLEVBQWtCO0FBQ2hCUCxRQUFBQSxNQUFNLENBQUMsSUFBSTNILEtBQUosQ0FBVSxtQ0FBVixDQUFELENBQU47QUFDRCxPQUZELE1BRU87QUFDTDhHLFFBQUFBLE9BQU8sQ0FBQ29CLEdBQUQsQ0FBUDtBQUNEO0FBQ0YsS0FORDtBQU9ELEdBdENZLENBQWI7QUF1Q0QsQ0ExQ0Q7O0FBaURBakosT0FBTyxDQUFDd0osZ0JBQVIsR0FBMkIsZUFBZUEsZ0JBQWYsR0FBbUM7QUFDNUQsTUFBSXpFLE1BQU0sR0FBRyxNQUFNLEtBQUtHLFVBQUwsQ0FBZ0IsUUFBaEIsRUFBMEIsa0JBQTFCLENBQW5CO0FBQ0EsU0FBTzNELFFBQVEsQ0FBQ3dELE1BQUQsRUFBUyxFQUFULENBQVIsS0FBeUIsQ0FBaEM7QUFDRCxDQUhEOztBQVVBL0UsT0FBTyxDQUFDeUosZUFBUixHQUEwQixlQUFlQSxlQUFmLENBQWdDUCxFQUFoQyxFQUFvQztBQUM1RCxRQUFNLEtBQUt4RCxVQUFMLENBQWdCLFFBQWhCLEVBQTBCLGtCQUExQixFQUE4Q3dELEVBQUUsR0FBRyxDQUFILEdBQU8sQ0FBdkQsQ0FBTjtBQUNELENBRkQ7O0FBV0FsSixPQUFPLENBQUMwSixxQkFBUixHQUFnQyxlQUFlQSxxQkFBZixDQUFzQ1IsRUFBdEMsRUFBMEM7QUFDeEUsUUFBTSxLQUFLM0csS0FBTCxDQUFXLENBQ2YsSUFEZSxFQUNULFdBRFMsRUFFZixJQUZlLEVBRVQscUNBRlMsRUFHZixNQUhlLEVBR1AsT0FITyxFQUdFMkcsRUFBRSxHQUFHLE1BQUgsR0FBWSxPQUhoQixDQUFYLENBQU47QUFLRCxDQU5EOztBQWFBbEosT0FBTyxDQUFDMkosUUFBUixHQUFtQixlQUFlQSxRQUFmLEdBQTJCO0FBQzVDLE1BQUk1RSxNQUFNLEdBQUcsTUFBTSxLQUFLRyxVQUFMLENBQWdCLFFBQWhCLEVBQTBCLFNBQTFCLENBQW5CO0FBQ0EsU0FBUTNELFFBQVEsQ0FBQ3dELE1BQUQsRUFBUyxFQUFULENBQVIsS0FBeUIsQ0FBakM7QUFDRCxDQUhEOztBQVlBL0UsT0FBTyxDQUFDNEosWUFBUixHQUF1QixlQUFlQSxZQUFmLENBQTZCVixFQUE3QixFQUFpQ1csVUFBVSxHQUFHLEtBQTlDLEVBQXFEO0FBQzFFLE1BQUlBLFVBQUosRUFBZ0I7QUFDZCxVQUFNLEtBQUt0SCxLQUFMLENBQVcsQ0FBQyxLQUFELEVBQVEsTUFBUixFQUFnQjJHLEVBQUUsR0FBRyxRQUFILEdBQWMsU0FBaEMsQ0FBWCxFQUF1RDtBQUMzRFksTUFBQUEsVUFBVSxFQUFFO0FBRCtDLEtBQXZELENBQU47QUFHRCxHQUpELE1BSU87QUFDTCxVQUFNLEtBQUt2SCxLQUFMLENBQVcsQ0FDZixJQURlLEVBQ1QsV0FEUyxFQUVmLElBRmUsRUFFVHBELDhCQUZTLEVBR2YsSUFIZSxFQUdURCxnQ0FIUyxFQUlmLE1BSmUsRUFJUCxXQUpPLEVBSU1nSyxFQUFFLEdBQUcsUUFBSCxHQUFjLFNBSnRCLENBQVgsQ0FBTjtBQU1EO0FBQ0YsQ0FiRDs7QUFvQkFsSixPQUFPLENBQUMrSixRQUFSLEdBQW1CLGVBQWVBLFFBQWYsR0FBMkI7QUFDNUMsTUFBSWhGLE1BQU0sR0FBRyxNQUFNLEtBQUtHLFVBQUwsQ0FBZ0IsUUFBaEIsRUFBMEIsYUFBMUIsQ0FBbkI7QUFDQSxTQUFRM0QsUUFBUSxDQUFDd0QsTUFBRCxFQUFTLEVBQVQsQ0FBUixLQUF5QixDQUFqQztBQUNELENBSEQ7O0FBWUEvRSxPQUFPLENBQUNnSyxZQUFSLEdBQXVCLGVBQWVBLFlBQWYsQ0FBNkJkLEVBQTdCLEVBQWlDVyxVQUFVLEdBQUcsS0FBOUMsRUFBcUQ7QUFDMUUsTUFBSUEsVUFBSixFQUFnQjtBQUNkLFVBQU0sS0FBS3RILEtBQUwsQ0FBVyxDQUFDLEtBQUQsRUFBUSxNQUFSLEVBQWdCMkcsRUFBRSxHQUFHLFFBQUgsR0FBYyxTQUFoQyxDQUFYLEVBQXVEO0FBQzNEWSxNQUFBQSxVQUFVLEVBQUU7QUFEK0MsS0FBdkQsQ0FBTjtBQUdELEdBSkQsTUFJTztBQUNMLFVBQU0sS0FBS3ZILEtBQUwsQ0FBVyxDQUNmLElBRGUsRUFDVCxXQURTLEVBRWYsSUFGZSxFQUVUbEQsOEJBRlMsRUFHZixJQUhlLEVBR1RELGdDQUhTLEVBSWYsTUFKZSxFQUlQLFdBSk8sRUFJTThKLEVBQUUsR0FBRyxRQUFILEdBQWMsU0FKdEIsQ0FBWCxDQUFOO0FBTUQ7QUFDRixDQWJEOztBQXVCQWxKLE9BQU8sQ0FBQ2lLLGNBQVIsR0FBeUIsZUFBZUEsY0FBZixDQUErQjtBQUFDQyxFQUFBQSxJQUFEO0FBQU9mLEVBQUFBO0FBQVAsQ0FBL0IsRUFBNkNVLFVBQVUsR0FBRyxLQUExRCxFQUFpRTtBQUN4RixNQUFJTSxvQkFBS0MsUUFBTCxDQUFjRixJQUFkLENBQUosRUFBeUI7QUFDdkIsVUFBTSxLQUFLTixZQUFMLENBQWtCTSxJQUFsQixFQUF3QkwsVUFBeEIsQ0FBTjtBQUNEOztBQUNELE1BQUlNLG9CQUFLQyxRQUFMLENBQWNqQixJQUFkLENBQUosRUFBeUI7QUFDdkIsVUFBTSxLQUFLYSxZQUFMLENBQWtCYixJQUFsQixFQUF3QlUsVUFBeEIsQ0FBTjtBQUNEO0FBQ0YsQ0FQRDs7QUFzQkE3SixPQUFPLENBQUNxSyxpQkFBUixHQUE0QixlQUFlQSxpQkFBZixDQUFrQ25CLEVBQWxDLEVBQXNDO0FBQ2hFLFFBQU0sS0FBSzNHLEtBQUwsQ0FBVyxDQUNmLElBRGUsRUFDVCxXQURTLEVBRWYsSUFGZSxFQUVUaEQsd0JBRlMsRUFHZixJQUhlLEVBR1RELDBCQUhTLEVBSWYsTUFKZSxFQUlQLFdBSk8sRUFJTTRKLEVBQUUsR0FBRyxRQUFILEdBQWMsU0FKdEIsQ0FBWCxDQUFOO0FBTUQsQ0FQRDs7QUFlQWxKLE9BQU8sQ0FBQ3NLLGFBQVIsR0FBd0IsZUFBZUEsYUFBZixHQUFnQztBQUN0RCxNQUFJQyx1QkFBdUIsR0FBRyxNQUFNLEtBQUtyRixVQUFMLENBQWdCLFFBQWhCLEVBQTBCLHlCQUExQixDQUFwQztBQUNBLE1BQUlzRiwwQkFBMEIsR0FBRyxNQUFNLEtBQUt0RixVQUFMLENBQWdCLFFBQWhCLEVBQTBCLDRCQUExQixDQUF2QztBQUNBLE1BQUl1RixzQkFBc0IsR0FBRyxNQUFNLEtBQUt2RixVQUFMLENBQWdCLFFBQWhCLEVBQTBCLHdCQUExQixDQUFuQztBQUNBLFNBQU9qRSxnQkFBRXlKLElBQUYsQ0FBTyxDQUFDSCx1QkFBRCxFQUEwQkMsMEJBQTFCLEVBQXNEQyxzQkFBdEQsQ0FBUCxFQUNRRSxPQUFELElBQWFBLE9BQU8sS0FBSyxLQURoQyxDQUFQO0FBRUQsQ0FORDs7QUFrQkEzSyxPQUFPLENBQUM0SywrQkFBUixHQUEwQyxlQUFlQSwrQkFBZixDQUFnREMsUUFBaEQsRUFBMERDLE9BQTFELEVBQW1FQyxNQUFNLEdBQUcsSUFBNUUsRUFBa0Y7QUFDMUgsUUFBTUMsTUFBTSxHQUFHLENBQ2IsSUFEYSxFQUNQLFdBRE8sRUFFYixJQUZhLEVBRVB2TCxxQkFGTyxFQUdiLElBSGEsRUFHUEQsdUJBSE8sRUFJYixNQUphLEVBSUwsTUFKSyxFQUlHcUwsUUFBUSxDQUFDcEosV0FBVCxFQUpILEVBS2IsTUFMYSxFQUtMLFNBTEssRUFLTXFKLE9BQU8sQ0FBQ0csV0FBUixFQUxOLENBQWY7O0FBUUEsTUFBSUYsTUFBSixFQUFZO0FBQ1ZDLElBQUFBLE1BQU0sQ0FBQ3pHLElBQVAsQ0FBWSxNQUFaLEVBQW9CLFFBQXBCLEVBQThCd0csTUFBOUI7QUFDRDs7QUFFRCxRQUFNLEtBQUt4SSxLQUFMLENBQVd5SSxNQUFYLENBQU47QUFDRCxDQWREOztBQStCQWhMLE9BQU8sQ0FBQ2tMLGNBQVIsR0FBeUIsZUFBZUEsY0FBZixDQUErQkMsUUFBL0IsRUFBeUN0QixVQUFVLEdBQUcsS0FBdEQsRUFBNkQ7QUFDcEYsUUFBTXVCLG1CQUFtQixHQUFHLENBQUNDLFNBQUQsRUFBWUMsVUFBVSxHQUFHLElBQXpCLEtBQWtDO0FBQzVELFFBQUksQ0FBQ25CLG9CQUFLQyxRQUFMLENBQWNlLFFBQVEsQ0FBQ0UsU0FBRCxDQUF0QixDQUFMLEVBQXlDO0FBQ3ZDLFVBQUlDLFVBQUosRUFBZ0I7QUFDZCxjQUFNLElBQUl2SyxLQUFKLENBQVcsR0FBRXNLLFNBQVUsbUJBQXZCLENBQU47QUFDRDs7QUFDRCxhQUFPLElBQVA7QUFDRDs7QUFDRCxVQUFNRSxVQUFVLEdBQUdDLFVBQVUsQ0FBQ0wsUUFBUSxDQUFDRSxTQUFELENBQVQsQ0FBN0I7O0FBQ0EsUUFBSSxDQUFDekosS0FBSyxDQUFDMkosVUFBRCxDQUFWLEVBQXdCO0FBQ3RCLGFBQVEsR0FBRXRLLGdCQUFFd0ssSUFBRixDQUFPRixVQUFQLEVBQW1CLENBQW5CLENBQXNCLEVBQWhDO0FBQ0Q7O0FBQ0QsUUFBSUQsVUFBSixFQUFnQjtBQUNkLFlBQU0sSUFBSXZLLEtBQUosQ0FBVyxHQUFFc0ssU0FBVSwyQ0FBYixHQUNiLElBQUdGLFFBQVEsQ0FBQ0UsU0FBRCxDQUFZLG9CQURwQixDQUFOO0FBRUQ7O0FBQ0QsV0FBTyxJQUFQO0FBQ0QsR0FoQkQ7O0FBaUJBLFFBQU1LLFNBQVMsR0FBR04sbUJBQW1CLENBQUMsV0FBRCxDQUFyQztBQUNBLFFBQU1PLFFBQVEsR0FBR1AsbUJBQW1CLENBQUMsVUFBRCxDQUFwQztBQUNBLFFBQU1RLFFBQVEsR0FBR1IsbUJBQW1CLENBQUMsVUFBRCxFQUFhLEtBQWIsQ0FBcEM7O0FBQ0EsTUFBSXZCLFVBQUosRUFBZ0I7QUFDZCxVQUFNLEtBQUtnQyxvQkFBTCxFQUFOO0FBQ0EsVUFBTSxLQUFLQyxPQUFMLENBQWEsQ0FBQyxLQUFELEVBQVEsS0FBUixFQUFlLEtBQWYsRUFBc0JKLFNBQXRCLEVBQWlDQyxRQUFqQyxDQUFiLENBQU47QUFFQSxVQUFNLEtBQUtHLE9BQUwsQ0FBYSxDQUFDLEtBQUQsRUFBUSxLQUFSLEVBQWUsS0FBZixFQUFzQkosU0FBUyxDQUFDOUUsT0FBVixDQUFrQixHQUFsQixFQUF1QixHQUF2QixDQUF0QixFQUFtRCtFLFFBQVEsQ0FBQy9FLE9BQVQsQ0FBaUIsR0FBakIsRUFBc0IsR0FBdEIsQ0FBbkQsQ0FBYixDQUFOO0FBQ0QsR0FMRCxNQUtPO0FBQ0wsVUFBTUUsSUFBSSxHQUFHLENBQ1gsSUFEVyxFQUNMLGNBREssRUFFWCxJQUZXLEVBRUwsV0FGSyxFQUVRNEUsU0FGUixFQUdYLElBSFcsRUFHTCxVQUhLLEVBR09DLFFBSFAsQ0FBYjs7QUFLQSxRQUFJeEIsb0JBQUtDLFFBQUwsQ0FBY3dCLFFBQWQsQ0FBSixFQUE2QjtBQUMzQjlFLE1BQUFBLElBQUksQ0FBQ3ZDLElBQUwsQ0FBVSxJQUFWLEVBQWdCLFVBQWhCLEVBQTRCcUgsUUFBNUI7QUFDRDs7QUFDRDlFLElBQUFBLElBQUksQ0FBQ3ZDLElBQUwsQ0FBVTdFLGdCQUFWO0FBQ0EsVUFBTSxLQUFLNkMsS0FBTCxDQUFXdUUsSUFBWCxDQUFOO0FBQ0Q7QUFDRixDQXRDRDs7QUE4Q0E5RyxPQUFPLENBQUMrTCxjQUFSLEdBQXlCLGVBQWVBLGNBQWYsR0FBaUM7QUFDeEQsTUFBSUMsTUFBSjs7QUFDQSxNQUFJO0FBQ0ZBLElBQUFBLE1BQU0sR0FBRyxNQUFNLEtBQUt6SixLQUFMLENBQVcsQ0FDeEIsSUFEd0IsRUFDbEIsV0FEa0IsRUFFeEIsSUFGd0IsRUFFbEI1QyxpQkFGa0IsRUFHeEIsSUFId0IsRUFHbEJDLHlCQUhrQixDQUFYLENBQWY7QUFLRCxHQU5ELENBTUUsT0FBT2tCLEdBQVAsRUFBWTtBQUNaLFVBQU0sSUFBSUMsS0FBSixDQUFXLCtEQUFELEdBQ2IsMEdBRGEsR0FFYiwyREFBMERELEdBQUcsQ0FBQ2dCLE9BQVEsRUFGbkUsQ0FBTjtBQUdEOztBQUVELFFBQU1tSyxLQUFLLEdBQUcsaURBQWlEdEosSUFBakQsQ0FBc0RxSixNQUF0RCxDQUFkOztBQUNBLE1BQUksQ0FBQ0MsS0FBTCxFQUFZO0FBQ1YsVUFBTSxJQUFJbEwsS0FBSixDQUFXLG9FQUFtRWlMLE1BQU8sRUFBckYsQ0FBTjtBQUNEOztBQUNELFFBQU1iLFFBQVEsR0FBRztBQUNmUSxJQUFBQSxRQUFRLEVBQUVNLEtBQUssQ0FBQyxDQUFELENBREE7QUFFZlAsSUFBQUEsU0FBUyxFQUFFTyxLQUFLLENBQUMsQ0FBRCxDQUZEO0FBR2ZMLElBQUFBLFFBQVEsRUFBRUssS0FBSyxDQUFDLENBQUQ7QUFIQSxHQUFqQjs7QUFLQXZLLGtCQUFJQyxLQUFKLENBQVcsd0JBQXVCcUMsSUFBSSxDQUFDQyxTQUFMLENBQWVrSCxRQUFmLENBQXlCLEVBQTNEOztBQUNBLFNBQU9BLFFBQVA7QUFDRCxDQXpCRDs7QUFpQ0FuTCxPQUFPLENBQUNrTSxNQUFSLEdBQWlCLGVBQWVBLE1BQWYsQ0FBdUIvTCxJQUF2QixFQUE2QjtBQUM1QyxRQUFNLEtBQUtvQyxLQUFMLENBQVcsQ0FBQyxJQUFELEVBQU8sS0FBUCxFQUFjcEMsSUFBZCxDQUFYLENBQU47QUFDRCxDQUZEOztBQWNBSCxPQUFPLENBQUN1RSxJQUFSLEdBQWUsZUFBZUEsSUFBZixDQUFxQjRILFNBQXJCLEVBQWdDN0osVUFBaEMsRUFBNEM4SixJQUE1QyxFQUFrRDtBQUMvRCxRQUFNLEtBQUsvSixLQUFMLENBQVdsQyxjQUFLa00sS0FBTCxDQUFXQyxPQUFYLENBQW1CaEssVUFBbkIsQ0FBWCxDQUFOO0FBQ0EsUUFBTSxLQUFLd0osT0FBTCxDQUFhLENBQUMsTUFBRCxFQUFTSyxTQUFULEVBQW9CN0osVUFBcEIsQ0FBYixFQUE4QzhKLElBQTlDLENBQU47QUFDRCxDQUhEOztBQVdBcE0sT0FBTyxDQUFDdU0sSUFBUixHQUFlLGVBQWVBLElBQWYsQ0FBcUJqSyxVQUFyQixFQUFpQzZKLFNBQWpDLEVBQTRDO0FBRXpELFFBQU0sS0FBS0wsT0FBTCxDQUFhLENBQUMsTUFBRCxFQUFTeEosVUFBVCxFQUFxQjZKLFNBQXJCLENBQWIsRUFBOEM7QUFBQ0ssSUFBQUEsT0FBTyxFQUFFO0FBQVYsR0FBOUMsQ0FBTjtBQUNELENBSEQ7O0FBYUF4TSxPQUFPLENBQUN5TSxhQUFSLEdBQXdCLGVBQWVBLGFBQWYsQ0FBOEJDLFdBQTlCLEVBQTJDO0FBQ2pFLE1BQUksQ0FBQyxLQUFLbEssWUFBTCxDQUFrQmtLLFdBQWxCLENBQUwsRUFBcUM7QUFDbkMsVUFBTSxJQUFJM0wsS0FBSixDQUFXLHlCQUF3QjJMLFdBQVksRUFBL0MsQ0FBTjtBQUNEOztBQUNELFNBQU8sQ0FBQ3pMLGdCQUFFNEMsT0FBRixFQUFVLE1BQU0sS0FBSzhJLGFBQUwsQ0FBbUJELFdBQW5CLENBQWhCLEVBQVI7QUFDRCxDQUxEOztBQVdBMU0sT0FBTyxDQUFDNE0sY0FBUixHQUF5QixlQUFlQSxjQUFmLEdBQWlDO0FBQ3hEbEwsa0JBQUlDLEtBQUosQ0FBVyx1QkFBWDs7QUFDQSxRQUFNa0wsV0FBVyxHQUFHLE1BQU0sS0FBS2YsT0FBTCxDQUFhLENBQUMsU0FBRCxFQUFZLFFBQVosQ0FBYixDQUExQjtBQUNBLFNBQU9lLFdBQVcsQ0FBQzFILEtBQVosQ0FBa0IySCxPQUFsQixFQUF1QnhILE1BQXZCLENBQStCeUgsSUFBRCxJQUFVeEgsT0FBTyxDQUFDd0gsSUFBSSxDQUFDdkwsSUFBTCxFQUFELENBQS9DLENBQVA7QUFDRCxDQUpEOztBQVlBeEIsT0FBTyxDQUFDZ04sV0FBUixHQUFzQixlQUFlQSxXQUFmLENBQTRCQyxVQUE1QixFQUF3Q0MsVUFBeEMsRUFBb0Q7QUFDeEV4TCxrQkFBSUMsS0FBSixDQUFXLHNCQUFxQnNMLFVBQVcsZUFBY0MsVUFBVyxFQUFwRTs7QUFDQSxRQUFNLEtBQUtwQixPQUFMLENBQWEsQ0FBQyxTQUFELEVBQWEsT0FBTW1CLFVBQVcsRUFBOUIsRUFBa0MsT0FBTUMsVUFBVyxFQUFuRCxDQUFiLENBQU47QUFDRCxDQUhEOztBQVlBbE4sT0FBTyxDQUFDbU4saUJBQVIsR0FBNEIsZUFBZUEsaUJBQWYsQ0FBa0NGLFVBQWxDLEVBQThDO0FBQ3hFdkwsa0JBQUlDLEtBQUosQ0FBVyw4Q0FBNkNzTCxVQUFXLEdBQW5FOztBQUNBLFFBQU0sS0FBS25CLE9BQUwsQ0FBYSxDQUFDLFNBQUQsRUFBYSxVQUFiLEVBQXlCLE9BQU1tQixVQUFXLEVBQTFDLENBQWIsQ0FBTjtBQUNELENBSEQ7O0FBU0FqTixPQUFPLENBQUNvTixjQUFSLEdBQXlCLGVBQWVBLGNBQWYsR0FBaUM7QUFDeEQxTCxrQkFBSUMsS0FBSixDQUFXLCtCQUFYOztBQUNBLFFBQU1rTCxXQUFXLEdBQUcsTUFBTSxLQUFLZixPQUFMLENBQWEsQ0FBQyxTQUFELEVBQVksUUFBWixDQUFiLENBQTFCO0FBQ0EsU0FBT2UsV0FBVyxDQUFDMUgsS0FBWixDQUFrQjJILE9BQWxCLEVBQXVCeEgsTUFBdkIsQ0FBK0J5SCxJQUFELElBQVV4SCxPQUFPLENBQUN3SCxJQUFJLENBQUN2TCxJQUFMLEVBQUQsQ0FBL0MsQ0FBUDtBQUNELENBSkQ7O0FBYUF4QixPQUFPLENBQUNxTixXQUFSLEdBQXNCLGVBQWVBLFdBQWYsQ0FBNEJILFVBQTVCLEVBQXdDRCxVQUF4QyxFQUFvRDtBQUN4RXZMLGtCQUFJQyxLQUFKLENBQVcsc0JBQXFCdUwsVUFBVyxlQUFjRCxVQUFXLEVBQXBFOztBQUNBLFFBQU0sS0FBS25CLE9BQUwsQ0FBYSxDQUFDLFNBQUQsRUFBYSxPQUFNb0IsVUFBVyxFQUE5QixFQUFrQyxPQUFNRCxVQUFXLEVBQW5ELENBQWIsQ0FBTjtBQUNELENBSEQ7O0FBWUFqTixPQUFPLENBQUNzTixpQkFBUixHQUE0QixlQUFlQSxpQkFBZixDQUFrQ0osVUFBbEMsRUFBOEM7QUFDeEV4TCxrQkFBSUMsS0FBSixDQUFXLHNEQUFxRHVMLFVBQVcsR0FBM0U7O0FBQ0EsUUFBTSxLQUFLcEIsT0FBTCxDQUFhLENBQUMsU0FBRCxFQUFhLFVBQWIsRUFBeUIsT0FBTW9CLFVBQVcsRUFBMUMsQ0FBYixDQUFOO0FBQ0QsQ0FIRDs7QUFhQWxOLE9BQU8sQ0FBQ3VOLG1CQUFSLEdBQThCLGVBQWVBLG1CQUFmLENBQW9DTixVQUFwQyxFQUFnREMsVUFBaEQsRUFBNEQ7QUFDeEZ4TCxrQkFBSUMsS0FBSixDQUFXLHNCQUFxQnNMLFVBQVcsd0JBQXVCQyxVQUFXLEVBQTdFOztBQUNBLFFBQU0sS0FBS3BCLE9BQUwsQ0FBYSxDQUFDLFNBQUQsRUFBYSxPQUFNbUIsVUFBVyxFQUE5QixFQUFrQyxpQkFBZ0JDLFVBQVcsRUFBN0QsQ0FBYixDQUFOO0FBQ0QsQ0FIRDs7QUFZQWxOLE9BQU8sQ0FBQ3dOLElBQVIsR0FBZSxlQUFlQSxJQUFmLEdBQXVCO0FBQ3BDLE1BQUl6SSxNQUFNLEdBQUcsTUFBTSxLQUFLeEMsS0FBTCxDQUFXLENBQUMsTUFBRCxFQUFTLE1BQVQsQ0FBWCxDQUFuQjs7QUFDQSxNQUFJd0MsTUFBTSxDQUFDMEksT0FBUCxDQUFlLE1BQWYsTUFBMkIsQ0FBL0IsRUFBa0M7QUFDaEMsV0FBTyxJQUFQO0FBQ0Q7O0FBQ0QsUUFBTSxJQUFJMU0sS0FBSixDQUFXLDZCQUE0QmdFLE1BQU8sRUFBOUMsQ0FBTjtBQUNELENBTkQ7O0FBYUEvRSxPQUFPLENBQUMwTixPQUFSLEdBQWtCLGVBQWVBLE9BQWYsR0FBMEI7QUFDMUMsTUFBSTtBQUNGLFVBQU0sS0FBS0MsVUFBTCxFQUFOO0FBQ0EsVUFBTSxLQUFLQyxVQUFMLEVBQU47QUFDQSxVQUFNLEtBQUtDLGFBQUwsQ0FBbUIsRUFBbkIsQ0FBTjtBQUNBLFVBQU0sS0FBS0MsV0FBTCxFQUFOO0FBQ0QsR0FMRCxDQUtFLE9BQU9qTSxDQUFQLEVBQVU7QUFDVixVQUFNLElBQUlkLEtBQUosQ0FBVyxtQ0FBa0NjLENBQUMsQ0FBQ0MsT0FBUSxFQUF2RCxDQUFOO0FBQ0Q7QUFDRixDQVREOztBQWdCQTlCLE9BQU8sQ0FBQzhOLFdBQVIsR0FBc0IsZUFBZUEsV0FBZixHQUE4QjtBQUNsRCxNQUFJLENBQUM3TSxnQkFBRTRDLE9BQUYsQ0FBVSxLQUFLa0ssTUFBZixDQUFMLEVBQTZCO0FBQzNCLFVBQU0sSUFBSWhOLEtBQUosQ0FBVSwwREFBVixDQUFOO0FBQ0Q7O0FBQ0QsT0FBS2dOLE1BQUwsR0FBYyxJQUFJQyxlQUFKLENBQVc7QUFDdkIzTixJQUFBQSxHQUFHLEVBQUUsS0FBS0gsVUFEYTtBQUV2QnlCLElBQUFBLEtBQUssRUFBRSxLQUZnQjtBQUd2QnNNLElBQUFBLFVBQVUsRUFBRSxLQUhXO0FBSXZCQyxJQUFBQSxzQkFBc0IsRUFBRSxDQUFDLENBQUMsS0FBS0E7QUFKUixHQUFYLENBQWQ7QUFNQSxRQUFNLEtBQUtILE1BQUwsQ0FBWUksWUFBWixFQUFOO0FBQ0QsQ0FYRDs7QUFpQkFuTyxPQUFPLENBQUMyTixVQUFSLEdBQXFCLGVBQWVBLFVBQWYsR0FBNkI7QUFDaEQsTUFBSTFNLGdCQUFFNEMsT0FBRixDQUFVLEtBQUtrSyxNQUFmLENBQUosRUFBNEI7QUFDMUI7QUFDRDs7QUFDRCxNQUFJO0FBQ0YsVUFBTSxLQUFLQSxNQUFMLENBQVlLLFdBQVosRUFBTjtBQUNELEdBRkQsU0FFVTtBQUNSLFNBQUtMLE1BQUwsR0FBYyxJQUFkO0FBQ0Q7QUFDRixDQVREOztBQWtCQS9OLE9BQU8sQ0FBQ3FPLGFBQVIsR0FBd0IsU0FBU0EsYUFBVCxHQUEwQjtBQUNoRCxNQUFJcE4sZ0JBQUU0QyxPQUFGLENBQVUsS0FBS2tLLE1BQWYsQ0FBSixFQUE0QjtBQUMxQixVQUFNLElBQUloTixLQUFKLENBQVUsbURBQVYsQ0FBTjtBQUNEOztBQUNELFNBQU8sS0FBS2dOLE1BQUwsQ0FBWU8sT0FBWixFQUFQO0FBQ0QsQ0FMRDs7QUFjQXRPLE9BQU8sQ0FBQ3VPLGlCQUFSLEdBQTRCLFNBQVNBLGlCQUFULENBQTRCQyxRQUE1QixFQUFzQztBQUNoRSxNQUFJdk4sZ0JBQUU0QyxPQUFGLENBQVUsS0FBS2tLLE1BQWYsQ0FBSixFQUE0QjtBQUMxQixVQUFNLElBQUloTixLQUFKLENBQVUsb0NBQVYsQ0FBTjtBQUNEOztBQUNELE9BQUtnTixNQUFMLENBQVk3RSxFQUFaLENBQWUsUUFBZixFQUF5QnNGLFFBQXpCO0FBQ0QsQ0FMRDs7QUFjQXhPLE9BQU8sQ0FBQ3lPLG9CQUFSLEdBQStCLFNBQVNBLG9CQUFULENBQStCRCxRQUEvQixFQUF5QztBQUN0RSxNQUFJdk4sZ0JBQUU0QyxPQUFGLENBQVUsS0FBS2tLLE1BQWYsQ0FBSixFQUE0QjtBQUMxQixVQUFNLElBQUloTixLQUFKLENBQVUsb0NBQVYsQ0FBTjtBQUNEOztBQUNELE9BQUtnTixNQUFMLENBQVlXLGNBQVosQ0FBMkIsUUFBM0IsRUFBcUNGLFFBQXJDO0FBQ0QsQ0FMRDs7QUFhQXhPLE9BQU8sQ0FBQzJNLGFBQVIsR0FBd0IsZUFBZUEsYUFBZixDQUE4QmdDLElBQTlCLEVBQW9DO0FBQzFEak4sa0JBQUlDLEtBQUosQ0FBVyx1QkFBc0JnTixJQUFLLGFBQXRDOztBQUNBLE1BQUksQ0FBQzFOLGdCQUFFMk4sU0FBRixDQUFZLEtBQUtDLGlCQUFqQixDQUFMLEVBQTBDO0FBRXhDLFVBQU1DLFdBQVcsR0FBRzdOLGdCQUFFTyxJQUFGLEVBQU8sTUFBTSxLQUFLZSxLQUFMLENBQVcsQ0FBQyx1QkFBRCxDQUFYLENBQWIsRUFBcEI7O0FBQ0EsU0FBS3NNLGlCQUFMLEdBQXlCdE4sUUFBUSxDQUFDTixnQkFBRXNJLElBQUYsQ0FBT3VGLFdBQVcsQ0FBQzNKLEtBQVosQ0FBa0IsS0FBbEIsQ0FBUCxDQUFELEVBQW1DLEVBQW5DLENBQVIsS0FBbUQsQ0FBNUU7O0FBQ0EsUUFBSSxLQUFLMEosaUJBQVQsRUFBNEI7QUFDMUIsV0FBS0UsNkJBQUwsR0FBcUMsU0FBUzFGLElBQVQsQ0FBY3lGLFdBQWQsQ0FBckM7QUFDRCxLQUZELE1BRU87QUFDTCxXQUFLRSxpQkFBTCxHQUF5QnpOLFFBQVEsRUFBQyxNQUFNLEtBQUtnQixLQUFMLENBQVcsQ0FBQyxtQ0FBRCxDQUFYLENBQVAsR0FBMEQsRUFBMUQsQ0FBUixLQUEwRSxDQUFuRztBQUNEO0FBQ0Y7O0FBQ0QsTUFBSSxLQUFLc00saUJBQUwsSUFBMEIsS0FBS0csaUJBQW5DLEVBQXNEO0FBQ3BELFVBQU1DLFlBQVksR0FBRyxLQUFLSixpQkFBTCxHQUNoQixLQUFLRSw2QkFBTCxHQUNDLENBQUMsT0FBRCxFQUFVLElBQVYsRUFBZ0I5TixnQkFBRWlPLFlBQUYsQ0FBZVAsSUFBZixDQUFoQixDQURELEdBRUMsQ0FBQyxPQUFELEVBQVcsSUFBRzFOLGdCQUFFaU8sWUFBRixDQUFlUCxJQUFJLENBQUNRLEtBQUwsQ0FBVyxDQUFDLEVBQVosQ0FBZixDQUFnQyxHQUE5QyxDQUhlLEdBSWpCLENBQUMsT0FBRCxFQUFVUixJQUFWLENBSko7O0FBS0EsUUFBSTtBQUNGLGFBQU8sQ0FBQyxNQUFNLEtBQUtwTSxLQUFMLENBQVcwTSxZQUFYLENBQVAsRUFDSjlKLEtBREksQ0FDRSxLQURGLEVBRUpDLEdBRkksQ0FFQ2dLLENBQUQsSUFBTzdOLFFBQVEsQ0FBQzZOLENBQUQsRUFBSSxFQUFKLENBRmYsRUFHSjlKLE1BSEksQ0FHSThKLENBQUQsSUFBT25PLGdCQUFFQyxTQUFGLENBQVlrTyxDQUFaLENBSFYsQ0FBUDtBQUlELEtBTEQsQ0FLRSxPQUFPdk4sQ0FBUCxFQUFVO0FBR1YsVUFBSUEsQ0FBQyxDQUFDNEUsSUFBRixLQUFXLENBQWYsRUFBa0I7QUFDaEIsZUFBTyxFQUFQO0FBQ0Q7O0FBQ0QsWUFBTSxJQUFJMUYsS0FBSixDQUFXLG9DQUFtQzROLElBQUssTUFBSzlNLENBQUMsQ0FBQ0MsT0FBUSxFQUFsRSxDQUFOO0FBQ0Q7QUFDRjs7QUFFREosa0JBQUlDLEtBQUosQ0FBVSw4QkFBVjs7QUFDQSxRQUFNME4sY0FBYyxHQUFHLEtBQXZCO0FBQ0EsUUFBTUMsc0JBQXNCLEdBQUcsTUFBL0I7QUFDQSxRQUFNdkssTUFBTSxHQUFHLE1BQU0sS0FBS3hDLEtBQUwsQ0FBVyxDQUFDLElBQUQsQ0FBWCxDQUFyQjtBQUNBLFFBQU1nTixVQUFVLEdBQUcsSUFBSTdNLE1BQUosQ0FBWSxVQUFTMk0sY0FBZSxXQUFVQyxzQkFBdUIsU0FBckUsRUFBK0UsR0FBL0UsRUFBb0YzTSxJQUFwRixDQUF5Rm9DLE1BQXpGLENBQW5COztBQUNBLE1BQUksQ0FBQ3dLLFVBQUwsRUFBaUI7QUFDZixVQUFNLElBQUl4TyxLQUFKLENBQVcsNkJBQTRCNE4sSUFBSyxxQkFBb0I1SixNQUFPLEVBQXZFLENBQU47QUFDRDs7QUFDRCxRQUFNeUssU0FBUyxHQUFHRCxVQUFVLENBQUMsQ0FBRCxDQUFWLENBQWMvTixJQUFkLEdBQXFCMkQsS0FBckIsQ0FBMkIsS0FBM0IsQ0FBbEI7QUFDQSxRQUFNc0ssUUFBUSxHQUFHRCxTQUFTLENBQUMvQixPQUFWLENBQWtCNEIsY0FBbEIsQ0FBakI7QUFDQSxRQUFNSyxJQUFJLEdBQUcsRUFBYjtBQUNBLFFBQU1DLGdCQUFnQixHQUFHLElBQUlqTixNQUFKLENBQVksc0JBQXFCekIsZ0JBQUVpTyxZQUFGLENBQWVQLElBQWYsQ0FBcUIsU0FBdEQsRUFBZ0UsSUFBaEUsQ0FBekI7QUFDQSxNQUFJaUIsV0FBSjs7QUFDQSxTQUFRQSxXQUFXLEdBQUdELGdCQUFnQixDQUFDaE4sSUFBakIsQ0FBc0JvQyxNQUF0QixDQUF0QixFQUFzRDtBQUNwRCxVQUFNOEssS0FBSyxHQUFHRCxXQUFXLENBQUMsQ0FBRCxDQUFYLENBQWVwTyxJQUFmLEdBQXNCMkQsS0FBdEIsQ0FBNEIsS0FBNUIsQ0FBZDs7QUFDQSxRQUFJc0ssUUFBUSxJQUFJRCxTQUFTLENBQUNwTixNQUF0QixJQUFnQ1IsS0FBSyxDQUFDaU8sS0FBSyxDQUFDSixRQUFELENBQU4sQ0FBekMsRUFBNEQ7QUFDMUQsWUFBTSxJQUFJMU8sS0FBSixDQUFXLDZCQUE0QjROLElBQUssV0FBVWlCLFdBQVcsQ0FBQyxDQUFELENBQVgsQ0FBZXBPLElBQWYsRUFBc0IsaUJBQWdCdUQsTUFBTyxFQUFuRyxDQUFOO0FBQ0Q7O0FBQ0QySyxJQUFBQSxJQUFJLENBQUNuTCxJQUFMLENBQVVoRCxRQUFRLENBQUNzTyxLQUFLLENBQUNKLFFBQUQsQ0FBTixFQUFrQixFQUFsQixDQUFsQjtBQUNEOztBQUNELFNBQU9DLElBQVA7QUFDRCxDQXRERDs7QUE4REExUCxPQUFPLENBQUM4UCxtQkFBUixHQUE4QixlQUFlQSxtQkFBZixDQUFvQ25CLElBQXBDLEVBQTBDO0FBQ3RFLE1BQUk7QUFDRmpOLG9CQUFJQyxLQUFKLENBQVcsMEJBQXlCZ04sSUFBSyxZQUF6Qzs7QUFDQSxRQUFJZSxJQUFJLEdBQUcsTUFBTSxLQUFLL0MsYUFBTCxDQUFtQmdDLElBQW5CLENBQWpCOztBQUNBLFFBQUkxTixnQkFBRTRDLE9BQUYsQ0FBVTZMLElBQVYsQ0FBSixFQUFxQjtBQUNuQmhPLHNCQUFJTSxJQUFKLENBQVUsT0FBTTJNLElBQUssMEJBQXJCOztBQUNBO0FBQ0Q7O0FBQ0QsU0FBSyxJQUFJb0IsR0FBVCxJQUFnQkwsSUFBaEIsRUFBc0I7QUFDcEIsWUFBTSxLQUFLTSxnQkFBTCxDQUFzQkQsR0FBdEIsQ0FBTjtBQUNEO0FBQ0YsR0FWRCxDQVVFLE9BQU9sTyxDQUFQLEVBQVU7QUFDVixVQUFNLElBQUlkLEtBQUosQ0FBVyxrQkFBaUI0TixJQUFLLCtCQUE4QjlNLENBQUMsQ0FBQ0MsT0FBUSxFQUF6RSxDQUFOO0FBQ0Q7QUFDRixDQWREOztBQXlCQTlCLE9BQU8sQ0FBQ2dRLGdCQUFSLEdBQTJCLGVBQWVBLGdCQUFmLENBQWlDRCxHQUFqQyxFQUFzQztBQUMvRHJPLGtCQUFJQyxLQUFKLENBQVcsOEJBQTZCb08sR0FBSSxFQUE1Qzs7QUFDQSxNQUFJRSxPQUFPLEdBQUcsS0FBZDtBQUNBLE1BQUlDLFVBQVUsR0FBRyxLQUFqQjs7QUFDQSxNQUFJO0FBQ0YsUUFBSTtBQUVGLFlBQU0sS0FBSzNOLEtBQUwsQ0FBVyxDQUFDLE1BQUQsRUFBUyxJQUFULEVBQWV3TixHQUFmLENBQVgsQ0FBTjtBQUNELEtBSEQsQ0FHRSxPQUFPbE8sQ0FBUCxFQUFVO0FBQ1YsVUFBSSxDQUFDQSxDQUFDLENBQUNDLE9BQUYsQ0FBVTRDLFFBQVYsQ0FBbUIseUJBQW5CLENBQUwsRUFBb0Q7QUFDbEQsY0FBTTdDLENBQU47QUFDRDs7QUFDRCxVQUFJO0FBQ0ZvTyxRQUFBQSxPQUFPLEdBQUcsTUFBTSxLQUFLRSxNQUFMLEVBQWhCO0FBQ0QsT0FGRCxDQUVFLE9BQU9DLEdBQVAsRUFBWSxDQUFFOztBQUNoQixVQUFJSCxPQUFKLEVBQWE7QUFDWCxjQUFNcE8sQ0FBTjtBQUNEOztBQUNESCxzQkFBSU0sSUFBSixDQUFVLG1CQUFrQitOLEdBQUksb0RBQWhDOztBQUNBLFVBQUk7QUFBQ00sUUFBQUE7QUFBRCxVQUFpQixNQUFNLEtBQUtDLElBQUwsRUFBM0I7QUFDQUosTUFBQUEsVUFBVSxHQUFHRyxZQUFiO0FBQ0EsWUFBTSxLQUFLOU4sS0FBTCxDQUFXLENBQUMsTUFBRCxFQUFTLElBQVQsRUFBZXdOLEdBQWYsQ0FBWCxDQUFOO0FBQ0Q7O0FBQ0QsVUFBTTdJLFNBQVMsR0FBRyxJQUFsQjtBQUNBLFFBQUluQyxNQUFKOztBQUNBLFFBQUk7QUFDRixZQUFNLGdDQUFpQixZQUFZO0FBQ2pDLFlBQUk7QUFDRkEsVUFBQUEsTUFBTSxHQUFHLE1BQU0sS0FBS3hDLEtBQUwsQ0FBVyxDQUFDLE1BQUQsRUFBU3dOLEdBQVQsQ0FBWCxDQUFmO0FBQ0EsaUJBQU8sS0FBUDtBQUNELFNBSEQsQ0FHRSxPQUFPbE8sQ0FBUCxFQUFVO0FBRVYsaUJBQU8sSUFBUDtBQUNEO0FBQ0YsT0FSSyxFQVFIO0FBQUNzRixRQUFBQSxNQUFNLEVBQUVELFNBQVQ7QUFBb0JFLFFBQUFBLFVBQVUsRUFBRTtBQUFoQyxPQVJHLENBQU47QUFTRCxLQVZELENBVUUsT0FBT3RHLEdBQVAsRUFBWTtBQUNaWSxzQkFBSTRCLElBQUosQ0FBVSx1QkFBc0J5TSxHQUFJLE9BQU03SSxTQUFVLDhCQUFwRDs7QUFDQW5DLE1BQUFBLE1BQU0sR0FBRyxNQUFNLEtBQUt4QyxLQUFMLENBQVcsQ0FBQyxNQUFELEVBQVMsSUFBVCxFQUFld04sR0FBZixDQUFYLENBQWY7QUFDRDs7QUFDRCxXQUFPaEwsTUFBUDtBQUNELEdBcENELFNBb0NVO0FBQ1IsUUFBSW1MLFVBQUosRUFBZ0I7QUFDZCxZQUFNLEtBQUtLLE1BQUwsRUFBTjtBQUNEO0FBQ0Y7QUFDRixDQTdDRDs7QUFzREF2USxPQUFPLENBQUN3USxtQkFBUixHQUE4QixlQUFlQSxtQkFBZixDQUFvQ0MsTUFBcEMsRUFBNEMvRCxXQUE1QyxFQUF5RDtBQUVyRixPQUFLZ0UsU0FBTCxDQUFlRCxNQUFmO0FBRUEsTUFBSUUsS0FBSyxHQUFHQyxJQUFJLENBQUNDLEdBQUwsRUFBWjtBQUNBLE1BQUkzSixTQUFTLEdBQUcsS0FBaEI7O0FBQ0EsTUFBSTtBQUNGLFdBQVEwSixJQUFJLENBQUNDLEdBQUwsS0FBYUYsS0FBZCxHQUF1QnpKLFNBQTlCLEVBQXlDO0FBQ3ZDLFVBQUksTUFBTSxLQUFLdUYsYUFBTCxDQUFtQkMsV0FBbkIsQ0FBVixFQUEyQztBQUV6QyxjQUFNLHFCQUFNLEdBQU4sQ0FBTjtBQUNBO0FBQ0Q7O0FBQ0Q7QUFDRDs7QUFDRCxVQUFNLElBQUkzTCxLQUFKLENBQVcsNkJBQTRCbUcsU0FBVSxLQUFqRCxDQUFOO0FBQ0QsR0FWRCxDQVVFLE9BQU9yRixDQUFQLEVBQVU7QUFDVixVQUFNLElBQUlkLEtBQUosQ0FBVyxvREFBbURjLENBQUMsQ0FBQ0MsT0FBUSxFQUF4RSxDQUFOO0FBQ0Q7QUFDRixDQW5CRDs7QUEyQkE5QixPQUFPLENBQUMwUSxTQUFSLEdBQW9CLGVBQWVBLFNBQWYsQ0FBMEJELE1BQTFCLEVBQWtDO0FBQ3BELE1BQUksQ0FBQyxLQUFLak8sWUFBTCxDQUFrQmlPLE1BQWxCLENBQUwsRUFBZ0M7QUFDOUIsVUFBTSxJQUFJMVAsS0FBSixDQUFXLGtCQUFpQjBQLE1BQU8sRUFBbkMsQ0FBTjtBQUNEOztBQUNEL08sa0JBQUlDLEtBQUosQ0FBVyxpQkFBZ0I4TyxNQUFPLEVBQWxDOztBQUNBLFFBQU0sS0FBS2xPLEtBQUwsQ0FBVyxDQUFDLElBQUQsRUFBTyxXQUFQLEVBQW9CLElBQXBCLEVBQTBCa08sTUFBMUIsQ0FBWCxDQUFOO0FBQ0QsQ0FORDs7QUFXQXpRLE9BQU8sQ0FBQzhRLGtCQUFSLEdBQTZCLGVBQWVBLGtCQUFmLEdBQXFDO0FBQ2hFLE1BQUksS0FBS0MsY0FBTCxJQUF1QixLQUFLQSxjQUFMLENBQW9CQyxTQUEvQyxFQUEwRDtBQUN4RCxVQUFNLEtBQUtELGNBQUwsQ0FBb0JFLElBQXBCLEVBQU47QUFDRDtBQUNGLENBSkQ7O0FBZUFqUixPQUFPLENBQUNrUixVQUFSLEdBQXFCLGVBQWVBLFVBQWYsQ0FBMkJyTyxHQUEzQixFQUFnQ3NPLFFBQWhDLEVBQTBDQyxjQUExQyxFQUEwRDtBQUM3RSxNQUFJRCxRQUFRLENBQUMsQ0FBRCxDQUFSLEtBQWdCLEdBQXBCLEVBQXlCO0FBQ3ZCdE8sSUFBQUEsR0FBRyxHQUFHLEVBQU47QUFDRDs7QUFDRCxNQUFJd08sV0FBVyxHQUFHLENBQUN4TyxHQUFHLEdBQUdzTyxRQUFQLEVBQWlCdkssT0FBakIsQ0FBeUIsTUFBekIsRUFBaUMsR0FBakMsQ0FBbEI7QUFDQSxNQUFJN0IsTUFBTSxHQUFHLE1BQU0sS0FBS3hDLEtBQUwsQ0FBVyxDQUM1QixJQUQ0QixFQUN0QixZQURzQixFQUU1QixJQUY0QixFQUV0QixlQUZzQixFQUc1QjhPLFdBSDRCLEVBSTVCRCxjQUo0QixDQUFYLENBQW5COztBQU1BLE1BQUlyTSxNQUFNLENBQUMwSSxPQUFQLENBQWUsV0FBZixNQUFnQyxDQUFDLENBQXJDLEVBQXdDO0FBQ3RDLFVBQU0sSUFBSTFNLEtBQUosQ0FBVyw0REFBMkRnRSxNQUFNLENBQUNJLEtBQVAsQ0FBYSxJQUFiLEVBQW1CLENBQW5CLENBQXNCLEVBQTVGLENBQU47QUFDRDtBQUNGLENBZEQ7O0FBMEJBbkYsT0FBTyxDQUFDc1IsZUFBUixHQUEwQixlQUFlQSxlQUFmLENBQWdDQyxlQUFoQyxFQUFpREMsT0FBakQsRUFBMERDLFlBQTFELEVBQXdFO0FBQ2hHLE1BQUksQ0FBQyxLQUFLalAsWUFBTCxDQUFrQitPLGVBQWxCLENBQUwsRUFBeUM7QUFDdkMsVUFBTSxJQUFJeFEsS0FBSixDQUFXLGlCQUFnQndRLGVBQWdCLEVBQTNDLENBQU47QUFDRDs7QUFDRCxTQUFPLE1BQU0sSUFBSTlJLGlCQUFKLENBQU0sT0FBT1osT0FBUCxFQUFnQmEsTUFBaEIsS0FBMkI7QUFDNUMsUUFBSTVCLElBQUksR0FBRyxLQUFLNUcsVUFBTCxDQUFnQndSLFdBQWhCLENBQ1JDLE1BRFEsQ0FDRCxDQUFDLE9BQUQsRUFBVSxJQUFWLEVBQWdCLFlBQWhCLEVBQThCLElBQTlCLEVBQW9DLFVBQXBDLEVBQWdELE1BQWhELEVBQXdELElBQXhELENBREMsRUFFUkEsTUFGUSxDQUVELENBQUNKLGVBQUQsQ0FGQyxDQUFYOztBQUdBN1Asb0JBQUlDLEtBQUosQ0FBVyxrQ0FBaUMsQ0FBQyxLQUFLekIsVUFBTCxDQUFnQkMsSUFBakIsRUFBdUJ3UixNQUF2QixDQUE4QjdLLElBQTlCLEVBQW9DeEMsSUFBcEMsQ0FBeUMsR0FBekMsQ0FBOEMsRUFBMUY7O0FBQ0EsUUFBSTtBQUVGLFdBQUt5TSxjQUFMLEdBQXNCLElBQUlhLHdCQUFKLENBQWUsS0FBSzFSLFVBQUwsQ0FBZ0JDLElBQS9CLEVBQXFDMkcsSUFBckMsQ0FBdEI7QUFDQSxZQUFNLEtBQUtpSyxjQUFMLENBQW9CSixLQUFwQixDQUEwQixDQUExQixDQUFOO0FBQ0EsV0FBS0ksY0FBTCxDQUFvQjdILEVBQXBCLENBQXVCLFFBQXZCLEVBQWlDLENBQUNuRSxNQUFELEVBQVM4TSxNQUFULEtBQW9CO0FBQ25ELFlBQUlBLE1BQUosRUFBWTtBQUNWbkosVUFBQUEsTUFBTSxDQUFDLElBQUkzSCxLQUFKLENBQVcsa0RBQWlEOFEsTUFBTyxFQUFuRSxDQUFELENBQU47QUFDRDtBQUNGLE9BSkQ7QUFLQSxZQUFNLEtBQUtDLGVBQUwsQ0FBcUJOLE9BQXJCLEVBQThCQyxZQUE5QixDQUFOO0FBQ0E1SixNQUFBQSxPQUFPO0FBQ1IsS0FYRCxDQVdFLE9BQU9oRyxDQUFQLEVBQVU7QUFDVjZHLE1BQUFBLE1BQU0sQ0FBQyxJQUFJM0gsS0FBSixDQUFXLDRDQUEyQ2MsQ0FBQyxDQUFDQyxPQUFRLEVBQWhFLENBQUQsQ0FBTjtBQUNEO0FBQ0YsR0FuQlksQ0FBYjtBQW9CRCxDQXhCRDs7QUFrQ0E5QixPQUFPLENBQUNxQixpQkFBUixHQUE0QixlQUFlQSxpQkFBZixDQUFrQzBRLFFBQWxDLEVBQTRDO0FBQ3RFLE1BQUloTixNQUFNLEdBQUcsTUFBTSxLQUFLeEMsS0FBTCxDQUFXLENBQUMsU0FBRCxFQUFZd1AsUUFBWixDQUFYLENBQW5CO0FBQ0EsTUFBSUMsR0FBRyxHQUFHak4sTUFBTSxDQUFDdkQsSUFBUCxFQUFWOztBQUNBRSxrQkFBSUMsS0FBSixDQUFXLDRCQUEyQm9RLFFBQVMsTUFBS0MsR0FBSSxFQUF4RDs7QUFDQSxTQUFPQSxHQUFQO0FBQ0QsQ0FMRDs7QUFzQkFoUyxPQUFPLENBQUNpUyxpQkFBUixHQUE0QixlQUFlQSxpQkFBZixDQUFrQ0MsSUFBbEMsRUFBd0NGLEdBQXhDLEVBQTZDNUYsSUFBSSxHQUFHLEVBQXBELEVBQXdEO0FBQ2xGLFFBQU07QUFBQ3RDLElBQUFBLFVBQVUsR0FBRztBQUFkLE1BQXNCc0MsSUFBNUI7O0FBQ0ExSyxrQkFBSUMsS0FBSixDQUFXLDRCQUEyQnVRLElBQUssU0FBUUYsR0FBSSxHQUF2RDs7QUFDQSxRQUFNLEtBQUt6UCxLQUFMLENBQVcsQ0FBQyxTQUFELEVBQVkyUCxJQUFaLEVBQWtCRixHQUFsQixDQUFYLEVBQW1DO0FBQ3ZDbEksSUFBQUE7QUFEdUMsR0FBbkMsQ0FBTjtBQUdELENBTkQ7O0FBV0E5SixPQUFPLENBQUNtUyxvQkFBUixHQUErQixlQUFlQSxvQkFBZixHQUF1QztBQUNwRSxTQUFPLE1BQU0sS0FBSzlRLGlCQUFMLENBQXVCLHNCQUF2QixDQUFiO0FBQ0QsQ0FGRDs7QUFPQXJCLE9BQU8sQ0FBQ29TLG1CQUFSLEdBQThCLGVBQWVBLG1CQUFmLEdBQXNDO0FBQ2xFLFNBQU8sTUFBTSxLQUFLL1EsaUJBQUwsQ0FBdUIscUJBQXZCLENBQWI7QUFDRCxDQUZEOztBQU9BckIsT0FBTyxDQUFDcVMsa0JBQVIsR0FBNkIsZUFBZUEsa0JBQWYsR0FBcUM7QUFDaEUsU0FBTyxNQUFNLEtBQUtoUixpQkFBTCxDQUF1QixvQkFBdkIsQ0FBYjtBQUNELENBRkQ7O0FBT0FyQixPQUFPLENBQUNzUyx3QkFBUixHQUFtQyxlQUFlQSx3QkFBZixHQUEyQztBQUM1RSxTQUFPLE1BQU0sS0FBS2pSLGlCQUFMLENBQXVCLDRCQUF2QixDQUFiO0FBQ0QsQ0FGRDs7QUFPQXJCLE9BQU8sQ0FBQ3VTLHVCQUFSLEdBQWtDLGVBQWVBLHVCQUFmLEdBQTBDO0FBQzFFLFNBQU8sTUFBTSxLQUFLbFIsaUJBQUwsQ0FBdUIsMEJBQXZCLENBQWI7QUFDRCxDQUZEOztBQU9BckIsT0FBTyxDQUFDd1Msc0JBQVIsR0FBaUMsZUFBZUEsc0JBQWYsR0FBeUM7QUFDeEUsU0FBTyxNQUFNLEtBQUtuUixpQkFBTCxDQUF1QixtQkFBdkIsQ0FBYjtBQUNELENBRkQ7O0FBT0FyQixPQUFPLENBQUN5UyxRQUFSLEdBQW1CLGVBQWVBLFFBQWYsR0FBMkI7QUFDNUMsU0FBTyxNQUFNLEtBQUtwUixpQkFBTCxDQUF1QixrQkFBdkIsQ0FBYjtBQUNELENBRkQ7O0FBT0FyQixPQUFPLENBQUMwUyxlQUFSLEdBQTBCLGVBQWVBLGVBQWYsR0FBa0M7QUFDMUQsU0FBTyxNQUFNLEtBQUtyUixpQkFBTCxDQUF1Qix5QkFBdkIsQ0FBYjtBQUNELENBRkQ7O0FBVUFyQixPQUFPLENBQUMyUyxhQUFSLEdBQXdCLGVBQWVBLGFBQWYsR0FBZ0M7QUFDdEQsTUFBSTVOLE1BQU0sR0FBRyxNQUFNLEtBQUt4QyxLQUFMLENBQVcsQ0FBQyxJQUFELEVBQU8sTUFBUCxDQUFYLENBQW5CO0FBQ0EsTUFBSXFRLElBQUksR0FBRyxJQUFJbFEsTUFBSixDQUFXLDhCQUFYLEVBQTJDQyxJQUEzQyxDQUFnRG9DLE1BQWhELENBQVg7O0FBQ0EsTUFBSTZOLElBQUksSUFBSUEsSUFBSSxDQUFDeFEsTUFBTCxJQUFlLENBQTNCLEVBQThCO0FBQzVCLFdBQU93USxJQUFJLENBQUMsQ0FBRCxDQUFKLENBQVFwUixJQUFSLEVBQVA7QUFDRDs7QUFDRCxTQUFPLElBQVA7QUFDRCxDQVBEOztBQWVBeEIsT0FBTyxDQUFDNlMsZ0JBQVIsR0FBMkIsZUFBZUEsZ0JBQWYsR0FBbUM7QUFDNUQsTUFBSTlOLE1BQU0sR0FBRyxNQUFNLEtBQUt4QyxLQUFMLENBQVcsQ0FBQyxJQUFELEVBQU8sU0FBUCxDQUFYLENBQW5CO0FBQ0EsTUFBSXVRLE9BQU8sR0FBRyxJQUFJcFEsTUFBSixDQUFXLGlDQUFYLEVBQThDQyxJQUE5QyxDQUFtRG9DLE1BQW5ELENBQWQ7O0FBQ0EsTUFBSStOLE9BQU8sSUFBSUEsT0FBTyxDQUFDMVEsTUFBUixJQUFrQixDQUFqQyxFQUFvQztBQUNsQyxRQUFJMlEsYUFBYSxHQUFHeFIsUUFBUSxDQUFDdVIsT0FBTyxDQUFDLENBQUQsQ0FBUCxDQUFXdFIsSUFBWCxFQUFELEVBQW9CLEVBQXBCLENBQTVCO0FBQ0EsV0FBT0ksS0FBSyxDQUFDbVIsYUFBRCxDQUFMLEdBQXVCLElBQXZCLEdBQThCQSxhQUFyQztBQUNEOztBQUNELFNBQU8sSUFBUDtBQUNELENBUkQ7O0FBaUJBL1MsT0FBTyxDQUFDZ1QsWUFBUixHQUF1QixlQUFlQSxZQUFmLENBQTZCQyxTQUE3QixFQUF3Q0MsU0FBeEMsRUFBbUQ7QUFDeEUsTUFBSUMsS0FBSyxHQUFJLEdBQUVGLFNBQVUsSUFBR0MsU0FBVSxFQUF0Qzs7QUFDQSxNQUFJalMsZ0JBQUVtUyxXQUFGLENBQWNILFNBQWQsQ0FBSixFQUE4QjtBQUM1QixVQUFNLElBQUlsUyxLQUFKLENBQVcsMERBQXlEb1MsS0FBTSxFQUExRSxDQUFOO0FBQ0Q7O0FBQ0QsTUFBSWxTLGdCQUFFbVMsV0FBRixDQUFjRixTQUFkLENBQUosRUFBOEI7QUFDNUIsVUFBTSxJQUFJblMsS0FBSixDQUFXLHlEQUF3RG9TLEtBQU0sRUFBekUsQ0FBTjtBQUNEOztBQUVELFFBQU1FLGdCQUFnQixHQUFHLENBQ3ZCLENBQUMsWUFBRCxFQUFlRixLQUFmLENBRHVCLEVBRXZCLENBQUMsd0JBQUQsRUFBMkJGLFNBQTNCLENBRnVCLEVBR3ZCLENBQUMsd0JBQUQsRUFBMkJDLFNBQTNCLENBSHVCLENBQXpCOztBQUtBLE9BQUssTUFBTSxDQUFDSSxVQUFELEVBQWFDLFlBQWIsQ0FBWCxJQUF5Q0YsZ0JBQXpDLEVBQTJEO0FBQ3pELFVBQU0sS0FBSzNOLFVBQUwsQ0FBZ0IsUUFBaEIsRUFBMEI0TixVQUExQixFQUFzQ0MsWUFBdEMsQ0FBTjtBQUNEO0FBQ0YsQ0FqQkQ7O0FBdUJBdlQsT0FBTyxDQUFDd1QsZUFBUixHQUEwQixlQUFlQSxlQUFmLEdBQWtDO0FBQzFELFFBQU1ILGdCQUFnQixHQUFHLENBQ3ZCLFlBRHVCLEVBRXZCLHdCQUZ1QixFQUd2Qix3QkFIdUIsRUFJdkIsa0NBSnVCLENBQXpCOztBQU1BLE9BQUssTUFBTTFJLE9BQVgsSUFBc0IwSSxnQkFBdEIsRUFBd0M7QUFDdEMsVUFBTSxLQUFLOVEsS0FBTCxDQUFXLENBQUMsVUFBRCxFQUFhLFFBQWIsRUFBdUIsUUFBdkIsRUFBaUNvSSxPQUFqQyxDQUFYLENBQU47QUFDRDtBQUNGLENBVkQ7O0FBcUJBM0ssT0FBTyxDQUFDMEYsVUFBUixHQUFxQixlQUFlQSxVQUFmLENBQTJCK04sU0FBM0IsRUFBc0M5SSxPQUF0QyxFQUErQy9FLEtBQS9DLEVBQXNEO0FBQ3pFLFNBQU8sTUFBTSxLQUFLckQsS0FBTCxDQUFXLENBQUMsVUFBRCxFQUFhLEtBQWIsRUFBb0JrUixTQUFwQixFQUErQjlJLE9BQS9CLEVBQXdDL0UsS0FBeEMsQ0FBWCxDQUFiO0FBQ0QsQ0FGRDs7QUFZQTVGLE9BQU8sQ0FBQ2tGLFVBQVIsR0FBcUIsZUFBZUEsVUFBZixDQUEyQnVPLFNBQTNCLEVBQXNDOUksT0FBdEMsRUFBK0M7QUFDbEUsU0FBTyxNQUFNLEtBQUtwSSxLQUFMLENBQVcsQ0FBQyxVQUFELEVBQWEsS0FBYixFQUFvQmtSLFNBQXBCLEVBQStCOUksT0FBL0IsQ0FBWCxDQUFiO0FBQ0QsQ0FGRDs7QUFXQTNLLE9BQU8sQ0FBQzBULFNBQVIsR0FBb0IsZUFBZUEsU0FBZixDQUEwQmxILE9BQU8sR0FBRyxNQUFwQyxFQUE0QztBQUM5RCxTQUFPLE1BQU0sS0FBS1YsT0FBTCxDQUFhLENBQUMsV0FBRCxDQUFiLEVBQTRCO0FBQUNVLElBQUFBO0FBQUQsR0FBNUIsQ0FBYjtBQUNELENBRkQ7O0FBNkJBeE0sT0FBTyxDQUFDMlQsWUFBUixHQUF1QixTQUFTQSxZQUFULENBQXVCQyxXQUF2QixFQUFvQ0MsT0FBTyxHQUFHLEVBQTlDLEVBQWtEO0FBQ3ZFLFFBQU1wUCxHQUFHLEdBQUcsQ0FBQyxjQUFELENBQVo7QUFDQSxRQUFNO0FBQ0pxUCxJQUFBQSxTQURJO0FBRUpDLElBQUFBLE9BRkk7QUFHSkMsSUFBQUEsU0FISTtBQUlKQyxJQUFBQTtBQUpJLE1BS0ZKLE9BTEo7O0FBTUEsTUFBSTFKLG9CQUFLQyxRQUFMLENBQWMwSixTQUFkLENBQUosRUFBOEI7QUFDNUJyUCxJQUFBQSxHQUFHLENBQUNGLElBQUosQ0FBUyxRQUFULEVBQW1CdVAsU0FBbkI7QUFDRDs7QUFDRCxNQUFJM0osb0JBQUtDLFFBQUwsQ0FBYzRKLFNBQWQsQ0FBSixFQUE4QjtBQUM1QnZQLElBQUFBLEdBQUcsQ0FBQ0YsSUFBSixDQUFTLGNBQVQsRUFBeUJ5UCxTQUF6QjtBQUNEOztBQUNELE1BQUk3SixvQkFBS0MsUUFBTCxDQUFjMkosT0FBZCxDQUFKLEVBQTRCO0FBQzFCdFAsSUFBQUEsR0FBRyxDQUFDRixJQUFKLENBQVMsWUFBVCxFQUF1QndQLE9BQXZCO0FBQ0Q7O0FBQ0QsTUFBSUUsU0FBSixFQUFlO0FBQ2J4UCxJQUFBQSxHQUFHLENBQUNGLElBQUosQ0FBUyxhQUFUO0FBQ0Q7O0FBQ0RFLEVBQUFBLEdBQUcsQ0FBQ0YsSUFBSixDQUFTcVAsV0FBVDtBQUVBLFFBQU1NLE9BQU8sR0FBRyxDQUNkLEdBQUcsS0FBS2hVLFVBQUwsQ0FBZ0J3UixXQURMLEVBRWQsT0FGYyxFQUdkLEdBQUdqTixHQUhXLENBQWhCOztBQUtBL0Msa0JBQUlDLEtBQUosQ0FBVyw0REFBMkQsdUJBQU11UyxPQUFOLENBQWUsRUFBckY7O0FBQ0EsU0FBTyxJQUFJdEMsd0JBQUosQ0FBZSxLQUFLMVIsVUFBTCxDQUFnQkMsSUFBL0IsRUFBcUMrVCxPQUFyQyxDQUFQO0FBQ0QsQ0E3QkQ7O0FBeUNBbFUsT0FBTyxDQUFDbVUsbUJBQVIsR0FBOEIsZUFBZUEsbUJBQWYsQ0FBb0NDLE1BQXBDLEVBQTRDO0FBQ3hFMVMsa0JBQUlDLEtBQUosQ0FBVyw2QkFBNEJ5UyxNQUFPLEVBQTlDOztBQUNBLFFBQU0vTixVQUFVLEdBQUcsTUFBTSxLQUFLQSxVQUFMLEVBQXpCO0FBQ0EsUUFBTSxLQUFLSixTQUFMLENBQWVwRyxVQUFmLENBQU47O0FBQ0EsTUFBSTtBQUNGLFVBQU0sS0FBS3VHLE1BQUwsQ0FBWXZHLFVBQVosQ0FBTjtBQUNBLFVBQU0sS0FBSzBDLEtBQUwsQ0FBVyxDQUFDLE9BQUQsRUFBVSxNQUFWLEVBQW1CLElBQUc2UixNQUFPLEdBQTdCLENBQVgsQ0FBTjtBQUNELEdBSEQsU0FHVTtBQUNSLFVBQU0sS0FBS2hPLE1BQUwsQ0FBWUMsVUFBWixDQUFOO0FBQ0Q7QUFDRixDQVZEOztBQW1CQXJHLE9BQU8sQ0FBQ3FVLFdBQVIsR0FBc0IsZUFBZUEsV0FBZixHQUE4QjtBQUNsRDNTLGtCQUFJQyxLQUFKLENBQVUsMEJBQVY7O0FBQ0EsTUFBSTtBQUNGLFdBQU8sTUFBTSxLQUFLTixpQkFBTCxDQUF1QixzQkFBdkIsQ0FBYjtBQUNELEdBRkQsQ0FFRSxPQUFPUSxDQUFQLEVBQVU7QUFDVixVQUFNLElBQUlkLEtBQUosQ0FBVywyQ0FBMENjLENBQUMsQ0FBQ0MsT0FBUSxFQUEvRCxDQUFOO0FBQ0Q7QUFDRixDQVBEOztlQVNlOUIsTyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBsb2cgZnJvbSAnLi4vbG9nZ2VyLmpzJztcbmltcG9ydCB7IGdldElNRUxpc3RGcm9tT3V0cHV0LCBpc1Nob3dpbmdMb2Nrc2NyZWVuLCBpc0N1cnJlbnRGb2N1c09uS2V5Z3VhcmQsXG4gICAgICAgICBnZXRTdXJmYWNlT3JpZW50YXRpb24sIGlzU2NyZWVuT25GdWxseSwgZXh0cmFjdE1hdGNoaW5nUGVybWlzc2lvbnMgfSBmcm9tICcuLi9oZWxwZXJzLmpzJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJztcbmltcG9ydCB7IGZzLCB1dGlsIH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xuaW1wb3J0IG5ldCBmcm9tICduZXQnO1xuaW1wb3J0IHsgRU9MIH0gZnJvbSAnb3MnO1xuaW1wb3J0IExvZ2NhdCBmcm9tICcuLi9sb2djYXQnO1xuaW1wb3J0IHsgc2xlZXAsIHdhaXRGb3JDb25kaXRpb24gfSBmcm9tICdhc3luY2JveCc7XG5pbXBvcnQgeyBTdWJQcm9jZXNzIH0gZnJvbSAndGVlbl9wcm9jZXNzJztcbmltcG9ydCBCIGZyb20gJ2JsdWViaXJkJztcbmltcG9ydCB7IHF1b3RlIH0gZnJvbSAnc2hlbGwtcXVvdGUnO1xuXG5cbmNvbnN0IFNFVFRJTkdTX0hFTFBFUl9JRCA9ICdpby5hcHBpdW0uc2V0dGluZ3MnO1xuY29uc3QgV0lGSV9DT05ORUNUSU9OX1NFVFRJTkdfUkVDRUlWRVIgPSBgJHtTRVRUSU5HU19IRUxQRVJfSUR9Ly5yZWNlaXZlcnMuV2lGaUNvbm5lY3Rpb25TZXR0aW5nUmVjZWl2ZXJgO1xuY29uc3QgV0lGSV9DT05ORUNUSU9OX1NFVFRJTkdfQUNUSU9OID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS53aWZpYDtcbmNvbnN0IERBVEFfQ09OTkVDVElPTl9TRVRUSU5HX1JFQ0VJVkVSID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS8ucmVjZWl2ZXJzLkRhdGFDb25uZWN0aW9uU2V0dGluZ1JlY2VpdmVyYDtcbmNvbnN0IERBVEFfQ09OTkVDVElPTl9TRVRUSU5HX0FDVElPTiA9IGAke1NFVFRJTkdTX0hFTFBFUl9JRH0uZGF0YV9jb25uZWN0aW9uYDtcbmNvbnN0IEFOSU1BVElPTl9TRVRUSU5HX1JFQ0VJVkVSID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS8ucmVjZWl2ZXJzLkFuaW1hdGlvblNldHRpbmdSZWNlaXZlcmA7XG5jb25zdCBBTklNQVRJT05fU0VUVElOR19BQ1RJT04gPSBgJHtTRVRUSU5HU19IRUxQRVJfSUR9LmFuaW1hdGlvbmA7XG5jb25zdCBMT0NBTEVfU0VUVElOR19SRUNFSVZFUiA9IGAke1NFVFRJTkdTX0hFTFBFUl9JRH0vLnJlY2VpdmVycy5Mb2NhbGVTZXR0aW5nUmVjZWl2ZXJgO1xuY29uc3QgTE9DQUxFX1NFVFRJTkdfQUNUSU9OID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS5sb2NhbGVgO1xuY29uc3QgTE9DQVRJT05fU0VSVklDRSA9IGAke1NFVFRJTkdTX0hFTFBFUl9JRH0vLkxvY2F0aW9uU2VydmljZWA7XG5jb25zdCBMT0NBVElPTl9SRUNFSVZFUiA9IGAke1NFVFRJTkdTX0hFTFBFUl9JRH0vLnJlY2VpdmVycy5Mb2NhdGlvbkluZm9SZWNlaXZlcmA7XG5jb25zdCBMT0NBVElPTl9SRVRSSUVWQUxfQUNUSU9OID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS5sb2NhdGlvbmA7XG5jb25zdCBBUFBJVU1fSU1FID0gYCR7U0VUVElOR1NfSEVMUEVSX0lEfS8uQXBwaXVtSU1FYDtcbmNvbnN0IE1BWF9TSEVMTF9CVUZGRVJfTEVOR1RIID0gMTAwMDtcbmNvbnN0IE5PVF9DSEFOR0VBQkxFX1BFUk1fRVJST1IgPSAnbm90IGEgY2hhbmdlYWJsZSBwZXJtaXNzaW9uIHR5cGUnO1xuXG5sZXQgbWV0aG9kcyA9IHt9O1xuXG4vKipcbiAqIEdldCB0aGUgcGF0aCB0byBhZGIgZXhlY3V0YWJsZSBhbWQgYXNzaWduIGl0XG4gKiB0byB0aGlzLmV4ZWN1dGFibGUucGF0aCBhbmQgdGhpcy5iaW5hcmllcy5hZGIgcHJvcGVydGllcy5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEZ1bGwgcGF0aCB0byBhZGIgZXhlY3V0YWJsZS5cbiAqL1xubWV0aG9kcy5nZXRBZGJXaXRoQ29ycmVjdEFkYlBhdGggPSBhc3luYyBmdW5jdGlvbiBnZXRBZGJXaXRoQ29ycmVjdEFkYlBhdGggKCkge1xuICB0aGlzLmV4ZWN1dGFibGUucGF0aCA9IGF3YWl0IHRoaXMuZ2V0U2RrQmluYXJ5UGF0aCgnYWRiJyk7XG4gIHJldHVybiB0aGlzLmFkYjtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBmdWxsIHBhdGggdG8gYWFwdCB0b29sIGFuZCBhc3NpZ24gaXQgdG9cbiAqIHRoaXMuYmluYXJpZXMuYWFwdCBwcm9wZXJ0eVxuICovXG5tZXRob2RzLmluaXRBYXB0ID0gYXN5bmMgZnVuY3Rpb24gaW5pdEFhcHQgKCkge1xuICBhd2FpdCB0aGlzLmdldFNka0JpbmFyeVBhdGgoJ2FhcHQnKTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBmdWxsIHBhdGggdG8gYWFwdDIgdG9vbCBhbmQgYXNzaWduIGl0IHRvXG4gKiB0aGlzLmJpbmFyaWVzLmFhcHQyIHByb3BlcnR5XG4gKi9cbm1ldGhvZHMuaW5pdEFhcHQyID0gYXN5bmMgZnVuY3Rpb24gaW5pdEFhcHQyICgpIHtcbiAgYXdhaXQgdGhpcy5nZXRTZGtCaW5hcnlQYXRoKCdhYXB0MicpO1xufTtcblxuLyoqXG4gKiBHZXQgdGhlIGZ1bGwgcGF0aCB0byB6aXBhbGlnbiB0b29sIGFuZCBhc3NpZ24gaXQgdG9cbiAqIHRoaXMuYmluYXJpZXMuemlwYWxpZ24gcHJvcGVydHlcbiAqL1xubWV0aG9kcy5pbml0WmlwQWxpZ24gPSBhc3luYyBmdW5jdGlvbiBpbml0WmlwQWxpZ24gKCkge1xuICBhd2FpdCB0aGlzLmdldFNka0JpbmFyeVBhdGgoJ3ppcGFsaWduJyk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgZnVsbCBwYXRoIHRvIGJ1bmRsZXRvb2wgYmluYXJ5IGFuZCBhc3NpZ24gaXQgdG9cbiAqIHRoaXMuYmluYXJpZXMuYnVuZGxldG9vbCBwcm9wZXJ0eVxuICovXG5tZXRob2RzLmluaXRCdW5kbGV0b29sID0gYXN5bmMgZnVuY3Rpb24gaW5pdEJ1bmRsZXRvb2wgKCkge1xuICB0cnkge1xuICAgIHRoaXMuYmluYXJpZXMuYnVuZGxldG9vbCA9IGF3YWl0IGZzLndoaWNoKCdidW5kbGV0b29sLmphcicpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2J1bmRsZXRvb2wuamFyIGJpbmFyeSBpcyBleHBlY3RlZCB0byBiZSBwcmVzZW50IGluIFBBVEguICcgK1xuICAgICAgJ1Zpc2l0IGh0dHBzOi8vZ2l0aHViLmNvbS9nb29nbGUvYnVuZGxldG9vbCBmb3IgbW9yZSBkZXRhaWxzLicpO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBBUEkgbGV2ZWwgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge251bWJlcn0gVGhlIEFQSSBsZXZlbCBhcyBpbnRlZ2VyIG51bWJlciwgZm9yIGV4YW1wbGUgMjEgZm9yXG4gKiAgICAgICAgICAgICAgICAgIEFuZHJvaWQgTG9sbGlwb3AuIFRoZSByZXN1bHQgb2YgdGhpcyBtZXRob2QgaXMgY2FjaGVkLCBzbyBhbGwgdGhlIGZ1cnRoZXJcbiAqIGNhbGxzIHJldHVybiB0aGUgc2FtZSB2YWx1ZSBhcyB0aGUgZmlyc3Qgb25lLlxuICovXG5tZXRob2RzLmdldEFwaUxldmVsID0gYXN5bmMgZnVuY3Rpb24gZ2V0QXBpTGV2ZWwgKCkge1xuICBpZiAoIV8uaXNJbnRlZ2VyKHRoaXMuX2FwaUxldmVsKSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdHJPdXRwdXQgPSBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5idWlsZC52ZXJzaW9uLnNkaycpO1xuICAgICAgbGV0IGFwaUxldmVsID0gcGFyc2VJbnQoc3RyT3V0cHV0LnRyaW0oKSwgMTApO1xuXG4gICAgICAvLyBUZW1wIHdvcmthcm91bmQuIEFuZHJvaWQgUSBiZXRhIGVtdWxhdG9ycyByZXBvcnQgU0RLIDI4IHdoZW4gdGhleSBzaG91bGQgYmUgMjlcbiAgICAgIGlmIChhcGlMZXZlbCA9PT0gMjggJiYgKGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLmJ1aWxkLnZlcnNpb24ucmVsZWFzZScpKS50b0xvd2VyQ2FzZSgpID09PSAncScpIHtcbiAgICAgICAgbG9nLmRlYnVnKCdSZWxlYXNlIHZlcnNpb24gaXMgUSBidXQgZm91bmQgQVBJIExldmVsIDI4LiBTZXR0aW5nIEFQSSBMZXZlbCB0byAyOScpO1xuICAgICAgICBhcGlMZXZlbCA9IDI5O1xuICAgICAgfVxuICAgICAgdGhpcy5fYXBpTGV2ZWwgPSBhcGlMZXZlbDtcbiAgICAgIGxvZy5kZWJ1ZyhgRGV2aWNlIEFQSSBsZXZlbDogJHt0aGlzLl9hcGlMZXZlbH1gKTtcbiAgICAgIGlmIChpc05hTih0aGlzLl9hcGlMZXZlbCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUaGUgYWN0dWFsIG91dHB1dCAnJHtzdHJPdXRwdXR9JyBjYW5ub3QgYmUgY29udmVydGVkIHRvIGFuIGludGVnZXJgKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZGV2aWNlIEFQSSBsZXZlbC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGhpcy5fYXBpTGV2ZWw7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBwbGF0Zm9ybSB2ZXJzaW9uIG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBwbGF0Zm9ybSB2ZXJzaW9uIGFzIGEgc3RyaW5nLCBmb3IgZXhhbXBsZSAnNS4wJyBmb3JcbiAqIEFuZHJvaWQgTG9sbGlwb3AuXG4gKi9cbm1ldGhvZHMuZ2V0UGxhdGZvcm1WZXJzaW9uID0gYXN5bmMgZnVuY3Rpb24gZ2V0UGxhdGZvcm1WZXJzaW9uICgpIHtcbiAgbG9nLmluZm8oJ0dldHRpbmcgZGV2aWNlIHBsYXRmb3JtIHZlcnNpb24nKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8uYnVpbGQudmVyc2lvbi5yZWxlYXNlJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgZGV2aWNlIHBsYXRmb3JtIHZlcnNpb24uIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBWZXJpZnkgd2hldGhlciBhIGRldmljZSBpcyBjb25uZWN0ZWQuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiBhdCBsZWFzdCBvbmUgZGV2aWNlIGlzIHZpc2libGUgdG8gYWRiLlxuICovXG5tZXRob2RzLmlzRGV2aWNlQ29ubmVjdGVkID0gYXN5bmMgZnVuY3Rpb24gaXNEZXZpY2VDb25uZWN0ZWQgKCkge1xuICBsZXQgZGV2aWNlcyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGVkRGV2aWNlcygpO1xuICByZXR1cm4gZGV2aWNlcy5sZW5ndGggPiAwO1xufTtcblxuLyoqXG4gKiBSZWN1cnNpdmVseSBjcmVhdGUgYSBuZXcgZm9sZGVyIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSBuZXcgcGF0aCB0byBiZSBjcmVhdGVkLlxuICogQHJldHVybiB7c3RyaW5nfSBta2RpciBjb21tYW5kIG91dHB1dC5cbiAqL1xubWV0aG9kcy5ta2RpciA9IGFzeW5jIGZ1bmN0aW9uIG1rZGlyIChyZW1vdGVQYXRoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnbWtkaXInLCAnLXAnLCByZW1vdGVQYXRoXSk7XG59O1xuXG4vKipcbiAqIFZlcmlmeSB3aGV0aGVyIHRoZSBnaXZlbiBhcmd1bWVudCBpcyBhXG4gKiB2YWxpZCBjbGFzcyBuYW1lLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBjbGFzc1N0cmluZyAtIFRoZSBhY3R1YWwgY2xhc3MgbmFtZSB0byBiZSB2ZXJpZmllZC5cbiAqIEByZXR1cm4gez9BcnJheS48TWF0Y2g+fSBUaGUgcmVzdWx0IG9mIFJlZ2V4cC5leGVjIG9wZXJhdGlvblxuICogICAgICAgICAgICAgICAgICAgICAgICAgIG9yIF9udWxsXyBpZiBubyBtYXRjaGVzIGFyZSBmb3VuZC5cbiAqL1xubWV0aG9kcy5pc1ZhbGlkQ2xhc3MgPSBmdW5jdGlvbiBpc1ZhbGlkQ2xhc3MgKGNsYXNzU3RyaW5nKSB7XG4gIC8vIHNvbWUucGFja2FnZS9zb21lLnBhY2thZ2UuQWN0aXZpdHlcbiAgcmV0dXJuIG5ldyBSZWdFeHAoL15bYS16QS1aMC05Li9fXSskLykuZXhlYyhjbGFzc1N0cmluZyk7XG59O1xuXG4vKipcbiAqIEZvcmNlIGFwcGxpY2F0aW9uIHRvIHN0b3Agb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHN0b3BwZWQuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBvdXRwdXQgb2YgdGhlIGNvcnJlc3BvbmRpbmcgYWRiIGNvbW1hbmQuXG4gKi9cbm1ldGhvZHMuZm9yY2VTdG9wID0gYXN5bmMgZnVuY3Rpb24gZm9yY2VTdG9wIChwa2cpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydhbScsICdmb3JjZS1zdG9wJywgcGtnXSk7XG59O1xuXG4vKlxuICogS2lsbCBhcHBsaWNhdGlvblxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHN0b3BwZWQuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBvdXRwdXQgb2YgdGhlIGNvcnJlc3BvbmRpbmcgYWRiIGNvbW1hbmQuXG4gKi9cbm1ldGhvZHMua2lsbFBhY2thZ2UgPSBhc3luYyBmdW5jdGlvbiBraWxsUGFja2FnZSAocGtnKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnNoZWxsKFsnYW0nLCAna2lsbCcsIHBrZ10pO1xufTtcblxuLyoqXG4gKiBDbGVhciB0aGUgdXNlciBkYXRhIG9mIHRoZSBwYXJ0aWN1bGFyIGFwcGxpY2F0aW9uIG9uIHRoZSBkZXZpY2VcbiAqIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgY2xlYXJlZC5cbiAqIEByZXR1cm4ge3N0cmluZ30gVGhlIG91dHB1dCBvZiB0aGUgY29ycmVzcG9uZGluZyBhZGIgY29tbWFuZC5cbiAqL1xubWV0aG9kcy5jbGVhciA9IGFzeW5jIGZ1bmN0aW9uIGNsZWFyIChwa2cpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdjbGVhcicsIHBrZ10pO1xufTtcblxuLyoqXG4gKiBHcmFudCBhbGwgcGVybWlzc2lvbnMgcmVxdWVzdGVkIGJ5IHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKiBUaGlzIG1ldGhvZCBpcyBvbmx5IHVzZWZ1bCBvbiBBbmRyb2lkIDYuMCsgYW5kIGZvciBhcHBsaWNhdGlvbnNcbiAqIHRoYXQgc3VwcG9ydCBjb21wb25lbnRzLWJhc2VkIHBlcm1pc3Npb25zIHNldHRpbmcuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGFwayAtIFRoZSBwYXRoIHRvIHRoZSBhY3R1YWwgYXBrIGZpbGUuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGdyYW50aW5nIHBlcm1pc3Npb25zXG4gKi9cbm1ldGhvZHMuZ3JhbnRBbGxQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdyYW50QWxsUGVybWlzc2lvbnMgKHBrZywgYXBrKSB7XG4gIGNvbnN0IGFwaUxldmVsID0gYXdhaXQgdGhpcy5nZXRBcGlMZXZlbCgpO1xuICBsZXQgdGFyZ2V0U2RrID0gMDtcbiAgbGV0IGR1bXBzeXNPdXRwdXQgPSBudWxsO1xuICB0cnkge1xuICAgIGlmICghYXBrKSB7XG4gICAgICAvKipcbiAgICAgICAqIElmIGFwayBub3QgcHJvdmlkZWQsIGNvbnNpZGVyaW5nIGFwayBhbHJlYWR5IGluc3RhbGxlZCBvbiB0aGUgZGV2aWNlXG4gICAgICAgKiBhbmQgZmV0Y2hpbmcgdGFyZ2V0U2RrIHVzaW5nIHBhY2thZ2UgbmFtZS5cbiAgICAgICAqL1xuICAgICAgZHVtcHN5c091dHB1dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ3BhY2thZ2UnLCBwa2ddKTtcbiAgICAgIHRhcmdldFNkayA9IGF3YWl0IHRoaXMudGFyZ2V0U2RrVmVyc2lvblVzaW5nUEtHKHBrZywgZHVtcHN5c091dHB1dCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhcmdldFNkayA9IGF3YWl0IHRoaXMudGFyZ2V0U2RrVmVyc2lvbkZyb21NYW5pZmVzdChhcGspO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIC8vYXZvaWRpbmcgbG9nZ2luZyBlcnJvciBzdGFjaywgYXMgY2FsbGluZyBsaWJyYXJ5IGZ1bmN0aW9uIHdvdWxkIGhhdmUgbG9nZ2VkXG4gICAgbG9nLndhcm4oYFJhbiBpbnRvIHByb2JsZW0gZ2V0dGluZyB0YXJnZXQgU0RLIHZlcnNpb247IGlnbm9yaW5nLi4uYCk7XG4gIH1cbiAgaWYgKGFwaUxldmVsID49IDIzICYmIHRhcmdldFNkayA+PSAyMykge1xuICAgIC8qKlxuICAgICAqIElmIHRoZSBkZXZpY2UgaXMgcnVubmluZyBBbmRyb2lkIDYuMChBUEkgMjMpIG9yIGhpZ2hlciwgYW5kIHlvdXIgYXBwJ3MgdGFyZ2V0IFNESyBpcyAyMyBvciBoaWdoZXI6XG4gICAgICogVGhlIGFwcCBoYXMgdG8gbGlzdCB0aGUgcGVybWlzc2lvbnMgaW4gdGhlIG1hbmlmZXN0LlxuICAgICAqIHJlZmVyOiBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS90cmFpbmluZy9wZXJtaXNzaW9ucy9yZXF1ZXN0aW5nLmh0bWxcbiAgICAgKi9cbiAgICBkdW1wc3lzT3V0cHV0ID0gZHVtcHN5c091dHB1dCB8fCBhd2FpdCB0aGlzLnNoZWxsKFsnZHVtcHN5cycsICdwYWNrYWdlJywgcGtnXSk7XG4gICAgY29uc3QgcmVxdWVzdGVkUGVybWlzc2lvbnMgPSBhd2FpdCB0aGlzLmdldFJlcVBlcm1pc3Npb25zKHBrZywgZHVtcHN5c091dHB1dCk7XG4gICAgY29uc3QgZ3JhbnRlZFBlcm1pc3Npb25zID0gYXdhaXQgdGhpcy5nZXRHcmFudGVkUGVybWlzc2lvbnMocGtnLCBkdW1wc3lzT3V0cHV0KTtcbiAgICBjb25zdCBwZXJtaXNzaW9uc1RvR3JhbnQgPSBfLmRpZmZlcmVuY2UocmVxdWVzdGVkUGVybWlzc2lvbnMsIGdyYW50ZWRQZXJtaXNzaW9ucyk7XG4gICAgaWYgKF8uaXNFbXB0eShwZXJtaXNzaW9uc1RvR3JhbnQpKSB7XG4gICAgICBsb2cuaW5mbyhgJHtwa2d9IGNvbnRhaW5zIG5vIHBlcm1pc3Npb25zIGF2YWlsYWJsZSBmb3IgZ3JhbnRpbmdgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5ncmFudFBlcm1pc3Npb25zKHBrZywgcGVybWlzc2lvbnNUb0dyYW50KTtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogR3JhbnQgbXVsdGlwbGUgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKiBUaGlzIGNhbGwgaXMgbW9yZSBwZXJmb3JtYW50IHRoYW4gYGdyYW50UGVybWlzc2lvbmAgb25lLCBzaW5jZSBpdCBjb21iaW5lc1xuICogbXVsdGlwbGUgYGFkYiBzaGVsbGAgY2FsbHMgaW50byBhIHNpbmdsZSBjb21tYW5kLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gcGVybWlzc2lvbnMgLSBUaGUgbGlzdCBvZiBwZXJtaXNzaW9ucyB0byBiZSBncmFudGVkLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBjaGFuZ2luZyBwZXJtaXNzaW9ucy5cbiAqL1xubWV0aG9kcy5ncmFudFBlcm1pc3Npb25zID0gYXN5bmMgZnVuY3Rpb24gZ3JhbnRQZXJtaXNzaW9ucyAocGtnLCBwZXJtaXNzaW9ucykge1xuICAvLyBBcyBpdCBjb25zdW1lcyBtb3JlIHRpbWUgZm9yIGdyYW50aW5nIGVhY2ggcGVybWlzc2lvbixcbiAgLy8gdHJ5aW5nIHRvIGdyYW50IGFsbCBwZXJtaXNzaW9uIGJ5IGZvcm1pbmcgZXF1aXZhbGVudCBjb21tYW5kLlxuICAvLyBBbHNvLCBpdCBpcyBuZWNlc3NhcnkgdG8gc3BsaXQgbG9uZyBjb21tYW5kcyBpbnRvIGNodW5rcywgc2luY2UgdGhlIG1heGltdW0gbGVuZ3RoIG9mXG4gIC8vIGFkYiBzaGVsbCBidWZmZXIgaXMgbGltaXRlZFxuICBsb2cuZGVidWcoYEdyYW50aW5nIHBlcm1pc3Npb25zICR7SlNPTi5zdHJpbmdpZnkocGVybWlzc2lvbnMpfSB0byAnJHtwa2d9J2ApO1xuICBjb25zdCBjb21tYW5kcyA9IFtdO1xuICBsZXQgY21kQ2h1bmsgPSBbXTtcbiAgZm9yIChjb25zdCBwZXJtaXNzaW9uIG9mIHBlcm1pc3Npb25zKSB7XG4gICAgY29uc3QgbmV4dENtZCA9IFsncG0nLCAnZ3JhbnQnLCBwa2csIHBlcm1pc3Npb24sICc7J107XG4gICAgaWYgKG5leHRDbWQuam9pbignICcpLmxlbmd0aCArIGNtZENodW5rLmpvaW4oJyAnKS5sZW5ndGggPj0gTUFYX1NIRUxMX0JVRkZFUl9MRU5HVEgpIHtcbiAgICAgIGNvbW1hbmRzLnB1c2goY21kQ2h1bmspO1xuICAgICAgY21kQ2h1bmsgPSBbXTtcbiAgICB9XG4gICAgY21kQ2h1bmsgPSBbLi4uY21kQ2h1bmssIC4uLm5leHRDbWRdO1xuICB9XG4gIGlmICghXy5pc0VtcHR5KGNtZENodW5rKSkge1xuICAgIGNvbW1hbmRzLnB1c2goY21kQ2h1bmspO1xuICB9XG4gIGxvZy5kZWJ1ZyhgR290IHRoZSBmb2xsb3dpbmcgY29tbWFuZCBjaHVua3MgdG8gZXhlY3V0ZTogJHtKU09OLnN0cmluZ2lmeShjb21tYW5kcyl9YCk7XG4gIGxldCBsYXN0RXJyb3IgPSBudWxsO1xuICBmb3IgKGNvbnN0IGNtZCBvZiBjb21tYW5kcykge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnNoZWxsKGNtZCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gdGhpcyBpcyB0byBnaXZlIHRoZSBtZXRob2QgYSBjaGFuY2UgdG8gYXNzaWduIGFsbCB0aGUgcmVxdWVzdGVkIHBlcm1pc3Npb25zXG4gICAgICAvLyBiZWZvcmUgdG8gcXVpdCBpbiBjYXNlIHdlJ2QgbGlrZSB0byBpZ25vcmUgdGhlIGVycm9yIG9uIHRoZSBoaWdoZXIgbGV2ZWxcbiAgICAgIGlmICghZS5tZXNzYWdlLmluY2x1ZGVzKE5PVF9DSEFOR0VBQkxFX1BFUk1fRVJST1IpKSB7XG4gICAgICAgIGxhc3RFcnJvciA9IGU7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGlmIChsYXN0RXJyb3IpIHtcbiAgICB0aHJvdyBsYXN0RXJyb3I7XG4gIH1cbn07XG5cbi8qKlxuICogR3JhbnQgc2luZ2xlIHBlcm1pc3Npb24gZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IHBlcm1pc3Npb24gLSBUaGUgZnVsbCBuYW1lIG9mIHRoZSBwZXJtaXNzaW9uIHRvIGJlIGdyYW50ZWQuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGNoYW5naW5nIHBlcm1pc3Npb25zLlxuICovXG5tZXRob2RzLmdyYW50UGVybWlzc2lvbiA9IGFzeW5jIGZ1bmN0aW9uIGdyYW50UGVybWlzc2lvbiAocGtnLCBwZXJtaXNzaW9uKSB7XG4gIHRyeSB7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChbJ3BtJywgJ2dyYW50JywgcGtnLCBwZXJtaXNzaW9uXSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKCFlcnJvci5tZXNzYWdlLmluY2x1ZGVzKE5PVF9DSEFOR0VBQkxFX1BFUk1fRVJST1IpKSB7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogUmV2b2tlIHNpbmdsZSBwZXJtaXNzaW9uIGZyb20gdGhlIHBhcnRpY3VsYXIgcGFja2FnZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGtnIC0gVGhlIHBhY2thZ2UgbmFtZSB0byBiZSBwcm9jZXNzZWQuXG4gKiBAcGFyYW0ge3N0cmluZ30gcGVybWlzc2lvbiAtIFRoZSBmdWxsIG5hbWUgb2YgdGhlIHBlcm1pc3Npb24gdG8gYmUgcmV2b2tlZC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgY2hhbmdpbmcgcGVybWlzc2lvbnMuXG4gKi9cbm1ldGhvZHMucmV2b2tlUGVybWlzc2lvbiA9IGFzeW5jIGZ1bmN0aW9uIHJldm9rZVBlcm1pc3Npb24gKHBrZywgcGVybWlzc2lvbikge1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydwbScsICdyZXZva2UnLCBwa2csIHBlcm1pc3Npb25dKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoIWVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoTk9UX0NIQU5HRUFCTEVfUEVSTV9FUlJPUikpIHtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiBncmFudGVkIHBlcm1pc3Npb25zIGZvciB0aGUgcGFydGljdWxhciBwYWNrYWdlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBjbWRPdXRwdXQgW251bGxdIC0gT3B0aW9uYWwgcGFyYW1ldGVyIGNvbnRhaW5pbmcgY29tbWFuZCBvdXRwdXQgb2ZcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX2R1bXBzeXMgcGFja2FnZV8gY29tbWFuZC4gSXQgbWF5IHNwZWVkIHVwIHRoZSBtZXRob2QgZXhlY3V0aW9uLlxuICogQHJldHVybiB7QXJyYXk8U3RyaW5nPn0gVGhlIGxpc3Qgb2YgZ3JhbnRlZCBwZXJtaXNzaW9ucyBvciBhbiBlbXB0eSBsaXN0LlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBjaGFuZ2luZyBwZXJtaXNzaW9ucy5cbiAqL1xubWV0aG9kcy5nZXRHcmFudGVkUGVybWlzc2lvbnMgPSBhc3luYyBmdW5jdGlvbiBnZXRHcmFudGVkUGVybWlzc2lvbnMgKHBrZywgY21kT3V0cHV0ID0gbnVsbCkge1xuICBsb2cuZGVidWcoJ1JldHJpZXZpbmcgZ3JhbnRlZCBwZXJtaXNzaW9ucycpO1xuICBjb25zdCBzdGRvdXQgPSBjbWRPdXRwdXQgfHwgYXdhaXQgdGhpcy5zaGVsbChbJ2R1bXBzeXMnLCAncGFja2FnZScsIHBrZ10pO1xuICByZXR1cm4gZXh0cmFjdE1hdGNoaW5nUGVybWlzc2lvbnMoc3Rkb3V0LCBbJ2luc3RhbGwnLCAncnVudGltZSddLCB0cnVlKTtcbn07XG5cbi8qKlxuICogUmV0cmlldmUgdGhlIGxpc3Qgb2YgZGVuaWVkIHBlcm1pc3Npb25zIGZvciB0aGUgcGFydGljdWxhciBwYWNrYWdlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwa2cgLSBUaGUgcGFja2FnZSBuYW1lIHRvIGJlIHByb2Nlc3NlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBjbWRPdXRwdXQgW251bGxdIC0gT3B0aW9uYWwgcGFyYW1ldGVyIGNvbnRhaW5pbmcgY29tbWFuZCBvdXRwdXQgb2ZcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX2R1bXBzeXMgcGFja2FnZV8gY29tbWFuZC4gSXQgbWF5IHNwZWVkIHVwIHRoZSBtZXRob2QgZXhlY3V0aW9uLlxuICogQHJldHVybiB7QXJyYXk8U3RyaW5nPn0gVGhlIGxpc3Qgb2YgZGVuaWVkIHBlcm1pc3Npb25zIG9yIGFuIGVtcHR5IGxpc3QuXG4gKi9cbm1ldGhvZHMuZ2V0RGVuaWVkUGVybWlzc2lvbnMgPSBhc3luYyBmdW5jdGlvbiBnZXREZW5pZWRQZXJtaXNzaW9ucyAocGtnLCBjbWRPdXRwdXQgPSBudWxsKSB7XG4gIGxvZy5kZWJ1ZygnUmV0cmlldmluZyBkZW5pZWQgcGVybWlzc2lvbnMnKTtcbiAgY29uc3Qgc3Rkb3V0ID0gY21kT3V0cHV0IHx8IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ3BhY2thZ2UnLCBwa2ddKTtcbiAgcmV0dXJuIGV4dHJhY3RNYXRjaGluZ1Blcm1pc3Npb25zKHN0ZG91dCwgWydpbnN0YWxsJywgJ3J1bnRpbWUnXSwgZmFsc2UpO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbGlzdCBvZiByZXF1ZXN0ZWQgcGVybWlzc2lvbnMgZm9yIHRoZSBwYXJ0aWN1bGFyIHBhY2thZ2UuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBrZyAtIFRoZSBwYWNrYWdlIG5hbWUgdG8gYmUgcHJvY2Vzc2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IGNtZE91dHB1dCBbbnVsbF0gLSBPcHRpb25hbCBwYXJhbWV0ZXIgY29udGFpbmluZyBjb21tYW5kIG91dHB1dCBvZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfZHVtcHN5cyBwYWNrYWdlXyBjb21tYW5kLiBJdCBtYXkgc3BlZWQgdXAgdGhlIG1ldGhvZCBleGVjdXRpb24uXG4gKiBAcmV0dXJuIHtBcnJheTxTdHJpbmc+fSBUaGUgbGlzdCBvZiByZXF1ZXN0ZWQgcGVybWlzc2lvbnMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqL1xubWV0aG9kcy5nZXRSZXFQZXJtaXNzaW9ucyA9IGFzeW5jIGZ1bmN0aW9uIGdldFJlcVBlcm1pc3Npb25zIChwa2csIGNtZE91dHB1dCA9IG51bGwpIHtcbiAgbG9nLmRlYnVnKCdSZXRyaWV2aW5nIHJlcXVlc3RlZCBwZXJtaXNzaW9ucycpO1xuICBjb25zdCBzdGRvdXQgPSBjbWRPdXRwdXQgfHwgYXdhaXQgdGhpcy5zaGVsbChbJ2R1bXBzeXMnLCAncGFja2FnZScsIHBrZ10pO1xuICByZXR1cm4gZXh0cmFjdE1hdGNoaW5nUGVybWlzc2lvbnMoc3Rkb3V0LCBbJ3JlcXVlc3RlZCddKTtcbn07XG5cbi8qKlxuICogUmV0cmlldmUgdGhlIGxpc3Qgb2YgbG9jYXRpb24gcHJvdmlkZXJzIGZvciB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7QXJyYXkuPFN0cmluZz59IFRoZSBsaXN0IG9mIGF2YWlsYWJsZSBsb2NhdGlvbiBwcm92aWRlcnMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqL1xubWV0aG9kcy5nZXRMb2NhdGlvblByb3ZpZGVycyA9IGFzeW5jIGZ1bmN0aW9uIGdldExvY2F0aW9uUHJvdmlkZXJzICgpIHtcbiAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuZ2V0U2V0dGluZygnc2VjdXJlJywgJ2xvY2F0aW9uX3Byb3ZpZGVyc19hbGxvd2VkJyk7XG4gIHJldHVybiBzdGRvdXQudHJpbSgpLnNwbGl0KCcsJylcbiAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xufTtcblxuLyoqXG4gKiBUb2dnbGUgdGhlIHN0YXRlIG9mIEdQUyBsb2NhdGlvbiBwcm92aWRlci5cbiAqXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGVuYWJsZWQgLSBXaGV0aGVyIHRvIGVuYWJsZSAodHJ1ZSkgb3IgZGlzYWJsZSAoZmFsc2UpIHRoZSBHUFMgcHJvdmlkZXIuXG4gKi9cbm1ldGhvZHMudG9nZ2xlR1BTTG9jYXRpb25Qcm92aWRlciA9IGFzeW5jIGZ1bmN0aW9uIHRvZ2dsZUdQU0xvY2F0aW9uUHJvdmlkZXIgKGVuYWJsZWQpIHtcbiAgYXdhaXQgdGhpcy5zZXRTZXR0aW5nKCdzZWN1cmUnLCAnbG9jYXRpb25fcHJvdmlkZXJzX2FsbG93ZWQnLCBgJHtlbmFibGVkID8gJysnIDogJy0nfWdwc2ApO1xufTtcblxuLyoqXG4gKiBTZXQgaGlkZGVuIGFwaSBwb2xpY3kgdG8gbWFuYWdlIGFjY2VzcyB0byBub24tU0RLIEFQSXMuXG4gKiBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9wcmV2aWV3L3Jlc3RyaWN0aW9ucy1ub24tc2RrLWludGVyZmFjZXNcbiAqXG4gKiBAcGFyYW0ge251bWJlcnxzdHJpbmd9IHZhbHVlIC0gVGhlIEFQSSBlbmZvcmNlbWVudCBwb2xpY3kuXG4gKiAgICAgRm9yIEFuZHJvaWQgUFxuICogICAgIDA6IERpc2FibGUgbm9uLVNESyBBUEkgdXNhZ2UgZGV0ZWN0aW9uLiBUaGlzIHdpbGwgYWxzbyBkaXNhYmxlIGxvZ2dpbmcsIGFuZCBhbHNvIGJyZWFrIHRoZSBzdHJpY3QgbW9kZSBBUEksXG4gKiAgICAgICAgZGV0ZWN0Tm9uU2RrQXBpVXNhZ2UoKS4gTm90IHJlY29tbWVuZGVkLlxuICogICAgIDE6IFwiSnVzdCB3YXJuXCIgLSBwZXJtaXQgYWNjZXNzIHRvIGFsbCBub24tU0RLIEFQSXMsIGJ1dCBrZWVwIHdhcm5pbmdzIGluIHRoZSBsb2cuXG4gKiAgICAgICAgVGhlIHN0cmljdCBtb2RlIEFQSSB3aWxsIGtlZXAgd29ya2luZy5cbiAqICAgICAyOiBEaXNhbGxvdyB1c2FnZSBvZiBkYXJrIGdyZXkgYW5kIGJsYWNrIGxpc3RlZCBBUElzLlxuICogICAgIDM6IERpc2FsbG93IHVzYWdlIG9mIGJsYWNrbGlzdGVkIEFQSXMsIGJ1dCBhbGxvdyB1c2FnZSBvZiBkYXJrIGdyZXkgbGlzdGVkIEFQSXMuXG4gKlxuICogICAgIEZvciBBbmRyb2lkIFFcbiAqICAgICBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9wcmV2aWV3L25vbi1zZGstcSNlbmFibGUtbm9uLXNkay1hY2Nlc3NcbiAqICAgICAwOiBEaXNhYmxlIGFsbCBkZXRlY3Rpb24gb2Ygbm9uLVNESyBpbnRlcmZhY2VzLiBVc2luZyB0aGlzIHNldHRpbmcgZGlzYWJsZXMgYWxsIGxvZyBtZXNzYWdlcyBmb3Igbm9uLVNESyBpbnRlcmZhY2UgdXNhZ2VcbiAqICAgICAgICBhbmQgcHJldmVudHMgeW91IGZyb20gdGVzdGluZyB5b3VyIGFwcCB1c2luZyB0aGUgU3RyaWN0TW9kZSBBUEkuIFRoaXMgc2V0dGluZyBpcyBub3QgcmVjb21tZW5kZWQuXG4gKiAgICAgMTogRW5hYmxlIGFjY2VzcyB0byBhbGwgbm9uLVNESyBpbnRlcmZhY2VzLCBidXQgcHJpbnQgbG9nIG1lc3NhZ2VzIHdpdGggd2FybmluZ3MgZm9yIGFueSBub24tU0RLIGludGVyZmFjZSB1c2FnZS5cbiAqICAgICAgICBVc2luZyB0aGlzIHNldHRpbmcgYWxzbyBhbGxvd3MgeW91IHRvIHRlc3QgeW91ciBhcHAgdXNpbmcgdGhlIFN0cmljdE1vZGUgQVBJLlxuICogICAgIDI6IERpc2FsbG93IHVzYWdlIG9mIG5vbi1TREsgaW50ZXJmYWNlcyB0aGF0IGJlbG9uZyB0byBlaXRoZXIgdGhlIGJsYWNrIGxpc3RcbiAqICAgICAgICBvciB0byBhIHJlc3RyaWN0ZWQgZ3JleWxpc3QgZm9yIHlvdXIgdGFyZ2V0IEFQSSBsZXZlbC5cbiAqL1xubWV0aG9kcy5zZXRIaWRkZW5BcGlQb2xpY3kgPSBhc3luYyBmdW5jdGlvbiBzZXRIaWRkZW5BcGlQb2xpY3kgKHZhbHVlKSB7XG4gIGF3YWl0IHRoaXMuc2V0U2V0dGluZygnZ2xvYmFsJywgJ2hpZGRlbl9hcGlfcG9saWN5X3ByZV9wX2FwcHMnLCB2YWx1ZSk7XG4gIGF3YWl0IHRoaXMuc2V0U2V0dGluZygnZ2xvYmFsJywgJ2hpZGRlbl9hcGlfcG9saWN5X3BfYXBwcycsIHZhbHVlKTtcbiAgYXdhaXQgdGhpcy5zZXRTZXR0aW5nKCdnbG9iYWwnLCAnaGlkZGVuX2FwaV9wb2xpY3knLCB2YWx1ZSk7XG59O1xuXG4vKipcbiAqIFJlc2V0IGFjY2VzcyB0byBub24tU0RLIEFQSXMgdG8gaXRzIGRlZmF1bHQgc2V0dGluZy5cbiAqIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3ByZXZpZXcvcmVzdHJpY3Rpb25zLW5vbi1zZGstaW50ZXJmYWNlc1xuICovXG5tZXRob2RzLnNldERlZmF1bHRIaWRkZW5BcGlQb2xpY3kgPSBhc3luYyBmdW5jdGlvbiBzZXREZWZhdWx0SGlkZGVuQXBpUG9saWN5ICgpIHtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ3NldHRpbmdzJywgJ2RlbGV0ZScsICdnbG9iYWwnLCAnaGlkZGVuX2FwaV9wb2xpY3lfcHJlX3BfYXBwcyddKTtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ3NldHRpbmdzJywgJ2RlbGV0ZScsICdnbG9iYWwnLCAnaGlkZGVuX2FwaV9wb2xpY3lfcF9hcHBzJ10pO1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnc2V0dGluZ3MnLCAnZGVsZXRlJywgJ2dsb2JhbCcsICdoaWRkZW5fYXBpX3BvbGljeSddKTtcbn07XG5cbi8qKlxuICogU3RvcCB0aGUgcGFydGljdWxhciBwYWNrYWdlIGlmIGl0IGlzIHJ1bm5pbmcgYW5kIGNsZWFycyBpdHMgYXBwbGljYXRpb24gZGF0YS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGtnIC0gVGhlIHBhY2thZ2UgbmFtZSB0byBiZSBwcm9jZXNzZWQuXG4gKi9cbm1ldGhvZHMuc3RvcEFuZENsZWFyID0gYXN5bmMgZnVuY3Rpb24gc3RvcEFuZENsZWFyIChwa2cpIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCB0aGlzLmZvcmNlU3RvcChwa2cpO1xuICAgIGF3YWl0IHRoaXMuY2xlYXIocGtnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IHN0b3AgYW5kIGNsZWFyICR7cGtnfS4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGF2YWlsYWJsZSBpbnB1dCBtZXRob2RzIChJTUVzKSBmb3IgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge0FycmF5LjxTdHJpbmc+fSBUaGUgbGlzdCBvZiBJTUUgbmFtZXMgb3IgYW4gZW1wdHkgbGlzdC5cbiAqL1xubWV0aG9kcy5hdmFpbGFibGVJTUVzID0gYXN5bmMgZnVuY3Rpb24gYXZhaWxhYmxlSU1FcyAoKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGdldElNRUxpc3RGcm9tT3V0cHV0KGF3YWl0IHRoaXMuc2hlbGwoWydpbWUnLCAnbGlzdCcsICctYSddKSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgYXZhaWxhYmxlIElNRSdzLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogUmV0cmlldmUgdGhlIGxpc3Qgb2YgZW5hYmxlZCBpbnB1dCBtZXRob2RzIChJTUVzKSBmb3IgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge0FycmF5LjxTdHJpbmc+fSBUaGUgbGlzdCBvZiBlbmFibGVkIElNRSBuYW1lcyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmVuYWJsZWRJTUVzID0gYXN5bmMgZnVuY3Rpb24gZW5hYmxlZElNRXMgKCkge1xuICB0cnkge1xuICAgIHJldHVybiBnZXRJTUVMaXN0RnJvbU91dHB1dChhd2FpdCB0aGlzLnNoZWxsKFsnaW1lJywgJ2xpc3QnXSkpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBnZXR0aW5nIGVuYWJsZWQgSU1FJ3MuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBFbmFibGUgdGhlIHBhcnRpY3VsYXIgaW5wdXQgbWV0aG9kIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gaW1lSWQgLSBPbmUgb2YgZXhpc3RpbmcgSU1FIGlkcy5cbiAqL1xubWV0aG9kcy5lbmFibGVJTUUgPSBhc3luYyBmdW5jdGlvbiBlbmFibGVJTUUgKGltZUlkKSB7XG4gIGF3YWl0IHRoaXMuc2hlbGwoWydpbWUnLCAnZW5hYmxlJywgaW1lSWRdKTtcbn07XG5cbi8qKlxuICogRGlzYWJsZSB0aGUgcGFydGljdWxhciBpbnB1dCBtZXRob2Qgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBpbWVJZCAtIE9uZSBvZiBleGlzdGluZyBJTUUgaWRzLlxuICovXG5tZXRob2RzLmRpc2FibGVJTUUgPSBhc3luYyBmdW5jdGlvbiBkaXNhYmxlSU1FIChpbWVJZCkge1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnaW1lJywgJ2Rpc2FibGUnLCBpbWVJZF0pO1xufTtcblxuLyoqXG4gKiBTZXQgdGhlIHBhcnRpY3VsYXIgaW5wdXQgbWV0aG9kIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gaW1lSWQgLSBPbmUgb2YgZXhpc3RpbmcgSU1FIGlkcy5cbiAqL1xubWV0aG9kcy5zZXRJTUUgPSBhc3luYyBmdW5jdGlvbiBzZXRJTUUgKGltZUlkKSB7XG4gIGF3YWl0IHRoaXMuc2hlbGwoWydpbWUnLCAnc2V0JywgaW1lSWRdKTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBkZWZhdWx0IGlucHV0IG1ldGhvZCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7P3N0cmluZ30gVGhlIG5hbWUgb2YgdGhlIGRlZmF1bHQgaW5wdXQgbWV0aG9kXG4gKi9cbm1ldGhvZHMuZGVmYXVsdElNRSA9IGFzeW5jIGZ1bmN0aW9uIGRlZmF1bHRJTUUgKCkge1xuICB0cnkge1xuICAgIGxldCBlbmdpbmUgPSBhd2FpdCB0aGlzLmdldFNldHRpbmcoJ3NlY3VyZScsICdkZWZhdWx0X2lucHV0X21ldGhvZCcpO1xuICAgIGlmIChlbmdpbmUgPT09ICdudWxsJykge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiBlbmdpbmUudHJpbSgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBnZXR0aW5nIGRlZmF1bHQgSU1FLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogU2VuZCB0aGUgcGFydGljdWxhciBrZXljb2RlIHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IGtleWNvZGUgLSBUaGUgYWN0dWFsIGtleSBjb2RlIHRvIGJlIHNlbnQuXG4gKi9cbm1ldGhvZHMua2V5ZXZlbnQgPSBhc3luYyBmdW5jdGlvbiBrZXlldmVudCAoa2V5Y29kZSkge1xuICAvLyBrZXljb2RlIG11c3QgYmUgYW4gaW50LlxuICBsZXQgY29kZSA9IHBhcnNlSW50KGtleWNvZGUsIDEwKTtcbiAgYXdhaXQgdGhpcy5zaGVsbChbJ2lucHV0JywgJ2tleWV2ZW50JywgY29kZV0pO1xufTtcblxuLyoqXG4gKiBTZW5kIHRoZSBwYXJ0aWN1bGFyIHRleHQgdG8gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSB0ZXh0IC0gVGhlIGFjdHVhbCB0ZXh0IHRvIGJlIHNlbnQuXG4gKi9cbm1ldGhvZHMuaW5wdXRUZXh0ID0gYXN5bmMgZnVuY3Rpb24gaW5wdXRUZXh0ICh0ZXh0KSB7XG4gIC8qIGVzbGludC1kaXNhYmxlIG5vLXVzZWxlc3MtZXNjYXBlICovXG4gIC8vIG5lZWQgdG8gZXNjYXBlIHdoaXRlc3BhY2UgYW5kICggKSA8ID4gfCA7ICYgKiBcXCB+IFwiICdcbiAgdGV4dCA9IHRleHRcbiAgICAgICAgICAucmVwbGFjZSgvXFxcXC9nLCAnXFxcXFxcXFwnKVxuICAgICAgICAgIC5yZXBsYWNlKC9cXCgvZywgJ1xcKCcpXG4gICAgICAgICAgLnJlcGxhY2UoL1xcKS9nLCAnXFwpJylcbiAgICAgICAgICAucmVwbGFjZSgvPC9nLCAnXFw8JylcbiAgICAgICAgICAucmVwbGFjZSgvPi9nLCAnXFw+JylcbiAgICAgICAgICAucmVwbGFjZSgvXFx8L2csICdcXHwnKVxuICAgICAgICAgIC5yZXBsYWNlKC87L2csICdcXDsnKVxuICAgICAgICAgIC5yZXBsYWNlKC8mL2csICdcXCYnKVxuICAgICAgICAgIC5yZXBsYWNlKC9cXCovZywgJ1xcKicpXG4gICAgICAgICAgLnJlcGxhY2UoL34vZywgJ1xcficpXG4gICAgICAgICAgLnJlcGxhY2UoL1wiL2csICdcXFwiJylcbiAgICAgICAgICAucmVwbGFjZSgvJy9nLCBcIlxcJ1wiKVxuICAgICAgICAgIC5yZXBsYWNlKC8gL2csICclcycpO1xuICAvKiBlc2xpbnQtZGlzYWJsZSBuby11c2VsZXNzLWVzY2FwZSAqL1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnaW5wdXQnLCAndGV4dCcsIHRleHRdKTtcbn07XG5cbi8qKlxuICogQ2xlYXIgdGhlIGFjdGl2ZSB0ZXh0IGZpZWxkIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdCBieSBzZW5kaW5nXG4gKiBzcGVjaWFsIGtleWV2ZW50cyB0byBpdC5cbiAqXG4gKiBAcGFyYW0ge251bWJlcn0gbGVuZ3RoIFsxMDBdIC0gVGhlIG1heGltdW0gbGVuZ3RoIG9mIHRoZSB0ZXh0IGluIHRoZSBmaWVsZCB0byBiZSBjbGVhcmVkLlxuICovXG5tZXRob2RzLmNsZWFyVGV4dEZpZWxkID0gYXN5bmMgZnVuY3Rpb24gY2xlYXJUZXh0RmllbGQgKGxlbmd0aCA9IDEwMCkge1xuICAvLyBhc3N1bWVzIHRoYXQgdGhlIEVkaXRUZXh0IGZpZWxkIGFscmVhZHkgaGFzIGZvY3VzXG4gIGxvZy5kZWJ1ZyhgQ2xlYXJpbmcgdXAgdG8gJHtsZW5ndGh9IGNoYXJhY3RlcnNgKTtcbiAgaWYgKGxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybjtcbiAgfVxuICBsZXQgYXJncyA9IFsnaW5wdXQnLCAna2V5ZXZlbnQnXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIC8vIHdlIGNhbm5vdCBrbm93IHdoZXJlIHRoZSBjdXJzb3IgaXMgaW4gdGhlIHRleHQgZmllbGQsIHNvIGRlbGV0ZSBib3RoIGJlZm9yZVxuICAgIC8vIGFuZCBhZnRlciBzbyB0aGF0IHdlIGdldCByaWQgb2YgZXZlcnl0aGluZ1xuICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9hbmRyb2lkL3ZpZXcvS2V5RXZlbnQuaHRtbCNLRVlDT0RFX0RFTFxuICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9hbmRyb2lkL3ZpZXcvS2V5RXZlbnQuaHRtbCNLRVlDT0RFX0ZPUldBUkRfREVMXG4gICAgYXJncy5wdXNoKCc2NycsICcxMTInKTtcbiAgfVxuICBhd2FpdCB0aGlzLnNoZWxsKGFyZ3MpO1xufTtcblxuLyoqXG4gKiBTZW5kIHRoZSBzcGVjaWFsIGtleWNvZGUgdG8gdGhlIGRldmljZSB1bmRlciB0ZXN0IGluIG9yZGVyIHRvIGxvY2sgaXQuXG4gKi9cbm1ldGhvZHMubG9jayA9IGFzeW5jIGZ1bmN0aW9uIGxvY2sgKCkge1xuICBpZiAoYXdhaXQgdGhpcy5pc1NjcmVlbkxvY2tlZCgpKSB7XG4gICAgbG9nLmRlYnVnKCdTY3JlZW4gaXMgYWxyZWFkeSBsb2NrZWQuIERvaW5nIG5vdGhpbmcuJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxvZy5kZWJ1ZygnUHJlc3NpbmcgdGhlIEtFWUNPREVfUE9XRVIgYnV0dG9uIHRvIGxvY2sgc2NyZWVuJyk7XG4gIGF3YWl0IHRoaXMua2V5ZXZlbnQoMjYpO1xuXG4gIGNvbnN0IHRpbWVvdXRNcyA9IDUwMDA7XG4gIHRyeSB7XG4gICAgYXdhaXQgd2FpdEZvckNvbmRpdGlvbihhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmlzU2NyZWVuTG9ja2VkKCksIHtcbiAgICAgIHdhaXRNczogdGltZW91dE1zLFxuICAgICAgaW50ZXJ2YWxNczogNTAwLFxuICAgIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBUaGUgZGV2aWNlIHNjcmVlbiBpcyBzdGlsbCBsb2NrZWQgYWZ0ZXIgJHt0aW1lb3V0TXN9bXMgdGltZW91dGApO1xuICB9XG59O1xuXG4vKipcbiAqIFNlbmQgdGhlIHNwZWNpYWwga2V5Y29kZSB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QgaW4gb3JkZXIgdG8gZW11bGF0ZVxuICogQmFjayBidXR0b24gdGFwLlxuICovXG5tZXRob2RzLmJhY2sgPSBhc3luYyBmdW5jdGlvbiBiYWNrICgpIHtcbiAgbG9nLmRlYnVnKCdQcmVzc2luZyB0aGUgQkFDSyBidXR0b24nKTtcbiAgYXdhaXQgdGhpcy5rZXlldmVudCg0KTtcbn07XG5cbi8qKlxuICogU2VuZCB0aGUgc3BlY2lhbCBrZXljb2RlIHRvIHRoZSBkZXZpY2UgdW5kZXIgdGVzdCBpbiBvcmRlciB0byBlbXVsYXRlXG4gKiBIb21lIGJ1dHRvbiB0YXAuXG4gKi9cbm1ldGhvZHMuZ29Ub0hvbWUgPSBhc3luYyBmdW5jdGlvbiBnb1RvSG9tZSAoKSB7XG4gIGxvZy5kZWJ1ZygnUHJlc3NpbmcgdGhlIEhPTUUgYnV0dG9uJyk7XG4gIGF3YWl0IHRoaXMua2V5ZXZlbnQoMyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gdGhlIGFjdHVhbCBwYXRoIHRvIGFkYiBleGVjdXRhYmxlLlxuICovXG5tZXRob2RzLmdldEFkYlBhdGggPSBmdW5jdGlvbiBnZXRBZGJQYXRoICgpIHtcbiAgcmV0dXJuIHRoaXMuZXhlY3V0YWJsZS5wYXRoO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSBjdXJyZW50IHNjcmVlbiBvcmllbnRhdGlvbiBvZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7bnVtYmVyfSBUaGUgY3VycmVudCBvcmllbnRhdGlvbiBlbmNvZGVkIGFzIGFuIGludGVnZXIgbnVtYmVyLlxuICovXG5tZXRob2RzLmdldFNjcmVlbk9yaWVudGF0aW9uID0gYXN5bmMgZnVuY3Rpb24gZ2V0U2NyZWVuT3JpZW50YXRpb24gKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ2R1bXBzeXMnLCAnaW5wdXQnXSk7XG4gIHJldHVybiBnZXRTdXJmYWNlT3JpZW50YXRpb24oc3Rkb3V0KTtcbn07XG5cbi8qKlxuICogUmV0cmlldmUgdGhlIHNjcmVlbiBsb2NrIHN0YXRlIG9mIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSBkZXZpY2UgaXMgbG9ja2VkLlxuICovXG5tZXRob2RzLmlzU2NyZWVuTG9ja2VkID0gYXN5bmMgZnVuY3Rpb24gaXNTY3JlZW5Mb2NrZWQgKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ2R1bXBzeXMnLCAnd2luZG93J10pO1xuICBpZiAocHJvY2Vzcy5lbnYuQVBQSVVNX0xPR19EVU1QU1lTKSB7XG4gICAgLy8gb3B0aW9uYWwgZGVidWdnaW5nXG4gICAgLy8gaWYgdGhlIG1ldGhvZCBpcyBub3Qgd29ya2luZywgdHVybiBpdCBvbiBhbmQgc2VuZCB1cyB0aGUgb3V0cHV0XG4gICAgbGV0IGR1bXBzeXNGaWxlID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksICdkdW1wc3lzLmxvZycpO1xuICAgIGxvZy5kZWJ1ZyhgV3JpdGluZyBkdW1wc3lzIG91dHB1dCB0byAke2R1bXBzeXNGaWxlfWApO1xuICAgIGF3YWl0IGZzLndyaXRlRmlsZShkdW1wc3lzRmlsZSwgc3Rkb3V0KTtcbiAgfVxuICByZXR1cm4gKGlzU2hvd2luZ0xvY2tzY3JlZW4oc3Rkb3V0KSB8fCBpc0N1cnJlbnRGb2N1c09uS2V5Z3VhcmQoc3Rkb3V0KSB8fFxuICAgICAgICAgICFpc1NjcmVlbk9uRnVsbHkoc3Rkb3V0KSk7XG59O1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IEtleWJvYXJkU3RhdGVcbiAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gaXNLZXlib2FyZFNob3duIC0gV2hldGhlciBzb2Z0IGtleWJvYXJkIGlzIGN1cnJlbnRseSB2aXNpYmxlLlxuICogQHByb3BlcnR5IHtib29sZWFufSBjYW5DbG9zZUtleWJvYXJkIC0gV2hldGhlciB0aGUga2V5Ym9hcmQgY2FuIGJlIGNsb3NlZC5cbiAqL1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBzdGF0ZSBvZiB0aGUgc29mdHdhcmUga2V5Ym9hcmQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge0tleWJvYXJkU3RhdGV9IFRoZSBrZXlib2FyZCBzdGF0ZS5cbiAqL1xubWV0aG9kcy5pc1NvZnRLZXlib2FyZFByZXNlbnQgPSBhc3luYyBmdW5jdGlvbiBpc1NvZnRLZXlib2FyZFByZXNlbnQgKCkge1xuICB0cnkge1xuICAgIGNvbnN0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydkdW1wc3lzJywgJ2lucHV0X21ldGhvZCddKTtcbiAgICBjb25zdCBpbnB1dFNob3duTWF0Y2ggPSAvbUlucHV0U2hvd249KFxcdyspLy5leGVjKHN0ZG91dCk7XG4gICAgY29uc3QgaW5wdXRWaWV3U2hvd25NYXRjaCA9IC9tSXNJbnB1dFZpZXdTaG93bj0oXFx3KykvLmV4ZWMoc3Rkb3V0KTtcbiAgICByZXR1cm4ge1xuICAgICAgaXNLZXlib2FyZFNob3duOiAhIShpbnB1dFNob3duTWF0Y2ggJiYgaW5wdXRTaG93bk1hdGNoWzFdID09PSAndHJ1ZScpLFxuICAgICAgY2FuQ2xvc2VLZXlib2FyZDogISEoaW5wdXRWaWV3U2hvd25NYXRjaCAmJiBpbnB1dFZpZXdTaG93bk1hdGNoWzFdID09PSAndHJ1ZScpLFxuICAgIH07XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGZpbmRpbmcgc29mdGtleWJvYXJkLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogU2VuZCBhbiBhcmJpdHJhcnkgVGVsbmV0IGNvbW1hbmQgdG8gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBjb21tYW5kIC0gVGhlIGNvbW1hbmQgdG8gYmUgc2VudC5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBhY3R1YWwgb3V0cHV0IG9mIHRoZSBnaXZlbiBjb21tYW5kLlxuICovXG5tZXRob2RzLnNlbmRUZWxuZXRDb21tYW5kID0gYXN5bmMgZnVuY3Rpb24gc2VuZFRlbG5ldENvbW1hbmQgKGNvbW1hbmQpIHtcbiAgbG9nLmRlYnVnKGBTZW5kaW5nIHRlbG5ldCBjb21tYW5kIHRvIGRldmljZTogJHtjb21tYW5kfWApO1xuICBsZXQgcG9ydCA9IGF3YWl0IHRoaXMuZ2V0RW11bGF0b3JQb3J0KCk7XG4gIHJldHVybiBhd2FpdCBuZXcgQigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgbGV0IGNvbm4gPSBuZXQuY3JlYXRlQ29ubmVjdGlvbihwb3J0LCAnbG9jYWxob3N0JyksXG4gICAgICAgIGNvbm5lY3RlZCA9IGZhbHNlLFxuICAgICAgICByZWFkeVJlZ2V4ID0gL15PSyQvbSxcbiAgICAgICAgZGF0YVN0cmVhbSA9ICcnLFxuICAgICAgICByZXMgPSBudWxsO1xuICAgIGNvbm4ub24oJ2Nvbm5lY3QnLCAoKSA9PiB7XG4gICAgICBsb2cuZGVidWcoJ1NvY2tldCBjb25uZWN0aW9uIHRvIGRldmljZSBjcmVhdGVkJyk7XG4gICAgfSk7XG4gICAgY29ubi5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICBkYXRhID0gZGF0YS50b1N0cmluZygndXRmOCcpO1xuICAgICAgaWYgKCFjb25uZWN0ZWQpIHtcbiAgICAgICAgaWYgKHJlYWR5UmVnZXgudGVzdChkYXRhKSkge1xuICAgICAgICAgIGNvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgICAgbG9nLmRlYnVnKCdTb2NrZXQgY29ubmVjdGlvbiB0byBkZXZpY2UgcmVhZHknKTtcbiAgICAgICAgICBjb25uLndyaXRlKGAke2NvbW1hbmR9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRhdGFTdHJlYW0gKz0gZGF0YTtcbiAgICAgICAgaWYgKHJlYWR5UmVnZXgudGVzdChkYXRhKSkge1xuICAgICAgICAgIHJlcyA9IGRhdGFTdHJlYW0ucmVwbGFjZShyZWFkeVJlZ2V4LCAnJykudHJpbSgpO1xuICAgICAgICAgIHJlcyA9IF8ubGFzdChyZXMudHJpbSgpLnNwbGl0KCdcXG4nKSk7XG4gICAgICAgICAgbG9nLmRlYnVnKGBUZWxuZXQgY29tbWFuZCBnb3QgcmVzcG9uc2U6ICR7cmVzfWApO1xuICAgICAgICAgIGNvbm4ud3JpdGUoJ3F1aXRcXG4nKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIGNvbm4ub24oJ2Vycm9yJywgKGVycikgPT4geyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIHByb21pc2UvcHJlZmVyLWF3YWl0LXRvLWNhbGxiYWNrc1xuICAgICAgbG9nLmRlYnVnKGBUZWxuZXQgY29tbWFuZCBlcnJvcjogJHtlcnIubWVzc2FnZX1gKTtcbiAgICAgIHJlamVjdChlcnIpO1xuICAgIH0pO1xuICAgIGNvbm4ub24oJ2Nsb3NlJywgKCkgPT4ge1xuICAgICAgaWYgKHJlcyA9PT0gbnVsbCkge1xuICAgICAgICByZWplY3QobmV3IEVycm9yKCdOZXZlciBnb3QgYSByZXNwb25zZSBmcm9tIGNvbW1hbmQnKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXNvbHZlKHJlcyk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufTtcblxuLyoqXG4gKiBDaGVjayB0aGUgc3RhdGUgb2YgQWlycGxhbmUgbW9kZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiBBaXJwbGFuZSBtb2RlIGlzIGVuYWJsZWQuXG4gKi9cbm1ldGhvZHMuaXNBaXJwbGFuZU1vZGVPbiA9IGFzeW5jIGZ1bmN0aW9uIGlzQWlycGxhbmVNb2RlT24gKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnYWlycGxhbmVfbW9kZV9vbicpO1xuICByZXR1cm4gcGFyc2VJbnQoc3Rkb3V0LCAxMCkgIT09IDA7XG59O1xuXG4vKipcbiAqIENoYW5nZSB0aGUgc3RhdGUgb2YgQWlycGxhbmUgbW9kZSBpbiBTZXR0aW5ncyBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtib29sZWFufSBvbiAtIFRydWUgdG8gZW5hYmxlIHRoZSBBaXJwbGFuZSBtb2RlIGluIFNldHRpbmdzIGFuZCBmYWxzZSB0byBkaXNhYmxlIGl0LlxuICovXG5tZXRob2RzLnNldEFpcnBsYW5lTW9kZSA9IGFzeW5jIGZ1bmN0aW9uIHNldEFpcnBsYW5lTW9kZSAob24pIHtcbiAgYXdhaXQgdGhpcy5zZXRTZXR0aW5nKCdnbG9iYWwnLCAnYWlycGxhbmVfbW9kZV9vbicsIG9uID8gMSA6IDApO1xufTtcblxuLyoqXG4gKiBCcm9hZGNhc3QgdGhlIHN0YXRlIG9mIEFpcnBsYW5lIG1vZGUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICogVGhpcyBtZXRob2Qgc2hvdWxkIGJlIGNhbGxlZCBhZnRlciB7QGxpbmsgI3NldEFpcnBsYW5lTW9kZX0sIG90aGVyd2lzZVxuICogdGhlIG1vZGUgY2hhbmdlIGlzIG5vdCBnb2luZyB0byBiZSBhcHBsaWVkIGZvciB0aGUgZGV2aWNlLlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb24gLSBUcnVlIHRvIGJyb2FkY2FzdCBlbmFibGUgYW5kIGZhbHNlIHRvIGJyb2FkY2FzdCBkaXNhYmxlLlxuICovXG5tZXRob2RzLmJyb2FkY2FzdEFpcnBsYW5lTW9kZSA9IGFzeW5jIGZ1bmN0aW9uIGJyb2FkY2FzdEFpcnBsYW5lTW9kZSAob24pIHtcbiAgYXdhaXQgdGhpcy5zaGVsbChbXG4gICAgJ2FtJywgJ2Jyb2FkY2FzdCcsXG4gICAgJy1hJywgJ2FuZHJvaWQuaW50ZW50LmFjdGlvbi5BSVJQTEFORV9NT0RFJyxcbiAgICAnLS1leicsICdzdGF0ZScsIG9uID8gJ3RydWUnIDogJ2ZhbHNlJ1xuICBdKTtcbn07XG5cbi8qKlxuICogQ2hlY2sgdGhlIHN0YXRlIG9mIFdpRmkgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgV2lGaSBpcyBlbmFibGVkLlxuICovXG5tZXRob2RzLmlzV2lmaU9uID0gYXN5bmMgZnVuY3Rpb24gaXNXaWZpT24gKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnd2lmaV9vbicpO1xuICByZXR1cm4gKHBhcnNlSW50KHN0ZG91dCwgMTApICE9PSAwKTtcbn07XG5cbi8qKlxuICogQ2hhbmdlIHRoZSBzdGF0ZSBvZiBXaUZpIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge2Jvb2xlYW59IG9uIC0gVHJ1ZSB0byBlbmFibGUgYW5kIGZhbHNlIHRvIGRpc2FibGUgaXQuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGlzRW11bGF0b3IgW2ZhbHNlXSAtIFNldCBpdCB0byB0cnVlIGlmIHRoZSBkZXZpY2UgdW5kZXIgdGVzdFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpcyBhbiBlbXVsYXRvciByYXRoZXIgdGhhbiBhIHJlYWwgZGV2aWNlLlxuICovXG5tZXRob2RzLnNldFdpZmlTdGF0ZSA9IGFzeW5jIGZ1bmN0aW9uIHNldFdpZmlTdGF0ZSAob24sIGlzRW11bGF0b3IgPSBmYWxzZSkge1xuICBpZiAoaXNFbXVsYXRvcikge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydzdmMnLCAnd2lmaScsIG9uID8gJ2VuYWJsZScgOiAnZGlzYWJsZSddLCB7XG4gICAgICBwcml2aWxlZ2VkOiB0cnVlLFxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoW1xuICAgICAgJ2FtJywgJ2Jyb2FkY2FzdCcsXG4gICAgICAnLWEnLCBXSUZJX0NPTk5FQ1RJT05fU0VUVElOR19BQ1RJT04sXG4gICAgICAnLW4nLCBXSUZJX0NPTk5FQ1RJT05fU0VUVElOR19SRUNFSVZFUixcbiAgICAgICctLWVzJywgJ3NldHN0YXR1cycsIG9uID8gJ2VuYWJsZScgOiAnZGlzYWJsZSdcbiAgICBdKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDaGVjayB0aGUgc3RhdGUgb2YgRGF0YSB0cmFuc2ZlciBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiBEYXRhIHRyYW5zZmVyIGlzIGVuYWJsZWQuXG4gKi9cbm1ldGhvZHMuaXNEYXRhT24gPSBhc3luYyBmdW5jdGlvbiBpc0RhdGFPbiAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLmdldFNldHRpbmcoJ2dsb2JhbCcsICdtb2JpbGVfZGF0YScpO1xuICByZXR1cm4gKHBhcnNlSW50KHN0ZG91dCwgMTApICE9PSAwKTtcbn07XG5cbi8qKlxuICogQ2hhbmdlIHRoZSBzdGF0ZSBvZiBEYXRhIHRyYW5zZmVyIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge2Jvb2xlYW59IG9uIC0gVHJ1ZSB0byBlbmFibGUgYW5kIGZhbHNlIHRvIGRpc2FibGUgaXQuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGlzRW11bGF0b3IgW2ZhbHNlXSAtIFNldCBpdCB0byB0cnVlIGlmIHRoZSBkZXZpY2UgdW5kZXIgdGVzdFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpcyBhbiBlbXVsYXRvciByYXRoZXIgdGhhbiBhIHJlYWwgZGV2aWNlLlxuICovXG5tZXRob2RzLnNldERhdGFTdGF0ZSA9IGFzeW5jIGZ1bmN0aW9uIHNldERhdGFTdGF0ZSAob24sIGlzRW11bGF0b3IgPSBmYWxzZSkge1xuICBpZiAoaXNFbXVsYXRvcikge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydzdmMnLCAnZGF0YScsIG9uID8gJ2VuYWJsZScgOiAnZGlzYWJsZSddLCB7XG4gICAgICBwcml2aWxlZ2VkOiB0cnVlLFxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoW1xuICAgICAgJ2FtJywgJ2Jyb2FkY2FzdCcsXG4gICAgICAnLWEnLCBEQVRBX0NPTk5FQ1RJT05fU0VUVElOR19BQ1RJT04sXG4gICAgICAnLW4nLCBEQVRBX0NPTk5FQ1RJT05fU0VUVElOR19SRUNFSVZFUixcbiAgICAgICctLWVzJywgJ3NldHN0YXR1cycsIG9uID8gJ2VuYWJsZScgOiAnZGlzYWJsZSdcbiAgICBdKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDaGFuZ2UgdGhlIHN0YXRlIG9mIFdpRmkgYW5kL29yIERhdGEgdHJhbnNmZXIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7Ym9vbGVhbn0gd2lmaSAtIFRydWUgdG8gZW5hYmxlIGFuZCBmYWxzZSB0byBkaXNhYmxlIFdpRmkuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGRhdGEgLSBUcnVlIHRvIGVuYWJsZSBhbmQgZmFsc2UgdG8gZGlzYWJsZSBEYXRhIHRyYW5zZmVyLlxuICogQHBhcmFtIHtib29sZWFufSBpc0VtdWxhdG9yIFtmYWxzZV0gLSBTZXQgaXQgdG8gdHJ1ZSBpZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3RcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaXMgYW4gZW11bGF0b3IgcmF0aGVyIHRoYW4gYSByZWFsIGRldmljZS5cbiAqL1xubWV0aG9kcy5zZXRXaWZpQW5kRGF0YSA9IGFzeW5jIGZ1bmN0aW9uIHNldFdpZmlBbmREYXRhICh7d2lmaSwgZGF0YX0sIGlzRW11bGF0b3IgPSBmYWxzZSkge1xuICBpZiAodXRpbC5oYXNWYWx1ZSh3aWZpKSkge1xuICAgIGF3YWl0IHRoaXMuc2V0V2lmaVN0YXRlKHdpZmksIGlzRW11bGF0b3IpO1xuICB9XG4gIGlmICh1dGlsLmhhc1ZhbHVlKGRhdGEpKSB7XG4gICAgYXdhaXQgdGhpcy5zZXREYXRhU3RhdGUoZGF0YSwgaXNFbXVsYXRvcik7XG4gIH1cbn07XG5cbi8qKlxuICogQ2hhbmdlIHRoZSBzdGF0ZSBvZiBhbmltYXRpb24gb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICogQW5pbWF0aW9uIG9uIHRoZSBkZXZpY2UgaXMgY29udHJvbGxlZCBieSB0aGUgZm9sbG93aW5nIGdsb2JhbCBwcm9wZXJ0aWVzOlxuICogW0FOSU1BVE9SX0RVUkFUSU9OX1NDQUxFXXtAbGluayBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvYW5kcm9pZC9wcm92aWRlci9TZXR0aW5ncy5HbG9iYWwuaHRtbCNBTklNQVRPUl9EVVJBVElPTl9TQ0FMRX0sXG4gKiBbVFJBTlNJVElPTl9BTklNQVRJT05fU0NBTEVde0BsaW5rIGh0dHBzOi8vZGV2ZWxvcGVyLmFuZHJvaWQuY29tL3JlZmVyZW5jZS9hbmRyb2lkL3Byb3ZpZGVyL1NldHRpbmdzLkdsb2JhbC5odG1sI1RSQU5TSVRJT05fQU5JTUFUSU9OX1NDQUxFfSxcbiAqIFtXSU5ET1dfQU5JTUFUSU9OX1NDQUxFXXtAbGluayBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvYW5kcm9pZC9wcm92aWRlci9TZXR0aW5ncy5HbG9iYWwuaHRtbCNXSU5ET1dfQU5JTUFUSU9OX1NDQUxFfS5cbiAqIFRoaXMgbWV0aG9kIHNldHMgYWxsIHRoaXMgcHJvcGVydGllcyB0byAwLjAgdG8gZGlzYWJsZSAoMS4wIHRvIGVuYWJsZSkgYW5pbWF0aW9uLlxuICpcbiAqIFR1cm5pbmcgb2ZmIGFuaW1hdGlvbiBtaWdodCBiZSB1c2VmdWwgdG8gaW1wcm92ZSBzdGFiaWxpdHlcbiAqIGFuZCByZWR1Y2UgdGVzdHMgZXhlY3V0aW9uIHRpbWUuXG4gKlxuICogQHBhcmFtIHtib29sZWFufSBvbiAtIFRydWUgdG8gZW5hYmxlIGFuZCBmYWxzZSB0byBkaXNhYmxlIGl0LlxuICovXG5tZXRob2RzLnNldEFuaW1hdGlvblN0YXRlID0gYXN5bmMgZnVuY3Rpb24gc2V0QW5pbWF0aW9uU3RhdGUgKG9uKSB7XG4gIGF3YWl0IHRoaXMuc2hlbGwoW1xuICAgICdhbScsICdicm9hZGNhc3QnLFxuICAgICctYScsIEFOSU1BVElPTl9TRVRUSU5HX0FDVElPTixcbiAgICAnLW4nLCBBTklNQVRJT05fU0VUVElOR19SRUNFSVZFUixcbiAgICAnLS1lcycsICdzZXRzdGF0dXMnLCBvbiA/ICdlbmFibGUnIDogJ2Rpc2FibGUnXG4gIF0pO1xufTtcblxuLyoqXG4gKiBDaGVjayB0aGUgc3RhdGUgb2YgYW5pbWF0aW9uIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIGF0IGxlYXN0IG9uZSBvZiBhbmltYXRpb24gc2NhbGUgc2V0dGluZ3NcbiAqICAgICAgICAgICAgICAgICAgIGlzIG5vdCBlcXVhbCB0byAnMC4wJy5cbiAqL1xubWV0aG9kcy5pc0FuaW1hdGlvbk9uID0gYXN5bmMgZnVuY3Rpb24gaXNBbmltYXRpb25PbiAoKSB7XG4gIGxldCBhbmltYXRvcl9kdXJhdGlvbl9zY2FsZSA9IGF3YWl0IHRoaXMuZ2V0U2V0dGluZygnZ2xvYmFsJywgJ2FuaW1hdG9yX2R1cmF0aW9uX3NjYWxlJyk7XG4gIGxldCB0cmFuc2l0aW9uX2FuaW1hdGlvbl9zY2FsZSA9IGF3YWl0IHRoaXMuZ2V0U2V0dGluZygnZ2xvYmFsJywgJ3RyYW5zaXRpb25fYW5pbWF0aW9uX3NjYWxlJyk7XG4gIGxldCB3aW5kb3dfYW5pbWF0aW9uX3NjYWxlID0gYXdhaXQgdGhpcy5nZXRTZXR0aW5nKCdnbG9iYWwnLCAnd2luZG93X2FuaW1hdGlvbl9zY2FsZScpO1xuICByZXR1cm4gXy5zb21lKFthbmltYXRvcl9kdXJhdGlvbl9zY2FsZSwgdHJhbnNpdGlvbl9hbmltYXRpb25fc2NhbGUsIHdpbmRvd19hbmltYXRpb25fc2NhbGVdLFxuICAgICAgICAgICAgICAgIChzZXR0aW5nKSA9PiBzZXR0aW5nICE9PSAnMC4wJyk7XG59O1xuXG4vKipcbiAqIENoYW5nZSB0aGUgbG9jYWxlIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC4gRG9uJ3QgbmVlZCB0byByZWJvb3QgdGhlIGRldmljZSBhZnRlciBjaGFuZ2luZyB0aGUgbG9jYWxlLlxuICogVGhpcyBtZXRob2Qgc2V0cyBhbiBhcmJpdHJhcnkgbG9jYWxlIGZvbGxvd2luZzpcbiAqICAgaHR0cHM6Ly9kZXZlbG9wZXIuYW5kcm9pZC5jb20vcmVmZXJlbmNlL2phdmEvdXRpbC9Mb2NhbGUuaHRtbFxuICogICBodHRwczovL2RldmVsb3Blci5hbmRyb2lkLmNvbS9yZWZlcmVuY2UvamF2YS91dGlsL0xvY2FsZS5odG1sI0xvY2FsZShqYXZhLmxhbmcuU3RyaW5nLCUyMGphdmEubGFuZy5TdHJpbmcpXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxhbmd1YWdlIC0gTGFuZ3VhZ2UuIGUuZy4gZW4sIGphXG4gKiBAcGFyYW0ge3N0cmluZ30gY291bnRyeSAtIENvdW50cnkuIGUuZy4gVVMsIEpQXG4gKiBAcGFyYW0gez9zdHJpbmd9IHNjcmlwdCAtIFNjcmlwdC4gZS5nLiBIYW5zIGluIGB6aC1IYW5zLUNOYFxuICovXG5tZXRob2RzLnNldERldmljZVN5c0xvY2FsZVZpYVNldHRpbmdBcHAgPSBhc3luYyBmdW5jdGlvbiBzZXREZXZpY2VTeXNMb2NhbGVWaWFTZXR0aW5nQXBwIChsYW5ndWFnZSwgY291bnRyeSwgc2NyaXB0ID0gbnVsbCkge1xuICBjb25zdCBwYXJhbXMgPSBbXG4gICAgJ2FtJywgJ2Jyb2FkY2FzdCcsXG4gICAgJy1hJywgTE9DQUxFX1NFVFRJTkdfQUNUSU9OLFxuICAgICctbicsIExPQ0FMRV9TRVRUSU5HX1JFQ0VJVkVSLFxuICAgICctLWVzJywgJ2xhbmcnLCBsYW5ndWFnZS50b0xvd2VyQ2FzZSgpLFxuICAgICctLWVzJywgJ2NvdW50cnknLCBjb3VudHJ5LnRvVXBwZXJDYXNlKClcbiAgXTtcblxuICBpZiAoc2NyaXB0KSB7XG4gICAgcGFyYW1zLnB1c2goJy0tZXMnLCAnc2NyaXB0Jywgc2NyaXB0KTtcbiAgfVxuXG4gIGF3YWl0IHRoaXMuc2hlbGwocGFyYW1zKTtcbn07XG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gTG9jYXRpb25cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfHN0cmluZ30gbG9uZ2l0dWRlIC0gVmFsaWQgbG9uZ2l0dWRlIHZhbHVlLlxuICogQHByb3BlcnR5IHtudW1iZXJ8c3RyaW5nfSBsYXRpdHVkZSAtIFZhbGlkIGxhdGl0dWRlIHZhbHVlLlxuICogQHByb3BlcnR5IHs/bnVtYmVyfHN0cmluZ30gYWx0aXR1ZGUgLSBWYWxpZCBhbHRpdHVkZSB2YWx1ZS5cbiAqL1xuXG4vKipcbiAqIEVtdWxhdGUgZ2VvbG9jYXRpb24gY29vcmRpbmF0ZXMgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7TG9jYXRpb259IGxvY2F0aW9uIC0gTG9jYXRpb24gb2JqZWN0LiBUaGUgYGFsdGl0dWRlYCB2YWx1ZSBpcyBpZ25vcmVkXG4gKiB3aGlsZSBtb2NraW5nIHRoZSBwb3NpdGlvbi5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNFbXVsYXRvciBbZmFsc2VdIC0gU2V0IGl0IHRvIHRydWUgaWYgdGhlIGRldmljZSB1bmRlciB0ZXN0XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzIGFuIGVtdWxhdG9yIHJhdGhlciB0aGFuIGEgcmVhbCBkZXZpY2UuXG4gKi9cbm1ldGhvZHMuc2V0R2VvTG9jYXRpb24gPSBhc3luYyBmdW5jdGlvbiBzZXRHZW9Mb2NhdGlvbiAobG9jYXRpb24sIGlzRW11bGF0b3IgPSBmYWxzZSkge1xuICBjb25zdCBmb3JtYXRMb2NhdGlvblZhbHVlID0gKHZhbHVlTmFtZSwgaXNSZXF1aXJlZCA9IHRydWUpID0+IHtcbiAgICBpZiAoIXV0aWwuaGFzVmFsdWUobG9jYXRpb25bdmFsdWVOYW1lXSkpIHtcbiAgICAgIGlmIChpc1JlcXVpcmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHt2YWx1ZU5hbWV9IG11c3QgYmUgcHJvdmlkZWRgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBjb25zdCBmbG9hdFZhbHVlID0gcGFyc2VGbG9hdChsb2NhdGlvblt2YWx1ZU5hbWVdKTtcbiAgICBpZiAoIWlzTmFOKGZsb2F0VmFsdWUpKSB7XG4gICAgICByZXR1cm4gYCR7Xy5jZWlsKGZsb2F0VmFsdWUsIDUpfWA7XG4gICAgfVxuICAgIGlmIChpc1JlcXVpcmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dmFsdWVOYW1lfSBpcyBleHBlY3RlZCB0byBiZSBhIHZhbGlkIGZsb2F0IG51bWJlci4gYCArXG4gICAgICAgIGAnJHtsb2NhdGlvblt2YWx1ZU5hbWVdfScgaXMgZ2l2ZW4gaW5zdGVhZGApO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfTtcbiAgY29uc3QgbG9uZ2l0dWRlID0gZm9ybWF0TG9jYXRpb25WYWx1ZSgnbG9uZ2l0dWRlJyk7XG4gIGNvbnN0IGxhdGl0dWRlID0gZm9ybWF0TG9jYXRpb25WYWx1ZSgnbGF0aXR1ZGUnKTtcbiAgY29uc3QgYWx0aXR1ZGUgPSBmb3JtYXRMb2NhdGlvblZhbHVlKCdhbHRpdHVkZScsIGZhbHNlKTtcbiAgaWYgKGlzRW11bGF0b3IpIHtcbiAgICBhd2FpdCB0aGlzLnJlc2V0VGVsbmV0QXV0aFRva2VuKCk7XG4gICAgYXdhaXQgdGhpcy5hZGJFeGVjKFsnZW11JywgJ2dlbycsICdmaXgnLCBsb25naXR1ZGUsIGxhdGl0dWRlXSk7XG4gICAgLy8gQSB3b3JrYXJvdW5kIGZvciBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL2FuZHJvaWQvaXNzdWVzL2RldGFpbD9pZD0yMDYxODBcbiAgICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydlbXUnLCAnZ2VvJywgJ2ZpeCcsIGxvbmdpdHVkZS5yZXBsYWNlKCcuJywgJywnKSwgbGF0aXR1ZGUucmVwbGFjZSgnLicsICcsJyldKTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBhcmdzID0gW1xuICAgICAgJ2FtJywgJ3N0YXJ0c2VydmljZScsXG4gICAgICAnLWUnLCAnbG9uZ2l0dWRlJywgbG9uZ2l0dWRlLFxuICAgICAgJy1lJywgJ2xhdGl0dWRlJywgbGF0aXR1ZGUsXG4gICAgXTtcbiAgICBpZiAodXRpbC5oYXNWYWx1ZShhbHRpdHVkZSkpIHtcbiAgICAgIGFyZ3MucHVzaCgnLWUnLCAnYWx0aXR1ZGUnLCBhbHRpdHVkZSk7XG4gICAgfVxuICAgIGFyZ3MucHVzaChMT0NBVElPTl9TRVJWSUNFKTtcbiAgICBhd2FpdCB0aGlzLnNoZWxsKGFyZ3MpO1xuICB9XG59O1xuXG4vKipcbiAqIEdldCB0aGUgY3VycmVudCBnZW8gbG9jYXRpb24gZnJvbSB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHJldHVybnMge0xvY2F0aW9ufSBUaGUgY3VycmVudCBsb2NhdGlvblxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBjdXJyZW50IGxvY2F0aW9uIGNhbm5vdCBiZSByZXRyaWV2ZWRcbiAqL1xubWV0aG9kcy5nZXRHZW9Mb2NhdGlvbiA9IGFzeW5jIGZ1bmN0aW9uIGdldEdlb0xvY2F0aW9uICgpIHtcbiAgbGV0IG91dHB1dDtcbiAgdHJ5IHtcbiAgICBvdXRwdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFtcbiAgICAgICdhbScsICdicm9hZGNhc3QnLFxuICAgICAgJy1uJywgTE9DQVRJT05fUkVDRUlWRVIsXG4gICAgICAnLWEnLCBMT0NBVElPTl9SRVRSSUVWQUxfQUNUSU9OLFxuICAgIF0pO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCByZXRyaWV2ZSB0aGUgY3VycmVudCBnZW8gY29vcmRpbmF0ZXMgZnJvbSB0aGUgZGV2aWNlLiBgICtcbiAgICAgIGBNYWtlIHN1cmUgdGhlIEFwcGl1bSBTZXR0aW5ncyBhcHBsaWNhdGlvbiBpcyB1cCB0byBkYXRlIGFuZCBoYXMgbG9jYXRpb24gcGVybWlzc2lvbnMuIEFsc28gdGhlIGxvY2F0aW9uIGAgK1xuICAgICAgYHNlcnZpY2VzIG11c3QgYmUgZW5hYmxlZCBvbiB0aGUgZGV2aWNlLiBPcmlnaW5hbCBlcnJvcjogJHtlcnIubWVzc2FnZX1gKTtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoID0gL2RhdGE9XCIoLT9bXFxkXFwuXSspXFxzKygtP1tcXGRcXC5dKylcXHMrKC0/W1xcZFxcLl0rKVwiLy5leGVjKG91dHB1dCk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBwYXJzZSB0aGUgYWN0dWFsIGxvY2F0aW9uIHZhbHVlcyBmcm9tIHRoZSBjb21tYW5kIG91dHB1dDogJHtvdXRwdXR9YCk7XG4gIH1cbiAgY29uc3QgbG9jYXRpb24gPSB7XG4gICAgbGF0aXR1ZGU6IG1hdGNoWzFdLFxuICAgIGxvbmdpdHVkZTogbWF0Y2hbMl0sXG4gICAgYWx0aXR1ZGU6IG1hdGNoWzNdLFxuICB9O1xuICBsb2cuZGVidWcoYEdvdCBnZW8gY29vcmRpbmF0ZXM6ICR7SlNPTi5zdHJpbmdpZnkobG9jYXRpb24pfWApO1xuICByZXR1cm4gbG9jYXRpb247XG59O1xuXG4vKipcbiAqIEZvcmNlZnVsbHkgcmVjdXJzaXZlbHkgcmVtb3ZlIGEgcGF0aCBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBCZSBjYXJlZnVsIHdoaWxlIGNhbGxpbmcgdGhpcyBtZXRob2QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBUaGUgcGF0aCB0byBiZSByZW1vdmVkIHJlY3Vyc2l2ZWx5LlxuICovXG5tZXRob2RzLnJpbXJhZiA9IGFzeW5jIGZ1bmN0aW9uIHJpbXJhZiAocGF0aCkge1xuICBhd2FpdCB0aGlzLnNoZWxsKFsncm0nLCAnLXJmJywgcGF0aF0pO1xufTtcblxuLyoqXG4gKiBTZW5kIGEgZmlsZSB0byB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsUGF0aCAtIFRoZSBwYXRoIHRvIHRoZSBmaWxlIG9uIHRoZSBsb2NhbCBmaWxlIHN5c3RlbS5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZW1vdGVQYXRoIC0gVGhlIGRlc3RpbmF0aW9uIHBhdGggb24gdGhlIHJlbW90ZSBkZXZpY2UuXG4gKiBAcGFyYW0ge29iamVjdH0gb3B0cyAtIEFkZGl0aW9uYWwgb3B0aW9ucyBtYXBwaW5nLiBTZWVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9ub2RlLXRlZW5fcHJvY2VzcyxcbiAqICAgICAgICAgICAgICAgICAgICAgICAgX2V4ZWNfIG1ldGhvZCBvcHRpb25zLCBmb3IgbW9yZSBpbmZvcm1hdGlvbiBhYm91dCBhdmFpbGFibGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucy5cbiAqL1xubWV0aG9kcy5wdXNoID0gYXN5bmMgZnVuY3Rpb24gcHVzaCAobG9jYWxQYXRoLCByZW1vdGVQYXRoLCBvcHRzKSB7XG4gIGF3YWl0IHRoaXMubWtkaXIocGF0aC5wb3NpeC5kaXJuYW1lKHJlbW90ZVBhdGgpKTtcbiAgYXdhaXQgdGhpcy5hZGJFeGVjKFsncHVzaCcsIGxvY2FsUGF0aCwgcmVtb3RlUGF0aF0sIG9wdHMpO1xufTtcblxuLyoqXG4gKiBSZWNlaXZlIGEgZmlsZSBmcm9tIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSBzb3VyY2UgcGF0aCBvbiB0aGUgcmVtb3RlIGRldmljZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhbFBhdGggLSBUaGUgZGVzdGluYXRpb24gcGF0aCB0byB0aGUgZmlsZSBvbiB0aGUgbG9jYWwgZmlsZSBzeXN0ZW0uXG4gKi9cbm1ldGhvZHMucHVsbCA9IGFzeW5jIGZ1bmN0aW9uIHB1bGwgKHJlbW90ZVBhdGgsIGxvY2FsUGF0aCkge1xuICAvLyBwdWxsIGZvbGRlciBjYW4gdGFrZSBtb3JlIHRpbWUsIGluY3JlYXNpbmcgdGltZSBvdXQgdG8gNjAgc2Vjc1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydwdWxsJywgcmVtb3RlUGF0aCwgbG9jYWxQYXRoXSwge3RpbWVvdXQ6IDYwMDAwfSk7XG59O1xuXG4vKipcbiAqIENoZWNrIHdoZXRoZXIgdGhlIHByb2Nlc3Mgd2l0aCB0aGUgcGFydGljdWxhciBuYW1lIGlzIHJ1bm5pbmcgb24gdGhlIGRldmljZVxuICogdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcHJvY2Vzc05hbWUgLSBUaGUgbmFtZSBvZiB0aGUgcHJvY2VzcyB0byBiZSBjaGVja2VkLlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgZ2l2ZW4gcHJvY2VzcyBpcyBydW5uaW5nLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBnaXZlbiBwcm9jZXNzIG5hbWUgaXMgbm90IGEgdmFsaWQgY2xhc3MgbmFtZS5cbiAqL1xubWV0aG9kcy5wcm9jZXNzRXhpc3RzID0gYXN5bmMgZnVuY3Rpb24gcHJvY2Vzc0V4aXN0cyAocHJvY2Vzc05hbWUpIHtcbiAgaWYgKCF0aGlzLmlzVmFsaWRDbGFzcyhwcm9jZXNzTmFtZSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcHJvY2VzcyBuYW1lOiAke3Byb2Nlc3NOYW1lfWApO1xuICB9XG4gIHJldHVybiAhXy5pc0VtcHR5KGF3YWl0IHRoaXMuZ2V0UElEc0J5TmFtZShwcm9jZXNzTmFtZSkpO1xufTtcblxuLyoqXG4gKiBHZXQgVENQIHBvcnQgZm9yd2FyZGluZyB3aXRoIGFkYiBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIG91dHB1dCBvZiB0aGUgY29ycmVzcG9uZGluZyBhZGIgY29tbWFuZC4gQW4gYXJyYXkgY29udGFpbnMgZWFjaCBmb3J3YXJkaW5nIGxpbmUgb2Ygb3V0cHV0XG4gKi9cbm1ldGhvZHMuZ2V0Rm9yd2FyZExpc3QgPSBhc3luYyBmdW5jdGlvbiBnZXRGb3J3YXJkTGlzdCAoKSB7XG4gIGxvZy5kZWJ1ZyhgTGlzdCBmb3J3YXJkaW5nIHBvcnRzYCk7XG4gIGNvbnN0IGNvbm5lY3Rpb25zID0gYXdhaXQgdGhpcy5hZGJFeGVjKFsnZm9yd2FyZCcsICctLWxpc3QnXSk7XG4gIHJldHVybiBjb25uZWN0aW9ucy5zcGxpdChFT0wpLmZpbHRlcigobGluZSkgPT4gQm9vbGVhbihsaW5lLnRyaW0oKSkpO1xufTtcblxuLyoqXG4gKiBTZXR1cCBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHN5c3RlbVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSBsb2NhbCBzeXN0ZW0gcG9ydC5cbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gZGV2aWNlUG9ydCAtIFRoZSBudW1iZXIgb2YgdGhlIHJlbW90ZSBkZXZpY2UgcG9ydC5cbiAqL1xubWV0aG9kcy5mb3J3YXJkUG9ydCA9IGFzeW5jIGZ1bmN0aW9uIGZvcndhcmRQb3J0IChzeXN0ZW1Qb3J0LCBkZXZpY2VQb3J0KSB7XG4gIGxvZy5kZWJ1ZyhgRm9yd2FyZGluZyBzeXN0ZW06ICR7c3lzdGVtUG9ydH0gdG8gZGV2aWNlOiAke2RldmljZVBvcnR9YCk7XG4gIGF3YWl0IHRoaXMuYWRiRXhlYyhbJ2ZvcndhcmQnLCBgdGNwOiR7c3lzdGVtUG9ydH1gLCBgdGNwOiR7ZGV2aWNlUG9ydH1gXSk7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBUQ1AgcG9ydCBmb3J3YXJkaW5nIHdpdGggYWRiIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC4gVGhlIGZvcndhcmRpbmdcbiAqIGZvciB0aGUgZ2l2ZW4gcG9ydCBzaG91bGQgYmUgc2V0dXAgd2l0aCB7QGxpbmsgI2ZvcndhcmRQb3J0fSBmaXJzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHN5c3RlbVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSBsb2NhbCBzeXN0ZW0gcG9ydFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG8gcmVtb3ZlIGZvcndhcmRpbmcgb24uXG4gKi9cbm1ldGhvZHMucmVtb3ZlUG9ydEZvcndhcmQgPSBhc3luYyBmdW5jdGlvbiByZW1vdmVQb3J0Rm9yd2FyZCAoc3lzdGVtUG9ydCkge1xuICBsb2cuZGVidWcoYFJlbW92aW5nIGZvcndhcmRlZCBwb3J0IHNvY2tldCBjb25uZWN0aW9uOiAke3N5c3RlbVBvcnR9IGApO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydmb3J3YXJkJywgYC0tcmVtb3ZlYCwgYHRjcDoke3N5c3RlbVBvcnR9YF0pO1xufTtcblxuLyoqXG4gKiBHZXQgVENQIHBvcnQgZm9yd2FyZGluZyB3aXRoIGFkYiBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIG91dHB1dCBvZiB0aGUgY29ycmVzcG9uZGluZyBhZGIgY29tbWFuZC4gQW4gYXJyYXkgY29udGFpbnMgZWFjaCBmb3J3YXJkaW5nIGxpbmUgb2Ygb3V0cHV0XG4gKi9cbm1ldGhvZHMuZ2V0UmV2ZXJzZUxpc3QgPSBhc3luYyBmdW5jdGlvbiBnZXRSZXZlcnNlTGlzdCAoKSB7XG4gIGxvZy5kZWJ1ZyhgTGlzdCByZXZlcnNlIGZvcndhcmRpbmcgcG9ydHNgKTtcbiAgY29uc3QgY29ubmVjdGlvbnMgPSBhd2FpdCB0aGlzLmFkYkV4ZWMoWydyZXZlcnNlJywgJy0tbGlzdCddKTtcbiAgcmV0dXJuIGNvbm5lY3Rpb25zLnNwbGl0KEVPTCkuZmlsdGVyKChsaW5lKSA9PiBCb29sZWFuKGxpbmUudHJpbSgpKSk7XG59O1xuXG4vKipcbiAqIFNldHVwIFRDUCBwb3J0IGZvcndhcmRpbmcgd2l0aCBhZGIgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICogT25seSBhdmFpbGFibGUgZm9yIEFQSSAyMSsuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBkZXZpY2VQb3J0IC0gVGhlIG51bWJlciBvZiB0aGUgcmVtb3RlIGRldmljZSBwb3J0LlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBzeXN0ZW1Qb3J0IC0gVGhlIG51bWJlciBvZiB0aGUgbG9jYWwgc3lzdGVtIHBvcnQuXG4gKi9cbm1ldGhvZHMucmV2ZXJzZVBvcnQgPSBhc3luYyBmdW5jdGlvbiByZXZlcnNlUG9ydCAoZGV2aWNlUG9ydCwgc3lzdGVtUG9ydCkge1xuICBsb2cuZGVidWcoYEZvcndhcmRpbmcgZGV2aWNlOiAke2RldmljZVBvcnR9IHRvIHN5c3RlbTogJHtzeXN0ZW1Qb3J0fWApO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydyZXZlcnNlJywgYHRjcDoke2RldmljZVBvcnR9YCwgYHRjcDoke3N5c3RlbVBvcnR9YF0pO1xufTtcblxuLyoqXG4gKiBSZW1vdmUgVENQIHBvcnQgZm9yd2FyZGluZyB3aXRoIGFkYiBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuIFRoZSBmb3J3YXJkaW5nXG4gKiBmb3IgdGhlIGdpdmVuIHBvcnQgc2hvdWxkIGJlIHNldHVwIHdpdGgge0BsaW5rICNmb3J3YXJkUG9ydH0gZmlyc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBkZXZpY2VQb3J0IC0gVGhlIG51bWJlciBvZiB0aGUgcmVtb3RlIGRldmljZSBwb3J0XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0byByZW1vdmUgZm9yd2FyZGluZyBvbi5cbiAqL1xubWV0aG9kcy5yZW1vdmVQb3J0UmV2ZXJzZSA9IGFzeW5jIGZ1bmN0aW9uIHJlbW92ZVBvcnRSZXZlcnNlIChkZXZpY2VQb3J0KSB7XG4gIGxvZy5kZWJ1ZyhgUmVtb3ZpbmcgcmV2ZXJzZSBmb3J3YXJkZWQgcG9ydCBzb2NrZXQgY29ubmVjdGlvbjogJHtkZXZpY2VQb3J0fSBgKTtcbiAgYXdhaXQgdGhpcy5hZGJFeGVjKFsncmV2ZXJzZScsIGAtLXJlbW92ZWAsIGB0Y3A6JHtkZXZpY2VQb3J0fWBdKTtcbn07XG5cbi8qKlxuICogU2V0dXAgVENQIHBvcnQgZm9yd2FyZGluZyB3aXRoIGFkYiBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuIFRoZSBkaWZmZXJlbmNlXG4gKiBiZXR3ZWVuIHtAbGluayAjZm9yd2FyZFBvcnR9IGlzIHRoYXQgdGhpcyBtZXRob2QgZG9lcyBzZXR1cCBmb3IgYW4gYWJzdHJhY3RcbiAqIGxvY2FsIHBvcnQuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd8bnVtYmVyfSBzeXN0ZW1Qb3J0IC0gVGhlIG51bWJlciBvZiB0aGUgbG9jYWwgc3lzdGVtIHBvcnQuXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IGRldmljZVBvcnQgLSBUaGUgbnVtYmVyIG9mIHRoZSByZW1vdGUgZGV2aWNlIHBvcnQuXG4gKi9cbm1ldGhvZHMuZm9yd2FyZEFic3RyYWN0UG9ydCA9IGFzeW5jIGZ1bmN0aW9uIGZvcndhcmRBYnN0cmFjdFBvcnQgKHN5c3RlbVBvcnQsIGRldmljZVBvcnQpIHtcbiAgbG9nLmRlYnVnKGBGb3J3YXJkaW5nIHN5c3RlbTogJHtzeXN0ZW1Qb3J0fSB0byBhYnN0cmFjdCBkZXZpY2U6ICR7ZGV2aWNlUG9ydH1gKTtcbiAgYXdhaXQgdGhpcy5hZGJFeGVjKFsnZm9yd2FyZCcsIGB0Y3A6JHtzeXN0ZW1Qb3J0fWAsIGBsb2NhbGFic3RyYWN0OiR7ZGV2aWNlUG9ydH1gXSk7XG59O1xuXG4vKipcbiAqIEV4ZWN1dGUgcGluZyBzaGVsbCBjb21tYW5kIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSBjb21tYW5kIG91dHB1dCBjb250YWlucyAncGluZycgc3Vic3RyaW5nLlxuICogQHRocm93cyB7ZXJyb3J9IElmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBleGVjdXRpbmcgJ3BpbmcnIGNvbW1hbmQgb24gdGhlXG4gKiAgICAgICAgICAgICAgICAgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMucGluZyA9IGFzeW5jIGZ1bmN0aW9uIHBpbmcgKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ2VjaG8nLCAncGluZyddKTtcbiAgaWYgKHN0ZG91dC5pbmRleE9mKCdwaW5nJykgPT09IDApIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoYEFEQiBwaW5nIGZhaWxlZCwgcmV0dXJuZWQgJHtzdGRvdXR9YCk7XG59O1xuXG4vKipcbiAqIFJlc3RhcnQgdGhlIGRldmljZSB1bmRlciB0ZXN0IHVzaW5nIGFkYiBjb21tYW5kcy5cbiAqXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgc3RhcnQgZmFpbHMuXG4gKi9cbm1ldGhvZHMucmVzdGFydCA9IGFzeW5jIGZ1bmN0aW9uIHJlc3RhcnQgKCkge1xuICB0cnkge1xuICAgIGF3YWl0IHRoaXMuc3RvcExvZ2NhdCgpO1xuICAgIGF3YWl0IHRoaXMucmVzdGFydEFkYigpO1xuICAgIGF3YWl0IHRoaXMud2FpdEZvckRldmljZSg2MCk7XG4gICAgYXdhaXQgdGhpcy5zdGFydExvZ2NhdCgpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBSZXN0YXJ0IGZhaWxlZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFN0YXJ0IHRoZSBsb2djYXQgcHJvY2VzcyB0byBnYXRoZXIgbG9ncy5cbiAqXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgcmVzdGFydCBmYWlscy5cbiAqL1xubWV0aG9kcy5zdGFydExvZ2NhdCA9IGFzeW5jIGZ1bmN0aW9uIHN0YXJ0TG9nY2F0ICgpIHtcbiAgaWYgKCFfLmlzRW1wdHkodGhpcy5sb2djYXQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVHJ5aW5nIHRvIHN0YXJ0IGxvZ2NhdCBjYXB0dXJlIGJ1dCBpdCdzIGFscmVhZHkgc3RhcnRlZCFcIik7XG4gIH1cbiAgdGhpcy5sb2djYXQgPSBuZXcgTG9nY2F0KHtcbiAgICBhZGI6IHRoaXMuZXhlY3V0YWJsZSxcbiAgICBkZWJ1ZzogZmFsc2UsXG4gICAgZGVidWdUcmFjZTogZmFsc2UsXG4gICAgY2xlYXJEZXZpY2VMb2dzT25TdGFydDogISF0aGlzLmNsZWFyRGV2aWNlTG9nc09uU3RhcnQsXG4gIH0pO1xuICBhd2FpdCB0aGlzLmxvZ2NhdC5zdGFydENhcHR1cmUoKTtcbn07XG5cbi8qKlxuICogU3RvcCB0aGUgYWN0aXZlIGxvZ2NhdCBwcm9jZXNzIHdoaWNoIGdhdGhlcnMgbG9ncy5cbiAqIFRoZSBjYWxsIHdpbGwgYmUgaWdub3JlZCBpZiBubyBsb2djYXQgcHJvY2VzcyBpcyBydW5uaW5nLlxuICovXG5tZXRob2RzLnN0b3BMb2djYXQgPSBhc3luYyBmdW5jdGlvbiBzdG9wTG9nY2F0ICgpIHtcbiAgaWYgKF8uaXNFbXB0eSh0aGlzLmxvZ2NhdCkpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCB0aGlzLmxvZ2NhdC5zdG9wQ2FwdHVyZSgpO1xuICB9IGZpbmFsbHkge1xuICAgIHRoaXMubG9nY2F0ID0gbnVsbDtcbiAgfVxufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgb3V0cHV0IGZyb20gdGhlIGN1cnJlbnRseSBydW5uaW5nIGxvZ2NhdCBwcm9jZXNzLlxuICogVGhlIGxvZ2NhdCBwcm9jZXNzIHNob3VsZCBiZSBleGVjdXRlZCBieSB7MmxpbmsgI3N0YXJ0TG9nY2F0fSBtZXRob2QuXG4gKlxuICogQHJldHVybiB7c3RyaW5nfSBUaGUgY29sbGVjdGVkIGxvZ2NhdCBvdXRwdXQuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbG9nY2F0IHByb2Nlc3MgaXMgbm90IHJ1bm5pbmcuXG4gKi9cbm1ldGhvZHMuZ2V0TG9nY2F0TG9ncyA9IGZ1bmN0aW9uIGdldExvZ2NhdExvZ3MgKCkge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMubG9nY2F0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGdldCBsb2djYXQgbG9ncyBzaW5jZSBsb2djYXQgaGFzbid0IHN0YXJ0ZWRcIik7XG4gIH1cbiAgcmV0dXJuIHRoaXMubG9nY2F0LmdldExvZ3MoKTtcbn07XG5cbi8qKlxuICogU2V0IHRoZSBjYWxsYmFjayBmb3IgdGhlIGxvZ2NhdCBvdXRwdXQgZXZlbnQuXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgLSBUaGUgbGlzdGVuZXIgZnVuY3Rpb24sIHdoaWNoIGFjY2VwdHMgb25lIGFyZ3VtZW50LiBUaGUgYXJndW1lbnQgaXNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYSBsb2cgcmVjb3JkIG9iamVjdCB3aXRoIGB0aW1lc3RhbXBgLCBgbGV2ZWxgIGFuZCBgbWVzc2FnZWAgcHJvcGVydGllcy5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiBsb2djYXQgcHJvY2VzcyBpcyBub3QgcnVubmluZy5cbiAqL1xubWV0aG9kcy5zZXRMb2djYXRMaXN0ZW5lciA9IGZ1bmN0aW9uIHNldExvZ2NhdExpc3RlbmVyIChsaXN0ZW5lcikge1xuICBpZiAoXy5pc0VtcHR5KHRoaXMubG9nY2F0KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkxvZ2NhdCBwcm9jZXNzIGhhc24ndCBiZWVuIHN0YXJ0ZWRcIik7XG4gIH1cbiAgdGhpcy5sb2djYXQub24oJ291dHB1dCcsIGxpc3RlbmVyKTtcbn07XG5cbi8qKlxuICogUmVtb3ZlcyB0aGUgcHJldmlvdXNseSBzZXQgY2FsbGJhY2sgZm9yIHRoZSBsb2djYXQgb3V0cHV0IGV2ZW50LlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIC0gVGhlIGxpc3RlbmVyIGZ1bmN0aW9uLCB3aGljaCBoYXMgYmVlbiBwcmV2aW91c2x5XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhc3NlZCB0byBgc2V0TG9nY2F0TGlzdGVuZXJgXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbG9nY2F0IHByb2Nlc3MgaXMgbm90IHJ1bm5pbmcuXG4gKi9cbm1ldGhvZHMucmVtb3ZlTG9nY2F0TGlzdGVuZXIgPSBmdW5jdGlvbiByZW1vdmVMb2djYXRMaXN0ZW5lciAobGlzdGVuZXIpIHtcbiAgaWYgKF8uaXNFbXB0eSh0aGlzLmxvZ2NhdCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJMb2djYXQgcHJvY2VzcyBoYXNuJ3QgYmVlbiBzdGFydGVkXCIpO1xuICB9XG4gIHRoaXMubG9nY2F0LnJlbW92ZUxpc3RlbmVyKCdvdXRwdXQnLCBsaXN0ZW5lcik7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgbGlzdCBvZiBwcm9jZXNzIGlkcyBmb3IgdGhlIHBhcnRpY3VsYXIgcHJvY2VzcyBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBUaGUgcGFydCBvZiBwcm9jZXNzIG5hbWUuXG4gKiBAcmV0dXJuIHtBcnJheS48bnVtYmVyPn0gVGhlIGxpc3Qgb2YgbWF0Y2hlZCBwcm9jZXNzIElEcyBvciBhbiBlbXB0eSBsaXN0LlxuICovXG5tZXRob2RzLmdldFBJRHNCeU5hbWUgPSBhc3luYyBmdW5jdGlvbiBnZXRQSURzQnlOYW1lIChuYW1lKSB7XG4gIGxvZy5kZWJ1ZyhgR2V0dGluZyBJRHMgb2YgYWxsICcke25hbWV9JyBwcm9jZXNzZXNgKTtcbiAgaWYgKCFfLmlzQm9vbGVhbih0aGlzLl9pc1BncmVwQXZhaWxhYmxlKSkge1xuICAgIC8vIHBncmVwIGlzIGluIHByaW9yaXR5LCBzaW5jZSBwaWRvZiBoYXMgYmVlbiByZXBvcnRlZCBvZiBoYXZpbmcgYnVncyBvbiBzb21lIHBsYXRmb3Jtc1xuICAgIGNvbnN0IHBncmVwT3V0cHV0ID0gXy50cmltKGF3YWl0IHRoaXMuc2hlbGwoWydwZ3JlcCAtLWhlbHA7IGVjaG8gJD8nXSkpO1xuICAgIHRoaXMuX2lzUGdyZXBBdmFpbGFibGUgPSBwYXJzZUludChfLmxhc3QocGdyZXBPdXRwdXQuc3BsaXQoL1xccysvKSksIDEwKSA9PT0gMDtcbiAgICBpZiAodGhpcy5faXNQZ3JlcEF2YWlsYWJsZSkge1xuICAgICAgdGhpcy5fY2FuUGdyZXBVc2VGdWxsQ21kTGluZVNlYXJjaCA9IC9eLWZcXGIvbS50ZXN0KHBncmVwT3V0cHV0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5faXNQaWRvZkF2YWlsYWJsZSA9IHBhcnNlSW50KGF3YWl0IHRoaXMuc2hlbGwoWydwaWRvZiAtLWhlbHAgPiAvZGV2L251bGw7IGVjaG8gJD8nXSksIDEwKSA9PT0gMDtcbiAgICB9XG4gIH1cbiAgaWYgKHRoaXMuX2lzUGdyZXBBdmFpbGFibGUgfHwgdGhpcy5faXNQaWRvZkF2YWlsYWJsZSkge1xuICAgIGNvbnN0IHNoZWxsQ29tbWFuZCA9IHRoaXMuX2lzUGdyZXBBdmFpbGFibGVcbiAgICAgID8gKHRoaXMuX2NhblBncmVwVXNlRnVsbENtZExpbmVTZWFyY2hcbiAgICAgICAgPyBbJ3BncmVwJywgJy1mJywgXy5lc2NhcGVSZWdFeHAobmFtZSldXG4gICAgICAgIDogWydwZ3JlcCcsIGBeJHtfLmVzY2FwZVJlZ0V4cChuYW1lLnNsaWNlKC0xNSkpfSRgXSlcbiAgICAgIDogWydwaWRvZicsIG5hbWVdO1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gKGF3YWl0IHRoaXMuc2hlbGwoc2hlbGxDb21tYW5kKSlcbiAgICAgICAgLnNwbGl0KC9cXHMrLylcbiAgICAgICAgLm1hcCgoeCkgPT4gcGFyc2VJbnQoeCwgMTApKVxuICAgICAgICAuZmlsdGVyKCh4KSA9PiBfLmlzSW50ZWdlcih4KSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gZXJyb3IgY29kZSAxIGlzIHJldHVybmVkIGlmIHRoZSB1dGlsaXR5IGRpZCBub3QgZmluZCBhbnkgcHJvY2Vzc2VzXG4gICAgICAvLyB3aXRoIHRoZSBnaXZlbiBuYW1lXG4gICAgICBpZiAoZS5jb2RlID09PSAxKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGV4dHJhY3QgcHJvY2VzcyBJRCBvZiAnJHtuYW1lfSc6ICR7ZS5tZXNzYWdlfWApO1xuICAgIH1cbiAgfVxuXG4gIGxvZy5kZWJ1ZygnVXNpbmcgcHMtYmFzZWQgUElEIGRldGVjdGlvbicpO1xuICBjb25zdCBwaWRDb2x1bW5UaXRsZSA9ICdQSUQnO1xuICBjb25zdCBwcm9jZXNzTmFtZUNvbHVtblRpdGxlID0gJ05BTUUnO1xuICBjb25zdCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsncHMnXSk7XG4gIGNvbnN0IHRpdGxlTWF0Y2ggPSBuZXcgUmVnRXhwKGBeKC4qXFxcXGIke3BpZENvbHVtblRpdGxlfVxcXFxiLipcXFxcYiR7cHJvY2Vzc05hbWVDb2x1bW5UaXRsZX1cXFxcYi4qKSRgLCAnbScpLmV4ZWMoc3Rkb3V0KTtcbiAgaWYgKCF0aXRsZU1hdGNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZCBub3QgZXh0cmFjdCBQSUQgb2YgJyR7bmFtZX0nIGZyb20gcHMgb3V0cHV0OiAke3N0ZG91dH1gKTtcbiAgfVxuICBjb25zdCBhbGxUaXRsZXMgPSB0aXRsZU1hdGNoWzFdLnRyaW0oKS5zcGxpdCgvXFxzKy8pO1xuICBjb25zdCBwaWRJbmRleCA9IGFsbFRpdGxlcy5pbmRleE9mKHBpZENvbHVtblRpdGxlKTtcbiAgY29uc3QgcGlkcyA9IFtdO1xuICBjb25zdCBwcm9jZXNzTmFtZVJlZ2V4ID0gbmV3IFJlZ0V4cChgXiguKlxcXFxiXFxcXGQrXFxcXGIuKlxcXFxiJHtfLmVzY2FwZVJlZ0V4cChuYW1lKX1cXFxcYi4qKSRgLCAnZ20nKTtcbiAgbGV0IG1hdGNoZWRMaW5lO1xuICB3aGlsZSAoKG1hdGNoZWRMaW5lID0gcHJvY2Vzc05hbWVSZWdleC5leGVjKHN0ZG91dCkpKSB7XG4gICAgY29uc3QgaXRlbXMgPSBtYXRjaGVkTGluZVsxXS50cmltKCkuc3BsaXQoL1xccysvKTtcbiAgICBpZiAocGlkSW5kZXggPj0gYWxsVGl0bGVzLmxlbmd0aCB8fCBpc05hTihpdGVtc1twaWRJbmRleF0pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBleHRyYWN0IFBJRCBvZiAnJHtuYW1lfScgZnJvbSAnJHttYXRjaGVkTGluZVsxXS50cmltKCl9Jy4gcHMgb3V0cHV0OiAke3N0ZG91dH1gKTtcbiAgICB9XG4gICAgcGlkcy5wdXNoKHBhcnNlSW50KGl0ZW1zW3BpZEluZGV4XSwgMTApKTtcbiAgfVxuICByZXR1cm4gcGlkcztcbn07XG5cbi8qKlxuICogR2V0IHRoZSBsaXN0IG9mIHByb2Nlc3MgaWRzIGZvciB0aGUgcGFydGljdWxhciBwcm9jZXNzIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIFRoZSBwYXJ0IG9mIHByb2Nlc3MgbmFtZS5cbiAqIEByZXR1cm4ge0FycmF5LjxudW1iZXI+fSBUaGUgbGlzdCBvZiBtYXRjaGVkIHByb2Nlc3MgSURzIG9yIGFuIGVtcHR5IGxpc3QuXG4gKi9cbm1ldGhvZHMua2lsbFByb2Nlc3Nlc0J5TmFtZSA9IGFzeW5jIGZ1bmN0aW9uIGtpbGxQcm9jZXNzZXNCeU5hbWUgKG5hbWUpIHtcbiAgdHJ5IHtcbiAgICBsb2cuZGVidWcoYEF0dGVtcHRpbmcgdG8ga2lsbCBhbGwgJHtuYW1lfSBwcm9jZXNzZXNgKTtcbiAgICBsZXQgcGlkcyA9IGF3YWl0IHRoaXMuZ2V0UElEc0J5TmFtZShuYW1lKTtcbiAgICBpZiAoXy5pc0VtcHR5KHBpZHMpKSB7XG4gICAgICBsb2cuaW5mbyhgTm8gJyR7bmFtZX0nIHByb2Nlc3MgaGFzIGJlZW4gZm91bmRgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChsZXQgcGlkIG9mIHBpZHMpIHtcbiAgICAgIGF3YWl0IHRoaXMua2lsbFByb2Nlc3NCeVBJRChwaWQpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGtpbGwgJHtuYW1lfSBwcm9jZXNzZXMuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBLaWxsIHRoZSBwYXJ0aWN1bGFyIHByb2Nlc3Mgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICogVGhlIGN1cnJlbnQgdXNlciBpcyBhdXRvbWF0aWNhbGx5IHN3aXRjaGVkIHRvIHJvb3QgaWYgbmVjZXNzYXJ5IGluIG9yZGVyXG4gKiB0byBwcm9wZXJseSBraWxsIHRoZSBwcm9jZXNzLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gcGlkIC0gVGhlIElEIG9mIHRoZSBwcm9jZXNzIHRvIGJlIGtpbGxlZC5cbiAqIEByZXR1cm4ge3N0cmluZ30gS2lsbCBjb21tYW5kIHN0ZG91dC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgcHJvY2VzcyB3aXRoIGdpdmVuIElEIGlzIG5vdCBwcmVzZW50IG9yIGNhbm5vdCBiZSBraWxsZWQuXG4gKi9cbm1ldGhvZHMua2lsbFByb2Nlc3NCeVBJRCA9IGFzeW5jIGZ1bmN0aW9uIGtpbGxQcm9jZXNzQnlQSUQgKHBpZCkge1xuICBsb2cuZGVidWcoYEF0dGVtcHRpbmcgdG8ga2lsbCBwcm9jZXNzICR7cGlkfWApO1xuICBsZXQgd2FzUm9vdCA9IGZhbHNlO1xuICBsZXQgYmVjYW1lUm9vdCA9IGZhbHNlO1xuICB0cnkge1xuICAgIHRyeSB7XG4gICAgICAvLyBDaGVjayBpZiB0aGUgcHJvY2VzcyBleGlzdHMgYW5kIHRocm93IGFuIGV4Y2VwdGlvbiBvdGhlcndpc2VcbiAgICAgIGF3YWl0IHRoaXMuc2hlbGwoWydraWxsJywgJy0wJywgcGlkXSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKCFlLm1lc3NhZ2UuaW5jbHVkZXMoJ09wZXJhdGlvbiBub3QgcGVybWl0dGVkJykpIHtcbiAgICAgICAgdGhyb3cgZTtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIHdhc1Jvb3QgPSBhd2FpdCB0aGlzLmlzUm9vdCgpO1xuICAgICAgfSBjYXRjaCAoaWduKSB7fVxuICAgICAgaWYgKHdhc1Jvb3QpIHtcbiAgICAgICAgdGhyb3cgZTtcbiAgICAgIH1cbiAgICAgIGxvZy5pbmZvKGBDYW5ub3Qga2lsbCBQSUQgJHtwaWR9IGR1ZSB0byBpbnN1ZmZpY2llbnQgcGVybWlzc2lvbnMuIFJldHJ5aW5nIGFzIHJvb3RgKTtcbiAgICAgIGxldCB7aXNTdWNjZXNzZnVsfSA9IGF3YWl0IHRoaXMucm9vdCgpO1xuICAgICAgYmVjYW1lUm9vdCA9IGlzU3VjY2Vzc2Z1bDtcbiAgICAgIGF3YWl0IHRoaXMuc2hlbGwoWydraWxsJywgJy0wJywgcGlkXSk7XG4gICAgfVxuICAgIGNvbnN0IHRpbWVvdXRNcyA9IDEwMDA7XG4gICAgbGV0IHN0ZG91dDtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgd2FpdEZvckNvbmRpdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ2tpbGwnLCBwaWRdKTtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAvLyBraWxsIHJldHVybnMgbm9uLXplcm8gY29kZSBpZiB0aGUgcHJvY2VzcyBpcyBhbHJlYWR5IGtpbGxlZFxuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICB9LCB7d2FpdE1zOiB0aW1lb3V0TXMsIGludGVydmFsTXM6IDMwMH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgbG9nLndhcm4oYENhbm5vdCBraWxsIHByb2Nlc3MgJHtwaWR9IGluICR7dGltZW91dE1zfSBtcy4gVHJ5aW5nIHRvIGZvcmNlIGtpbGwuLi5gKTtcbiAgICAgIHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoWydraWxsJywgJy05JywgcGlkXSk7XG4gICAgfVxuICAgIHJldHVybiBzdGRvdXQ7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGJlY2FtZVJvb3QpIHtcbiAgICAgIGF3YWl0IHRoaXMudW5yb290KCk7XG4gICAgfVxuICB9XG59O1xuXG4vKipcbiAqIEJyb2FkY2FzdCBwcm9jZXNzIGtpbGxpbmcgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBpbnRlbnQgLSBUaGUgbmFtZSBvZiB0aGUgaW50ZW50IHRvIGJyb2FkY2FzdCB0by5cbiAqIEBwYXJhbSB7c3RyaW5nfSBwcm9jZXNzTmFtZSAtIFRoZSBuYW1lIG9mIHRoZSBraWxsZWQgcHJvY2Vzcy5cbiAqIEB0aHJvd3Mge2Vycm9yfSBJZiB0aGUgcHJvY2VzcyB3YXMgbm90IGtpbGxlZC5cbiAqL1xubWV0aG9kcy5icm9hZGNhc3RQcm9jZXNzRW5kID0gYXN5bmMgZnVuY3Rpb24gYnJvYWRjYXN0UHJvY2Vzc0VuZCAoaW50ZW50LCBwcm9jZXNzTmFtZSkge1xuICAvLyBzdGFydCB0aGUgYnJvYWRjYXN0IHdpdGhvdXQgd2FpdGluZyBmb3IgaXQgdG8gZmluaXNoLlxuICB0aGlzLmJyb2FkY2FzdChpbnRlbnQpO1xuICAvLyB3YWl0IGZvciB0aGUgcHJvY2VzcyB0byBlbmRcbiAgbGV0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgbGV0IHRpbWVvdXRNcyA9IDQwMDAwO1xuICB0cnkge1xuICAgIHdoaWxlICgoRGF0ZS5ub3coKSAtIHN0YXJ0KSA8IHRpbWVvdXRNcykge1xuICAgICAgaWYgKGF3YWl0IHRoaXMucHJvY2Vzc0V4aXN0cyhwcm9jZXNzTmFtZSkpIHtcbiAgICAgICAgLy8gY29vbCBkb3duXG4gICAgICAgIGF3YWl0IHNsZWVwKDQwMCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFByb2Nlc3MgbmV2ZXIgZGllZCB3aXRoaW4gJHt0aW1lb3V0TXN9IG1zYCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBicm9hZGNhc3QgcHJvY2VzcyBlbmQuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBCcm9hZGNhc3QgYSBtZXNzYWdlIHRvIHRoZSBnaXZlbiBpbnRlbnQuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGludGVudCAtIFRoZSBuYW1lIG9mIHRoZSBpbnRlbnQgdG8gYnJvYWRjYXN0IHRvLlxuICogQHRocm93cyB7ZXJyb3J9IElmIGludGVudCBuYW1lIGlzIG5vdCBhIHZhbGlkIGNsYXNzIG5hbWUuXG4gKi9cbm1ldGhvZHMuYnJvYWRjYXN0ID0gYXN5bmMgZnVuY3Rpb24gYnJvYWRjYXN0IChpbnRlbnQpIHtcbiAgaWYgKCF0aGlzLmlzVmFsaWRDbGFzcyhpbnRlbnQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGludGVudCAke2ludGVudH1gKTtcbiAgfVxuICBsb2cuZGVidWcoYEJyb2FkY2FzdGluZzogJHtpbnRlbnR9YCk7XG4gIGF3YWl0IHRoaXMuc2hlbGwoWydhbScsICdicm9hZGNhc3QnLCAnLWEnLCBpbnRlbnRdKTtcbn07XG5cbi8qKlxuICogS2lsbCBBbmRyb2lkIGluc3RydW1lbnRzIGlmIHRoZXkgYXJlIGN1cnJlbnRseSBydW5uaW5nLlxuICovXG5tZXRob2RzLmVuZEFuZHJvaWRDb3ZlcmFnZSA9IGFzeW5jIGZ1bmN0aW9uIGVuZEFuZHJvaWRDb3ZlcmFnZSAoKSB7XG4gIGlmICh0aGlzLmluc3RydW1lbnRQcm9jICYmIHRoaXMuaW5zdHJ1bWVudFByb2MuaXNSdW5uaW5nKSB7XG4gICAgYXdhaXQgdGhpcy5pbnN0cnVtZW50UHJvYy5zdG9wKCk7XG4gIH1cbn07XG5cbi8qKlxuICogSW5zdHJ1bWVudCB0aGUgcGFydGljdWxhciBhY3Rpdml0eS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcGtnIC0gVGhlIG5hbWUgb2YgdGhlIHBhY2thZ2UgdG8gYmUgaW5zdHJ1bWVudGVkLlxuICogQHBhcmFtIHtzdHJpbmd9IGFjdGl2aXR5IC0gVGhlIG5hbWUgb2YgdGhlIG1haW4gYWN0aXZpdHkgaW4gdGhpcyBwYWNrYWdlLlxuICogQHBhcmFtIHtzdHJpbmd9IGluc3RydW1lbnRXaXRoIC0gVGhlIG5hbWUgb2YgdGhlIHBhY2thZ2UgdG8gaW5zdHJ1bWVudFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhlIGFjdGl2aXR5IHdpdGguXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgYW55IGV4Y2VwdGlvbiBpcyByZXBvcnRlZCBieSBhZGIgc2hlbGwuXG4gKi9cbm1ldGhvZHMuaW5zdHJ1bWVudCA9IGFzeW5jIGZ1bmN0aW9uIGluc3RydW1lbnQgKHBrZywgYWN0aXZpdHksIGluc3RydW1lbnRXaXRoKSB7XG4gIGlmIChhY3Rpdml0eVswXSAhPT0gJy4nKSB7XG4gICAgcGtnID0gJyc7XG4gIH1cbiAgbGV0IHBrZ0FjdGl2aXR5ID0gKHBrZyArIGFjdGl2aXR5KS5yZXBsYWNlKC9cXC4rL2csICcuJyk7IC8vIEZpeCBwa2cuLmFjdGl2aXR5IGVycm9yXG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFtcbiAgICAnYW0nLCAnaW5zdHJ1bWVudCcsXG4gICAgJy1lJywgJ21haW5fYWN0aXZpdHknLFxuICAgIHBrZ0FjdGl2aXR5LFxuICAgIGluc3RydW1lbnRXaXRoLFxuICBdKTtcbiAgaWYgKHN0ZG91dC5pbmRleE9mKCdFeGNlcHRpb24nKSAhPT0gLTEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gZXhjZXB0aW9uIGR1cmluZyBpbnN0cnVtZW50YXRpb24uIE9yaWdpbmFsIGVycm9yICR7c3Rkb3V0LnNwbGl0KCdcXG4nKVswXX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBDb2xsZWN0IEFuZHJvaWQgY292ZXJhZ2UgYnkgaW5zdHJ1bWVudGluZyB0aGUgcGFydGljdWxhciBhY3Rpdml0eS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gaW5zdHJ1bWVudENsYXNzIC0gVGhlIG5hbWUgb2YgdGhlIGluc3RydW1lbnRhdGlvbiBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB3YWl0UGtnIC0gVGhlIG5hbWUgb2YgdGhlIHBhY2thZ2UgdG8gYmUgaW5zdHJ1bWVudGVkLlxuICogQHBhcmFtIHtzdHJpbmd9IHdhaXRBY3Rpdml0eSAtIFRoZSBuYW1lIG9mIHRoZSBtYWluIGFjdGl2aXR5IGluIHRoaXMgcGFja2FnZS5cbiAqXG4gKiBAcmV0dXJuIHtwcm9taXNlfSBUaGUgcHJvbWlzZSBpcyBzdWNjZXNzZnVsbHkgcmVzb2x2ZWQgaWYgdGhlIGluc3RydW1lbnRhdGlvbiBzdGFydHNcbiAqICAgICAgICAgICAgICAgICAgIHdpdGhvdXQgZXJyb3JzLlxuICovXG5tZXRob2RzLmFuZHJvaWRDb3ZlcmFnZSA9IGFzeW5jIGZ1bmN0aW9uIGFuZHJvaWRDb3ZlcmFnZSAoaW5zdHJ1bWVudENsYXNzLCB3YWl0UGtnLCB3YWl0QWN0aXZpdHkpIHtcbiAgaWYgKCF0aGlzLmlzVmFsaWRDbGFzcyhpbnN0cnVtZW50Q2xhc3MpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNsYXNzICR7aW5zdHJ1bWVudENsYXNzfWApO1xuICB9XG4gIHJldHVybiBhd2FpdCBuZXcgQihhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgbGV0IGFyZ3MgPSB0aGlzLmV4ZWN1dGFibGUuZGVmYXVsdEFyZ3NcbiAgICAgIC5jb25jYXQoWydzaGVsbCcsICdhbScsICdpbnN0cnVtZW50JywgJy1lJywgJ2NvdmVyYWdlJywgJ3RydWUnLCAnLXcnXSlcbiAgICAgIC5jb25jYXQoW2luc3RydW1lbnRDbGFzc10pO1xuICAgIGxvZy5kZWJ1ZyhgQ29sbGVjdGluZyBjb3ZlcmFnZSBkYXRhIHdpdGg6ICR7W3RoaXMuZXhlY3V0YWJsZS5wYXRoXS5jb25jYXQoYXJncykuam9pbignICcpfWApO1xuICAgIHRyeSB7XG4gICAgICAvLyBhbSBpbnN0cnVtZW50IHJ1bnMgZm9yIHRoZSBsaWZlIG9mIHRoZSBhcHAgcHJvY2Vzcy5cbiAgICAgIHRoaXMuaW5zdHJ1bWVudFByb2MgPSBuZXcgU3ViUHJvY2Vzcyh0aGlzLmV4ZWN1dGFibGUucGF0aCwgYXJncyk7XG4gICAgICBhd2FpdCB0aGlzLmluc3RydW1lbnRQcm9jLnN0YXJ0KDApO1xuICAgICAgdGhpcy5pbnN0cnVtZW50UHJvYy5vbignb3V0cHV0JywgKHN0ZG91dCwgc3RkZXJyKSA9PiB7XG4gICAgICAgIGlmIChzdGRlcnIpIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKGBGYWlsZWQgdG8gcnVuIGluc3RydW1lbnRhdGlvbi4gT3JpZ2luYWwgZXJyb3I6ICR7c3RkZXJyfWApKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBhd2FpdCB0aGlzLndhaXRGb3JBY3Rpdml0eSh3YWl0UGtnLCB3YWl0QWN0aXZpdHkpO1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJlamVjdChuZXcgRXJyb3IoYEFuZHJvaWQgY292ZXJhZ2UgZmFpbGVkLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCkpO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgcGFydGljdWxhciBwcm9wZXJ0eSBvZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHByb3BlcnR5IC0gVGhlIG5hbWUgb2YgdGhlIHByb3BlcnR5LiBUaGlzIG5hbWUgc2hvdWxkXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBiZSBrbm93biB0byBfYWRiIHNoZWxsIGdldHByb3BfIHRvb2wuXG4gKlxuICogQHJldHVybiB7c3RyaW5nfSBUaGUgdmFsdWUgb2YgdGhlIGdpdmVuIHByb3BlcnR5LlxuICovXG5tZXRob2RzLmdldERldmljZVByb3BlcnR5ID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlUHJvcGVydHkgKHByb3BlcnR5KSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnZ2V0cHJvcCcsIHByb3BlcnR5XSk7XG4gIGxldCB2YWwgPSBzdGRvdXQudHJpbSgpO1xuICBsb2cuZGVidWcoYEN1cnJlbnQgZGV2aWNlIHByb3BlcnR5ICcke3Byb3BlcnR5fSc6ICR7dmFsfWApO1xuICByZXR1cm4gdmFsO1xufTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBzZXRQcm9wT3B0c1xuICogQHByb3BlcnR5IHtib29sZWFufSBwcml2aWxlZ2VkIC0gRG8gd2UgcnVuIHNldFByb3AgYXMgYSBwcml2aWxlZ2VkIGNvbW1hbmQ/IERlZmF1bHQgdHJ1ZS5cbiAqL1xuXG4vKipcbiAqIFNldCB0aGUgcGFydGljdWxhciBwcm9wZXJ0eSBvZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHByb3BlcnR5IC0gVGhlIG5hbWUgb2YgdGhlIHByb3BlcnR5LiBUaGlzIG5hbWUgc2hvdWxkXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBiZSBrbm93biB0byBfYWRiIHNoZWxsIHNldHByb3BfIHRvb2wuXG4gKiBAcGFyYW0ge3N0cmluZ30gdmFsIC0gVGhlIG5ldyBwcm9wZXJ0eSB2YWx1ZS5cbiAqIEBwYXJhbSB7c2V0UHJvcE9wdHN9IG9wdHNcbiAqXG4gKiBAdGhyb3dzIHtlcnJvcn0gSWYgX3NldHByb3BfIHV0aWxpdHkgZmFpbHMgdG8gY2hhbmdlIHByb3BlcnR5IHZhbHVlLlxuICovXG5tZXRob2RzLnNldERldmljZVByb3BlcnR5ID0gYXN5bmMgZnVuY3Rpb24gc2V0RGV2aWNlUHJvcGVydHkgKHByb3AsIHZhbCwgb3B0cyA9IHt9KSB7XG4gIGNvbnN0IHtwcml2aWxlZ2VkID0gdHJ1ZX0gPSBvcHRzO1xuICBsb2cuZGVidWcoYFNldHRpbmcgZGV2aWNlIHByb3BlcnR5ICcke3Byb3B9JyB0byAnJHt2YWx9J2ApO1xuICBhd2FpdCB0aGlzLnNoZWxsKFsnc2V0cHJvcCcsIHByb3AsIHZhbF0sIHtcbiAgICBwcml2aWxlZ2VkLFxuICB9KTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBDdXJyZW50IHN5c3RlbSBsYW5ndWFnZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMuZ2V0RGV2aWNlU3lzTGFuZ3VhZ2UgPSBhc3luYyBmdW5jdGlvbiBnZXREZXZpY2VTeXNMYW5ndWFnZSAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdwZXJzaXN0LnN5cy5sYW5ndWFnZScpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEN1cnJlbnQgY291bnRyeSBuYW1lIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqL1xubWV0aG9kcy5nZXREZXZpY2VTeXNDb3VudHJ5ID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlU3lzQ291bnRyeSAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdwZXJzaXN0LnN5cy5jb3VudHJ5Jyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gQ3VycmVudCBzeXN0ZW0gbG9jYWxlIG5hbWUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldERldmljZVN5c0xvY2FsZSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZVN5c0xvY2FsZSAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdwZXJzaXN0LnN5cy5sb2NhbGUnKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBDdXJyZW50IHByb2R1Y3QgbGFuZ3VhZ2UgbmFtZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMuZ2V0RGV2aWNlUHJvZHVjdExhbmd1YWdlID0gYXN5bmMgZnVuY3Rpb24gZ2V0RGV2aWNlUHJvZHVjdExhbmd1YWdlICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLnByb2R1Y3QubG9jYWxlLmxhbmd1YWdlJyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gQ3VycmVudCBwcm9kdWN0IGNvdW50cnkgbmFtZSBvbiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMuZ2V0RGV2aWNlUHJvZHVjdENvdW50cnkgPSBhc3luYyBmdW5jdGlvbiBnZXREZXZpY2VQcm9kdWN0Q291bnRyeSAoKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdyby5wcm9kdWN0LmxvY2FsZS5yZWdpb24nKTtcbn07XG5cbi8qKlxuICogQHJldHVybiB7c3RyaW5nfSBDdXJyZW50IHByb2R1Y3QgbG9jYWxlIG5hbWUgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldERldmljZVByb2R1Y3RMb2NhbGUgPSBhc3luYyBmdW5jdGlvbiBnZXREZXZpY2VQcm9kdWN0TG9jYWxlICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLnByb2R1Y3QubG9jYWxlJyk7XG59O1xuXG4vKipcbiAqIEByZXR1cm4ge3N0cmluZ30gVGhlIG1vZGVsIG5hbWUgb2YgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICovXG5tZXRob2RzLmdldE1vZGVsID0gYXN5bmMgZnVuY3Rpb24gZ2V0TW9kZWwgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5nZXREZXZpY2VQcm9wZXJ0eSgncm8ucHJvZHVjdC5tb2RlbCcpO1xufTtcblxuLyoqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IFRoZSBtYW51ZmFjdHVyZXIgbmFtZSBvZiB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKi9cbm1ldGhvZHMuZ2V0TWFudWZhY3R1cmVyID0gYXN5bmMgZnVuY3Rpb24gZ2V0TWFudWZhY3R1cmVyICgpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3JvLnByb2R1Y3QubWFudWZhY3R1cmVyJyk7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgY3VycmVudCBzY3JlZW4gc2l6ZS5cbiAqXG4gKiBAcmV0dXJuIHtzdHJpbmd9IERldmljZSBzY3JlZW4gc2l6ZSBhcyBzdHJpbmcgaW4gZm9ybWF0ICdXeEgnIG9yXG4gKiAgICAgICAgICAgICAgICAgIF9udWxsXyBpZiBpdCBjYW5ub3QgYmUgZGV0ZXJtaW5lZC5cbiAqL1xubWV0aG9kcy5nZXRTY3JlZW5TaXplID0gYXN5bmMgZnVuY3Rpb24gZ2V0U2NyZWVuU2l6ZSAoKSB7XG4gIGxldCBzdGRvdXQgPSBhd2FpdCB0aGlzLnNoZWxsKFsnd20nLCAnc2l6ZSddKTtcbiAgbGV0IHNpemUgPSBuZXcgUmVnRXhwKC9QaHlzaWNhbCBzaXplOiAoW15cXHI/XFxuXSspKi9nKS5leGVjKHN0ZG91dCk7XG4gIGlmIChzaXplICYmIHNpemUubGVuZ3RoID49IDIpIHtcbiAgICByZXR1cm4gc2l6ZVsxXS50cmltKCk7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59O1xuXG4vKipcbiAqIEdldCB0aGUgY3VycmVudCBzY3JlZW4gZGVuc2l0eSBpbiBkcGlcbiAqXG4gKiBAcmV0dXJuIHs/bnVtYmVyfSBEZXZpY2Ugc2NyZWVuIGRlbnNpdHkgYXMgYSBudW1iZXIgb3IgX251bGxfIGlmIGl0XG4gKiAgICAgICAgICAgICAgICAgIGNhbm5vdCBiZSBkZXRlcm1pbmVkXG4gKi9cbm1ldGhvZHMuZ2V0U2NyZWVuRGVuc2l0eSA9IGFzeW5jIGZ1bmN0aW9uIGdldFNjcmVlbkRlbnNpdHkgKCkge1xuICBsZXQgc3Rkb3V0ID0gYXdhaXQgdGhpcy5zaGVsbChbJ3dtJywgJ2RlbnNpdHknXSk7XG4gIGxldCBkZW5zaXR5ID0gbmV3IFJlZ0V4cCgvUGh5c2ljYWwgZGVuc2l0eTogKFteXFxyP1xcbl0rKSovZykuZXhlYyhzdGRvdXQpO1xuICBpZiAoZGVuc2l0eSAmJiBkZW5zaXR5Lmxlbmd0aCA+PSAyKSB7XG4gICAgbGV0IGRlbnNpdHlOdW1iZXIgPSBwYXJzZUludChkZW5zaXR5WzFdLnRyaW0oKSwgMTApO1xuICAgIHJldHVybiBpc05hTihkZW5zaXR5TnVtYmVyKSA/IG51bGwgOiBkZW5zaXR5TnVtYmVyO1xuICB9XG4gIHJldHVybiBudWxsO1xufTtcblxuLyoqXG4gKiBTZXR1cCBIVFRQIHByb3h5IGluIGRldmljZSBnbG9iYWwgc2V0dGluZ3MuXG4gKiBSZWFkIGh0dHBzOi8vYW5kcm9pZC5nb29nbGVzb3VyY2UuY29tL3BsYXRmb3JtL2ZyYW1ld29ya3MvYmFzZS8rL2FuZHJvaWQtOS4wLjBfcjIxL2NvcmUvamF2YS9hbmRyb2lkL3Byb3ZpZGVyL1NldHRpbmdzLmphdmEgZm9yIGVhY2ggcHJvcGVydHlcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcHJveHlIb3N0IC0gVGhlIGhvc3QgbmFtZSBvZiB0aGUgcHJveHkuXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHByb3h5UG9ydCAtIFRoZSBwb3J0IG51bWJlciB0byBiZSBzZXQuXG4gKi9cbm1ldGhvZHMuc2V0SHR0cFByb3h5ID0gYXN5bmMgZnVuY3Rpb24gc2V0SHR0cFByb3h5IChwcm94eUhvc3QsIHByb3h5UG9ydCkge1xuICBsZXQgcHJveHkgPSBgJHtwcm94eUhvc3R9OiR7cHJveHlQb3J0fWA7XG4gIGlmIChfLmlzVW5kZWZpbmVkKHByb3h5SG9zdCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbGwgdG8gc2V0SHR0cFByb3h5IG1ldGhvZCB3aXRoIHVuZGVmaW5lZCBwcm94eV9ob3N0OiAke3Byb3h5fWApO1xuICB9XG4gIGlmIChfLmlzVW5kZWZpbmVkKHByb3h5UG9ydCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbGwgdG8gc2V0SHR0cFByb3h5IG1ldGhvZCB3aXRoIHVuZGVmaW5lZCBwcm94eV9wb3J0ICR7cHJveHl9YCk7XG4gIH1cblxuICBjb25zdCBodHRwUHJveHlTZXR0aW5zID0gW1xuICAgIFsnaHR0cF9wcm94eScsIHByb3h5XSxcbiAgICBbJ2dsb2JhbF9odHRwX3Byb3h5X2hvc3QnLCBwcm94eUhvc3RdLFxuICAgIFsnZ2xvYmFsX2h0dHBfcHJveHlfcG9ydCcsIHByb3h5UG9ydF1cbiAgXTtcbiAgZm9yIChjb25zdCBbc2V0dGluZ0tleSwgc2V0dGluZ1ZhbHVlXSBvZiBodHRwUHJveHlTZXR0aW5zKSB7XG4gICAgYXdhaXQgdGhpcy5zZXRTZXR0aW5nKCdnbG9iYWwnLCBzZXR0aW5nS2V5LCBzZXR0aW5nVmFsdWUpO1xuICB9XG59O1xuXG4vKipcbiAqIERlbGV0ZSBIVFRQIHByb3h5IGluIGRldmljZSBnbG9iYWwgc2V0dGluZ3MuXG4gKiBSZWJvb3RpbmcgdGhlIHRlc3QgZGV2aWNlIGlzIG5lY2Vzc2FyeSB0byBhcHBseSB0aGUgY2hhbmdlLlxuICovXG5tZXRob2RzLmRlbGV0ZUh0dHBQcm94eSA9IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZUh0dHBQcm94eSAoKSB7XG4gIGNvbnN0IGh0dHBQcm94eVNldHRpbnMgPSBbXG4gICAgJ2h0dHBfcHJveHknLFxuICAgICdnbG9iYWxfaHR0cF9wcm94eV9ob3N0JyxcbiAgICAnZ2xvYmFsX2h0dHBfcHJveHlfcG9ydCcsXG4gICAgJ2dsb2JhbF9odHRwX3Byb3h5X2V4Y2x1c2lvbl9saXN0JyAvLyBgZ2xvYmFsX2h0dHBfcHJveHlfZXhjbHVzaW9uX2xpc3Q9YCB3YXMgZ2VuZXJhdGVkIGJ5IGBzZXR0aW5ncyBnbG9iYWwgaHR0b19wcm94eSB4eHh4YFxuICBdO1xuICBmb3IgKGNvbnN0IHNldHRpbmcgb2YgaHR0cFByb3h5U2V0dGlucykge1xuICAgIGF3YWl0IHRoaXMuc2hlbGwoWydzZXR0aW5ncycsICdkZWxldGUnLCAnZ2xvYmFsJywgc2V0dGluZ10pO1xuICB9XG59O1xuXG4vKipcbiAqIFNldCBkZXZpY2UgcHJvcGVydHkuXG4gKiBbYW5kcm9pZC5wcm92aWRlci5TZXR0aW5nc117QGxpbmsgaHR0cHM6Ly9kZXZlbG9wZXIuYW5kcm9pZC5jb20vcmVmZXJlbmNlL2FuZHJvaWQvcHJvdmlkZXIvU2V0dGluZ3MuaHRtbH1cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZXNwYWNlIC0gb25lIG9mIHtzeXN0ZW0sIHNlY3VyZSwgZ2xvYmFsfSwgY2FzZS1pbnNlbnNpdGl2ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzZXR0aW5nIC0gcHJvcGVydHkgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gdmFsdWUgLSBwcm9wZXJ0eSB2YWx1ZS5cbiAqIEByZXR1cm4ge3N0cmluZ30gY29tbWFuZCBvdXRwdXQuXG4gKi9cbm1ldGhvZHMuc2V0U2V0dGluZyA9IGFzeW5jIGZ1bmN0aW9uIHNldFNldHRpbmcgKG5hbWVzcGFjZSwgc2V0dGluZywgdmFsdWUpIHtcbiAgcmV0dXJuIGF3YWl0IHRoaXMuc2hlbGwoWydzZXR0aW5ncycsICdwdXQnLCBuYW1lc3BhY2UsIHNldHRpbmcsIHZhbHVlXSk7XG59O1xuXG4vKipcbiAqIEdldCBkZXZpY2UgcHJvcGVydHkuXG4gKiBbYW5kcm9pZC5wcm92aWRlci5TZXR0aW5nc117QGxpbmsgaHR0cHM6Ly9kZXZlbG9wZXIuYW5kcm9pZC5jb20vcmVmZXJlbmNlL2FuZHJvaWQvcHJvdmlkZXIvU2V0dGluZ3MuaHRtbH1cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZXNwYWNlIC0gb25lIG9mIHtzeXN0ZW0sIHNlY3VyZSwgZ2xvYmFsfSwgY2FzZS1pbnNlbnNpdGl2ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzZXR0aW5nIC0gcHJvcGVydHkgbmFtZS5cbiAqIEByZXR1cm4ge3N0cmluZ30gcHJvcGVydHkgdmFsdWUuXG4gKi9cbm1ldGhvZHMuZ2V0U2V0dGluZyA9IGFzeW5jIGZ1bmN0aW9uIGdldFNldHRpbmcgKG5hbWVzcGFjZSwgc2V0dGluZykge1xuICByZXR1cm4gYXdhaXQgdGhpcy5zaGVsbChbJ3NldHRpbmdzJywgJ2dldCcsIG5hbWVzcGFjZSwgc2V0dGluZ10pO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgYGFkYiBidWdyZXBvcnRgIGNvbW1hbmQgb3V0cHV0LiBUaGlzXG4gKiBvcGVyYXRpb24gbWF5IHRha2UgdXAgdG8gc2V2ZXJhbCBtaW51dGVzLlxuICpcbiAqIEBwYXJhbSB7P251bWJlcn0gdGltZW91dCBbMTIwMDAwXSAtIENvbW1hbmQgdGltZW91dCBpbiBtaWxsaXNlY29uZHNcbiAqIEByZXR1cm5zIHtzdHJpbmd9IENvbW1hbmQgc3Rkb3V0XG4gKi9cbm1ldGhvZHMuYnVncmVwb3J0ID0gYXN5bmMgZnVuY3Rpb24gYnVncmVwb3J0ICh0aW1lb3V0ID0gMTIwMDAwKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLmFkYkV4ZWMoWydidWdyZXBvcnQnXSwge3RpbWVvdXR9KTtcbn07XG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gU2NyZWVucmVjb3JkT3B0aW9uc1xuICogQHByb3BlcnR5IHs/c3RyaW5nfSB2aWRlb1NpemUgLSBUaGUgZm9ybWF0IGlzIHdpZHRoeGhlaWdodC5cbiAqICAgICAgICAgICAgICAgICAgVGhlIGRlZmF1bHQgdmFsdWUgaXMgdGhlIGRldmljZSdzIG5hdGl2ZSBkaXNwbGF5IHJlc29sdXRpb24gKGlmIHN1cHBvcnRlZCksXG4gKiAgICAgICAgICAgICAgICAgIDEyODB4NzIwIGlmIG5vdC4gRm9yIGJlc3QgcmVzdWx0cyxcbiAqICAgICAgICAgICAgICAgICAgdXNlIGEgc2l6ZSBzdXBwb3J0ZWQgYnkgeW91ciBkZXZpY2UncyBBZHZhbmNlZCBWaWRlbyBDb2RpbmcgKEFWQykgZW5jb2Rlci5cbiAqICAgICAgICAgICAgICAgICAgRm9yIGV4YW1wbGUsIFwiMTI4MHg3MjBcIlxuICogQHByb3BlcnR5IHs/Ym9vbGVhbn0gYnVnUmVwb3J0IC0gU2V0IGl0IHRvIGB0cnVlYCBpbiBvcmRlciB0byBkaXNwbGF5IGFkZGl0aW9uYWwgaW5mb3JtYXRpb24gb24gdGhlIHZpZGVvIG92ZXJsYXksXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNoIGFzIGEgdGltZXN0YW1wLCB0aGF0IGlzIGhlbHBmdWwgaW4gdmlkZW9zIGNhcHR1cmVkIHRvIGlsbHVzdHJhdGUgYnVncy5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFRoaXMgb3B0aW9uIGlzIG9ubHkgc3VwcG9ydGVkIHNpbmNlIEFQSSBsZXZlbCAyNyAoQW5kcm9pZCBQKS5cbiAqIEBwcm9wZXJ0eSB7P3N0cmluZ3xudW1iZXJ9IHRpbWVMaW1pdCAtIFRoZSBtYXhpbXVtIHJlY29yZGluZyB0aW1lLCBpbiBzZWNvbmRzLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgVGhlIGRlZmF1bHQgKGFuZCBtYXhpbXVtKSB2YWx1ZSBpcyAxODAgKDMgbWludXRlcykuXG4gKiBAcHJvcGVydHkgez9zdHJpbmd8bnVtYmVyfSBiaXRSYXRlIC0gVGhlIHZpZGVvIGJpdCByYXRlIGZvciB0aGUgdmlkZW8sIGluIG1lZ2FiaXRzIHBlciBzZWNvbmQuXG4gKiAgICAgICAgICAgICAgICBUaGUgZGVmYXVsdCB2YWx1ZSBpcyA0LiBZb3UgY2FuIGluY3JlYXNlIHRoZSBiaXQgcmF0ZSB0byBpbXByb3ZlIHZpZGVvIHF1YWxpdHksXG4gKiAgICAgICAgICAgICAgICBidXQgZG9pbmcgc28gcmVzdWx0cyBpbiBsYXJnZXIgbW92aWUgZmlsZXMuXG4gKi9cblxuLyoqXG4gKiBJbml0aWF0ZSBzY3JlZW5yZWNvcmQgdXRpbGl0eSBvbiB0aGUgZGV2aWNlXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGRlc3RpbmF0aW9uIC0gRnVsbCBwYXRoIHRvIHRoZSB3cml0YWJsZSBtZWRpYSBmaWxlIGRlc3RpbmF0aW9uXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbiB0aGUgZGV2aWNlIGZpbGUgc3lzdGVtLlxuICogQHBhcmFtIHs/U2NyZWVucmVjb3JkT3B0aW9uc30gb3B0aW9ucyBbe31dXG4gKiBAcmV0dXJucyB7U3ViUHJvY2Vzc30gc2NyZWVucmVjb3JkIHByb2Nlc3MsIHdoaWNoIGNhbiBiZSB0aGVuIGNvbnRyb2xsZWQgYnkgdGhlIGNsaWVudCBjb2RlXG4gKi9cbm1ldGhvZHMuc2NyZWVucmVjb3JkID0gZnVuY3Rpb24gc2NyZWVucmVjb3JkIChkZXN0aW5hdGlvbiwgb3B0aW9ucyA9IHt9KSB7XG4gIGNvbnN0IGNtZCA9IFsnc2NyZWVucmVjb3JkJ107XG4gIGNvbnN0IHtcbiAgICB2aWRlb1NpemUsXG4gICAgYml0UmF0ZSxcbiAgICB0aW1lTGltaXQsXG4gICAgYnVnUmVwb3J0LFxuICB9ID0gb3B0aW9ucztcbiAgaWYgKHV0aWwuaGFzVmFsdWUodmlkZW9TaXplKSkge1xuICAgIGNtZC5wdXNoKCctLXNpemUnLCB2aWRlb1NpemUpO1xuICB9XG4gIGlmICh1dGlsLmhhc1ZhbHVlKHRpbWVMaW1pdCkpIHtcbiAgICBjbWQucHVzaCgnLS10aW1lLWxpbWl0JywgdGltZUxpbWl0KTtcbiAgfVxuICBpZiAodXRpbC5oYXNWYWx1ZShiaXRSYXRlKSkge1xuICAgIGNtZC5wdXNoKCctLWJpdC1yYXRlJywgYml0UmF0ZSk7XG4gIH1cbiAgaWYgKGJ1Z1JlcG9ydCkge1xuICAgIGNtZC5wdXNoKCctLWJ1Z3JlcG9ydCcpO1xuICB9XG4gIGNtZC5wdXNoKGRlc3RpbmF0aW9uKTtcblxuICBjb25zdCBmdWxsQ21kID0gW1xuICAgIC4uLnRoaXMuZXhlY3V0YWJsZS5kZWZhdWx0QXJncyxcbiAgICAnc2hlbGwnLFxuICAgIC4uLmNtZFxuICBdO1xuICBsb2cuZGVidWcoYEJ1aWxkaW5nIHNjcmVlbnJlY29yZCBwcm9jZXNzIHdpdGggdGhlIGNvbW1hbmQgbGluZTogYWRiICR7cXVvdGUoZnVsbENtZCl9YCk7XG4gIHJldHVybiBuZXcgU3ViUHJvY2Vzcyh0aGlzLmV4ZWN1dGFibGUucGF0aCwgZnVsbENtZCk7XG59O1xuXG4vKipcbiAqIFBlcmZvcm1zIHRoZSBnaXZlbiBlZGl0b3IgYWN0aW9uIG9uIHRoZSBmb2N1c2VkIGlucHV0IGZpZWxkLlxuICogVGhpcyBtZXRob2QgcmVxdWlyZXMgQXBwaXVtIFNldHRpbmdzIGhlbHBlciB0byBiZSBpbnN0YWxsZWQgb24gdGhlIGRldmljZS5cbiAqIE5vIGV4Y2VwdGlvbiBpcyB0aHJvd24gaWYgdGhlcmUgd2FzIGEgZmFpbHVyZSB3aGlsZSBwZXJmb3JtaW5nIHRoZSBhY3Rpb24uXG4gKiBZb3UgbXVzdCBpbnZlc3RpZ2F0ZSB0aGUgbG9nY2F0IG91dHB1dCBpZiBzb21ldGhpbmcgZGlkIG5vdCB3b3JrIGFzIGV4cGVjdGVkLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfG51bWJlcn0gYWN0aW9uIC0gRWl0aGVyIGFjdGlvbiBjb2RlIG9yIG5hbWUuIFRoZSBmb2xsb3dpbmcgYWN0aW9uXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWVzIGFyZSBzdXBwb3J0ZWQ6IGBub3JtYWwsIHVuc3BlY2lmaWVkLCBub25lLFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBnbywgc2VhcmNoLCBzZW5kLCBuZXh0LCBkb25lLCBwcmV2aW91c2BcbiAqL1xubWV0aG9kcy5wZXJmb3JtRWRpdG9yQWN0aW9uID0gYXN5bmMgZnVuY3Rpb24gcGVyZm9ybUVkaXRvckFjdGlvbiAoYWN0aW9uKSB7XG4gIGxvZy5kZWJ1ZyhgUGVyZm9ybWluZyBlZGl0b3IgYWN0aW9uOiAke2FjdGlvbn1gKTtcbiAgY29uc3QgZGVmYXVsdElNRSA9IGF3YWl0IHRoaXMuZGVmYXVsdElNRSgpO1xuICBhd2FpdCB0aGlzLmVuYWJsZUlNRShBUFBJVU1fSU1FKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCB0aGlzLnNldElNRShBUFBJVU1fSU1FKTtcbiAgICBhd2FpdCB0aGlzLnNoZWxsKFsnaW5wdXQnLCAndGV4dCcsIGAvJHthY3Rpb259L2BdKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCB0aGlzLnNldElNRShkZWZhdWx0SU1FKTtcbiAgfVxufTtcblxuLyoqXG4gKiBHZXQgdHogZGF0YWJhc2UgdGltZSB6b25lIGZvcm1hdHRlZCB0aW1lem9uZVxuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9IFRaIGRhdGFiYXNlIFRpbWUgWm9uZXMgZm9ybWF0XG4gKlxuICogQHRocm93cyB7ZXJyb3J9IElmIGFueSBleGNlcHRpb24gaXMgcmVwb3J0ZWQgYnkgYWRiIHNoZWxsLlxuICovXG5tZXRob2RzLmdldFRpbWVab25lID0gYXN5bmMgZnVuY3Rpb24gZ2V0VGltZVpvbmUgKCkge1xuICBsb2cuZGVidWcoJ0dldHRpbmcgY3VycmVudCB0aW1lem9uZScpO1xuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmdldERldmljZVByb3BlcnR5KCdwZXJzaXN0LnN5cy50aW1lem9uZScpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBnZXR0aW5nIHRpbWV6b25lLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IG1ldGhvZHM7XG4iXSwiZmlsZSI6ImxpYi90b29scy9hZGItY29tbWFuZHMuanMiLCJzb3VyY2VSb290IjoiLi4vLi4vLi4ifQ==
